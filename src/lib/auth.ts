import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'

export type Role = 'ADMIN' | 'VENDEUR' | 'TECHNICIEN'

export type Profile = {
  id: string
  full_name: string
  role: Role
  active: boolean
  email: string | null
}

/** Profil de l'utilisateur connecté (mémoïsé pour la durée de la requête). */
export const getCurrentProfile = cache(async (): Promise<Profile | null> => {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from('profiles')
    .select('id, full_name, role, active')
    .eq('id', user.id)
    .maybeSingle()

  if (!data) return null
  return { ...data, email: user.email ?? null } as Profile
})

type Guard = { ok: true; profile: Profile } | { ok: false; error: string }

/** À appeler en tête de chaque Server Action. */
export async function requireStaff(roles?: Role[]): Promise<Guard> {
  const profile = await getCurrentProfile()
  if (!profile) return { ok: false, error: 'Session expirée, reconnectez-vous.' }
  if (!profile.active) return { ok: false, error: 'Compte en attente de validation.' }
  if (roles && !roles.includes(profile.role)) return { ok: false, error: 'Action non autorisée pour votre rôle.' }
  return { ok: true, profile }
}
