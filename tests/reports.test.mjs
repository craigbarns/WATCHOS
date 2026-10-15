import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { parisDay } from '../src/lib/format.ts'

test('Cancelled sales do not count as extra tickets in reports', async (t) => {
  // Local PostgreSQL only: never writes to the live shop.
  const db = new PGlite({ extensions: { uuid_ossp, pgcrypto } })
  try {
    await db.exec(`CREATE SCHEMA auth; CREATE SCHEMA extensions;
      CREATE ROLE anon; CREATE ROLE authenticated;
      CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;`)
    for (const file of (await readdir('supabase/migrations')).filter((f) => f.endsWith('.sql')).sort()) await db.exec(await readFile(`supabase/migrations/${file}`, 'utf8'))
    const admin = crypto.randomUUID()
    await db.query('INSERT INTO auth.users VALUES ($1, $2)', [admin, 'admin@example.invalid'])
    await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [admin])
    const service = Object.fromEntries((await db.query('SELECT code, id FROM service_categories')).rows.map((r) => [r.code, r.id]))
    const sell = async (code, amount, method = 'CB') => (await db.query('SELECT finalize_sale(null,$1::jsonb,$2::jsonb,$3) AS s', [
      JSON.stringify([{ service_id: service[code], quantity: 1, unit_price_ttc: amount }]), JSON.stringify([{ method, amount }]), crypto.randomUUID(),
    ])).rows[0].s

    // Journée : 8 + 8 + 59 + 8 € encaissés, et une pile saisie à 59 € puis annulée par avoir
    await sell('pile', 8)
    await sell('pile', 8, 'ESPÈCES')
    await sell('bracelet', 59)
    const mistake = await sell('pile', 59)
    await db.query('SELECT refund_sale($1, $2, $3)', [mistake.sale_id, 'Erreur de prix', crypto.randomUUID()])
    await sell('pile', 8)

    await t.test('Cash report counts sale tickets and cancellations separately', async () => {
      const report = (await db.query("SELECT cash_report(now() - interval '1 day', now() + interval '1 day') AS r")).rows[0].r
      assert.equal(Number(report.total_ttc), 83)
      assert.equal(Number(report.tickets), 5)
      assert.equal(Number(report.refunds), 1)
      assert.equal(Number(report.refunds_ttc), -59)
      assert.equal(Number(report.average_ticket), 20.75)
      assert.match(report.first_receipt, /^T\d{4}-000001$/)
      assert.match(report.last_receipt, /^T\d{4}-000006$/)
      assert.equal(Number(report.payments_total), 83)
      assert.equal(report.balanced, true)
      const daily = (await db.query('SELECT day_cash_report($1) AS r', [parisDay()])).rows[0].r
      assert.equal(Number(daily.tickets), 5)
      assert.equal(Number(daily.average_ticket), 20.75)
    })

    await t.test('Statistics count tickets net of cancellations, like quantities and turnover', async () => {
      const rows = (await db.query('SELECT * FROM service_sales_stats($1,$1)', [parisDay()])).rows
      const pile = rows.find((r) => r.service_id === service.pile)
      assert.equal(Number(pile.quantity), 3)
      assert.equal(Number(pile.tickets), 3)
      assert.equal(Number(pile.total_ttc), 24)
      const bracelet = rows.find((r) => r.service_id === service.bracelet)
      assert.equal(Number(bracelet.tickets), 1)
      assert.equal(Number(bracelet.total_ttc), 59)
    })

    await t.test('An empty period reports zero without dividing by zero', async () => {
      const report = (await db.query("SELECT cash_report('2020-01-01T00:00:00Z', '2020-01-02T00:00:00Z') AS r")).rows[0].r
      assert.equal(Number(report.tickets), 0)
      assert.equal(Number(report.refunds), 0)
      assert.equal(Number(report.average_ticket), 0)
      assert.equal(report.first_receipt, null)
      assert.equal(report.balanced, true)
    })
  } finally {
    await db.close()
  }
})
