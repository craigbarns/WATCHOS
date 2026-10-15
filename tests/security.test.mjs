import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'

// Local PostgreSQL only. Requests run as the API roles (anon / authenticated) with
// Supabase's default grants, so row level security and triggers apply as in production.
test('Direct API access cannot write sales or fiscal data', async (t) => {
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
    const sale = (await as('vendeur', 'SELECT finalize_sale(null,$1::jsonb,$2::jsonb,$3) AS s', [
      JSON.stringify([{ service_id: pile, quantity: 1, unit_price_ttc: 8 }]), JSON.stringify([{ method: 'ESPÈCES', amount: 8 }]), crypto.randomUUID(),
    ])).rows[0].s

    await t.test('Visitors and disabled accounts see nothing; sales data cannot be written directly', async () => {
      assert.equal((await as('anon', 'SELECT * FROM sales')).rows.length, 0)
      assert.equal((await as('inactif', 'SELECT * FROM sales')).rows.length, 0)
      await assert.rejects(as('vendeur', "INSERT INTO sales (status, receipt_number, total_ttc) VALUES ('FINALIZED', 'T-FAUX', 1)"))
      await assert.rejects(as('vendeur', "INSERT INTO payments (sale_id, method, amount) VALUES ($1, 'CB', 1)", [sale.sale_id]))
      for (const sql of ["UPDATE payments SET method = 'CB'", 'DELETE FROM sales', 'UPDATE fiscal_counters SET value = 0', "UPDATE profiles SET role = 'ADMIN'", 'UPDATE service_categories SET vat_rate = 0']) {
        assert.equal((await as('vendeur', sql)).affectedRows, 0, sql)
      }
    })

    await t.test('Technicians cannot sell, cancel or close a day', async () => {
      await assert.rejects(as('tech', 'SELECT finalize_sale(null,$1::jsonb,$2::jsonb,$3)', [
        JSON.stringify([{ service_id: pile, quantity: 1, unit_price_ttc: 8 }]), JSON.stringify([{ method: 'CB', amount: 8 }]), crypto.randomUUID(),
      ]), /Accès refusé|administrateurs/)
      await assert.rejects(as('tech', "SELECT refund_sale($1, 'Erreur de saisie', $2)", [sale.sale_id, crypto.randomUUID()]), /administrateurs et les vendeurs/)
      await assert.rejects(as('tech', "SELECT close_day('2020-01-01')"), /Accès refusé/)
      await assert.rejects(as('anon', "SELECT close_day('2020-01-01')"), /permission denied/)
    })
  } finally {
    await db.close()
  }
})
