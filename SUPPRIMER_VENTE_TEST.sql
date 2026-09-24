-- One-time reset explicitly requested by the owner on 2026-09-17.
-- Run with a database administrator after saving a private database backup.
-- This is deliberately NOT a migration and exposes no callable reset endpoint.
BEGIN;
LOCK TABLE sales, sale_lines, payments, fiscal_events, fiscal_closures,
  stock_movements, serialized_items, products IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM sales WHERE id <> '8e6bc05d-78ec-45f5-af4d-b4b135792993'::uuid
             OR receipt_number IS DISTINCT FROM 'T2026-000001') THEN
    RAISE EXCEPTION 'Arrêt : une autre vente existe. Vérifier le périmètre avant toute suppression.';
  END IF;
  IF EXISTS (SELECT 1 FROM sale_lines l JOIN products p ON p.id = l.product_id
             WHERE p.description IS DISTINCT FROM 'Article de démonstration' OR p.sku IS NULL OR p.sku !~ '^DEMO-[WA][0-9]{2}$') THEN
    RAISE EXCEPTION 'Arrêt : une ligne de vente concerne un produit hors démonstration.';
  END IF;
  IF EXISTS (SELECT 1 FROM products p WHERE p.description = 'Article de démonstration'
             AND p.sku ~ '^DEMO-[WA][0-9]{2}$' AND (p.status <> 'ARCHIVED' OR p.stock_quantity <> 0)) THEN
    RAISE EXCEPTION 'Archiver le stock de démonstration avant la remise à zéro.';
  END IF;
END $$;

-- Trigger changes are transactional: any failure restores all protections.
ALTER TABLE fiscal_events DISABLE TRIGGER prevent_fiscal_events_mod;
ALTER TABLE fiscal_closures DISABLE TRIGGER prevent_fiscal_closures_mod;
ALTER TABLE payments DISABLE TRIGGER prevent_payments_mod;
ALTER TABLE sale_lines DISABLE TRIGGER prevent_sale_lines_mod;
ALTER TABLE sales DISABLE TRIGGER enforce_sale_immutability_delete;
ALTER TABLE stock_movements DISABLE TRIGGER prevent_stock_movements_mod;

DELETE FROM fiscal_closures;
DELETE FROM fiscal_events WHERE entity_id = '8e6bc05d-78ec-45f5-af4d-b4b135792993';
DELETE FROM payments WHERE sale_id = '8e6bc05d-78ec-45f5-af4d-b4b135792993';
DELETE FROM sale_lines WHERE sale_id = '8e6bc05d-78ec-45f5-af4d-b4b135792993';
DELETE FROM sales WHERE id = '8e6bc05d-78ec-45f5-af4d-b4b135792993';
DELETE FROM stock_movements WHERE product_id IN (
  SELECT id FROM products WHERE description = 'Article de démonstration' AND sku ~ '^DEMO-[WA][0-9]{2}$'
);
DELETE FROM serialized_items WHERE product_id IN (
  SELECT id FROM products WHERE description = 'Article de démonstration' AND sku ~ '^DEMO-[WA][0-9]{2}$'
);
DELETE FROM products WHERE description = 'Article de démonstration' AND sku ~ '^DEMO-[WA][0-9]{2}$';

UPDATE fiscal_counters SET value = 0 WHERE name IN ('RECEIPT', 'FISCAL_EVENT', 'CLOSURE');

ALTER TABLE fiscal_events ENABLE TRIGGER prevent_fiscal_events_mod;
ALTER TABLE fiscal_closures ENABLE TRIGGER prevent_fiscal_closures_mod;
ALTER TABLE payments ENABLE TRIGGER prevent_payments_mod;
ALTER TABLE sale_lines ENABLE TRIGGER prevent_sale_lines_mod;
ALTER TABLE sales ENABLE TRIGGER enforce_sale_immutability_delete;
ALTER TABLE stock_movements ENABLE TRIGGER prevent_stock_movements_mod;
COMMIT;
