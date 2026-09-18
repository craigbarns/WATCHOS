-- Nom commercial corrigé ; aucune modification de la raison sociale ni des ventes.
UPDATE settings SET store_name = 'Heures et Passion', updated_at = NOW()
WHERE lower(trim(store_name)) IN ('heure et passion', 'heure & passion', 'heures & passion');

-- Un montant vide signifie « à définir », distinct d'une intervention gratuite.
ALTER TABLE sav_cases
    ADD COLUMN amount_due NUMERIC(12, 2) CHECK (amount_due BETWEEN 0 AND 999999.99),
    ADD COLUMN is_paid BOOLEAN NOT NULL DEFAULT false,
    ADD CONSTRAINT sav_paid_amount_required CHECK (NOT is_paid OR amount_due IS NOT NULL);

-- Suivi manuel du règlement SAV : ne crée aucune vente ni opération de caisse.
CREATE FUNCTION update_sav_payment(p_id UUID, p_amount_due NUMERIC, p_is_paid BOOLEAN)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_case sav_cases%ROWTYPE;
BEGIN
    IF app_role() IS NULL THEN RAISE EXCEPTION 'Accès refusé.'; END IF;
    IF p_is_paid IS NULL THEN RAISE EXCEPTION 'Indiquez si le dossier est payé.'; END IF;
    IF p_amount_due IS NOT NULL AND (
        p_amount_due NOT BETWEEN 0 AND 999999.99 OR round(p_amount_due, 2) <> p_amount_due
    ) THEN
        RAISE EXCEPTION 'Montant invalide : de 0 à 999 999,99 €, avec deux décimales maximum.';
    END IF;
    IF p_is_paid AND p_amount_due IS NULL THEN
        RAISE EXCEPTION 'Renseignez le montant avant de marquer le dossier comme payé.';
    END IF;

    SELECT * INTO v_case FROM sav_cases WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Dossier introuvable.'; END IF;
    IF v_case.amount_due IS NOT DISTINCT FROM p_amount_due AND v_case.is_paid = p_is_paid THEN RETURN; END IF;

    UPDATE sav_cases SET amount_due = p_amount_due, is_paid = p_is_paid, updated_at = NOW() WHERE id = p_id;
    INSERT INTO sav_events (sav_case_id, event_type, description, user_id)
    VALUES (p_id, 'PAYMENT',
        'Règlement : ' || COALESCE(replace(fiscal_amount(v_case.amount_due), '.', ',') || ' €', 'montant à définir') ||
        ' (' || CASE WHEN v_case.is_paid THEN 'Payé' ELSE 'Non payé' END || ') → ' ||
        COALESCE(replace(fiscal_amount(p_amount_due), '.', ',') || ' €', 'montant à définir') ||
        ' (' || CASE WHEN p_is_paid THEN 'Payé' ELSE 'Non payé' END || ').', auth.uid());
END;
$$;
REVOKE ALL ON FUNCTION update_sav_payment(UUID, NUMERIC, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION update_sav_payment(UUID, NUMERIC, BOOLEAN) TO authenticated;
