import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { generateFiscalHash } from '../src/lib/fiscal/core.ts'
import { parisDay } from '../src/lib/format.ts'
import { whatsappPhone, whatsappLink, savReadyMessage } from '../src/lib/whatsapp.ts'

test('WhatsApp normalizes contact numbers and encodes the exact message', () => {
  for (const phone of ['06 12 34 56 78', '+33 6 12 34 56 78', '0033612345678', '+33 (0)6.12.34.56.78', '33612345678']) assert.equal(whatsappPhone(phone), '33612345678')
  assert.equal(whatsappPhone('+44 7700 900123'), '447700900123')
  for (const phone of [null, '', '123', '06 12 34', '+33 1234', '06/07', '06 12 34 56 78 poste 3', '++33612345678', '+33061234', '0000000000', '1234567890123456']) assert.equal(whatsappPhone(phone), null, phone)
  const message = savReadyMessage({ firstName: 'Élodie', caseNumber: 'SAV-2026-0012', brand: 'Omega', model: 'De Ville', storeName: 'Heure & Passion', address: '1 rue de Paris', storePhone: '01 23 45 67 89' })
  const url = new URL(whatsappLink('06 12 34 56 78', message))
  assert.equal(url.origin, 'https://wa.me')
  assert.equal(url.pathname, '/33612345678')
  assert.equal(url.searchParams.get('text'), message)
  assert.match(message, /Élodie/)
  assert.match(message, /SAV-2026-0012/)
  assert.match(message, /Omega De Ville/)
  assert.match(message, /Heure & Passion/)
  assert.equal(whatsappLink(null, message), null)
})

test('Service checkout, statistics and workshop confirmations', async (t) => {
  const db = new PGlite({ extensions: { uuid_ossp, pgcrypto } })
  try {
    await db.exec(`CREATE SCHEMA auth; CREATE SCHEMA extensions;
      CREATE ROLE anon; CREATE ROLE authenticated;
      CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;`)
    for (const file of (await readdir('supabase/migrations')).filter((f) => f.endsWith('.sql')).sort()) await db.exec(await readFile(`supabase/migrations/${file}`, 'utf8'))
    const admin = '00000000-0000-4000-8000-000000000001'
    const tech = '00000000-0000-4000-8000-000000000002'
    await db.query('INSERT INTO auth.users VALUES ($1, $2), ($3, $4)', [admin, 'admin@example.invalid', tech, 'tech@example.invalid'])
    await db.query("UPDATE profiles SET active=true, role='TECHNICIEN' WHERE id=$1", [tech])
    const login = (id) => db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [id])
    await login(admin)
    const services = (await db.query('SELECT * FROM service_categories ORDER BY sort_order')).rows
    assert.deepEqual(services.map((s) => s.label), ['Pile', 'Bracelet', 'Pile plus contrôle étanchéité', 'Changement de verre', 'Polissage', 'Bracelets sur mesure', 'Échange standard de mouvement quartz', 'Révision montre quartz', 'Révision montre automatique', 'Aiguillage', 'Intervention partielle'])
    const pile = services[0].id
    const bracelet = services[1].id
    const finalize = async (lines, amount, key = crypto.randomUUID()) => (await db.query('SELECT finalize_sale(null,$1::jsonb,$2::jsonb,$3) AS sale', [JSON.stringify(lines), JSON.stringify([{ method: 'CB', amount }]), key])).rows[0].sale
    const line = { service_id: pile, quantity: 2, unit_price_ttc: 15.50, discount_amount: 1 }
    let sale
    await t.test('Free prices and discounts work with zero inventory; fiscal fields come from the service', async () => {
      sale = await finalize([{ ...line, label: 'Fake label', vat_rate: 0 }, { service_id: bracelet, quantity: 1, unit_price_ttc: 25 }], 55, 'service-first-sale')
      const rows = (await db.query('SELECT * FROM sale_lines WHERE sale_id=$1 ORDER BY total_ttc DESC', [sale.sale_id])).rows
      assert.equal(rows[0].label, 'Pile')
      assert.equal(Number(rows[0].unit_price_ttc), 15.50)
      assert.equal(Number(rows[0].total_ttc), 30)
      assert.equal(Number(rows[0].total_ht), 25)
      assert.equal(Number(rows[0].vat_rate), 20)
      assert.equal(rows[0].product_id, null)
      assert.equal((await db.query('SELECT count(*)::int AS n FROM stock_movements')).rows[0].n, 0)
      const event = (await db.query('SELECT * FROM fiscal_events WHERE entity_id=$1', [sale.sale_id])).rows[0]
      assert.equal(event.current_hash, generateFiscalHash(event.canonical_payload, event.sequence_number, event.previous_hash))
      assert.equal((await finalize([line], 55, 'service-first-sale')).sale_id, sale.sale_id)
      assert.equal((await db.query('SELECT count(*)::int AS n FROM sales')).rows[0].n, 1)
      await assert.rejects(db.query('UPDATE sale_lines SET unit_price_ttc=1 WHERE sale_id=$1', [sale.sale_id]))
    })
    await t.test('Invalid and unavailable services cannot create a sale', async () => {
      for (const unit_price_ttc of [null, 0, -1, 1.001, 1000000, 'NaN', 'Infinity']) await assert.rejects(finalize([{ ...line, unit_price_ttc }], 1))
      for (const quantity of [null, 0, -1, 1.5, 1000]) await assert.rejects(finalize([{ ...line, quantity }], 1))
      await assert.rejects(finalize([{ ...line, service_id: crypto.randomUUID() }], 30))
      await assert.rejects(finalize([{ ...line, product_id: crypto.randomUUID() }], 30))
      await assert.rejects(finalize([{ ...line, serialized_item_id: crypto.randomUUID() }], 30))
      await assert.rejects(finalize([line], 29))
      await assert.rejects(finalize([{ ...line, discount_amount: 32 }], 1))
      await db.query('UPDATE service_categories SET active=false WHERE id=$1', [pile])
      await assert.rejects(finalize([line], 30))
      await db.query('UPDATE service_categories SET active=true WHERE id=$1', [pile])
      assert.equal((await db.query('SELECT count(*)::int AS n FROM sales')).rows[0].n, 1)
    })
    await t.test('Statistics group repeated lines by post and count distinct tickets, including zero sales', async () => {
      await finalize([{ service_id: pile, quantity: 1, unit_price_ttc: 10 }, { service_id: pile, quantity: 1, unit_price_ttc: 20 }], 30)
      const rows = (await db.query('SELECT * FROM service_sales_stats($1,$1)', [parisDay()])).rows
      assert.equal(rows.length, 11)
      const p = rows.find((r) => r.service_id === pile)
      assert.equal(Number(p.quantity), 4)
      assert.equal(Number(p.tickets), 2)
      assert.equal(Number(p.total_ttc), 60)
      assert.equal(Number(p.total_ht), 50)
      assert.equal(Number(rows[2].quantity), 0)
      await assert.rejects(db.query("SELECT * FROM service_sales_stats('2026-02-03','2026-02-01')"))
    })
    await t.test('Statistics use inclusive Paris days, exclude drafts and handle more than 1,000 sales', async () => {
      // Isolated report fixtures; no remote database or real tickets.
      await db.query(`WITH fixture_sales AS (
        INSERT INTO sales(status, total_ttc, finalized_at)
        SELECT 'FINALIZED', 1, '2026-03-28 23:00:00+00'::timestamptz FROM generate_series(1,1001) RETURNING id
      ) INSERT INTO sale_lines(sale_id,service_id,label,quantity,unit_price_ht,unit_price_ttc,vat_rate,total_ttc,total_ht)
        SELECT id,$1,'Pile',1,0.83,1,20,1,0.83 FROM fixture_sales`, [pile])
      for (const [status, date] of [['FINALIZED','2026-03-29 21:59:59+00'], ['FINALIZED','2026-03-29 22:00:00+00'], ['FINALIZED','2026-03-28 22:59:59+00'], ['DRAFT','2026-03-29 10:00:00+00']]) {
        const fixture = (await db.query('INSERT INTO sales(status,finalized_at) VALUES ($1,$2) RETURNING id', [status,date])).rows[0].id
        await db.query("INSERT INTO sale_lines(sale_id,service_id,label,quantity,unit_price_ht,unit_price_ttc,vat_rate,total_ttc,total_ht) VALUES ($1,$2,'Pile',1,10,12,20,12,10)", [fixture,pile])
      }
      const p = (await db.query("SELECT * FROM service_sales_stats('2026-03-29','2026-03-29') WHERE service_id=$1", [pile])).rows[0]
      assert.equal(Number(p.quantity), 1002)
      assert.equal(Number(p.total_ttc), 1013)
    })
    await t.test('Technicians cannot sell or read sales statistics through RPC', async () => {
      await login(tech)
      await assert.rejects(finalize([line],30), /Accès refusé/)
      await assert.rejects(finalize([line],55,'service-first-sale'), /Accès refusé/)
      await assert.rejects(db.query('SELECT * FROM service_sales_stats($1,$1)', [parisDay()]), /Accès refusé/)
      await login(admin)
    })
    await t.test('WhatsApp confirmation requires a ready case and records one human confirmation', async () => {
      const customer = (await db.query("INSERT INTO customers(first_name,last_name) VALUES ('Client','Test') RETURNING id")).rows[0].id
      const sav = (await db.query("INSERT INTO sav_cases(case_number,customer_id,status) VALUES ('SAV-TEST',$1,'EN_REPARATION') RETURNING id", [customer])).rows[0].id
      await assert.rejects(db.query('SELECT confirm_sav_whatsapp($1)', [sav]), /prêt/)
      await db.query("UPDATE sav_cases SET status='PRET' WHERE id=$1", [sav])
      await login(tech)
      await db.query('SELECT confirm_sav_whatsapp($1)', [sav])
      await db.query('SELECT confirm_sav_whatsapp($1)', [sav])
      assert.equal((await db.query('SELECT status FROM sav_cases WHERE id=$1',[sav])).rows[0].status,'CLIENT_PREVENU')
      const events = (await db.query("SELECT * FROM sav_events WHERE sav_case_id=$1", [sav])).rows
      assert.equal(events.length,1)
      assert.equal(events[0].event_type,'WHATSAPP')
      assert.equal(events[0].user_id,tech)
      await login('')
      await assert.rejects(db.query('SELECT confirm_sav_whatsapp($1)',[sav]), /Accès refusé/)
    })
  } finally { await db.close() }
})
