-- =====================================================================
-- AUDIT FISCAL : CLÔTURES, ARCHIVES ET VERROUS
--
-- 1. Clôtures mensuelles et annuelles. Le BOFiP (BOI-TVA-DECLA-30-10-30,
--    condition de conservation) impose une clôture journalière, mensuelle
--    et annuelle, « cumulatives et impératives ». close_period les produit
--    dans la même chaîne que les Z, avec le même format d'empreinte.
--    Le total perpétuel devient le cumul exact de toutes les opérations
--    jusqu'à la fin de la période, quel que soit l'ordre des clôtures.
--    Le détail scellé ajoute le cumul depuis le 1er janvier (exercice
--    supposé calé sur l'année civile).
-- 2. close_pending clôture, dans l'ordre, les journées, mois et années
--    terminés qui ne l'ont pas encore été (rattrapage automatique).
-- 3. Registre des archives : chaque export enregistre l'empreinte SHA-256
--    du fichier, la période et son auteur, dans une chaîne d'empreintes.
-- 4. Dossiers SAV : le montant, le « payé » et le ticket lié ne se
--    modifient plus directement par l'API, seulement par les fonctions
--    qui laissent une trace (règlement, encaissement, annulation).
-- 5. Garantie : 12 mois, sur une vente (pas un avoir) de moins de
--    15 minutes, comme la case cochée à l'encaissement.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Clôtures journalière, mensuelle et annuelle
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION close_period(p_type TEXT, p_day DATE) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_first DATE;
    v_next DATE;
    v_label TEXT;
    v_e TEXT := 'e';
    v_start TIMESTAMPTZ;
    v_end TIMESTAMPTZ;
    v_count INT;
    v_ht NUMERIC(15, 2);
    v_vat NUMERIC(15, 2);
    v_ttc NUMERIC(15, 2);
    v_perpetual NUMERIC(15, 2);
    v_year_to_date NUMERIC(15, 2);
    v_sequence BIGINT;
    v_prev_hash TEXT;
    v_hash TEXT;
    v_versions settings%ROWTYPE;
    v_details JSONB;
BEGIN
    IF COALESCE(app_role(), '') NOT IN ('ADMIN', 'VENDEUR') THEN
        RAISE EXCEPTION 'Accès refusé.';
    END IF;
    IF p_day IS NULL THEN
        RAISE EXCEPTION 'Date invalide.';
    END IF;

    CASE p_type
        WHEN 'DAILY' THEN
            v_first := p_day;
            v_next := p_day + 1;
            v_label := 'La journée du ' || to_char(p_day, 'DD/MM/YYYY');
        WHEN 'MONTHLY' THEN
            v_first := date_trunc('month', p_day::TIMESTAMP)::DATE;
            v_next := (v_first + INTERVAL '1 month')::DATE;
            v_label := 'Le mois ' || to_char(v_first, 'MM/YYYY');
            v_e := '';
        WHEN 'ANNUAL' THEN
            v_first := date_trunc('year', p_day::TIMESTAMP)::DATE;
            v_next := (v_first + INTERVAL '1 year')::DATE;
            v_label := 'L''année ' || to_char(v_first, 'YYYY');
        ELSE
            RAISE EXCEPTION 'Type de clôture invalide.';
    END CASE;
    v_start := v_first::TIMESTAMP AT TIME ZONE 'Europe/Paris';
    v_end := v_next::TIMESTAMP AT TIME ZONE 'Europe/Paris';

    IF v_end > NOW() THEN
        RAISE EXCEPTION '% n''est pas terminé%.', v_label, v_e;
    END IF;

    PERFORM value FROM fiscal_counters WHERE name = 'CLOSURE' FOR UPDATE;

    IF EXISTS (SELECT 1 FROM fiscal_closures WHERE closure_type = p_type AND period_start = v_start) THEN
        RAISE EXCEPTION '% est déjà clôturé%.', v_label, v_e;
    END IF;

    -- Un mois récapitule des journées clôturées, une année des mois clôturés
    IF p_type = 'MONTHLY' AND EXISTS (
        SELECT 1 FROM fiscal_events e
        WHERE e.occurred_at >= v_start AND e.occurred_at < v_end
          AND NOT EXISTS (
              SELECT 1 FROM fiscal_closures c
              WHERE c.closure_type = 'DAILY'
                AND c.period_start = ((e.occurred_at AT TIME ZONE 'Europe/Paris')::DATE)::TIMESTAMP AT TIME ZONE 'Europe/Paris')
    ) THEN
        RAISE EXCEPTION 'Clôturez d''abord toutes les journées du mois %.', to_char(v_first, 'MM/YYYY');
    END IF;
    IF p_type = 'ANNUAL' AND EXISTS (
        SELECT 1 FROM fiscal_events e
        WHERE e.occurred_at >= v_start AND e.occurred_at < v_end
          AND NOT EXISTS (
              SELECT 1 FROM fiscal_closures c
              WHERE c.closure_type = 'MONTHLY'
                AND c.period_start = date_trunc('month', e.occurred_at AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'Europe/Paris')
    ) THEN
        RAISE EXCEPTION 'Clôturez d''abord tous les mois de l''année %.', to_char(v_first, 'YYYY');
    END IF;

    SELECT COUNT(*), COALESCE(SUM(amount_ht), 0), COALESCE(SUM(vat_amount), 0), COALESCE(SUM(amount_ttc), 0)
    INTO v_count, v_ht, v_vat, v_ttc
    FROM fiscal_events WHERE occurred_at >= v_start AND occurred_at < v_end;

    -- Total perpétuel : cumul de toutes les opérations jusqu'à la fin de la période
    SELECT COALESCE(SUM(amount_ttc), 0) INTO v_perpetual FROM fiscal_events WHERE occurred_at < v_end;
    -- Cumul du grand total depuis l'ouverture de l'exercice (1er janvier)
    SELECT COALESCE(SUM(amount_ttc), 0) INTO v_year_to_date FROM fiscal_events
    WHERE occurred_at >= (date_trunc('year', v_first::TIMESTAMP) AT TIME ZONE 'Europe/Paris') AND occurred_at < v_end;

    UPDATE fiscal_counters SET value = value + 1 WHERE name = 'CLOSURE' RETURNING value INTO v_sequence;
    SELECT current_hash INTO v_prev_hash FROM fiscal_closures ORDER BY sequence_number DESC LIMIT 1;
    v_prev_hash := COALESCE(v_prev_hash, 'GENESIS');

    v_hash := encode(digest(
        v_prev_hash || '||' ||
        'closure_type:' || p_type ||
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
    v_details := cash_report(v_start, v_end) || jsonb_build_object('year_to_date_ttc', v_year_to_date);

    INSERT INTO fiscal_closures (sequence_number, closure_type, period_start, period_end, operations_count, total_ht,
                                 total_vat, total_ttc, perpetual_total, previous_hash, current_hash, app_version,
                                 fiscal_core_version, created_by, details)
    VALUES (v_sequence, p_type, v_start, v_end, v_count, v_ht, v_vat, v_ttc, v_perpetual, v_prev_hash, v_hash,
            COALESCE(v_versions.app_version, '1.0.0'), COALESCE(v_versions.fiscal_core_version, '1.0.0'), auth.uid(), v_details);

    RETURN jsonb_build_object('success', true, 'sequence_number', v_sequence, 'closure_type', p_type,
                              'total_ttc', v_ttc, 'operations_count', v_count, 'hash', v_hash, 'details', v_details);
END;
$$;

REVOKE ALL ON FUNCTION close_period(TEXT, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION close_period(TEXT, DATE) TO authenticated;

-- Le Z d'une journée garde son nom et son fonctionnement
CREATE OR REPLACE FUNCTION close_day(p_day DATE) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
    RETURN close_period('DAILY', p_day);
END;
$$;

REVOKE ALL ON FUNCTION close_day(DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION close_day(DATE) TO authenticated;

-- ---------------------------------------------------------------------
-- 2. Rattrapage : journées, puis mois, puis années terminés
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION close_pending() RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_today DATE := (NOW() AT TIME ZONE 'Europe/Paris')::DATE;
    v_period DATE;
    v_days INT := 0;
    v_months INT := 0;
    v_years INT := 0;
BEGIN
    IF COALESCE(app_role(), '') NOT IN ('ADMIN', 'VENDEUR') THEN
        RAISE EXCEPTION 'Accès refusé.';
    END IF;
    PERFORM value FROM fiscal_counters WHERE name = 'CLOSURE' FOR UPDATE;

    FOR v_period IN
        SELECT DISTINCT (occurred_at AT TIME ZONE 'Europe/Paris')::DATE AS d FROM fiscal_events
        WHERE occurred_at < (v_today::TIMESTAMP AT TIME ZONE 'Europe/Paris')
        ORDER BY d
    LOOP
        IF NOT EXISTS (SELECT 1 FROM fiscal_closures WHERE closure_type = 'DAILY'
                       AND period_start = v_period::TIMESTAMP AT TIME ZONE 'Europe/Paris') THEN
            PERFORM close_period('DAILY', v_period);
            v_days := v_days + 1;
        END IF;
    END LOOP;

    FOR v_period IN
        SELECT DISTINCT date_trunc('month', occurred_at AT TIME ZONE 'Europe/Paris')::DATE AS m FROM fiscal_events
        WHERE occurred_at < (date_trunc('month', v_today::TIMESTAMP) AT TIME ZONE 'Europe/Paris')
        ORDER BY m
    LOOP
        IF NOT EXISTS (SELECT 1 FROM fiscal_closures WHERE closure_type = 'MONTHLY'
                       AND period_start = v_period::TIMESTAMP AT TIME ZONE 'Europe/Paris') THEN
            PERFORM close_period('MONTHLY', v_period);
            v_months := v_months + 1;
        END IF;
    END LOOP;

    FOR v_period IN
        SELECT DISTINCT date_trunc('year', occurred_at AT TIME ZONE 'Europe/Paris')::DATE AS y FROM fiscal_events
        WHERE occurred_at < (date_trunc('year', v_today::TIMESTAMP) AT TIME ZONE 'Europe/Paris')
        ORDER BY y
    LOOP
        IF NOT EXISTS (SELECT 1 FROM fiscal_closures WHERE closure_type = 'ANNUAL'
                       AND period_start = v_period::TIMESTAMP AT TIME ZONE 'Europe/Paris') THEN
            PERFORM close_period('ANNUAL', v_period);
            v_years := v_years + 1;
        END IF;
    END LOOP;

    RETURN jsonb_build_object('success', true, 'days', v_days, 'months', v_months, 'years', v_years);
END;
$$;

REVOKE ALL ON FUNCTION close_pending() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION close_pending() TO authenticated;

-- ---------------------------------------------------------------------
-- 3. Registre des archives
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS fiscal_archives (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sequence_number BIGINT NOT NULL UNIQUE,
    period_start TIMESTAMPTZ NOT NULL,
    period_end TIMESTAMPTZ NOT NULL,
    sales_count INTEGER NOT NULL,
    total_ttc NUMERIC(15, 2) NOT NULL,
    file_sha256 TEXT NOT NULL CHECK (file_sha256 ~ '^[0-9a-f]{64}$'),
    previous_hash TEXT NOT NULL,
    current_hash TEXT NOT NULL,
    created_by UUID REFERENCES profiles(id),
    created_at TIMESTAMPTZ NOT NULL
);

ALTER TABLE fiscal_archives ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON fiscal_archives TO authenticated;
DROP POLICY IF EXISTS staff_read ON fiscal_archives;
CREATE POLICY staff_read ON fiscal_archives FOR SELECT TO authenticated
    USING (app_role() IN ('ADMIN', 'VENDEUR'));

DROP TRIGGER IF EXISTS prevent_fiscal_archives_mod ON fiscal_archives;
CREATE TRIGGER prevent_fiscal_archives_mod
BEFORE UPDATE OR DELETE ON fiscal_archives
FOR EACH ROW EXECUTE FUNCTION prevent_modification();

INSERT INTO fiscal_counters (name, value) VALUES ('ARCHIVE', 0) ON CONFLICT (name) DO NOTHING;

-- Format canonique identique à src/lib/fiscal/core.ts (generateArchiveHash)
CREATE OR REPLACE FUNCTION record_archive(p_start TIMESTAMPTZ, p_end TIMESTAMPTZ, p_file_sha256 TEXT) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_now TIMESTAMPTZ := NOW();
    v_count INT;
    v_ttc NUMERIC(15, 2);
    v_sequence BIGINT;
    v_prev_hash TEXT;
    v_hash TEXT;
BEGIN
    IF COALESCE(app_role(), '') NOT IN ('ADMIN', 'VENDEUR') THEN
        RAISE EXCEPTION 'Accès refusé.';
    END IF;
    IF p_start IS NULL OR p_end IS NULL OR p_end <= p_start THEN
        RAISE EXCEPTION 'Période invalide.';
    END IF;
    IF p_file_sha256 IS NULL OR p_file_sha256 !~ '^[0-9a-f]{64}$' THEN
        RAISE EXCEPTION 'Empreinte de fichier invalide.';
    END IF;

    PERFORM value FROM fiscal_counters WHERE name = 'ARCHIVE' FOR UPDATE;

    SELECT count(*), COALESCE(sum(total_ttc), 0) INTO v_count, v_ttc
    FROM sales WHERE status = 'FINALIZED' AND finalized_at >= p_start AND finalized_at < p_end;

    UPDATE fiscal_counters SET value = value + 1 WHERE name = 'ARCHIVE' RETURNING value INTO v_sequence;
    SELECT current_hash INTO v_prev_hash FROM fiscal_archives ORDER BY sequence_number DESC LIMIT 1;
    v_prev_hash := COALESCE(v_prev_hash, 'GENESIS');

    v_hash := encode(digest(
        v_prev_hash || '||' ||
        'created_at:' || to_char(v_now AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') ||
        '|file_sha256:' || p_file_sha256 ||
        '|period_end:' || to_char(p_end AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') ||
        '|period_start:' || to_char(p_start AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') ||
        '|sales_count:' || v_count ||
        '|sequence_number:' || v_sequence ||
        '|total_ttc:' || fiscal_amount(v_ttc),
        'sha256'), 'hex');

    INSERT INTO fiscal_archives (sequence_number, period_start, period_end, sales_count, total_ttc, file_sha256,
                                 previous_hash, current_hash, created_by, created_at)
    VALUES (v_sequence, p_start, p_end, v_count, v_ttc, p_file_sha256, v_prev_hash, v_hash, auth.uid(), v_now);

    RETURN jsonb_build_object('success', true, 'sequence_number', v_sequence, 'hash', v_hash,
                              'sales_count', v_count, 'total_ttc', v_ttc);
END;
$$;

REVOKE ALL ON FUNCTION record_archive(TIMESTAMPTZ, TIMESTAMPTZ, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION record_archive(TIMESTAMPTZ, TIMESTAMPTZ, TEXT) TO authenticated;

-- ---------------------------------------------------------------------
-- 4. Règlement des dossiers SAV : uniquement par les fonctions tracées
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION guard_sav_payment() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    -- Les fonctions update_sav_payment, checkout_sav et unlink_sav_on_refund
    -- s'exécutent avec les droits de leur propriétaire : elles ne sont pas concernées.
    IF current_user IN ('authenticated', 'anon') THEN
        IF TG_OP = 'INSERT' THEN
            IF NEW.amount_due IS NOT NULL OR NEW.is_paid OR NEW.sale_id IS NOT NULL THEN
                RAISE EXCEPTION 'Le règlement d''un dossier SAV se saisit depuis sa fiche.';
            END IF;
        ELSIF NEW.amount_due IS DISTINCT FROM OLD.amount_due
           OR NEW.is_paid IS DISTINCT FROM OLD.is_paid
           OR NEW.sale_id IS DISTINCT FROM OLD.sale_id THEN
            RAISE EXCEPTION 'Le règlement d''un dossier SAV se saisit depuis sa fiche.';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_sav_payment ON sav_cases;
CREATE TRIGGER guard_sav_payment
BEFORE INSERT OR UPDATE ON sav_cases
FOR EACH ROW EXECUTE FUNCTION guard_sav_payment();

-- ---------------------------------------------------------------------
-- 5. Garantie : posée à l'encaissement, 12 mois, jamais sur un avoir
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS staff_insert ON sale_warranties;
CREATE POLICY staff_insert ON sale_warranties FOR INSERT TO authenticated
    WITH CHECK (
        app_role() IN ('ADMIN', 'VENDEUR')
        AND created_by = auth.uid()
        AND months = 12
        AND EXISTS (
            SELECT 1 FROM sales s
            WHERE s.id = sale_id
              AND s.status = 'FINALIZED'
              AND s.parent_sale_id IS NULL
              AND s.finalized_at > NOW() - INTERVAL '15 minutes'
        )
    );
