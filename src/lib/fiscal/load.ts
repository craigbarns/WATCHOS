import type { SupabaseClient } from '@supabase/supabase-js'
import { verifyClosureChain, verifyFiscalChain, type ClosurePayload, type FiscalPayload } from '@/lib/fiscal/core'

const PAGE = 1000

async function fetchAll<T>(query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query(from, from + PAGE - 1)
    if (error) throw error
    rows.push(...(data ?? []))
    if (!data || data.length < PAGE) return rows
  }
}

export type FiscalEventRow = {
  sequence_number: number
  event_type: string
  entity_id: string
  occurred_at: string
  amount_ht: number
  vat_amount: number
  amount_ttc: number
  canonical_payload: FiscalPayload
  previous_hash: string | null
  current_hash: string
}

export type ClosureRow = {
  sequence_number: number
  closure_type: ClosurePayload['closure_type']
  period_start: string
  period_end: string
  operations_count: number
  total_ht: number
  total_vat: number
  total_ttc: number
  perpetual_total: number
  previous_hash: string | null
  current_hash: string
  created_at: string
}

/** Charge l'intégralité des journaux fiscaux et vérifie les deux chaînes. */
export async function loadFiscalJournal(supabase: SupabaseClient) {
  const [events, closures] = await Promise.all([
    fetchAll<FiscalEventRow>((from, to) =>
      supabase.from('fiscal_events').select('*').order('sequence_number').range(from, to)
    ),
    fetchAll<ClosureRow>((from, to) =>
      supabase.from('fiscal_closures').select('*').order('sequence_number').range(from, to)
    ),
  ])

  const eventsCheck = verifyFiscalChain(
    events.map((e) => ({ ...e, payload: e.canonical_payload }))
  )
  const closuresCheck = verifyClosureChain(
    closures.map((c) => ({ ...c, payload: c }))
  )

  return { events, closures, eventsCheck, closuresCheck }
}
