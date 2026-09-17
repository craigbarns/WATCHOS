CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- RPC: finalize_sale
-- Handled inside a single transaction.

CREATE OR REPLACE FUNCTION finalize_sale(
    p_customer_id UUID,
    p_user_id UUID,
    p_lines JSONB,
    p_payments JSONB,
    p_idempotency_key TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_sale_id UUID;
    v_receipt_number TEXT;
    v_total_ttc NUMERIC(12, 2) := 0;
    v_total_ht NUMERIC(12, 2) := 0;
    v_total_vat NUMERIC(12, 2) := 0;
    v_line JSONB;
    v_payment JSONB;
    v_sequence_number INT;
    v_prev_hash TEXT;
    v_current_hash TEXT;
    v_canonical TEXT;
    v_fiscal_payload JSONB;
    v_operator_id UUID;
BEGIN
    -- 1. Create the sale entry (FINALIZED immediately for simplicity here, or could transition from DRAFT)
    -- We assume atomic creation in this flow.
    v_receipt_number := 'TKT-' || to_char(NOW(), 'YYYYMMDD-HH24MISS') || '-' || upper(substring(md5(random()::text) from 1 for 4));

    INSERT INTO sales (status, receipt_number, customer_id, user_id, finalized_at)
    VALUES ('FINALIZED', v_receipt_number, p_customer_id, p_user_id, NOW())
    RETURNING id INTO v_sale_id;

    -- 2. Process Lines & Stock
    FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
    LOOP
        -- Insert line
        INSERT INTO sale_lines (sale_id, product_id, serialized_item_id, label, quantity, unit_price_ht, unit_price_ttc, vat_rate, total_ttc)
        VALUES (
            v_sale_id, 
            (v_line->>'product_id')::UUID, 
            NULLIF(v_line->>'serialized_item_id', '')::UUID,
            v_line->>'label', 
            (v_line->>'quantity')::INT, 
            (v_line->>'unit_price_ht')::NUMERIC, 
            (v_line->>'unit_price_ttc')::NUMERIC, 
            (v_line->>'vat_rate')::NUMERIC,
            (v_line->>'unit_price_ttc')::NUMERIC * (v_line->>'quantity')::INT
        );

        v_total_ttc := v_total_ttc + ((v_line->>'unit_price_ttc')::NUMERIC * (v_line->>'quantity')::INT);
        v_total_ht := v_total_ht + ((v_line->>'unit_price_ht')::NUMERIC * (v_line->>'quantity')::INT);

        -- Stock update for Serialized Item
        IF v_line->>'serialized_item_id' IS NOT NULL AND v_line->>'serialized_item_id' != '' THEN
            UPDATE serialized_items 
            SET status = 'SOLD', updated_at = NOW() 
            WHERE id = (v_line->>'serialized_item_id')::UUID AND status = 'AVAILABLE';
            
            IF NOT FOUND THEN
                RAISE EXCEPTION 'Article sérialisé indisponible ou déjà vendu: %', v_line->>'serialized_item_id';
            END IF;
        END IF;

        -- Create Stock Movement
        INSERT INTO stock_movements (product_id, serialized_item_id, movement_type, quantity, user_id, reason, reference_id)
        VALUES (
            (v_line->>'product_id')::UUID, 
            NULLIF(v_line->>'serialized_item_id', '')::UUID, 
            'SALE', 
            -(v_line->>'quantity')::INT, 
            p_user_id, 
            'Vente ' || v_receipt_number, 
            v_sale_id
        );
    END LOOP;

    v_total_vat := v_total_ttc - v_total_ht;

    -- Update Sale totals
    UPDATE sales 
    SET total_ht = v_total_ht, total_vat = v_total_vat, total_ttc = v_total_ttc
    WHERE id = v_sale_id;

    -- 3. Process Payments
    FOR v_payment IN SELECT * FROM jsonb_array_elements(p_payments)
    LOOP
        INSERT INTO payments (sale_id, method, amount)
        VALUES (v_sale_id, v_payment->>'method', (v_payment->>'amount')::NUMERIC);
    END LOOP;

    -- 4. BOFiP / Fiscal Event Creation
    -- Get previous hash
    SELECT current_hash INTO v_prev_hash FROM fiscal_events ORDER BY sequence_number DESC LIMIT 1;
    IF v_prev_hash IS NULL THEN v_prev_hash := 'GENESIS'; END IF;

    -- Build payload (Must match the Node.js schema)
    v_fiscal_payload := jsonb_build_object(
        'entity_id', v_sale_id,
        'event_type', 'SALE',
        'operator_id', p_user_id,
        'occurred_at', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'amount_ht', v_total_ht,
        'vat_amount', v_total_vat,
        'amount_ttc', v_total_ttc
    );

    -- Insert safely with sequence
    INSERT INTO fiscal_events (event_type, entity_id, operator_id, amount_ht, vat_amount, amount_ttc, canonical_payload, previous_hash, current_hash, app_version, fiscal_core_version)
    VALUES (
        'SALE', v_sale_id, p_user_id, v_total_ht, v_total_vat, v_total_ttc, v_fiscal_payload,
        v_prev_hash, 
        'PENDING_HASH_CALCULATION', -- In a real pure PG setup, we could use pgcrypto. Here we will let the Node app verify/generate it or do it via Trigger. 
        -- Actually, since BOFiP requires strict chaining, we can hash it right in PG using pgcrypto!
        '1.0.0', '1.0.0'
    ) RETURNING sequence_number INTO v_sequence_number;

    -- Canonical string building in PG
    v_canonical := 'amount_ht:' || to_char(v_total_ht, 'FM999999999.00') ||
                   '|amount_ttc:' || to_char(v_total_ttc, 'FM999999999.00') ||
                   '|entity_id:' || v_sale_id ||
                   '|event_type:SALE' ||
                   '|occurred_at:' || (v_fiscal_payload->>'occurred_at') ||
                   '|operator_id:' || p_user_id ||
                   '|sequence_number:' || v_sequence_number ||
                   '|vat_amount:' || to_char(v_total_vat, 'FM999999999.00');

    v_current_hash := encode(digest(v_prev_hash || '||' || v_canonical, 'sha256'), 'hex');

    UPDATE fiscal_events SET current_hash = v_current_hash WHERE sequence_number = v_sequence_number;

    RETURN jsonb_build_object(
        'success', true,
        'sale_id', v_sale_id,
        'receipt_number', v_receipt_number,
        'hash', v_current_hash
    );
END;
$$;
