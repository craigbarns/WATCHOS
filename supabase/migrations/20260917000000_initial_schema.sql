-- PHASE 1 & BASE SCHEMA

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. PROFILES (extends Supabase Auth)
CREATE TABLE profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('ADMIN', 'VENDEUR', 'TECHNICIEN')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. SETTINGS
CREATE TABLE settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    store_name TEXT NOT NULL,
    company_name TEXT,
    address TEXT,
    siret TEXT,
    vat_number TEXT,
    phone TEXT,
    email TEXT,
    app_version TEXT NOT NULL DEFAULT '1.0.0',
    fiscal_core_version TEXT NOT NULL DEFAULT '1.0.0',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. CUSTOMERS
CREATE TABLE customers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    civility TEXT,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    address TEXT,
    postal_code TEXT,
    city TEXT,
    country TEXT,
    internal_notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX idx_customers_phone ON customers(phone);
CREATE INDEX idx_customers_email ON customers(email);
CREATE INDEX idx_customers_name ON customers(last_name, first_name);

-- 4. PRODUCTS (Type A and B)
CREATE TABLE products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    type TEXT NOT NULL CHECK (type IN ('SERIALIZED', 'NON_SERIALIZED')),
    brand TEXT,
    collection TEXT,
    model TEXT NOT NULL,
    reference TEXT,
    sku TEXT,
    ean TEXT,
    description TEXT,
    movement TEXT,
    caliber TEXT,
    diameter TEXT,
    material TEXT,
    bracelet TEXT,
    color TEXT,
    condition TEXT CHECK (condition IN ('NEW', 'USED')),
    purchase_price_ht NUMERIC(12, 2),
    purchase_price_ttc NUMERIC(12, 2),
    selling_price_ttc NUMERIC(12, 2) NOT NULL,
    vat_rate NUMERIC(5, 2) NOT NULL,
    location TEXT,
    status TEXT DEFAULT 'AVAILABLE',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX idx_products_reference ON products(reference);
CREATE INDEX idx_products_sku ON products(sku);
CREATE INDEX idx_products_ean ON products(ean);

-- 5. SERIALIZED ITEMS (Specific instances of watches)
CREATE TABLE serialized_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_id UUID NOT NULL REFERENCES products(id),
    serial_number TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE', 'RESERVED', 'SOLD', 'IN_SAV', 'RETURNED', 'ARCHIVED')),
    year TEXT,
    has_box BOOLEAN DEFAULT FALSE,
    has_papers BOOLEAN DEFAULT FALSE,
    has_certificate BOOLEAN DEFAULT FALSE,
    entry_date DATE,
    supplier TEXT,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX idx_serialized_items_serial ON serialized_items(serial_number);
CREATE INDEX idx_serialized_items_status ON serialized_items(status);

-- 6. STOCK MOVEMENTS (Append only)
CREATE TABLE stock_movements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_id UUID NOT NULL REFERENCES products(id),
    serialized_item_id UUID REFERENCES serialized_items(id),
    movement_type TEXT NOT NULL CHECK (movement_type IN ('PURCHASE', 'SALE', 'RETURN', 'SAV_OUT', 'SAV_IN', 'ADJUSTMENT', 'INVENTORY')),
    quantity INTEGER NOT NULL,
    user_id UUID REFERENCES profiles(id),
    reason TEXT,
    reference_id UUID, -- Can link to a sale or SAV
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX idx_stock_movements_product ON stock_movements(product_id);

-- 7. SALES
CREATE TABLE sales (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'FINALIZED')),
    receipt_number TEXT UNIQUE, -- Nullable while DRAFT, generated when FINALIZED
    customer_id UUID REFERENCES customers(id),
    user_id UUID REFERENCES profiles(id),
    total_ht NUMERIC(12, 2) DEFAULT 0,
    total_vat NUMERIC(12, 2) DEFAULT 0,
    total_ttc NUMERIC(12, 2) DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    finalized_at TIMESTAMP WITH TIME ZONE,
    parent_sale_id UUID REFERENCES sales(id) -- Used for refunds linking to original sale
);
CREATE INDEX idx_sales_receipt ON sales(receipt_number);
CREATE INDEX idx_sales_status ON sales(status);
CREATE INDEX idx_sales_date ON sales(finalized_at);

-- 8. SALE LINES
CREATE TABLE sale_lines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sale_id UUID NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id),
    serialized_item_id UUID REFERENCES serialized_items(id),
    label TEXT NOT NULL, -- Snapshot of product name
    quantity INTEGER NOT NULL,
    unit_price_ht NUMERIC(12, 2) NOT NULL,
    unit_price_ttc NUMERIC(12, 2) NOT NULL,
    vat_rate NUMERIC(5, 2) NOT NULL,
    discount_amount NUMERIC(12, 2) DEFAULT 0,
    total_ttc NUMERIC(12, 2) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 9. PAYMENTS
CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sale_id UUID NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    method TEXT NOT NULL CHECK (method IN ('CB', 'ESPÈCES', 'VIREMENT', 'CHÈQUE', 'AUTRE')),
    amount NUMERIC(12, 2) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 10. FISCAL EVENTS (Append only, Immutability, Chaining)
CREATE TABLE fiscal_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sequence_number SERIAL NOT NULL,
    event_type TEXT NOT NULL CHECK (event_type IN ('SALE', 'REFUND')),
    entity_id UUID NOT NULL REFERENCES sales(id),
    operator_id UUID REFERENCES profiles(id),
    occurred_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    amount_ht NUMERIC(12, 2) NOT NULL,
    vat_amount NUMERIC(12, 2) NOT NULL,
    amount_ttc NUMERIC(12, 2) NOT NULL,
    canonical_payload JSONB NOT NULL,
    previous_hash TEXT,
    current_hash TEXT NOT NULL,
    app_version TEXT NOT NULL,
    fiscal_core_version TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE UNIQUE INDEX idx_fiscal_events_sequence ON fiscal_events(sequence_number);

-- 11. FISCAL CLOSURES
CREATE TABLE fiscal_closures (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    closure_type TEXT NOT NULL CHECK (closure_type IN ('DAILY', 'MONTHLY', 'ANNUAL')),
    period_start TIMESTAMP WITH TIME ZONE NOT NULL,
    period_end TIMESTAMP WITH TIME ZONE NOT NULL,
    operations_count INTEGER NOT NULL,
    total_ht NUMERIC(15, 2) NOT NULL,
    total_vat NUMERIC(15, 2) NOT NULL,
    total_ttc NUMERIC(15, 2) NOT NULL,
    perpetual_total NUMERIC(15, 2) NOT NULL, -- The grand total
    sequence_number SERIAL NOT NULL,
    previous_hash TEXT,
    current_hash TEXT NOT NULL,
    app_version TEXT NOT NULL,
    fiscal_core_version TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID REFERENCES profiles(id)
);

-- 12. SAV CASES
CREATE TABLE sav_cases (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    case_number TEXT UNIQUE NOT NULL,
    customer_id UUID NOT NULL REFERENCES customers(id),
    brand TEXT,
    model TEXT,
    reference TEXT,
    serial_number TEXT,
    deposit_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    declared_problem TEXT,
    visual_condition TEXT,
    accessories_left TEXT,
    box_left BOOLEAN DEFAULT FALSE,
    technician_id UUID REFERENCES profiles(id),
    diagnostic TEXT,
    estimated_date DATE,
    internal_notes TEXT,
    status TEXT NOT NULL DEFAULT 'RECU' CHECK (status IN ('RECU', 'DIAGNOSTIC', 'DEVIS_A_FAIRE', 'ATTENTE_CLIENT', 'ACCEPTE', 'REFUSE', 'EN_REPARATION', 'ATTENTE_PIECE', 'CONTROLE', 'PRET', 'CLIENT_PREVENU', 'RESTITUE', 'ANNULE')),
    return_date TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX idx_sav_cases_number ON sav_cases(case_number);
CREATE INDEX idx_sav_cases_status ON sav_cases(status);

-- 13. SAV EVENTS
CREATE TABLE sav_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sav_case_id UUID NOT NULL REFERENCES sav_cases(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    description TEXT,
    user_id UUID REFERENCES profiles(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 14. SAV PHOTOS
CREATE TABLE sav_photos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sav_case_id UUID NOT NULL REFERENCES sav_cases(id) ON DELETE CASCADE,
    photo_url TEXT NOT NULL,
    photo_type TEXT,
    user_id UUID REFERENCES profiles(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- IMMUTABILITY TRIGGERS
CREATE OR REPLACE FUNCTION check_sale_immutability() RETURNS TRIGGER AS $$
BEGIN
    IF OLD.status = 'FINALIZED' THEN
        RAISE EXCEPTION 'A finalized sale cannot be modified or deleted.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER enforce_sale_immutability_update
BEFORE UPDATE ON sales
FOR EACH ROW EXECUTE FUNCTION check_sale_immutability();

CREATE TRIGGER enforce_sale_immutability_delete
BEFORE DELETE ON sales
FOR EACH ROW EXECUTE FUNCTION check_sale_immutability();

CREATE OR REPLACE FUNCTION prevent_modification() RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'This table is append-only. Updates and Deletes are forbidden.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER prevent_fiscal_events_mod
BEFORE UPDATE OR DELETE ON fiscal_events
FOR EACH ROW EXECUTE FUNCTION prevent_modification();

CREATE TRIGGER prevent_fiscal_closures_mod
BEFORE UPDATE OR DELETE ON fiscal_closures
FOR EACH ROW EXECUTE FUNCTION prevent_modification();

CREATE TRIGGER prevent_stock_movements_mod
BEFORE UPDATE OR DELETE ON stock_movements
FOR EACH ROW EXECUTE FUNCTION prevent_modification();

CREATE TRIGGER prevent_sav_events_mod
BEFORE UPDATE OR DELETE ON sav_events
FOR EACH ROW EXECUTE FUNCTION prevent_modification();
