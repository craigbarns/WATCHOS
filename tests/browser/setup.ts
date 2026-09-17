import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { writeFile, unlink } from 'node:fs/promises'

// Explicitly invoked, read-only browser checks against the configured shop.
// No account is created, no password is changed and no email is sent.
export default async function setup() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: profiles, error } = await admin.from('profiles').select('id').eq('role', 'ADMIN').eq('active', true)
  if (error) throw error
  const operator = process.env.MAINTENANCE_OPERATOR_ID ? profiles?.find((p) => p.id === process.env.MAINTENANCE_OPERATOR_ID) : profiles?.length === 1 ? profiles[0] : null
  if (!operator) throw new Error('MAINTENANCE_OPERATOR_ID doit désigner un administrateur actif.')
  const { data: { user }, error: userError } = await admin.auth.admin.getUserById(operator.id)
  if (userError || !user?.email) throw userError || new Error('Administrateur introuvable')
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: 'magiclink', email: user.email })
  if (linkError) throw linkError
  const jar = new Map<string, { name: string; value: string; domain: string; path: string; expires: number; httpOnly: boolean; secure: boolean; sameSite: 'Lax' }>()
  const client = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => [...jar.values()],
      setAll: (cookies) => { for (const cookie of cookies) jar.set(cookie.name, { name: cookie.name, value: cookie.value, domain: '127.0.0.1', path: '/', expires: Math.floor(Date.now() / 1000) + (cookie.options.maxAge || 3600), httpOnly: false, secure: false, sameSite: 'Lax' }) },
    },
  })
  const { error: authError } = await client.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'magiclink' })
  if (authError) throw authError
  await writeFile('.test-session.json', JSON.stringify({ cookies: [...jar.values()], origins: [] }), { mode: 0o600 })
  return async () => { await client.auth.signOut({ scope: 'local' }); await unlink('.test-session.json').catch(() => {}) }
}
