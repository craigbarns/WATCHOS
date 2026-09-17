-- =====================================================================
-- Seuls les administrateurs et vendeurs peuvent enregistrer une vente,
-- y compris en appelant directement la fonction finalize_sale par l'API
-- (auparavant tout compte actif, dont les techniciens, le pouvait).
-- =====================================================================

CREATE OR REPLACE FUNCTION guard_sale_author() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF COALESCE(app_role(), '') NOT IN ('ADMIN', 'VENDEUR') THEN
        RAISE EXCEPTION 'Seuls les administrateurs et les vendeurs peuvent encaisser.';
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION guard_sale_author() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS guard_sale_author ON sales;
CREATE TRIGGER guard_sale_author
BEFORE INSERT ON sales
FOR EACH ROW EXECUTE FUNCTION guard_sale_author();
