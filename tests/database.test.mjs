import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { generateFiscalHash, generateClosureHash } from '../src/lib/fiscal/core.ts'

// An isolated PostgreSQL instance: no production connection or credentials.
test('Stock, sales, permissions and fiscal journal integrate correctly', async (t) => {
  const db = new PGlite({ extensions: { uuid_ossp, pgcrypto } })
  try {
    await db.exec(`CREATE SCHEMA auth; CREATE SCHEMA extensions;
      CREATE ROLE anon; CREATE ROLE authenticated;
      CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;`)
    for (const file of (await readdir('supabase/migrations')).filter((f) => f.endsWith('.sql')).sort()) await db.exec(await readFile(`supabase/migrations/${file}`, 'utf8'))
    const admin = '00000000-0000-4000-8000-000000000001'
    const tech = '00000000-0000-4000-8000-000000000002'
    const accessory = '00000000-0000-4000-8000-000000000003'
    const watch = '00000000-0000-4000-8000-000000000004'
    const serial = '00000000-0000-4000-8000-000000000005'
    await db.query('INSERT INTO auth.users VALUES ($1, $2), ($3, $4)', [admin, 'admin@example.invalid', tech, 'tech@example.invalid'])
    await db.query("UPDATE profiles SET active=true, role='TECHNICIEN' WHERE id=$1", [tech])
    await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [admin])
    await db.exec("INSERT INTO settings (store_name,app_version,fiscal_core_version) VALUES ('Test','1.1.0','1.1.0')")
    await db.query("INSERT INTO products (id,type,model,selling_price_ttc,vat_rate,stock_quantity) VALUES ($1,'NON_SERIALIZED','Accessoire test',120,20,3),($2,'SERIALIZED','Montre test',240,20,0)", [accessory, watch])
    await db.query("INSERT INTO serialized_items (id,product_id,serial_number) VALUES ($1,$2,'TEST-001')", [serial,watch])
    const lines = [{ product_id: accessory, quantity: 1 }, { product_id: watch, serialized_item_id: serial, quantity: 1 }]
    const finalize = async (payment, key, input = lines) => (await db.query('SELECT finalize_sale(null,$1::jsonb,$2::jsonb,$3) AS sale', [JSON.stringify(input), JSON.stringify([{ method: 'CB', amount: payment }]), key])).rows[0].sale
    await t.test('Payment mismatch rolls back stock and journal', async () => {
      await assert.rejects(finalize(1, 'invalid-payment'))
      assert.equal((await db.query('SELECT count(*)::int AS n FROM sales')).rows[0].n, 0)
      assert.equal((await db.query('SELECT stock_quantity FROM products WHERE id=$1', [accessory])).rows[0].stock_quantity, 3)
    })
    let sale
    await t.test('Sale is atomic and idempotent', async () => {
      sale = await finalize(360, 'test-sale-001')
      assert.equal((await finalize(360, 'test-sale-001')).sale_id, sale.sale_id)
      assert.equal((await db.query('SELECT count(*)::int AS n FROM sales')).rows[0].n, 1)
      assert.equal((await db.query('SELECT stock_quantity FROM products WHERE id=$1', [accessory])).rows[0].stock_quantity, 2)
      assert.equal((await db.query('SELECT status FROM serialized_items WHERE id=$1', [serial])).rows[0].status, 'SOLD')
    })
    await t.test('SQL and JavaScript agree on the fiscal hash', async () => {
      const e = (await db.query('SELECT * FROM fiscal_events')).rows[0]
      assert.equal(e.current_hash, generateFiscalHash(e.canonical_payload, e.sequence_number, e.previous_hash))
    })
    await t.test('Sold watches cannot be sold again or restored', async () => {
      await assert.rejects(finalize(240, 'second-sale', [lines[1]]))
      await assert.rejects(db.query("SELECT set_serialized_status($1,'AVAILABLE','Test')", [serial]))
    })
    await t.test('Inventory retirement is audited without touching the sale', async () => {
      await db.query("SELECT adjust_product_stock($1,'INVENTORY',0,'Retrait démonstration')", [accessory])
      assert.equal((await db.query('SELECT stock_quantity FROM products WHERE id=$1', [accessory])).rows[0].stock_quantity, 0)
      assert.equal((await db.query("SELECT quantity FROM stock_movements WHERE movement_type='INVENTORY'")).rows[0].quantity, -2)
      assert.equal((await db.query('SELECT count(*)::int AS n FROM sales')).rows[0].n, 1)
      await assert.rejects(finalize(120, 'out-of-stock', [lines[0]]))
    })
    await t.test('Sales, payments and journal remain immutable', async () => {
      await assert.rejects(db.query('DELETE FROM sales WHERE id=$1', [sale.sale_id]))
      await assert.rejects(db.exec('DELETE FROM payments'))
      await assert.rejects(db.exec('UPDATE fiscal_events SET amount_ttc=1'))
    })
    await t.test('Technicians cannot sell or change inventory', async () => {
      await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [tech])
      await assert.rejects(db.query("SELECT adjust_product_stock($1,'PURCHASE',1,'Test')", [accessory]))
      // A fresh in-stock accessory avoids a false positive caused by insufficient stock.
      await db.query('UPDATE products SET stock_quantity=1 WHERE id=$1', [accessory])
      await assert.rejects(finalize(120, 'technician-sale', [lines[0]]), /administrateurs|vendeurs|Accès refusé/)
    })
    await t.test('Daily closures use Paris boundaries and cannot be duplicated', async () => {
      await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [admin])
      await db.exec("SELECT close_day('2026-03-29')")
      const closure = (await db.query('SELECT * FROM fiscal_closures')).rows[0]
      assert.equal(new Date(closure.period_end) - new Date(closure.period_start), 23 * 60 * 60 * 1000)
      assert.equal(closure.current_hash, generateClosureHash(closure, closure.sequence_number, closure.previous_hash))
      await assert.rejects(db.exec("SELECT close_day('2026-03-29')"), /déjà clôturée/)
      await assert.rejects(db.exec('DELETE FROM fiscal_closures'))
    })
    await t.test('Test reset refuses unrelated data, removes only the approved trial and restores protections', async () => {
      const reset = (await readFile('scripts/maintenance/reset-test-shop.sql', 'utf8')).replaceAll('8e6bc05d-78ec-45f5-af4d-b4b135792993', sale.sale_id)
      await assert.rejects(db.exec(reset), /hors démonstration/)
      await db.exec('ROLLBACK')
      await db.query("UPDATE products SET description='Article de démonstration',sku=CASE WHEN type='SERIALIZED' THEN 'DEMO-W01' ELSE 'DEMO-A01' END,status='ARCHIVED',stock_quantity=0")
      await db.exec(reset)
      for (const table of ['sales','sale_lines','payments','fiscal_events','fiscal_closures','products','serialized_items','stock_movements']) {
        assert.equal((await db.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n, 0, table)
      }
      assert.equal((await db.query("SELECT count(*)::int AS n FROM pg_trigger WHERE tgenabled='D'")).rows[0].n, 0)
      await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [admin])
      await db.query("INSERT INTO products (id,type,model,selling_price_ttc,vat_rate,stock_quantity) VALUES ($1,'NON_SERIALIZED','Article réel',120,20,1)", [accessory])
      const fresh = await finalize(120, 'fresh-start', [lines[0]])
      assert.match(fresh.receipt_number, /000001$/)
      const event = (await db.query('SELECT * FROM fiscal_events')).rows[0]
      assert.equal(event.sequence_number, 1)
      assert.equal(event.previous_hash, 'GENESIS')
      await assert.rejects(db.exec('DELETE FROM fiscal_events'))
    })

  } finally { await db.close() }
})
