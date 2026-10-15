import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { verifyArchiveChain, verifyClosureChain } from '../src/lib/fiscal/core.ts'

// Local PostgreSQL only: never writes to the live shop.
test('Daily, monthly and annual closures, catch-up and archive register', async (t) => {
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

    // Opérations passées (les ventes réelles sont horodatées à l'instant de l'encaissement)
    let sequence = 0
    const operation = async (occurredAt, ttc, type = 'SALE') => {
      const ht = Math.round((ttc / 1.2) * 100) / 100
      const sale = (await db.query(
        "INSERT INTO sales (status, receipt_number, user_id, total_ht, total_vat, total_ttc, finalized_at) VALUES ('FINALIZED', $1, $2, $3, $4, $5, $6) RETURNING id",
        [`TEST-${++sequence}`, admin, ht, Math.round((ttc - ht) * 100) / 100, ttc, occurredAt]
      )).rows[0].id
      await db.query("UPDATE fiscal_counters SET value = value + 1 WHERE name = 'FISCAL_EVENT'")
      await db.query(
        `INSERT INTO fiscal_events (sequence_number, event_type, entity_id, operator_id, occurred_at, amount_ht, vat_amount, amount_ttc,
           canonical_payload, previous_hash, current_hash, app_version, fiscal_core_version)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, '{}', 'test', 'test', '1.0.0', '1.0.0')`,
        [sequence, type, sale, admin, occurredAt, ht, Math.round((ttc - ht) * 100) / 100, ttc]
      )
    }
    await operation('2024-12-30T09:00:00Z', 100)
    await operation('2024-12-31T22:30:00Z', 20) // 23 h 30 à Paris : 31 décembre
    await operation('2024-12-31T23:30:00Z', 30) // 0 h 30 à Paris : 1er janvier 2025
    await operation('2025-03-30T10:00:00Z', 40) // jour du passage à l'heure d'été
    await operation('2025-03-31T08:00:00Z', -20, 'REFUND')
    // Vente du jour : jamais clôturée tant que la journée n'est pas finie
    const pile = (await db.query("SELECT id FROM service_categories WHERE code = 'pile'")).rows[0].id
    await db.query('SELECT finalize_sale(null,$1::jsonb,$2::jsonb,$3)', [JSON.stringify([{ service_id: pile, quantity: 1, unit_price_ttc: 8 }]), JSON.stringify([{ method: 'CB', amount: 8 }]), crypto.randomUUID()])

    const closures = async () => (await db.query('SELECT * FROM fiscal_closures ORDER BY sequence_number')).rows
    const find = (rows, type, start) => rows.find((c) => c.closure_type === type && new Date(c.period_start).toISOString() === start)

    await t.test('A month cannot be closed before its days, nor a period that is not over', async () => {
      await assert.rejects(db.query("SELECT close_period('MONTHLY', '2024-12-01')"), /journées du mois 12\/2024/)
      await assert.rejects(db.query("SELECT close_period('ANNUAL', '2024-06-15')"), /mois de l'année 2024/)
      await assert.rejects(db.query("SELECT close_period('MONTHLY', current_date)"), /n'est pas terminé\./)
      await assert.rejects(db.query("SELECT close_period('WEEKLY', '2024-12-01')"), /invalide/)
      assert.equal((await closures()).length, 0)
    })

    await t.test('Catch-up closes days, then months, then years, in order', async () => {
      const result = (await db.query('SELECT close_pending() AS r')).rows[0].r
      assert.deepEqual({ days: result.days, months: result.months, years: result.years }, { days: 5, months: 3, years: 2 })
      const rows = await closures()
      assert.deepEqual(rows.map((c) => c.closure_type), ['DAILY', 'DAILY', 'DAILY', 'DAILY', 'DAILY', 'MONTHLY', 'MONTHLY', 'MONTHLY', 'ANNUAL', 'ANNUAL'])
      assert.equal(verifyClosureChain(rows.map((c) => ({ ...c, payload: c }))).valid, true)

      // Journées en heure de Paris, y compris autour de minuit UTC et du changement d'heure
      assert.equal(Number(find(rows, 'DAILY', '2024-12-30T23:00:00.000Z').total_ttc), 20)
      assert.equal(Number(find(rows, 'DAILY', '2024-12-31T23:00:00.000Z').total_ttc), 30)
      const dst = find(rows, 'DAILY', '2025-03-29T23:00:00.000Z')
      assert.equal(new Date(dst.period_end) - new Date(dst.period_start), 23 * 3600 * 1000)

      // Mois et années : totaux de la période, avoirs déduits
      assert.equal(Number(find(rows, 'MONTHLY', '2024-11-30T23:00:00.000Z').total_ttc), 120)
      assert.equal(Number(find(rows, 'MONTHLY', '2024-12-31T23:00:00.000Z').total_ttc), 30)
      assert.equal(Number(find(rows, 'MONTHLY', '2025-02-28T23:00:00.000Z').total_ttc), 20)
      assert.equal(Number(find(rows, 'ANNUAL', '2023-12-31T23:00:00.000Z').total_ttc), 120)
      const year2025 = find(rows, 'ANNUAL', '2024-12-31T23:00:00.000Z')
      assert.equal(Number(year2025.total_ttc), 50)
      assert.equal(year2025.operations_count, 3)

      // Total perpétuel exact à la fin de chaque période, cumul depuis le 1er janvier dans le détail
      assert.deepEqual(rows.map((c) => Number(c.perpetual_total)), [100, 120, 150, 190, 170, 120, 150, 170, 120, 170])
      assert.equal(Number(find(rows, 'DAILY', '2025-03-30T22:00:00.000Z').details.year_to_date_ttc), 50)
      assert.equal(Number(find(rows, 'DAILY', '2024-12-30T23:00:00.000Z').details.year_to_date_ttc), 120)
    })

    await t.test('Catch-up is idempotent and periods cannot be closed twice', async () => {
      const again = (await db.query('SELECT close_pending() AS r')).rows[0].r
      assert.deepEqual({ days: again.days, months: again.months, years: again.years }, { days: 0, months: 0, years: 0 })
      await assert.rejects(db.query("SELECT close_period('MONTHLY', '2024-12-01')"), /mois 12\/2024 est déjà clôturé\./)
      await assert.rejects(db.query("SELECT close_day('2024-12-30')"), /déjà clôturée/)
      await assert.rejects(db.exec('DELETE FROM fiscal_closures'))
    })

    await t.test('Technicians cannot close periods', async () => {
      await login(tech)
      await assert.rejects(db.query('SELECT close_pending()'), /Accès refusé/)
      await assert.rejects(db.query("SELECT close_period('DAILY', '2020-01-01')"), /Accès refusé/)
      await login(admin)
    })

    await t.test('Archives are recorded in a chain verified by the application', async () => {
      const sha = (text) => createHash('sha256').update(text).digest('hex')
      const record = async (start, end, content) => (await db.query('SELECT record_archive($1, $2, $3) AS r', [start, end, sha(content)])).rows[0].r
      const first = await record('2024-01-01T00:00:00+01', '2025-01-01T00:00:00+01', 'archive 2024')
      assert.equal(first.sequence_number, 1)
      assert.equal(first.sales_count, 2)
      assert.equal(Number(first.total_ttc), 120)
      await record('2025-01-01T00:00:00+01', '2026-01-01T00:00:00+01', 'archive 2025')
      const archives = (await db.query('SELECT * FROM fiscal_archives ORDER BY sequence_number')).rows
      assert.equal(archives[1].previous_hash, archives[0].current_hash)
      assert.equal(verifyArchiveChain(archives.map((a) => ({ ...a, payload: a }))).valid, true)
      assert.equal(verifyArchiveChain([{ ...archives[0], payload: { ...archives[0], file_sha256: sha('altéré') } }]).valid, false)
      await assert.rejects(db.query("SELECT record_archive(now() - interval '1 day', now(), 'pas-une-empreinte')"), /Empreinte/)
      await assert.rejects(db.exec('UPDATE fiscal_archives SET total_ttc = 0'))
      await login(tech)
      await assert.rejects(record('2024-01-01T00:00:00+01', '2025-01-01T00:00:00+01', 'x'), /Accès refusé/)
      await login(admin)
    })
  } finally {
    await db.close()
  }
})
