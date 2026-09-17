'use server'

import { createClient } from '@/lib/supabase/server'
import { requireStaff } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
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

// ---------------------------------------------------------------------
// Comptes du personnel (créés par l'administrateur, sans email de confirmation)
// ---------------------------------------------------------------------

const passwordSchema = z
  .string()
  .min(8, 'Le mot de passe doit contenir au moins 8 caractères.')
  .max(72, 'Mot de passe trop long.')

const createMemberSchema = z.object({
  full_name: z.string().trim().min(1, 'Nom requis').max(100),
  email: z.email('Email invalide').transform((v) => v.trim().toLowerCase()),
  role: z.enum(['ADMIN', 'VENDEUR', 'TECHNICIEN']),
  password: passwordSchema,
})

function authErrorMessage(message: string) {
  if (/already (been )?registered|already exists/i.test(message)) return 'Un compte existe déjà avec cet email.'
  if (/password/i.test(message) && /weak|short|characters/i.test(message)) return 'Mot de passe trop faible : 8 caractères minimum, mélangez lettres et chiffres.'
  if (/SUPABASE_SERVICE_ROLE_KEY/.test(message)) return message
  return `Création impossible : ${message}`
}

export async function createStaffMember(input: z.input<typeof createMemberSchema>): Promise<Result> {
  const guard = await requireStaff(['ADMIN'])
  if (!guard.ok) return { success: false, error: guard.error }

  const parsed = createMemberSchema.safeParse(input)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? 'Données invalides.' }
  const { full_name, email, role, password } = parsed.data

  try {
    const admin = createAdminClient()
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name },
    })
    if (error || !data.user) return { success: false, error: authErrorMessage(error?.message ?? 'erreur inconnue') }

    // Le profil est créé par le trigger handle_new_user (inactif) : on applique nom, rôle et activation
    const { error: profileError } = await admin
      .from('profiles')
      .upsert({ id: data.user.id, full_name, role, active: true, updated_at: new Date().toISOString() })
    if (profileError) return { success: false, error: `Compte créé mais profil non enregistré : ${profileError.message}` }
  } catch (e) {
    return { success: false, error: authErrorMessage((e as Error).message) }
  }

  revalidatePath('/parametres')
  return { success: true }
}

const resetPasswordSchema = z.object({ id: z.guid(), password: passwordSchema })

export async function resetStaffPassword(input: z.input<typeof resetPasswordSchema>): Promise<Result> {
  const guard = await requireStaff(['ADMIN'])
  if (!guard.ok) return { success: false, error: guard.error }

  const parsed = resetPasswordSchema.safeParse(input)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? 'Données invalides.' }

  try {
    const { error } = await createAdminClient().auth.admin.updateUserById(parsed.data.id, { password: parsed.data.password })
    if (error) return { success: false, error: authErrorMessage(error.message) }
  } catch (e) {
    return { success: false, error: authErrorMessage((e as Error).message) }
  }
  return { success: true }
}
