import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'

// Local PostgreSQL only. Requests run as the API roles (anon / authenticated) with
// Supabase's default grants, so row level security and triggers apply as in production.
test('Direct API access cannot bypass the traced workflows', async (t) => {
  const db = new PGlite({ extensions: { uuid_ossp, pgcrypto } })
  try {
    await db.exec(`CREATE SCHEMA auth; CREATE SCHEMA extensions;
      CREATE ROLE anon; CREATE ROLE authenticated;
      CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      GRANT USAGE ON SCHEMA public, auth, extensions TO anon, authenticated;
      GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated;`)
    for (const file of (await readdir('supabase/migrations')).filter((f) => f.endsWith('.sql')).sort()) await db.exec(await readFile(`supabase/migrations/${file}`, 'utf8'))
    const users = { admin: crypto.randomUUID(), vendeur: crypto.randomUUID(), tech: crypto.randomUUID(), inactif: crypto.randomUUID() }
    for (const [name, id] of Object.entries(users)) await db.query('INSERT INTO auth.users VALUES ($1, $2)', [id, `${name}@example.invalid`])
    await db.query("UPDATE profiles SET active=true, role='VENDEUR' WHERE id=$1", [users.vendeur])
    await db.query("UPDATE profiles SET active=true, role='TECHNICIEN' WHERE id=$1", [users.tech])

    const as = async (who, sql, params = []) => {
      await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [who === 'anon' ? '' : users[who]])
      await db.exec(`SET ROLE ${who === 'anon' ? 'anon' : 'authenticated'}`)
      try {
        return await db.query(sql, params)
      } finally {
        await db.exec('RESET ROLE')
      }
    }
    const pile = (await db.query("SELECT id FROM service_categories WHERE code = 'pile'")).rows[0].id
    const sell = (who) => as(who, 'SELECT finalize_sale(null,$1::jsonb,$2::jsonb,$3) AS s', [
      JSON.stringify([{ service_id: pile, quantity: 1, unit_price_ttc: 8 }]), JSON.stringify([{ method: 'ESPÈCES', amount: 8 }]), crypto.randomUUID(),
    ]).then((r) => r.rows[0].s)
    const sale = await sell('vendeur')
    const customer = (await as('tech', "INSERT INTO customers (first_name, last_name) VALUES ('Jean', 'Test') RETURNING id")).rows[0].id
    const sav = (await as('tech', "INSERT INTO sav_cases (case_number, customer_id, brand, declared_problem) VALUES ('SAV-SEC-1', $1, 'Omega', 'Pile') RETURNING id", [customer])).rows[0].id

    await t.test('Visitors and disabled accounts see nothing; sales data cannot be written directly', async () => {
      assert.equal((await as('anon', 'SELECT * FROM sales')).rows.length, 0)
      assert.equal((await as('inactif', 'SELECT * FROM sales')).rows.length, 0)
      await assert.rejects(as('vendeur', "INSERT INTO sales (status, receipt_number, total_ttc) VALUES ('FINALIZED', 'T-FAUX', 1)"))
      await assert.rejects(as('vendeur', "INSERT INTO payments (sale_id, method, amount) VALUES ($1, 'CB', 1)", [sale.sale_id]))
      for (const sql of ["UPDATE payments SET method = 'CB'", 'DELETE FROM sales', 'UPDATE fiscal_counters SET value = 0', "UPDATE profiles SET role = 'ADMIN'", 'UPDATE service_categories SET vat_rate = 0']) {
        assert.equal((await as('vendeur', sql)).affectedRows, 0, sql)
      }
    })

    await t.test('SAV payment fields change only through the traced functions', async () => {
      await assert.rejects(as('tech', 'UPDATE sav_cases SET is_paid = true, amount_due = 59 WHERE id = $1', [sav]), /depuis sa fiche/)
      await assert.rejects(as('vendeur', 'UPDATE sav_cases SET sale_id = $2 WHERE id = $1', [sav, sale.sale_id]), /depuis sa fiche/)
      await assert.rejects(as('tech', "INSERT INTO sav_cases (case_number, customer_id, brand, declared_problem, is_paid, amount_due) VALUES ('SAV-SEC-2', $1, 'Omega', 'Pile', true, 8)", [customer]), /depuis sa fiche/)
      assert.equal((await as('tech', "UPDATE sav_cases SET status = 'DIAGNOSTIC' WHERE id = $1", [sav])).affectedRows, 1)
      await as('tech', 'SELECT update_sav_payment($1, 8, true)', [sav])
      const state = (await db.query('SELECT is_paid, amount_due FROM sav_cases WHERE id = $1', [sav])).rows[0]
      assert.deepEqual([state.is_paid, Number(state.amount_due)], [true, 8])
      const event = (await db.query("SELECT user_id FROM sav_events WHERE sav_case_id = $1 AND event_type = 'PAYMENT'", [sav])).rows
      assert.deepEqual(event.map((e) => e.user_id), [users.tech])
    })

    await t.test('A 12-month warranty is added only to a sale just encashed', async () => {
      const warranty = (who, saleId, months = 12) => as(who, 'INSERT INTO sale_warranties (sale_id, months, created_by) VALUES ($1, $2, auth.uid())', [saleId, months])
      await assert.rejects(warranty('vendeur', sale.sale_id, 120), /row-level security/)
      await assert.rejects(warranty('tech', sale.sale_id), /row-level security/)
      await warranty('vendeur', sale.sale_id)
      const second = await sell('vendeur')
      const refund = (await as('vendeur', "SELECT refund_sale($1, 'Erreur de saisie', $2) AS r", [second.sale_id, crypto.randomUUID()])).rows[0].r
      await assert.rejects(warranty('vendeur', refund.refund_id), /row-level security/)
      await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [users.admin])
      const old = (await db.query("INSERT INTO sales (status, receipt_number, total_ttc, finalized_at) VALUES ('FINALIZED', 'T-ANCIEN', 8, now() - interval '1 day') RETURNING id")).rows[0].id
      await assert.rejects(warranty('vendeur', old), /row-level security/)
    })
  } finally {
    await db.close()
  }
})
