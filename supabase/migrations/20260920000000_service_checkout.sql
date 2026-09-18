-- Prestations à prix libre, sans gestion de stock. Historique existant conservé.
CREATE TABLE service_categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code TEXT NOT NULL UNIQUE,
    label TEXT NOT NULL,
    vat_rate NUMERIC(5, 2) NOT NULL DEFAULT 20 CHECK (vat_rate BETWEEN 0 AND 100),
    sort_order INTEGER NOT NULL,
    active BOOLEAN NOT NULL DEFAULT true
);
ALTER TABLE service_categories ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON service_categories TO authenticated;
CREATE POLICY staff_read ON service_categories FOR SELECT TO authenticated USING (app_role() IS NOT NULL);
INSERT INTO service_categories (code, label, sort_order) VALUES
    ('pile', 'Pile', 1),
    ('bracelet', 'Bracelet', 2),
    ('pile_etancheite', 'Pile plus contrôle étanchéité', 3),
    ('verre', 'Changement de verre', 4),
    ('polissage', 'Polissage', 5),
    ('bracelet_sur_mesure', 'Bracelets sur mesure', 6),
    ('mouvement_quartz', 'Échange standard de mouvement quartz', 7),
    ('revision_quartz', 'Révision montre quartz', 8),
    ('revision_automatique', 'Révision montre automatique', 9),
    ('aiguillage', 'Aiguillage', 10),
    ('intervention_partielle', 'Intervention partielle', 11);

ALTER TABLE sale_lines ALTER COLUMN product_id DROP NOT NULL;
ALTER TABLE sale_lines ADD COLUMN service_id UUID REFERENCES service_categories(id);
ALTER TABLE sale_lines ADD CONSTRAINT sale_line_source CHECK (
    (product_id IS NOT NULL AND service_id IS NULL) OR
    (product_id IS NULL AND service_id IS NOT NULL AND serialized_item_id IS NULL)
);
CREATE INDEX idx_sale_lines_service ON sale_lines(service_id, sale_id);

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
    v_service service_categories%ROWTYPE;
    v_price NUMERIC(12, 2);
    v_rate NUMERIC(5, 2);
    v_label TEXT;
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
    IF COALESCE(app_role(), '') NOT IN ('ADMIN', 'VENDEUR') THEN
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

    IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
        RAISE EXCEPTION 'Le panier est vide.';
    END IF;

    -- 1. Prestations : prix saisi par le vendeur, poste et TVA relus en base.
    -- Les anciennes ventes de produits conservent leur contrôle de stock.
    FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
    LOOP
        IF (v_line->>'quantity') IS NULL OR (v_line->>'quantity')::NUMERIC NOT BETWEEN 1 AND 999
           OR (v_line->>'quantity')::NUMERIC <> trunc((v_line->>'quantity')::NUMERIC) THEN
            RAISE EXCEPTION 'Quantité invalide.';
        END IF;
        v_qty := (v_line->>'quantity')::INT;
        v_service := NULL;
        v_product := NULL;
        v_item := NULL;
        IF NULLIF(v_line->>'service_id', '') IS NOT NULL THEN
            IF NULLIF(v_line->>'product_id', '') IS NOT NULL OR NULLIF(v_line->>'serialized_item_id', '') IS NOT NULL THEN
                RAISE EXCEPTION 'Une ligne doit désigner une prestation ou un produit.';
            END IF;
            SELECT * INTO v_service FROM service_categories WHERE id = (v_line->>'service_id')::UUID AND active FOR SHARE;
            IF NOT FOUND THEN RAISE EXCEPTION 'Poste de prestation indisponible.'; END IF;
            IF (v_line->>'unit_price_ttc') IS NULL
               OR (v_line->>'unit_price_ttc')::NUMERIC NOT BETWEEN 0.01 AND 999999.99
               OR round((v_line->>'unit_price_ttc')::NUMERIC, 2) <> (v_line->>'unit_price_ttc')::NUMERIC THEN
                RAISE EXCEPTION 'Saisissez un montant TTC positif avec deux décimales maximum.';
            END IF;
            v_price := (v_line->>'unit_price_ttc')::NUMERIC;
            v_rate := v_service.vat_rate;
            v_label := v_service.label;
        ELSE
            SELECT * INTO v_product FROM products WHERE id = (v_line->>'product_id')::UUID FOR UPDATE;
            IF NOT FOUND THEN
                RAISE EXCEPTION 'Produit introuvable.';
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

            v_price := v_product.selling_price_ttc;
            v_rate := v_product.vat_rate;
            v_label := trim(concat_ws(' ', v_product.brand, v_product.model, v_product.reference));
        END IF;

        v_line_gross := v_price * v_qty;
        v_discount := round(COALESCE((v_line->>'discount_amount')::NUMERIC, 0), 2);
        IF v_discount < 0 OR v_discount > v_line_gross THEN
            RAISE EXCEPTION 'Remise invalide sur %.', v_label;
        END IF;
        v_line_ttc := v_line_gross - v_discount;
        v_line_ht := round(v_line_ttc / (1 + v_rate / 100), 2);

        v_total_ttc := v_total_ttc + v_line_ttc;
        v_total_ht := v_total_ht + v_line_ht;

        v_prepared := v_prepared || jsonb_build_object(
            'product_id', v_product.id,
            'service_id', v_service.id,
            'serialized_item_id', CASE WHEN v_product.type = 'SERIALIZED' THEN v_item.id END,
            'label', v_label,
            'quantity', v_qty,
            'unit_price_ttc', v_price,
            'unit_price_ht', round(v_price / (1 + v_rate / 100), 2),
            'vat_rate', v_rate,
            'discount_amount', v_discount,
            'total_ttc', v_line_ttc,
            'total_ht', v_line_ht
        );
    END LOOP;
    v_total_vat := v_total_ttc - v_total_ht;

    -- 2. Validation des paiements
    IF p_payments IS NULL OR jsonb_typeof(p_payments) <> 'array' OR jsonb_array_length(p_payments) = 0 THEN
        RAISE EXCEPTION 'Aucun paiement.';
    END IF;
    FOR v_payment IN SELECT * FROM jsonb_array_elements(p_payments)
    LOOP
        IF (v_payment->>'amount') IS NULL OR (v_payment->>'amount')::NUMERIC NOT BETWEEN 0.01 AND 9999999999.99 THEN
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
        INSERT INTO sale_lines (sale_id, product_id, service_id, serialized_item_id, label, quantity, unit_price_ht, unit_price_ttc,
                                vat_rate, discount_amount, total_ttc, total_ht)
        VALUES (v_sale_id, (v_line->>'product_id')::UUID, (v_line->>'service_id')::UUID, NULLIF(v_line->>'serialized_item_id', '')::UUID,
                v_line->>'label', (v_line->>'quantity')::INT, (v_line->>'unit_price_ht')::NUMERIC,
                (v_line->>'unit_price_ttc')::NUMERIC, (v_line->>'vat_rate')::NUMERIC,
                (v_line->>'discount_amount')::NUMERIC, (v_line->>'total_ttc')::NUMERIC, (v_line->>'total_ht')::NUMERIC);

        IF NULLIF(v_line->>'serialized_item_id', '') IS NOT NULL THEN
            UPDATE serialized_items SET status = 'SOLD', updated_at = v_now
            WHERE id = (v_line->>'serialized_item_id')::UUID;
        END IF;

        IF (v_line->>'product_id') IS NOT NULL THEN
            INSERT INTO stock_movements (product_id, serialized_item_id, movement_type, quantity, user_id, reason, reference_id)
            VALUES ((v_line->>'product_id')::UUID, NULLIF(v_line->>'serialized_item_id', '')::UUID, 'SALE',
                    -(v_line->>'quantity')::INT, v_user_id, 'Vente ' || v_receipt_number, v_sale_id);
        END IF;
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


-- Agrégation en base, sans limite de pagination. Dates inclusives en heure de Paris.
CREATE FUNCTION service_sales_stats(p_start DATE, p_end DATE)
RETURNS TABLE(service_id UUID, label TEXT, quantity BIGINT, tickets BIGINT, total_ht NUMERIC, total_ttc NUMERIC)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF COALESCE(app_role(), '') NOT IN ('ADMIN', 'VENDEUR') THEN RAISE EXCEPTION 'Accès refusé.'; END IF;
    IF p_start IS NULL OR p_end IS NULL OR p_end < p_start THEN RAISE EXCEPTION 'Période invalide.'; END IF;
    RETURN QUERY
    SELECT c.id, c.label, COALESCE(sum(l.quantity), 0)::BIGINT, count(DISTINCT l.sale_id),
           COALESCE(sum(l.total_ht), 0), COALESCE(sum(l.total_ttc), 0)
    FROM service_categories c
    LEFT JOIN (sale_lines l INNER JOIN sales s ON s.id = l.sale_id
        AND s.status = 'FINALIZED'
        AND s.finalized_at >= (p_start::TIMESTAMP AT TIME ZONE 'Europe/Paris')
        AND s.finalized_at < ((p_end + 1)::TIMESTAMP AT TIME ZONE 'Europe/Paris')) ON l.service_id = c.id
    GROUP BY c.id ORDER BY c.sort_order;
END;
$$;
REVOKE ALL ON FUNCTION service_sales_stats(DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION service_sales_stats(DATE, DATE) TO authenticated;

-- Confirmation humaine uniquement : ouvrir WhatsApp ne prouve pas un envoi.
CREATE FUNCTION confirm_sav_whatsapp(p_id UUID) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_status TEXT;
BEGIN
    IF app_role() IS NULL THEN RAISE EXCEPTION 'Accès refusé.'; END IF;
    SELECT status INTO v_status FROM sav_cases WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Dossier introuvable.'; END IF;
    IF v_status = 'CLIENT_PREVENU' THEN RETURN; END IF;
    IF v_status <> 'PRET' THEN RAISE EXCEPTION 'Le dossier doit être prêt avant de prévenir le client.'; END IF;
    UPDATE sav_cases SET status = 'CLIENT_PREVENU', updated_at = NOW() WHERE id = p_id;
    INSERT INTO sav_events (sav_case_id, event_type, description, user_id)
    VALUES (p_id, 'WHATSAPP', 'Prêt → Client prévenu : envoi WhatsApp confirmé par l’opérateur.', auth.uid());
END;
$$;
REVOKE ALL ON FUNCTION confirm_sav_whatsapp(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION confirm_sav_whatsapp(UUID) TO authenticated;
