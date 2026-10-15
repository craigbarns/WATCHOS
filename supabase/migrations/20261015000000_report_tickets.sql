-- =====================================================================
-- RAPPORTS : TICKETS, ANNULATIONS ET PANIER MOYEN
--
-- Un avoir (annulation) était compté comme un ticket de vente : une vente
-- annulée comptait deux fois (la vente et son avoir) et faisait baisser le
-- panier moyen. Le premier et le dernier ticket étaient pris par ordre
-- alphabétique, si bien qu'un avoir « A… » passait avant les tickets « T… ».
--
-- cash_report (caisse du jour, ventes, détail des clôtures Z) :
--   * tickets        : tickets de vente de la période, avoirs exclus ;
--   * refunds        : nombre d'avoirs de la période, refunds_ttc leur montant ;
--   * average_ticket : CA TTC net / (tickets - avoirs) ;
--   * first_receipt / last_receipt : dans l'ordre d'émission.
-- service_sales_stats : les tickets d'un poste sont comptés nets des avoirs,
-- comme les quantités et le chiffre d'affaires.
--
-- Aucun montant ne change (HT, TVA, TTC, règlements), aucune donnée n'est
-- modifiée, et les empreintes des clôtures restent calculées sur les mêmes
-- champs : seules les deux fonctions de lecture sont remplacées.
-- =====================================================================

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
        'tickets', s.tickets,
        'refunds', s.refunds,
        'refunds_ttc', s.refunds_ttc,
        'total_ht', s.total_ht,
        'total_vat', s.total_vat,
        'total_ttc', s.total_ttc,
        'discounts', COALESCE(l.discounts, 0),
        'average_ticket', CASE WHEN s.tickets > s.refunds THEN round(s.total_ttc / (s.tickets - s.refunds), 2) ELSE 0 END,
        'first_receipt', s.first_receipt,
        'last_receipt', s.last_receipt,
        'payments', COALESCE(p.rows, '[]'::JSONB),
        'payments_total', COALESCE(p.total, 0),
        'vat', COALESCE(l.rows, '[]'::JSONB),
        'balanced', COALESCE(p.total, 0) = s.total_ttc
    )
    INTO v_result
    FROM (
        SELECT count(*) FILTER (WHERE parent_sale_id IS NULL) AS tickets,
               count(*) FILTER (WHERE parent_sale_id IS NOT NULL) AS refunds,
               COALESCE(sum(total_ttc) FILTER (WHERE parent_sale_id IS NOT NULL), 0) AS refunds_ttc,
               COALESCE(sum(total_ht), 0) AS total_ht,
               COALESCE(sum(total_vat), 0) AS total_vat,
               COALESCE(sum(total_ttc), 0) AS total_ttc,
               (array_agg(receipt_number ORDER BY finalized_at, receipt_number))[1] AS first_receipt,
               (array_agg(receipt_number ORDER BY finalized_at DESC, receipt_number DESC))[1] AS last_receipt
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

-- Agrégation en base, sans limite de pagination. Dates inclusives en heure de Paris.
CREATE OR REPLACE FUNCTION service_sales_stats(p_start DATE, p_end DATE)
RETURNS TABLE(service_id UUID, label TEXT, quantity BIGINT, tickets BIGINT, total_ht NUMERIC, total_ttc NUMERIC)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF COALESCE(app_role(), '') NOT IN ('ADMIN', 'VENDEUR') THEN RAISE EXCEPTION 'Accès refusé.'; END IF;
    IF p_start IS NULL OR p_end IS NULL OR p_end < p_start THEN RAISE EXCEPTION 'Période invalide.'; END IF;
    RETURN QUERY
    SELECT c.id, c.label, COALESCE(sum(l.quantity), 0)::BIGINT,
           (count(DISTINCT l.sale_id) FILTER (WHERE s.parent_sale_id IS NULL)
            - count(DISTINCT l.sale_id) FILTER (WHERE s.parent_sale_id IS NOT NULL))::BIGINT,
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
