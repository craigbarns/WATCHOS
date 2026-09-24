-- =====================================================================
-- RAPPORT DE CAISSE DÉTAILLÉ
--
--  * cash_report(début, fin) : répartition par mode de règlement
--    (espèces, CB, chèque, virement, autre), ventilation de TVA,
--    nombre de tickets, remises, premier et dernier ticket.
--  * close_day enregistre ce détail dans la clôture (colonne details),
--    de façon définitive comme le reste de la clôture.
--
-- L'empreinte SHA-256 reste calculée sur les mêmes champs qu'avant
-- (totaux + cumul perpétuel) : les clôtures déjà générées restent
-- vérifiables par src/lib/fiscal/core.ts.
-- =====================================================================

ALTER TABLE fiscal_closures ADD COLUMN IF NOT EXISTS details JSONB;

CREATE OR REPLACE FUNCTION cash_report(p_start TIMESTAMPTZ, p_end TIMESTAMPTZ) RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_result JSONB;
BEGIN
    IF COALESCE(app_role(), '') NOT IN ('ADMIN', 'VENDEUR') THEN
        RAISE EXCEPTION 'Accès refusé.';
    END IF;
    IF p_start IS NULL OR p_end IS NULL OR p_end <= p_start THEN
        RAISE EXCEPTION 'Période invalide.';
    END IF;

    SELECT jsonb_build_object(
        'period_start', to_char(p_start AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'period_end', to_char(p_end AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'tickets', COALESCE(s.tickets, 0),
        'total_ht', COALESCE(s.total_ht, 0),
        'total_vat', COALESCE(s.total_vat, 0),
        'total_ttc', COALESCE(s.total_ttc, 0),
        'discounts', COALESCE(l.discounts, 0),
        'average_ticket', CASE WHEN COALESCE(s.tickets, 0) > 0 THEN round(s.total_ttc / s.tickets, 2) ELSE 0 END,
        'first_receipt', s.first_receipt,
        'last_receipt', s.last_receipt,
        'payments', COALESCE(p.rows, '[]'::JSONB),
        'payments_total', COALESCE(p.total, 0),
        'vat', COALESCE(l.rows, '[]'::JSONB),
        'balanced', COALESCE(p.total, 0) = COALESCE(s.total_ttc, 0)
    )
    INTO v_result
    FROM (
        SELECT count(*) AS tickets,
               COALESCE(sum(total_ht), 0) AS total_ht,
               COALESCE(sum(total_vat), 0) AS total_vat,
               COALESCE(sum(total_ttc), 0) AS total_ttc,
               min(receipt_number) AS first_receipt,
               max(receipt_number) AS last_receipt
        FROM sales
        WHERE status = 'FINALIZED' AND finalized_at >= p_start AND finalized_at < p_end
    ) s
    CROSS JOIN (
        SELECT jsonb_agg(jsonb_build_object('method', method, 'count', n, 'amount', amount) ORDER BY amount DESC) AS rows,
               sum(amount) AS total
        FROM (
            SELECT pay.method, count(*) AS n, sum(pay.amount) AS amount
            FROM payments pay
            JOIN sales sa ON sa.id = pay.sale_id
            WHERE sa.status = 'FINALIZED' AND sa.finalized_at >= p_start AND sa.finalized_at < p_end
            GROUP BY pay.method
        ) grouped
    ) p
    CROSS JOIN (
        SELECT jsonb_agg(jsonb_build_object('rate', rate, 'base_ht', base_ht, 'vat_amount', vat_amount, 'total_ttc', total_ttc) ORDER BY rate DESC) AS rows,
               sum(discounts) AS discounts
        FROM (
            SELECT sl.vat_rate AS rate,
                   COALESCE(sum(sl.total_ht), 0) AS base_ht,
                   COALESCE(sum(sl.total_ttc) - sum(sl.total_ht), 0) AS vat_amount,
                   COALESCE(sum(sl.total_ttc), 0) AS total_ttc,
                   COALESCE(sum(sl.discount_amount), 0) AS discounts
            FROM sale_lines sl
            JOIN sales sa ON sa.id = sl.sale_id
            WHERE sa.status = 'FINALIZED' AND sa.finalized_at >= p_start AND sa.finalized_at < p_end
            GROUP BY sl.vat_rate
        ) per_rate
    ) l;

    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION cash_report(TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION cash_report(TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

-- Rapport d'une journée de boutique (heure de Paris)
CREATE OR REPLACE FUNCTION day_cash_report(p_day DATE) RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
    SELECT cash_report((p_day::TIMESTAMP) AT TIME ZONE 'Europe/Paris', ((p_day + 1)::TIMESTAMP) AT TIME ZONE 'Europe/Paris')
$$;

REVOKE ALL ON FUNCTION day_cash_report(DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION day_cash_report(DATE) TO authenticated;

-- ---------------------------------------------------------------------
-- close_day : mêmes règles qu'avant, avec le détail scellé dans la clôture
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
    v_details JSONB;
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
    v_details := cash_report(v_start, v_end);

    INSERT INTO fiscal_closures (sequence_number, closure_type, period_start, period_end, operations_count, total_ht,
                                 total_vat, total_ttc, perpetual_total, previous_hash, current_hash, app_version,
                                 fiscal_core_version, created_by, details)
    VALUES (v_sequence, 'DAILY', v_start, v_end, v_count, v_ht, v_vat, v_ttc, v_perpetual, v_prev_hash, v_hash,
            COALESCE(v_versions.app_version, '1.0.0'), COALESCE(v_versions.fiscal_core_version, '1.0.0'), auth.uid(), v_details);

    RETURN jsonb_build_object('success', true, 'sequence_number', v_sequence, 'total_ttc', v_ttc,
                              'operations_count', v_count, 'hash', v_hash, 'details', v_details);
END;
$$;

REVOKE ALL ON FUNCTION close_day(DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION close_day(DATE) TO authenticated;
