import test from 'node:test'
import assert from 'node:assert/strict'
import { parisDayStartISO, parisYesterday, pendingClosureDays, toHT } from '../src/lib/format.ts'
import { generateFiscalHash, verifyFiscalChain } from '../src/lib/fiscal/core.ts'

test('Paris day boundaries remain correct on DST transition days', () => {
  for (const [day, expected] of [
    ['2026-01-15', '2026-01-14T23:00:00.000Z'],
    ['2026-07-15', '2026-07-14T22:00:00.000Z'],
    ['2026-03-29', '2026-03-28T23:00:00.000Z'],
    ['2026-03-30', '2026-03-29T22:00:00.000Z'],
    ['2026-10-25', '2026-10-24T22:00:00.000Z'],
    ['2026-10-26', '2026-10-25T23:00:00.000Z'],
  ]) assert.equal(parisDayStartISO(day), expected)
  assert.throws(() => parisDayStartISO('2026-02-30'))
})

test('Forgotten Z closures are listed by Paris day, oldest first, excluding today', () => {
  const events = [
    '2026-10-12T09:00:00Z', '2026-10-12T15:00:00Z', // 12 octobre, déjà clôturé
    '2026-10-13T22:30:00Z', // 0 h 30 à Paris : 14 octobre
    '2026-10-10T08:00:00Z',
    '2026-10-15T07:00:00Z', // aujourd'hui : jamais clôturé avant la fin de la journée
  ]
  const closures = ['2026-10-11T22:00:00Z'] // Z du 12 octobre (minuit à Paris)
  assert.deepEqual(pendingClosureDays(events, closures, '2026-10-15'), ['2026-10-10', '2026-10-14'])
  assert.deepEqual(pendingClosureDays([], closures, '2026-10-15'), [])
})

test('Yesterday is a calendar day even after a 23-hour day', () => {
  assert.equal(parisYesterday(new Date('2026-03-29T22:30:00Z')), '2026-03-29')
  assert.equal(parisYesterday(new Date('2026-10-25T23:30:00Z')), '2026-10-25')
})

test('VAT calculation rounds each line to cents', () => {
  assert.equal(toHT(120, 20), 100)
  assert.equal(toHT(0.5, 20), 0.42)
  assert.equal(toHT(105.5, 5.5), 100)
  assert.equal(toHT(8.79, 20), 7.33)
})

test('Displayed HT matches PostgreSQL rounding for every amount up to 1,000 €', () => {
  // round(ttc / (1 + taux / 100), 2) en arithmétique exacte, demi à l'opposé de zéro
  const exact = (cents, rate) => {
    const num = BigInt(cents) * 10000n
    const den = 10000n + BigInt(Math.round(rate * 100))
    return Number(num / den + (2n * (num % den) >= den ? 1n : 0n)) / 100
  }
  for (const rate of [20, 10, 5.5, 2.1, 0]) {
    for (let cents = 1; cents <= 100000; cents++) {
      if (toHT(cents / 100, rate) !== exact(cents, rate)) assert.fail(`${cents / 100} € TTC à ${rate} %`)
    }
  }
})

test('Journal verification rejects altered and truncated chains', () => {
  const payload = { entity_id: 'sale-1', event_type: 'SALE', operator_id: 'operator-1', occurred_at: '2026-09-17T10:00:00Z', amount_ht: 100, amount_ttc: 120, vat_amount: 20 }
  const first = { payload, sequence_number: 1, previous_hash: 'GENESIS', current_hash: generateFiscalHash(payload, 1, 'GENESIS') }
  const second = { payload: { ...payload, entity_id: 'sale-2' }, sequence_number: 2, previous_hash: first.current_hash, current_hash: '' }
  second.current_hash = generateFiscalHash(second.payload, 2, second.previous_hash)
  assert.equal(verifyFiscalChain([first, second]).valid, true)
  assert.equal(verifyFiscalChain([second]).valid, false)
  assert.equal(verifyFiscalChain([{ ...first, payload: { ...payload, amount_ttc: 121 } }]).valid, false)
})


test('Search preserves dotted references and apostrophes without filter delimiters', async () => {
  const { sanitizeSearchTerm } = await import('../src/lib/search.ts')
  assert.equal(sanitizeSearchTerm(' 310.30.42.50.01.002 '), '310.30.42.50.01.002')
  assert.equal(sanitizeSearchTerm("d'argent"), "d'argent")
  assert.equal(sanitizeSearchTerm('Rolex,(*)%"'), 'Rolex')
  assert.equal(sanitizeSearchTerm('x'.repeat(250)).length, 200)
})
