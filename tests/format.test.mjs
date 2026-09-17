import test from 'node:test'
import assert from 'node:assert/strict'
import { parisDayStartISO, parisYesterday, toHT } from '../src/lib/format.ts'
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

test('Yesterday is a calendar day even after a 23-hour day', () => {
  assert.equal(parisYesterday(new Date('2026-03-29T22:30:00Z')), '2026-03-29')
  assert.equal(parisYesterday(new Date('2026-10-25T23:30:00Z')), '2026-10-25')
})

test('VAT calculation rounds each line to cents', () => {
  assert.equal(toHT(120, 20), 100)
  assert.equal(toHT(0.5, 20), 0.42)
  assert.equal(toHT(105.5, 5.5), 100)
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
