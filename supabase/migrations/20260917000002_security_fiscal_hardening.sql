-- =====================================================================
-- PHASE 2 : SÉCURITÉ + FIABILISATION DU NOYAU FISCAL
--
-- Corrige :
--  * finalize_sale échouait systématiquement (UPDATE sur une vente
--    FINALIZED et sur fiscal_events, tous deux bloqués par triggers)
--  * prix / TVA envoyés par le navigateur (falsifiables)
--  * RPC exécutable par n'importe qui (anon) avec un p_user_id arbitraire
--  * chaîne fiscale forkable en cas de ventes simultanées
--  * numérotation non continue (SERIAL a des trous, ticket aléatoire)
--  * format de montant PG ≠ JS pour les montants < 1 € (".50" vs "0.50")
--  * idempotency key ignorée (double encaissement possible)
--  * aucune RLS : toutes les données lisibles/modifiables avec la clé anon
--  * tout nouvel inscrit devenait ADMIN
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ---------------------------------------------------------------------
-- 1. SCHÉMA
-- ---------------------------------------------------------------------

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT FALSE;
-- Les profils existants (créés avant cette migration) restent utilisables.
UPDATE profiles SET active = TRUE;

ALTER TABLE products ADD COLUMN IF NOT EXISTS stock_quantity INTEGER NOT NULL DEFAULT 0;

ALTER TABLE sales ADD COLUMN IF NOT EXISTS idempotency_key TEXT UNIQUE;
ALTER TABLE sale_lines ADD COLUMN IF NOT EXISTS total_ht NUMERIC(12, 2);

-- Compteurs continus (sans trou) protégés par verrou de ligne
CREATE TABLE IF NOT EXISTS fiscal_counters (
    name TEXT PRIMARY KEY,
    value BIGINT NOT NULL DEFAULT 0
);
INSERT INTO fiscal_counters (name, value) VALUES
    ('RECEIPT', (SELECT COUNT(*) FROM sales WHERE status = 'FINALIZED')),
    ('FISCAL_EVENT', COALESCE((SELECT MAX(sequence_number) FROM fiscal_events), 0)),
    ('CLOSURE', COALESCE((SELECT MAX(sequence_number) FROM fiscal_closures), 0)),
    ('SAV', (SELECT COUNT(*) FROM sav_cases))
ON CONFLICT (name) DO NOTHING;

CREATE UNIQUE INDEX IF NOT EXISTS idx_fiscal_closures_sequence ON fiscal_closures(sequence_number);
CREATE UNIQUE INDEX IF NOT EXISTS idx_fiscal_closures_period ON fiscal_closures(closure_type, period_start);

-- Lignes et paiements d'une vente : jamais modifiables après insertion
DROP TRIGGER IF EXISTS prevent_sale_lines_mod ON sale_lines;
CREATE TRIGGER prevent_sale_lines_mod
BEFORE UPDATE OR DELETE ON sale_lines
FOR EACH ROW EXECUTE FUNCTION prevent_modification();

DROP TRIGGER IF EXISTS prevent_payments_mod ON payments;
CREATE TRIGGER prevent_payments_mod
BEFORE UPDATE OR DELETE ON payments
FOR EACH ROW EXECUTE FUNCTION prevent_modification();

-- ---------------------------------------------------------------------
-- 2. PROFILS : création automatique, jamais ADMIN par défaut
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION handle_new_user() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_is_first BOOLEAN;
BEGIN
    SELECT NOT EXISTS (SELECT 1 FROM profiles) INTO v_is_first;
    INSERT INTO profiles (id, full_name, role, active)
    VALUES (
        NEW.id,
        split_part(NEW.email, '@', 1),
        CASE WHEN v_is_first THEN 'ADMIN' ELSE 'VENDEUR' END,
        v_is_first -- seul le tout premier compte est actif d'office
    )
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Rôle de l'utilisateur courant (NULL si inconnu ou non validé)
CREATE OR REPLACE FUNCTION app_role() RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT role FROM profiles WHERE id = auth.uid() AND active
$$;

-- ---------------------------------------------------------------------
-- 3. ROW LEVEL SECURITY
-- ---------------------------------------------------------------------

DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'profiles', 'settings', 'customers', 'products', 'serialized_items',
        'stock_movements', 'sales', 'sale_lines', 'payments', 'fiscal_events',
        'fiscal_closures', 'sav_cases', 'sav_events', 'sav_photos', 'fiscal_counters'
    ] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('DROP POLICY IF EXISTS staff_read ON %I', t);
        EXECUTE format('DROP POLICY IF EXISTS staff_insert ON %I', t);
        EXECUTE format('DROP POLICY IF EXISTS staff_update ON %I', t);
        EXECUTE format('DROP POLICY IF EXISTS admin_write ON %I', t);
    END LOOP;
END $$;

-- Lecture : tout membre actif du personnel
DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'settings', 'customers', 'products', 'serialized_items', 'stock_movements',
        'sales', 'sale_lines', 'payments', 'fiscal_events', 'fiscal_closures',
        'sav_cases', 'sav_events', 'sav_photos'
    ] LOOP
        EXECUTE format('CREATE POLICY staff_read ON %I FOR SELECT TO authenticated USING (app_role() IS NOT NULL)', t);
    END LOOP;
END $$;

-- Profils : chacun voit le sien (même inactif), le personnel voit les noms, l'admin gère
CREATE POLICY staff_read ON profiles FOR SELECT TO authenticated
    USING (id = auth.uid() OR app_role() IS NOT NULL);
CREATE POLICY admin_write ON profiles FOR UPDATE TO authenticated
    USING (app_role() = 'ADMIN') WITH CHECK (app_role() = 'ADMIN');

-- Paramètres boutique : admin uniquement
CREATE POLICY admin_write ON settings FOR ALL TO authenticated
    USING (app_role() = 'ADMIN') WITH CHECK (app_role() = 'ADMIN');

-- Clients & SAV : tout le personnel
CREATE POLICY staff_insert ON customers FOR INSERT TO authenticated WITH CHECK (app_role() IS NOT NULL);
CREATE POLICY staff_update ON customers FOR UPDATE TO authenticated USING (app_role() IS NOT NULL);
CREATE POLICY staff_insert ON sav_cases FOR INSERT TO authenticated WITH CHECK (app_role() IS NOT NULL);
CREATE POLICY staff_update ON sav_cases FOR UPDATE TO authenticated USING (app_role() IS NOT NULL);
CREATE POLICY staff_insert ON sav_events FOR INSERT TO authenticated WITH CHECK (app_role() IS NOT NULL AND user_id = auth.uid());
CREATE POLICY staff_insert ON sav_photos FOR INSERT TO authenticated WITH CHECK (app_role() IS NOT NULL);

-- Catalogue : admin & vendeurs
CREATE POLICY staff_insert ON products FOR INSERT TO authenticated WITH CHECK (app_role() IN ('ADMIN', 'VENDEUR'));
CREATE POLICY staff_update ON products FOR UPDATE TO authenticated USING (app_role() IN ('ADMIN', 'VENDEUR'));
CREATE POLICY staff_insert ON serialized_items FOR INSERT TO authenticated WITH CHECK (app_role() IN ('ADMIN', 'VENDEUR'));
CREATE POLICY staff_update ON serialized_items FOR UPDATE TO authenticated USING (app_role() IN ('ADMIN', 'VENDEUR'));
CREATE POLICY staff_insert ON stock_movements FOR INSERT TO authenticated
    WITH CHECK (app_role() IN ('ADMIN', 'VENDEUR') AND user_id = auth.uid());

-- sales / sale_lines / payments / fiscal_* / fiscal_counters :
-- aucune écriture directe, uniquement via les RPC SECURITY DEFINER ci-dessous.

-- ---------------------------------------------------------------------
-- 4. FORMAT CANONIQUE (doit rester identique à src/lib/fiscal/core.ts)
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fiscal_amount(p NUMERIC) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
    SELECT to_char(round(p, 2), 'FM999999999990.00')
$$;

-- ---------------------------------------------------------------------
-- 5. RPC finalize_sale
-- ---------------------------------------------------------------------

DROP FUNCTION IF EXISTS finalize_sale(UUID, UUID, JSONB, JSONB, TEXT);

CREATE OR REPLACE FUNCTION finalize_sale(
    p_customer_id UUID,
    p_lines JSONB,
    p_payments JSONB,
    p_idempotency_key TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_now TIMESTAMPTZ := NOW();
    v_existing sales%ROWTYPE;
    v_sale_id UUID;
    v_receipt_seq BIGINT;
    v_receipt_number TEXT;
    v_line JSONB;
    v_payment JSONB;
    v_product products%ROWTYPE;
    v_item serialized_items%ROWTYPE;
    v_qty INT;
    v_discount NUMERIC(12, 2);
    v_line_gross NUMERIC(12, 2);
    v_line_ttc NUMERIC(12, 2);
    v_line_ht NUMERIC(12, 2);
    v_prepared JSONB := '[]'::JSONB;
    v_total_ttc NUMERIC(12, 2) := 0;
    v_total_ht NUMERIC(12, 2) := 0;
    v_total_vat NUMERIC(12, 2);
    v_total_paid NUMERIC(12, 2) := 0;
    v_seen_items UUID[] := '{}';
    v_sequence BIGINT;
    v_prev_hash TEXT;
    v_hash TEXT;
    v_occurred_at TEXT;
    v_payload JSONB;
    v_versions settings%ROWTYPE;
BEGIN
    IF app_role() IS NULL THEN
        RAISE EXCEPTION 'Accès refusé : compte inactif ou non authentifié.';
    END IF;
    IF p_idempotency_key IS NULL OR length(p_idempotency_key) < 8 THEN
        RAISE EXCEPTION 'Clé d''idempotence manquante.';
    END IF;
    -- Toutes les écritures fiscales sont sérialisées par ce verrou
    PERFORM value FROM fiscal_counters WHERE name = 'FISCAL_EVENT' FOR UPDATE;

    -- Idempotence : un double clic renvoie la vente déjà créée
    SELECT * INTO v_existing FROM sales WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN
        RETURN jsonb_build_object(
            'success', true, 'sale_id', v_existing.id,
            'receipt_number', v_existing.receipt_number, 'replayed', true
        );
    END IF;

    IF jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
        RAISE EXCEPTION 'Le panier est vide.';
    END IF;

    -- 1. Validation des lignes avec les prix de la BASE (jamais ceux du client)
    FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
    LOOP
        SELECT * INTO v_product FROM products WHERE id = (v_line->>'product_id')::UUID FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Produit introuvable.';
        END IF;

        v_qty := COALESCE((v_line->>'quantity')::INT, 1);
        IF v_qty < 1 THEN
            RAISE EXCEPTION 'Quantité invalide pour %.', v_product.model;
        END IF;

        IF v_product.type = 'SERIALIZED' THEN
            IF v_qty <> 1 OR NULLIF(v_line->>'serialized_item_id', '') IS NULL THEN
                RAISE EXCEPTION 'La montre % doit être vendue à l''unité avec son numéro de série.', v_product.model;
            END IF;
            SELECT * INTO v_item FROM serialized_items
            WHERE id = (v_line->>'serialized_item_id')::UUID AND product_id = v_product.id
            FOR UPDATE;
            IF NOT FOUND OR v_item.status <> 'AVAILABLE' OR v_item.id = ANY(v_seen_items) THEN
                RAISE EXCEPTION 'Montre indisponible ou déjà vendue (%).', COALESCE(v_item.serial_number, v_product.model);
            END IF;
            v_seen_items := v_seen_items || v_item.id;
        ELSE
            IF v_product.stock_quantity < v_qty THEN
                RAISE EXCEPTION 'Stock insuffisant pour % (disponible : %).', v_product.model, v_product.stock_quantity;
            END IF;
            -- décrémenté immédiatement pour gérer un même produit sur plusieurs lignes
            UPDATE products SET stock_quantity = stock_quantity - v_qty, updated_at = v_now WHERE id = v_product.id;
        END IF;

        v_line_gross := v_product.selling_price_ttc * v_qty;
        v_discount := round(COALESCE((v_line->>'discount_amount')::NUMERIC, 0), 2);
        IF v_discount < 0 OR v_discount > v_line_gross THEN
            RAISE EXCEPTION 'Remise invalide sur %.', v_product.model;
        END IF;
        v_line_ttc := v_line_gross - v_discount;
        v_line_ht := round(v_line_ttc / (1 + v_product.vat_rate / 100), 2);

        v_total_ttc := v_total_ttc + v_line_ttc;
        v_total_ht := v_total_ht + v_line_ht;

        v_prepared := v_prepared || jsonb_build_object(
            'product_id', v_product.id,
            'serialized_item_id', CASE WHEN v_product.type = 'SERIALIZED' THEN v_item.id END,
            'label', trim(concat_ws(' ', v_product.brand, v_product.model, v_product.reference)),
            'quantity', v_qty,
            'unit_price_ttc', v_product.selling_price_ttc,
            'unit_price_ht', round(v_product.selling_price_ttc / (1 + v_product.vat_rate / 100), 2),
            'vat_rate', v_product.vat_rate,
            'discount_amount', v_discount,
            'total_ttc', v_line_ttc,
            'total_ht', v_line_ht
        );
    END LOOP;
    v_total_vat := v_total_ttc - v_total_ht;

    -- 2. Validation des paiements
    IF jsonb_typeof(p_payments) <> 'array' OR jsonb_array_length(p_payments) = 0 THEN
        RAISE EXCEPTION 'Aucun paiement.';
    END IF;
    FOR v_payment IN SELECT * FROM jsonb_array_elements(p_payments)
    LOOP
        IF (v_payment->>'amount')::NUMERIC <= 0 THEN
            RAISE EXCEPTION 'Montant de paiement invalide.';
        END IF;
        v_total_paid := v_total_paid + round((v_payment->>'amount')::NUMERIC, 2);
    END LOOP;
    IF v_total_paid <> v_total_ttc THEN
        RAISE EXCEPTION 'Paiements (% €) différents du total (% €).', v_total_paid, v_total_ttc;
    END IF;

    -- 3. Numéro de ticket continu
    UPDATE fiscal_counters SET value = value + 1 WHERE name = 'RECEIPT' RETURNING value INTO v_receipt_seq;
    v_receipt_number := 'T' || to_char(v_now AT TIME ZONE 'Europe/Paris', 'YYYY') || '-' || lpad(v_receipt_seq::TEXT, 6, '0');

    INSERT INTO sales (status, receipt_number, customer_id, user_id, total_ht, total_vat, total_ttc, finalized_at, idempotency_key)
    VALUES ('FINALIZED', v_receipt_number, p_customer_id, v_user_id, v_total_ht, v_total_vat, v_total_ttc, v_now, p_idempotency_key)
    RETURNING id INTO v_sale_id;

    FOR v_line IN SELECT * FROM jsonb_array_elements(v_prepared)
    LOOP
        INSERT INTO sale_lines (sale_id, product_id, serialized_item_id, label, quantity, unit_price_ht, unit_price_ttc,
                                vat_rate, discount_amount, total_ttc, total_ht)
        VALUES (v_sale_id, (v_line->>'product_id')::UUID, NULLIF(v_line->>'serialized_item_id', '')::UUID,
                v_line->>'label', (v_line->>'quantity')::INT, (v_line->>'unit_price_ht')::NUMERIC,
                (v_line->>'unit_price_ttc')::NUMERIC, (v_line->>'vat_rate')::NUMERIC,
                (v_line->>'discount_amount')::NUMERIC, (v_line->>'total_ttc')::NUMERIC, (v_line->>'total_ht')::NUMERIC);

        IF NULLIF(v_line->>'serialized_item_id', '') IS NOT NULL THEN
            UPDATE serialized_items SET status = 'SOLD', updated_at = v_now
            WHERE id = (v_line->>'serialized_item_id')::UUID;
        END IF;

        INSERT INTO stock_movements (product_id, serialized_item_id, movement_type, quantity, user_id, reason, reference_id)
        VALUES ((v_line->>'product_id')::UUID, NULLIF(v_line->>'serialized_item_id', '')::UUID, 'SALE',
                -(v_line->>'quantity')::INT, v_user_id, 'Vente ' || v_receipt_number, v_sale_id);
    END LOOP;

    FOR v_payment IN SELECT * FROM jsonb_array_elements(p_payments)
    LOOP
        INSERT INTO payments (sale_id, method, amount)
        VALUES (v_sale_id, v_payment->>'method', round((v_payment->>'amount')::NUMERIC, 2));
    END LOOP;

    -- 4. Événement fiscal chaîné (hash calculé AVANT insertion : table append-only)
    UPDATE fiscal_counters SET value = value + 1 WHERE name = 'FISCAL_EVENT' RETURNING value INTO v_sequence;
    SELECT current_hash INTO v_prev_hash FROM fiscal_events ORDER BY sequence_number DESC LIMIT 1;
    v_prev_hash := COALESCE(v_prev_hash, 'GENESIS');
    v_occurred_at := to_char(v_now AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');

    v_payload := jsonb_build_object(
        'entity_id', v_sale_id,
        'event_type', 'SALE',
        'operator_id', v_user_id,
        'occurred_at', v_occurred_at,
        'amount_ht', v_total_ht,
        'vat_amount', v_total_vat,
        'amount_ttc', v_total_ttc
    );

    v_hash := encode(digest(
        v_prev_hash || '||' ||
        'amount_ht:' || fiscal_amount(v_total_ht) ||
        '|amount_ttc:' || fiscal_amount(v_total_ttc) ||
        '|entity_id:' || v_sale_id ||
        '|event_type:SALE' ||
        '|occurred_at:' || v_occurred_at ||
        '|operator_id:' || v_user_id ||
        '|sequence_number:' || v_sequence ||
        '|vat_amount:' || fiscal_amount(v_total_vat),
        'sha256'), 'hex');

    SELECT * INTO v_versions FROM settings LIMIT 1;

    INSERT INTO fiscal_events (sequence_number, event_type, entity_id, operator_id, occurred_at, amount_ht, vat_amount,
                               amount_ttc, canonical_payload, previous_hash, current_hash, app_version, fiscal_core_version)
    VALUES (v_sequence, 'SALE', v_sale_id, v_user_id, v_now, v_total_ht, v_total_vat, v_total_ttc, v_payload,
            v_prev_hash, v_hash, COALESCE(v_versions.app_version, '1.0.0'), COALESCE(v_versions.fiscal_core_version, '1.0.0'));

    RETURN jsonb_build_object(
        'success', true,
        'sale_id', v_sale_id,
        'receipt_number', v_receipt_number,
        'hash', v_hash,
        'total_ttc', v_total_ttc
    );
END;
$$;

-- ---------------------------------------------------------------------
-- 6. RPC close_day : clôture journalière (Z) chaînée
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION close_day(p_day DATE) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_start TIMESTAMPTZ := (p_day::TIMESTAMP) AT TIME ZONE 'Europe/Paris';
    v_end TIMESTAMPTZ := ((p_day + 1)::TIMESTAMP) AT TIME ZONE 'Europe/Paris';
    v_count INT;
    v_ht NUMERIC(15, 2);
    v_vat NUMERIC(15, 2);
    v_ttc NUMERIC(15, 2);
    v_perpetual NUMERIC(15, 2);
    v_sequence BIGINT;
    v_prev_hash TEXT;
    v_hash TEXT;
    v_versions settings%ROWTYPE;
BEGIN
    IF COALESCE(app_role(), '') NOT IN ('ADMIN', 'VENDEUR') THEN
        RAISE EXCEPTION 'Accès refusé.';
    END IF;
    IF v_end > NOW() THEN
        RAISE EXCEPTION 'La journée du % n''est pas terminée.', to_char(p_day, 'DD/MM/YYYY');
    END IF;

    PERFORM value FROM fiscal_counters WHERE name = 'CLOSURE' FOR UPDATE;

    IF EXISTS (SELECT 1 FROM fiscal_closures WHERE closure_type = 'DAILY' AND period_start = v_start) THEN
        RAISE EXCEPTION 'La journée du % est déjà clôturée.', to_char(p_day, 'DD/MM/YYYY');
    END IF;

    SELECT COUNT(*), COALESCE(SUM(amount_ht), 0), COALESCE(SUM(vat_amount), 0), COALESCE(SUM(amount_ttc), 0)
    INTO v_count, v_ht, v_vat, v_ttc
    FROM fiscal_events WHERE occurred_at >= v_start AND occurred_at < v_end;

    SELECT COALESCE(
        (SELECT perpetual_total FROM fiscal_closures WHERE closure_type = 'DAILY' ORDER BY sequence_number DESC LIMIT 1), 0
    ) + v_ttc INTO v_perpetual;

    UPDATE fiscal_counters SET value = value + 1 WHERE name = 'CLOSURE' RETURNING value INTO v_sequence;
    SELECT current_hash INTO v_prev_hash FROM fiscal_closures ORDER BY sequence_number DESC LIMIT 1;
    v_prev_hash := COALESCE(v_prev_hash, 'GENESIS');

    v_hash := encode(digest(
        v_prev_hash || '||' ||
        'closure_type:DAILY' ||
        '|operations_count:' || v_count ||
        '|perpetual_total:' || fiscal_amount(v_perpetual) ||
        '|period_end:' || to_char(v_end AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') ||
        '|period_start:' || to_char(v_start AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') ||
        '|sequence_number:' || v_sequence ||
        '|total_ht:' || fiscal_amount(v_ht) ||
        '|total_ttc:' || fiscal_amount(v_ttc) ||
        '|total_vat:' || fiscal_amount(v_vat),
        'sha256'), 'hex');

    SELECT * INTO v_versions FROM settings LIMIT 1;

    INSERT INTO fiscal_closures (sequence_number, closure_type, period_start, period_end, operations_count, total_ht,
                                 total_vat, total_ttc, perpetual_total, previous_hash, current_hash, app_version,
                                 fiscal_core_version, created_by)
    VALUES (v_sequence, 'DAILY', v_start, v_end, v_count, v_ht, v_vat, v_ttc, v_perpetual, v_prev_hash, v_hash,
            COALESCE(v_versions.app_version, '1.0.0'), COALESCE(v_versions.fiscal_core_version, '1.0.0'), auth.uid());

    RETURN jsonb_build_object('success', true, 'sequence_number', v_sequence, 'total_ttc', v_ttc,
                              'operations_count', v_count, 'hash', v_hash);
END;
$$;

-- ---------------------------------------------------------------------
-- 7. DROITS D'EXÉCUTION
-- ---------------------------------------------------------------------

REVOKE ALL ON FUNCTION finalize_sale(UUID, JSONB, JSONB, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION finalize_sale(UUID, JSONB, JSONB, TEXT) TO authenticated;
REVOKE ALL ON FUNCTION close_day(DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION close_day(DATE) TO authenticated;
REVOKE ALL ON FUNCTION handle_new_user() FROM PUBLIC, anon, authenticated;
