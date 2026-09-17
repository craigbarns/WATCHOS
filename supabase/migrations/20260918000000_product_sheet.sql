-- =====================================================================
-- PHASE 3 : FICHE PRODUIT
--
--  * adjust_product_stock : réassort / ajustement / inventaire d'un accessoire,
--    atomique (verrou de ligne) et toujours tracé dans stock_movements
--  * set_serialized_status : réserver, envoyer en SAV, archiver, remettre en
--    vente une montre, tracé dans stock_movements
--  * Garde-fous : le stock et le statut ne peuvent plus être modifiés
--    directement depuis l'API (uniquement via ces fonctions ou une vente),
--    et une montre vendue est verrouillée.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. GARDE-FOUS
-- ---------------------------------------------------------------------

-- Dans une fonction SECURITY DEFINER, current_user est le propriétaire de la
-- fonction ; depuis l'API REST il vaut 'authenticated' ou 'anon'.
CREATE OR REPLACE FUNCTION guard_serialized_item_update() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.status = 'SOLD' AND (
        NEW.status IS DISTINCT FROM OLD.status
        OR NEW.serial_number IS DISTINCT FROM OLD.serial_number
        OR NEW.product_id IS DISTINCT FROM OLD.product_id
    ) THEN
        RAISE EXCEPTION 'Montre vendue : statut et numéro de série verrouillés.';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status AND current_user IN ('authenticated', 'anon') THEN
        RAISE EXCEPTION 'Le statut d''une montre se modifie uniquement depuis sa fiche.';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_serialized_item_update ON serialized_items;
CREATE TRIGGER guard_serialized_item_update
BEFORE UPDATE ON serialized_items
FOR EACH ROW EXECUTE FUNCTION guard_serialized_item_update();

CREATE OR REPLACE FUNCTION guard_product_update() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.stock_quantity IS DISTINCT FROM OLD.stock_quantity AND current_user IN ('authenticated', 'anon') THEN
        RAISE EXCEPTION 'Le stock se modifie uniquement par un mouvement de stock tracé.';
    END IF;
    IF NEW.type IS DISTINCT FROM OLD.type THEN
        RAISE EXCEPTION 'Le type d''un article ne peut pas être changé.';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_product_update ON products;
CREATE TRIGGER guard_product_update
BEFORE UPDATE ON products
FOR EACH ROW EXECUTE FUNCTION guard_product_update();

CREATE INDEX IF NOT EXISTS idx_stock_movements_item ON stock_movements(serialized_item_id);
CREATE INDEX IF NOT EXISTS idx_sale_lines_item ON sale_lines(serialized_item_id);
CREATE INDEX IF NOT EXISTS idx_sale_lines_product ON sale_lines(product_id);
CREATE INDEX IF NOT EXISTS idx_sav_cases_serial ON sav_cases(serial_number);

-- ---------------------------------------------------------------------
-- 2. STOCK DES ACCESSOIRES
--    PURCHASE / RETURN : p_quantity > 0 ajouté au stock
--    ADJUSTMENT        : p_quantity signé (casse, perte, correction)
--    INVENTORY         : p_quantity = quantité comptée (écart calculé ici)
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION adjust_product_stock(
    p_product_id UUID,
    p_movement_type TEXT,
    p_quantity INT,
    p_reason TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_product products%ROWTYPE;
    v_delta INT;
    v_new INT;
BEGIN
    IF COALESCE(app_role(), '') NOT IN ('ADMIN', 'VENDEUR') THEN
        RAISE EXCEPTION 'Accès refusé.';
    END IF;
    IF length(trim(COALESCE(p_reason, ''))) = 0 THEN
        RAISE EXCEPTION 'Le motif est obligatoire.';
    END IF;

    SELECT * INTO v_product FROM products WHERE id = p_product_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Article introuvable.';
    END IF;
    IF v_product.type <> 'NON_SERIALIZED' THEN
        RAISE EXCEPTION 'Les montres sont suivies à l''unité : utilisez leur statut.';
    END IF;

    CASE p_movement_type
        WHEN 'PURCHASE', 'RETURN' THEN
            IF p_quantity IS NULL OR p_quantity <= 0 THEN
                RAISE EXCEPTION 'La quantité doit être positive.';
            END IF;
            v_delta := p_quantity;
        WHEN 'ADJUSTMENT' THEN
            IF p_quantity IS NULL OR p_quantity = 0 THEN
                RAISE EXCEPTION 'La correction ne peut pas être nulle.';
            END IF;
            v_delta := p_quantity;
        WHEN 'INVENTORY' THEN
            IF p_quantity IS NULL OR p_quantity < 0 THEN
                RAISE EXCEPTION 'La quantité comptée est invalide.';
            END IF;
            v_delta := p_quantity - v_product.stock_quantity;
        ELSE
            RAISE EXCEPTION 'Type de mouvement invalide.';
    END CASE;

    v_new := v_product.stock_quantity + v_delta;
    IF v_new < 0 THEN
        RAISE EXCEPTION 'Stock insuffisant : % en stock.', v_product.stock_quantity;
    END IF;
    IF v_new > 1000000 THEN
        RAISE EXCEPTION 'Quantité trop élevée.';
    END IF;

    UPDATE products SET stock_quantity = v_new, updated_at = NOW() WHERE id = p_product_id;

    INSERT INTO stock_movements (product_id, movement_type, quantity, user_id, reason)
    VALUES (
        p_product_id, p_movement_type, v_delta, auth.uid(),
        CASE WHEN p_movement_type = 'INVENTORY'
            THEN format('Inventaire : %s compté(s) (%s en système) · %s', p_quantity, v_product.stock_quantity, trim(p_reason))
            ELSE trim(p_reason)
        END
    );

    RETURN jsonb_build_object('success', true, 'stock_quantity', v_new, 'delta', v_delta);
END;
$$;

-- ---------------------------------------------------------------------
-- 3. STATUT D'UNE MONTRE
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION set_serialized_status(
    p_item_id UUID,
    p_status TEXT,
    p_reason TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_item serialized_items%ROWTYPE;
    v_in_stock_before INT;
    v_in_stock_after INT;
    v_type TEXT;
    v_labels JSONB := '{"AVAILABLE":"Disponible","RESERVED":"Réservée","IN_SAV":"En SAV","ARCHIVED":"Archivée","SOLD":"Vendue","RETURNED":"Retournée"}';
BEGIN
    IF COALESCE(app_role(), '') NOT IN ('ADMIN', 'VENDEUR') THEN
        RAISE EXCEPTION 'Accès refusé.';
    END IF;
    IF p_status NOT IN ('AVAILABLE', 'RESERVED', 'IN_SAV', 'ARCHIVED') THEN
        RAISE EXCEPTION 'Ce statut ne peut pas être appliqué manuellement.';
    END IF;

    SELECT * INTO v_item FROM serialized_items WHERE id = p_item_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Montre introuvable.';
    END IF;
    IF v_item.status = 'SOLD' THEN
        RAISE EXCEPTION 'Montre vendue : son statut est verrouillé.';
    END IF;
    IF v_item.status = p_status THEN
        RAISE EXCEPTION 'La montre est déjà « % ».', v_labels->>p_status;
    END IF;
    IF p_status IN ('RESERVED', 'ARCHIVED') AND length(trim(COALESCE(p_reason, ''))) = 0 THEN
        RAISE EXCEPTION 'Précisez le motif (client, raison de l''archivage…).';
    END IF;

    -- Présence physique en boutique : disponible ou réservée
    v_in_stock_before := CASE WHEN v_item.status IN ('AVAILABLE', 'RESERVED', 'RETURNED') THEN 1 ELSE 0 END;
    v_in_stock_after := CASE WHEN p_status IN ('AVAILABLE', 'RESERVED') THEN 1 ELSE 0 END;
    v_type := CASE
        WHEN p_status = 'IN_SAV' THEN 'SAV_OUT'
        WHEN v_item.status = 'IN_SAV' THEN 'SAV_IN'
        ELSE 'ADJUSTMENT'
    END;

    UPDATE serialized_items SET status = p_status, updated_at = NOW() WHERE id = p_item_id;

    INSERT INTO stock_movements (product_id, serialized_item_id, movement_type, quantity, user_id, reason)
    VALUES (
        v_item.product_id, v_item.id, v_type, v_in_stock_after - v_in_stock_before, auth.uid(),
        format('%s → %s', v_labels->>v_item.status, v_labels->>p_status)
            || CASE WHEN length(trim(COALESCE(p_reason, ''))) > 0 THEN ' · ' || trim(p_reason) ELSE '' END
    );

    RETURN jsonb_build_object('success', true, 'status', p_status);
END;
$$;

REVOKE ALL ON FUNCTION adjust_product_stock(UUID, TEXT, INT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION adjust_product_stock(UUID, TEXT, INT, TEXT) TO authenticated;
REVOKE ALL ON FUNCTION set_serialized_status(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION set_serialized_status(UUID, TEXT, TEXT) TO authenticated;
