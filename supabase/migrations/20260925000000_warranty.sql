-- =====================================================================
-- GARANTIE SUR UNE VENTE
--
-- Case à cocher à l'encaissement (caisse et SAV). La garantie est
-- enregistrée à part : la vente et la chaîne fiscale restent intactes.
-- Une garantie posée ne peut plus être modifiée ni supprimée, comme le
-- ticket qu'elle accompagne.
-- =====================================================================

CREATE TABLE IF NOT EXISTS sale_warranties (
    sale_id UUID PRIMARY KEY REFERENCES sales(id) ON DELETE CASCADE,
    months INTEGER NOT NULL CHECK (months BETWEEN 1 AND 120),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES profiles(id)
);

ALTER TABLE sale_warranties ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON sale_warranties TO authenticated;

DROP POLICY IF EXISTS staff_read ON sale_warranties;
CREATE POLICY staff_read ON sale_warranties FOR SELECT TO authenticated
    USING (app_role() IS NOT NULL);

DROP POLICY IF EXISTS staff_insert ON sale_warranties;
CREATE POLICY staff_insert ON sale_warranties FOR INSERT TO authenticated
    WITH CHECK (app_role() IN ('ADMIN', 'VENDEUR') AND created_by = auth.uid());

-- Comme les lignes de vente et les règlements : ajout seul
DROP TRIGGER IF EXISTS prevent_sale_warranties_mod ON sale_warranties;
CREATE TRIGGER prevent_sale_warranties_mod
BEFORE UPDATE OR DELETE ON sale_warranties
FOR EACH ROW EXECUTE FUNCTION prevent_modification();
