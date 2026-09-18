import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { savPaymentSchema } from '../src/lib/sav-payment.ts'

test('SAV amounts accept French decimals and distinguish unknown amounts from free work', () => {
  const input = { id: crypto.randomUUID(), amount_due: '', is_paid: false }
  for (const [amount_due, expected] of [['', null], ['  ', null], ['15,50', 15.5], [' 25.90 ', 25.9], ['0', 0], ['999999,99', 999999.99]]) {
    assert.equal(savPaymentSchema.parse({ ...input, amount_due }).amount_due, expected)
  }
  for (const amount_due of ['-1', '1,001', '1.001', '1000000', 'NaN', 'Infinity', '1e3', '15 euros', '1,2.3']) {
    assert.equal(savPaymentSchema.safeParse({ ...input, amount_due }).success, false, amount_due)
  }
  assert.equal(savPaymentSchema.safeParse({ ...input, is_paid: true }).success, false)
  assert.equal(savPaymentSchema.safeParse({ ...input, amount_due: '0', is_paid: true }).success, true)
  assert.equal(savPaymentSchema.safeParse({ ...input, is_paid: 'false' }).success, false)
})

test('SAV payment persistence, audit and access are transactional', async (t) => {
  // Local PostgreSQL only: never writes to the live shop.
  const db = new PGlite({ extensions: { uuid_ossp, pgcrypto } })
  try {
    await db.exec(`CREATE SCHEMA auth; CREATE SCHEMA extensions;
      CREATE ROLE anon; CREATE ROLE authenticated;
      CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;`)
    for (const file of (await readdir('supabase/migrations')).filter((f) => f.endsWith('.sql')).sort()) {
      if (file === '20260921000000_sav_payment_and_store_name.sql') {
        await db.exec("INSERT INTO settings(store_name,company_name) VALUES ('Heure et Passion','Raison sociale conservée')")
      }
      await db.exec(await readFile(`supabase/migrations/${file}`, 'utf8'))
    }
    const admin = crypto.randomUUID()
    const tech = crypto.randomUUID()
    await db.query('INSERT INTO auth.users VALUES ($1,$2),($3,$4)', [admin, 'admin@example.invalid', tech, 'tech@example.invalid'])
    await db.query("UPDATE profiles SET active=true,role='TECHNICIEN' WHERE id=$1", [tech])
    const login = (id) => db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [id])
    await login(admin)
    const customer = (await db.query("INSERT INTO customers(first_name,last_name) VALUES ('Client','Test') RETURNING id")).rows[0].id
    const sav = (await db.query("INSERT INTO sav_cases(case_number,customer_id) VALUES ('SAV-PAYMENT-TEST',$1) RETURNING id", [customer])).rows[0].id
    const update = (amount, paid, id = sav) => db.query('SELECT update_sav_payment($1,$2,$3)', [id, amount, paid])
    const payment = async () => (await db.query('SELECT amount_due,is_paid FROM sav_cases WHERE id=$1', [sav])).rows[0]
    const events = async () => (await db.query('SELECT * FROM sav_events WHERE sav_case_id=$1 ORDER BY created_at,id', [sav])).rows

    await t.test('Migration corrects the trading name and preserves the legal company name', async () => {
      assert.deepEqual((await db.query('SELECT store_name,company_name FROM settings')).rows, [{ store_name: 'Heures et Passion', company_name: 'Raison sociale conservée' }])
      assert.deepEqual(await payment(), { amount_due: null, is_paid: false })
    })
    await t.test('Amount and checkbox persist with before/after values and the operator in history', async () => {
      await update('15.50', false)
      assert.deepEqual(await payment(), { amount_due: '15.50', is_paid: false })
      await login(tech)
      await update('15.50', true)
      assert.deepEqual(await payment(), { amount_due: '15.50', is_paid: true })
      const history = await events()
      assert.equal(history.length, 2)
      assert.equal(history[1].event_type, 'PAYMENT')
      assert.equal(history[1].user_id, tech)
      assert.match(history[1].description, /15,50 € \(Non payé\) → 15,50 € \(Payé\)/)
      await update('15.50', true)
      assert.equal((await events()).length, 2)
      await update('20.00', false)
      assert.deepEqual(await payment(), { amount_due: '20.00', is_paid: false })
      await update(null, false)
      assert.deepEqual(await payment(), { amount_due: null, is_paid: false })
      await update('0', true)
      assert.deepEqual(await payment(), { amount_due: '0.00', is_paid: true })
      const counts = (await db.query('SELECT (SELECT count(*)::int FROM sales) AS sales,(SELECT count(*)::int FROM payments) AS payments,(SELECT count(*)::int FROM fiscal_events) AS fiscal_events')).rows[0]
      assert.deepEqual(counts, { sales: 0, payments: 0, fiscal_events: 0 })
    })
    await t.test('Invalid amounts, missing cases and absent payment flags leave state and history unchanged', async () => {
      const before = await events()
      for (const amount of ['-1', '1.001', '1000000', 'NaN', 'Infinity', '-Infinity']) {
        await assert.rejects(update(amount, false), /Montant invalide/)
      }
      await assert.rejects(update(null, true), /Renseignez le montant/)
      await assert.rejects(update('10', null), /Indiquez/)
      await assert.rejects(update('10', false, crypto.randomUUID()), /introuvable/)
      assert.deepEqual(await payment(), { amount_due: '0.00', is_paid: true })
      assert.deepEqual(await events(), before)
    })
    await t.test('Inactive or anonymous users cannot change payment information', async () => {
      await login('')
      await assert.rejects(update('25', false), /Accès refusé/)
      await login(tech)
      await db.query('UPDATE profiles SET active=false WHERE id=$1', [tech])
      await assert.rejects(update('25', false), /Accès refusé/)
      assert.equal((await db.query("SELECT has_function_privilege('anon','update_sav_payment(uuid,numeric,boolean)','EXECUTE') AS allowed")).rows[0].allowed, false)
      assert.equal((await db.query("SELECT has_function_privilege('authenticated','update_sav_payment(uuid,numeric,boolean)','EXECUTE') AS allowed")).rows[0].allowed, true)
      await login(admin)
    })
    await t.test('A failed history insert rolls back the payment update', async () => {
      await db.exec(`CREATE FUNCTION reject_payment_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Simulated history failure'; END $$;
        CREATE TRIGGER reject_payment_event BEFORE INSERT ON sav_events FOR EACH ROW EXECUTE FUNCTION reject_payment_event();`)
      await assert.rejects(update('40', false), /Simulated history failure/)
      assert.deepEqual(await payment(), { amount_due: '0.00', is_paid: true })
    })
  } finally { await db.close() }
})
