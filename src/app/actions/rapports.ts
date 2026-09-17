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
