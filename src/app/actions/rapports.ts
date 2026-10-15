'use server'

import { createClient } from '@/lib/supabase/server'
import { requireStaff } from '@/lib/auth'
import { revalidatePath } from 'next/cache'
import { parisDay, pendingClosureDays } from '@/lib/format'

export async function closeDay(day: string): Promise<{ success: true; message: string } | { success: false; error: string }> {
  const guard = await requireStaff(['ADMIN', 'VENDEUR'])
  if (!guard.ok) return { success: false, error: guard.error }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return { success: false, error: 'Date invalide.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('close_day', { p_day: day })
  if (error) return { success: false, error: error.message }

  revalidatePath('/rapports')
  return { success: true, message: `Clôture n°${data.sequence_number} générée (${data.operations_count} opération(s)).` }
}

const PAGE = 1000

async function readAll<T>(query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const rows: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    rows.push(...(data ?? []))
    if (!data || data.length < PAGE) return rows
  }
}

/**
 * Génère, dans l'ordre chronologique, le Z de chaque journée terminée qui a des
 * opérations mais pas encore de clôture (journées oubliées).
 */
export async function closePendingDays(): Promise<{ success: true; closed: number } | { success: false; error: string; closed: number }> {
  const guard = await requireStaff(['ADMIN', 'VENDEUR'])
  if (!guard.ok) return { success: false, error: guard.error, closed: 0 }

  const supabase = await createClient()
  let closed = 0
  try {
    const [events, closures] = await Promise.all([
      readAll<{ occurred_at: string }>((from, to) => supabase.from('fiscal_events').select('occurred_at').order('sequence_number').range(from, to)),
      readAll<{ period_start: string }>((from, to) =>
        supabase.from('fiscal_closures').select('period_start').eq('closure_type', 'DAILY').order('sequence_number').range(from, to)
      ),
    ])
    const days = pendingClosureDays(events.map((e) => e.occurred_at), closures.map((c) => c.period_start), parisDay())
    for (const day of days) {
      const { error } = await supabase.rpc('close_day', { p_day: day })
      // Un autre poste vient de la clôturer : on passe à la suivante
      if (error && !/déjà clôturée/.test(error.message)) return { success: false, error: error.message, closed }
      if (!error) closed++
    }
  } catch (e) {
    return { success: false, error: (e as Error).message, closed }
  }

  if (closed > 0) revalidatePath('/rapports')
  return { success: true, closed }
}
