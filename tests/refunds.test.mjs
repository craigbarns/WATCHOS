import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { verifyFiscalChain } from '../src/lib/fiscal/core.ts'

// Local PostgreSQL only: never writes to the live shop.
test('Cancellations (avoirs) and SAV checkout', async (t) => {
  const db = new PGlite({ extensions: { uuid_ossp, pgcrypto } })
  try {
    await db.exec(`CREATE SCHEMA auth; CREATE SCHEMA extensions;
      CREATE ROLE anon; CREATE ROLE authenticated;
      CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;`)
    for (const file of (await readdir('supabase/migrations')).filter((f) => f.endsWith('.sql')).sort()) await db.exec(await readFile(`supabase/migrations/${file}`, 'utf8'))
    const admin = crypto.randomUUID()
    const tech = crypto.randomUUID()
    await db.query('INSERT INTO auth.users VALUES ($1,$2),($3,$4)', [admin, 'admin@example.invalid', tech, 'tech@example.invalid'])
    await db.query("UPDATE profiles SET active=true, role='TECHNICIEN' WHERE id=$1", [tech])
    const login = (id) => db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [id])
    await login(admin)
    const service = Object.fromEntries((await db.query('SELECT code, id FROM service_categories')).rows.map((r) => [r.code, r.id]))
    const refund = async (saleId, reason = 'Erreur de prix', key = crypto.randomUUID()) => (await db.query('SELECT refund_sale($1,$2,$3) AS r', [saleId, reason, key])).rows[0].r

    const sale = (await db.query('SELECT finalize_sale(null,$1::jsonb,$2::jsonb,$3) AS s', [
      JSON.stringify([{ service_id: service.pile, quantity: 2, unit_price_ttc: 8, discount_amount: 1 }, { service_id: service.bracelet, quantity: 1, unit_price_ttc: 59 }]),
      JSON.stringify([{ method: 'ESPÈCES', amount: 20 }, { method: 'CB', amount: 54 }]),
      crypto.randomUUID(),
    ])).rows[0].s

    await t.test('An avoir mirrors the sale with negative lines, payments and a chained REFUND event', async () => {
      const key = crypto.randomUUID()
      const result = await refund(sale.sale_id, 'Erreur de prix', key)
      assert.match(result.receipt_number, /^A\d{4}-\d{6}$/)
      assert.equal(Number(result.total_ttc), -74)
      const avoir = (await db.query('SELECT * FROM sales WHERE id=$1', [result.refund_id])).rows[0]
      assert.equal(avoir.parent_sale_id, sale.sale_id)
      assert.equal(avoir.cancel_reason, 'Erreur de prix')
      assert.deepEqual([Number(avoir.total_ttc), Number(avoir.total_ht), Number(avoir.total_vat)], [-74, -61.67, -12.33])
      const lines = (await db.query('SELECT quantity, total_ttc, discount_amount FROM sale_lines WHERE sale_id=$1 ORDER BY total_ttc', [result.refund_id])).rows
      assert.deepEqual(lines.map((l) => [l.quantity, Number(l.total_ttc), Number(l.discount_amount)]), [[-1, -59, 0], [-2, -15, -1]])
      const payments = (await db.query('SELECT method, amount FROM payments WHERE sale_id=$1 ORDER BY method', [result.refund_id])).rows
      assert.deepEqual(payments.map((p) => [p.method, Number(p.amount)]), [['CB', -54], ['ESPÈCES', -20]])
      const events = (await db.query('SELECT * FROM fiscal_events ORDER BY sequence_number')).rows
      assert.deepEqual(events.map((e) => e.event_type), ['SALE', 'REFUND'])
      assert.equal(verifyFiscalChain(events.map((e) => ({ ...e, payload: e.canonical_payload }))).valid, true)
      // Même clé : l'avoir déjà créé est renvoyé, sans doublon
      assert.equal((await refund(sale.sale_id, 'Erreur de prix', key)).refund_id, result.refund_id)
      assert.equal((await db.query('SELECT count(*)::int AS n FROM sales WHERE parent_sale_id IS NOT NULL')).rows[0].n, 1)
    })

    await t.test('A sale is cancelled once, an avoir never, and only by sellers with a reason', async () => {
      await assert.rejects(refund(sale.sale_id), /déjà été annulée/)
      const avoir = (await db.query('SELECT id FROM sales WHERE parent_sale_id=$1', [sale.sale_id])).rows[0].id
      await assert.rejects(refund(avoir), /avoir ne peut pas être annulé/)
      const other = (await db.query('SELECT finalize_sale(null,$1::jsonb,$2::jsonb,$3) AS s', [
        JSON.stringify([{ service_id: service.pile, quantity: 1, unit_price_ttc: 8 }]), JSON.stringify([{ method: 'CB', amount: 8 }]), crypto.randomUUID(),
      ])).rows[0].s
      await assert.rejects(refund(other.sale_id, ' '), /motif/)
      await login(tech)
      await assert.rejects(refund(other.sale_id), /administrateurs et les vendeurs/)
      await login(admin)
    })

    await t.test('SAV checkout creates one ticket, and cancelling it reopens the case as unpaid', async () => {
      const customer = (await db.query("INSERT INTO customers (first_name,last_name) VALUES ('Jean','Test') RETURNING id")).rows[0].id
      const sav = (await db.query("INSERT INTO sav_cases (case_number, customer_id, brand, declared_problem) VALUES ('SAV-TEST-1', $1, 'Omega', 'Pile') RETURNING id", [customer])).rows[0].id
      const checkout = (amount, payments, key = crypto.randomUUID()) =>
        db.query('SELECT checkout_sav($1,$2,$3,$4::jsonb,$5) AS r', [sav, service.pile, amount, JSON.stringify(payments), key])
      await assert.rejects(checkout(8, [{ method: 'CB', amount: 5 }]), /ne correspondent pas/)
      const first = (await checkout(8, [{ method: 'CB', amount: 8 }])).rows[0].r
      const replay = (await checkout(8, [{ method: 'CB', amount: 8 }])).rows[0].r
      assert.equal(replay.sale_id, first.sale_id)
      assert.equal(replay.replayed, true)
      let state = (await db.query('SELECT sale_id, is_paid, amount_due FROM sav_cases WHERE id=$1', [sav])).rows[0]
      assert.deepEqual([state.sale_id, state.is_paid, Number(state.amount_due)], [first.sale_id, true, 8])
      const line = (await db.query('SELECT label, total_ttc FROM sale_lines WHERE sale_id=$1', [first.sale_id])).rows[0]
      assert.deepEqual([line.label, Number(line.total_ttc)], ['Pile', 8])

      await refund(first.sale_id)
      state = (await db.query('SELECT sale_id, is_paid FROM sav_cases WHERE id=$1', [sav])).rows[0]
      assert.deepEqual([state.sale_id, state.is_paid], [null, false])
      const history = (await db.query("SELECT description FROM sav_events WHERE sav_case_id=$1 AND event_type='PAYMENT' ORDER BY created_at, id", [sav])).rows
      assert.match(history.at(-1).description, /Encaissement annulé — avoir A\d{4}-\d{6}/)
    })
  } finally {
    await db.close()
  }
})
