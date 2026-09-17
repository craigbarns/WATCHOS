-- DEV SEED DATA

-- 1. SETTINGS
INSERT INTO settings (store_name, company_name, address, siret, vat_number, phone, email, app_version, fiscal_core_version)
VALUES (
    'Boutique Horlogerie',
    'Horlogerie SAS',
    '123 Rue de la Paix, 75001 Paris',
    '12345678900012',
    'FR12345678900',
    '01 23 45 67 89',
    'contact@horlogerie.com',
    '1.0.0',
    '1.0.0'
);

-- 2. PRODUCTS
INSERT INTO products (id, type, brand, model, reference, sku, description, purchase_price_ht, purchase_price_ttc, selling_price_ttc, vat_rate, status, stock_quantity)
VALUES 
    ('11111111-1111-1111-1111-111111111111', 'SERIALIZED', 'Rolex', 'Datejust', '126200', 'RX-DJ-01', 'Rolex Datejust 36mm Acier', 5000, 6000, 8500, 20.0, 'AVAILABLE', 0),
    ('22222222-2222-2222-2222-222222222222', 'SERIALIZED', 'Omega', 'Speedmaster', '310.30.42.50.01.002', 'OM-SP-01', 'Omega Speedmaster Moonwatch Sapphire', 4000, 4800, 7500, 20.0, 'AVAILABLE', 0),
    ('33333333-3333-3333-3333-333333333333', 'SERIALIZED', 'Tudor', 'Black Bay', '79030N', 'TU-BB-01', 'Tudor Black Bay Fifty-Eight', 2500, 3000, 3900, 20.0, 'AVAILABLE', 0),
    ('44444444-4444-4444-4444-444444444444', 'NON_SERIALIZED', 'Generic', 'Bracelet Cuir Noir', 'BR-CUIR-N', 'AC-001', 'Bracelet cuir véritable 20mm', 50, 60, 150, 20.0, 'AVAILABLE', 12),
    ('55555555-5555-5555-5555-555555555555', 'NON_SERIALIZED', 'Generic', 'Pile Montre', 'PILE-377', 'AC-002', 'Pile oxyde d''argent 377', 1, 1.2, 15, 20.0, 'AVAILABLE', 40);

-- 3. SERIALIZED ITEMS (Les montres physiques)
INSERT INTO serialized_items (id, product_id, serial_number, status, year, has_box, has_papers)
VALUES
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'RX893201', 'AVAILABLE', '2023', true, true),
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'OM782910', 'AVAILABLE', '2022', true, true),
    ('cccccccc-cccc-cccc-cccc-cccccccccccc', '33333333-3333-3333-3333-333333333333', 'TU441293', 'AVAILABLE', '2021', false, true);

-- 4. CUSTOMERS
INSERT INTO customers (id, first_name, last_name, phone, email)
VALUES
    ('99999999-9999-9999-9999-999999999991', 'Gregory', 'Baranes', '0601020304', 'gregory@example.com'),
    ('99999999-9999-9999-9999-999999999992', 'Jean', 'Dupont', '0701020304', 'jean@example.com');
