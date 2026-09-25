-- =====================================================================
-- ANNULATION D'UNE VENTE (AVOIR)
--
-- La réglementation anti-fraude TVA interdit de supprimer ou de modifier
-- une vente enregistrée. Annuler = créer un document d'avoir :
--   * un ticket « A2026-000xxx » aux montants négatifs, lié à la vente
--     d'origine (parent_sale_id) et portant le motif ;
--   * les règlements sont contrepassés (mêmes modes, montants négatifs)
--     pour que le Z et le journal des encaissements restent justes ;
--   * les montres repassent en stock, les quantités sont recréditées ;
--   * un événement fiscal REFUND chaîné, comme pour une vente.
-- Une vente ne peut être annulée qu'une seule fois, et un avoir ne peut
-- pas être annulé.
-- =====================================================================

ALTER TABLE sales ADD COLUMN IF NOT EXISTS cancel_reason TEXT;

-- Le verrou « montre vendue » doit laisser passer le retour en stock d'un avoir.
-- Depuis l'API (rôles authenticated / anon) rien ne change : statut, numéro de
-- série et rattachement restent intouchables ; set_serialized_status continue
-- par ailleurs de refuser explicitement toute montre vendue.
CREATE OR REPLACE FUNCTION guard_serialized_item_update() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    IF current_user IN ('authenticated', 'anon') THEN
        IF OLD.status = 'SOLD' AND (
            NEW.status IS DISTINCT FROM OLD.status
            OR NEW.serial_number IS DISTINCT FROM OLD.serial_number
            OR NEW.product_id IS DISTINCT FROM OLD.product_id
        ) THEN
            RAISE EXCEPTION 'Montre vendue : statut et numéro de série verrouillés.';
        END IF;
        IF NEW.status IS DISTINCT FROM OLD.status THEN
            RAISE EXCEPTION 'Le statut d''une montre se modifie uniquement depuis sa fiche.';
        END IF;
    ELSIF OLD.status = 'SOLD' AND NEW.status NOT IN ('SOLD', 'AVAILABLE') THEN
        RAISE EXCEPTION 'Une montre vendue ne peut revenir en stock que par un avoir.';
    END IF;
    RETURN NEW;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_sales_parent ON sales(parent_sale_id);

CREATE OR REPLACE FUNCTION refund_sale(
    p_sale_id UUID,
    p_reason TEXT,
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
    v_original sales%ROWTYPE;
    v_refund_id UUID;
    v_receipt_seq BIGINT;
    v_receipt_number TEXT;
    v_line sale_lines%ROWTYPE;
    v_payment payments%ROWTYPE;
    v_sequence BIGINT;
    v_prev_hash TEXT;
    v_hash TEXT;
    v_occurred_at TEXT;
    v_payload JSONB;
    v_versions settings%ROWTYPE;
    v_reason TEXT := NULLIF(trim(COALESCE(p_reason, '')), '');
BEGIN
    IF COALESCE(app_role(), '') NOT IN ('ADMIN', 'VENDEUR') THEN
        RAISE EXCEPTION 'Seuls les administrateurs et les vendeurs peuvent annuler une vente.';
    END IF;
    IF p_idempotency_key IS NULL OR length(p_idempotency_key) < 8 THEN
        RAISE EXCEPTION 'Clé d''idempotence manquante.';
    END IF;
    IF v_reason IS NULL OR length(v_reason) < 3 THEN
        RAISE EXCEPTION 'Indiquez le motif de l''annulation.';
    END IF;

    PERFORM value FROM fiscal_counters WHERE name = 'FISCAL_EVENT' FOR UPDATE;

    SELECT * INTO v_existing FROM sales WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN
        RETURN jsonb_build_object('success', true, 'refund_id', v_existing.id,
                                  'receipt_number', v_existing.receipt_number, 'replayed', true);
    END IF;

    SELECT * INTO v_original FROM sales WHERE id = p_sale_id FOR UPDATE;
    IF NOT FOUND OR v_original.status <> 'FINALIZED' THEN
        RAISE EXCEPTION 'Vente introuvable.';
    END IF;
    IF v_original.parent_sale_id IS NOT NULL THEN
        RAISE EXCEPTION 'Un avoir ne peut pas être annulé.';
    END IF;
    IF EXISTS (SELECT 1 FROM sales WHERE parent_sale_id = p_sale_id) THEN
        RAISE EXCEPTION 'Cette vente a déjà été annulée.';
    END IF;

    UPDATE fiscal_counters SET value = value + 1 WHERE name = 'RECEIPT' RETURNING value INTO v_receipt_seq;
    v_receipt_number := 'A' || to_char(v_now AT TIME ZONE 'Europe/Paris', 'YYYY') || '-' || lpad(v_receipt_seq::TEXT, 6, '0');

    INSERT INTO sales (status, receipt_number, customer_id, user_id, total_ht, total_vat, total_ttc,
                       finalized_at, idempotency_key, parent_sale_id, cancel_reason)
    VALUES ('FINALIZED', v_receipt_number, v_original.customer_id, v_user_id,
            -v_original.total_ht, -v_original.total_vat, -v_original.total_ttc,
            v_now, p_idempotency_key, v_original.id, v_reason)
    RETURNING id INTO v_refund_id;

    -- Lignes contrepassées + retour en stock
    FOR v_line IN SELECT * FROM sale_lines WHERE sale_id = v_original.id
    LOOP
        INSERT INTO sale_lines (sale_id, product_id, service_id, serialized_item_id, label, quantity,
                                unit_price_ht, unit_price_ttc, vat_rate, discount_amount, total_ttc, total_ht)
        VALUES (v_refund_id, v_line.product_id, v_line.service_id, v_line.serialized_item_id,
                v_line.label, -v_line.quantity, v_line.unit_price_ht, v_line.unit_price_ttc, v_line.vat_rate,
                -v_line.discount_amount, -v_line.total_ttc, -v_line.total_ht);

        IF v_line.serialized_item_id IS NOT NULL THEN
            UPDATE serialized_items SET status = 'AVAILABLE', updated_at = v_now
            WHERE id = v_line.serialized_item_id AND status = 'SOLD';
        ELSIF v_line.product_id IS NOT NULL THEN
            UPDATE products SET stock_quantity = stock_quantity + v_line.quantity, updated_at = v_now
            WHERE id = v_line.product_id AND type = 'NON_SERIALIZED';
        END IF;

        IF v_line.product_id IS NOT NULL THEN
            INSERT INTO stock_movements (product_id, serialized_item_id, movement_type, quantity, user_id, reason, reference_id)
            VALUES (v_line.product_id, v_line.serialized_item_id, 'RETURN', v_line.quantity, v_user_id,
                    format('Annulation %s (ticket %s) · %s', v_receipt_number, v_original.receipt_number, v_reason), v_refund_id);
        END IF;
    END LOOP;

    -- Règlements contrepassés : le Z et le journal restent équilibrés
    FOR v_payment IN SELECT * FROM payments WHERE sale_id = v_original.id
    LOOP
        INSERT INTO payments (sale_id, method, amount) VALUES (v_refund_id, v_payment.method, -v_payment.amount);
    END LOOP;

    -- Événement fiscal REFUND, chaîné comme une vente
    UPDATE fiscal_counters SET value = value + 1 WHERE name = 'FISCAL_EVENT' RETURNING value INTO v_sequence;
    SELECT current_hash INTO v_prev_hash FROM fiscal_events ORDER BY sequence_number DESC LIMIT 1;
    v_prev_hash := COALESCE(v_prev_hash, 'GENESIS');
    v_occurred_at := to_char(v_now AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');

    v_payload := jsonb_build_object(
        'entity_id', v_refund_id,
        'event_type', 'REFUND',
        'operator_id', v_user_id,
        'occurred_at', v_occurred_at,
        'amount_ht', -v_original.total_ht,
        'vat_amount', -v_original.total_vat,
        'amount_ttc', -v_original.total_ttc
    );

    v_hash := encode(digest(
        v_prev_hash || '||' ||
        'amount_ht:' || fiscal_amount(-v_original.total_ht) ||
        '|amount_ttc:' || fiscal_amount(-v_original.total_ttc) ||
        '|entity_id:' || v_refund_id ||
        '|event_type:REFUND' ||
        '|occurred_at:' || v_occurred_at ||
        '|operator_id:' || v_user_id ||
        '|sequence_number:' || v_sequence ||
        '|vat_amount:' || fiscal_amount(-v_original.total_vat),
        'sha256'), 'hex');

    SELECT * INTO v_versions FROM settings LIMIT 1;

    INSERT INTO fiscal_events (sequence_number, event_type, entity_id, operator_id, occurred_at, amount_ht, vat_amount,
                               amount_ttc, canonical_payload, previous_hash, current_hash, app_version, fiscal_core_version)
    VALUES (v_sequence, 'REFUND', v_refund_id, v_user_id, v_now, -v_original.total_ht, -v_original.total_vat,
            -v_original.total_ttc, v_payload, v_prev_hash, v_hash,
            COALESCE(v_versions.app_version, '1.0.0'), COALESCE(v_versions.fiscal_core_version, '1.0.0'));

    RETURN jsonb_build_object(
        'success', true,
        'refund_id', v_refund_id,
        'receipt_number', v_receipt_number,
        'original_receipt', v_original.receipt_number,
        'total_ttc', -v_original.total_ttc,
        'hash', v_hash
    );
END;
$$;

REVOKE ALL ON FUNCTION refund_sale(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION refund_sale(UUID, TEXT, TEXT) TO authenticated;
