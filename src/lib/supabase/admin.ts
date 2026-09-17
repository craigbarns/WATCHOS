import { createClient } from '@supabase/supabase-js'

// IMPORTANT: This client should ONLY be used in secure Server Actions or Route Handlers.
// Never expose the service role key to the browser.
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      }
    }
  )
}
