import { createClient } from '@supabase/supabase-js'

// IMPORTANT: This client should ONLY be used in secure Server Actions or Route Handlers.
// Never expose the service role key to the browser.
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY manquante : ajoutez-la aux variables d’environnement du serveur (Vercel → Settings → Environment Variables).'
    )
  }
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}

export const hasAdminKey = () => Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY)

/** Domaine réservé (RFC 2606) utilisé pour libérer l'email d'un compte archivé. */
export const ARCHIVED_EMAIL_DOMAIN = 'archive.invalid'

export function isArchivedUser(user: { email?: string | null; banned_until?: string | null }) {
  return Boolean(user.email?.endsWith(`@${ARCHIVED_EMAIL_DOMAIN}`))
}
