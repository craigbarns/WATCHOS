import { createClient } from '@/lib/supabase/server'
import { requireStaff } from '@/lib/auth'
import { loadFiscalJournal } from '@/lib/fiscal/load'
import { FISCAL_CORE_VERSION } from '@/lib/fiscal/core'

/** Archive fiscale complète (JSON) : événements, clôtures, et résultat de vérification. */
export async function GET() {
  const guard = await requireStaff(['ADMIN', 'VENDEUR'])
  if (!guard.ok) return new Response(guard.error, { status: 403 })

  const supabase = await createClient()
  const [{ data: settings }, journal] = await Promise.all([
    supabase.from('settings').select('store_name, company_name, siret, vat_number, app_version').limit(1).maybeSingle(),
    loadFiscalJournal(supabase),
  ])

  const exportedAt = new Date().toISOString()
  const body = JSON.stringify(
    {
      exported_at: exportedAt,
      exported_by: guard.profile.full_name,
      fiscal_core_version: FISCAL_CORE_VERSION,
      hash_algorithm: 'SHA-256',
      store: settings,
      verification: { fiscal_events: journal.eventsCheck, fiscal_closures: journal.closuresCheck },
      fiscal_events: journal.events,
      fiscal_closures: journal.closures,
    },
    null,
    2
  )

  return new Response(body, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="archive-fiscale-${exportedAt.slice(0, 10)}.json"`,
      'Cache-Control': 'no-store',
    },
  })
}
