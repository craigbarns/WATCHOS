-- =====================================================================
-- ENCAISSEMENT D'UN DOSSIER SAV
--
-- Marquer « payé » ne créait aucune vente. Cette fonction encaisse
-- réellement le SAV : elle passe par finalize_sale (donc ticket numéroté,
-- TVA, règlements, événement fiscal chaîné), relie la vente au dossier et
-- le marque payé, le tout dans une seule transaction.
--
-- Si la vente est ensuite annulée par un avoir, le dossier repasse
-- automatiquement en « non payé » et se détache du ticket.
-- =====================================================================

ALTER TABLE sav_cases ADD COLUMN IF NOT EXISTS sale_id UUID REFERENCES sales(id);
CREATE INDEX IF NOT EXISTS idx_sav_cases_sale ON sav_cases(sale_id);

CREATE OR REPLACE FUNCTION checkout_sav(
    p_id UUID,
    p_service_id UUID,
    p_amount_ttc NUMERIC,
    p_payments JSONB,
    p_idempotency_key TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_case sav_cases%ROWTYPE;
    v_existing sales%ROWTYPE;
    v_sale JSONB;
    v_total NUMERIC(12, 2);
    v_payment JSONB;
BEGIN
    IF COALESCE(app_role(), '') NOT IN ('ADMIN', 'VENDEUR') THEN
        RAISE EXCEPTION 'Seuls les administrateurs et les vendeurs peuvent encaisser.';
    END IF;

    SELECT * INTO v_case FROM sav_cases WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Dossier introuvable.';
    END IF;

    -- Rejeu d'un même encaissement : on renvoie le ticket déjà créé
    IF v_case.sale_id IS NOT NULL THEN
        SELECT * INTO v_existing FROM sales WHERE id = v_case.sale_id;
        RETURN jsonb_build_object('success', true, 'sale_id', v_case.sale_id,
                                  'receipt_number', v_existing.receipt_number, 'replayed', true);
    END IF;

    IF p_amount_ttc IS NULL OR p_amount_ttc <= 0 OR round(p_amount_ttc, 2) <> p_amount_ttc OR p_amount_ttc > 999999.99 THEN
        RAISE EXCEPTION 'Saisissez un montant TTC positif, avec deux décimales maximum.';
    END IF;

    v_total := 0;
    FOR v_payment IN SELECT * FROM jsonb_array_elements(COALESCE(p_payments, '[]'::JSONB))
    LOOP
        v_total := v_total + round((v_payment->>'amount')::NUMERIC, 2);
    END LOOP;
    IF v_total <> p_amount_ttc THEN
        RAISE EXCEPTION 'Les règlements (% €) ne correspondent pas au montant du SAV (% €).', v_total, p_amount_ttc;
    END IF;

    -- Vente réelle : ticket, TVA, chaînage fiscal
    v_sale := finalize_sale(
        v_case.customer_id,
        jsonb_build_array(jsonb_build_object('service_id', p_service_id, 'quantity', 1, 'unit_price_ttc', p_amount_ttc)),
        p_payments,
        p_idempotency_key
    );

    UPDATE sav_cases
    SET sale_id = (v_sale->>'sale_id')::UUID,
        amount_due = p_amount_ttc,
        is_paid = true,
        updated_at = NOW()
    WHERE id = p_id;

    INSERT INTO sav_events (sav_case_id, event_type, description, user_id)
    VALUES (p_id, 'PAYMENT',
            format('Encaissé %s € — ticket %s', replace(fiscal_amount(p_amount_ttc), '.', ','), v_sale->>'receipt_number'),
            auth.uid());

    RETURN v_sale || jsonb_build_object('sav_case_id', p_id);
END;
$$;

REVOKE ALL ON FUNCTION checkout_sav(UUID, UUID, NUMERIC, JSONB, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION checkout_sav(UUID, UUID, NUMERIC, JSONB, TEXT) TO authenticated;

-- ---------------------------------------------------------------------
-- Annulation de la vente d'un SAV : le dossier redevient « non payé »
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION unlink_sav_on_refund() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_case sav_cases%ROWTYPE;
BEGIN
    IF NEW.parent_sale_id IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT * INTO v_case FROM sav_cases WHERE sale_id = NEW.parent_sale_id;
    IF NOT FOUND THEN
        RETURN NEW;
    END IF;

    UPDATE sav_cases SET sale_id = NULL, is_paid = false, updated_at = NOW() WHERE id = v_case.id;
    INSERT INTO sav_events (sav_case_id, event_type, description, user_id)
    VALUES (v_case.id, 'PAYMENT',
            format('Encaissement annulé — avoir %s. Le dossier repasse en « non payé ».', NEW.receipt_number),
            NEW.user_id);
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION unlink_sav_on_refund() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS unlink_sav_on_refund ON sales;
CREATE TRIGGER unlink_sav_on_refund
AFTER INSERT ON sales
FOR EACH ROW EXECUTE FUNCTION unlink_sav_on_refund();
