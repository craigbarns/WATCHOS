'use server'

import { createClient } from '@/lib/supabase/server'
import { requireStaff } from '@/lib/auth'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

type Result = { success: true } | { success: false; error: string }

const optional = z.string().trim().max(300).transform((v) => v || null)

const settingsSchema = z.object({
  store_name: z.string().trim().min(1, 'Nom de la boutique requis').max(200),
  company_name: optional,
  address: optional,
  siret: z.string().trim().regex(/^(\d{14})?$/, 'Le SIRET doit contenir 14 chiffres').transform((v) => v || null),
  vat_number: optional,
  phone: optional,
  email: optional,
})

export async function saveSettings(input: z.input<typeof settingsSchema>): Promise<Result> {
  const guard = await requireStaff(['ADMIN'])
  if (!guard.ok) return { success: false, error: guard.error }

  const parsed = settingsSchema.safeParse(input)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? 'Données invalides.' }

  const supabase = await createClient()
  const { data: existing } = await supabase.from('settings').select('id').limit(1).maybeSingle()
  const { error } = existing
    ? await supabase.from('settings').update({ ...parsed.data, updated_at: new Date().toISOString() }).eq('id', existing.id)
    : await supabase.from('settings').insert(parsed.data)

  if (error) return { success: false, error: error.message }
  revalidatePath('/', 'layout')
  return { success: true }
}

const userSchema = z.object({
  id: z.guid(),
  full_name: z.string().trim().min(1).max(100),
  role: z.enum(['ADMIN', 'VENDEUR', 'TECHNICIEN']),
  active: z.boolean(),
})

export async function updateUser(input: z.input<typeof userSchema>): Promise<Result> {
  const guard = await requireStaff(['ADMIN'])
  if (!guard.ok) return { success: false, error: guard.error }

  const parsed = userSchema.safeParse(input)
  if (!parsed.success) return { success: false, error: 'Données invalides.' }
  if (parsed.data.id === guard.profile.id && (!parsed.data.active || parsed.data.role !== 'ADMIN')) {
    return { success: false, error: 'Vous ne pouvez pas retirer vos propres droits administrateur.' }
  }

  const supabase = await createClient()
  const { id, ...values } = parsed.data
  const { error } = await supabase.from('profiles').update({ ...values, updated_at: new Date().toISOString() }).eq('id', id)
  if (error) return { success: false, error: error.message }

  revalidatePath('/parametres')
  return { success: true }
}
