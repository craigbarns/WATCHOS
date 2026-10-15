'use server'

import { createClient } from '@/lib/supabase/server'
import { requireStaff } from '@/lib/auth'
import { revalidatePath } from 'next/cache'

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

export type PendingClosures = { days: number; months: number; years: number }

/**
 * Clôture, dans l'ordre, les journées, mois et années terminés qui ne l'ont pas
 * encore été (clôtures obligatoires : journalière, mensuelle et annuelle).
 */
export async function closePendingPeriods(): Promise<{ success: true; closed: PendingClosures } | { success: false; error: string }> {
  const guard = await requireStaff(['ADMIN', 'VENDEUR'])
  if (!guard.ok) return { success: false, error: guard.error }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('close_pending')
  if (error) {
    return {
      success: false,
      error: error.code === 'PGRST202' ? 'Les clôtures automatiques doivent d’abord être activées en base (migration 20261015100000_fiscal_audit.sql).' : error.message,
    }
  }

  const closed = { days: Number(data.days), months: Number(data.months), years: Number(data.years) }
  if (closed.days + closed.months + closed.years > 0) revalidatePath('/rapports')
  return { success: true, closed }
}
