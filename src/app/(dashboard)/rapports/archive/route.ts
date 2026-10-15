import { createHash } from 'crypto'
import { createClient } from '@/lib/supabase/server'
import { requireStaff } from '@/lib/auth'
import { loadFiscalJournal } from '@/lib/fiscal/load'
import { FISCAL_CORE_VERSION } from '@/lib/fiscal/core'
import { parisDayOf, parisDayStartISO } from '@/lib/format'

const PAGE = 1000

const SALE_COLUMNS =
  'id, receipt_number, status, parent_sale_id, cancel_reason, finalized_at, customer_id, user_id, total_ht, total_vat, total_ttc, ' +
  'sale_lines(label, quantity, unit_price_ht, unit_price_ttc, vat_rate, discount_amount, total_ht, total_ttc, service_id, product_id, serialized_item_id), ' +
  'payments(method, amount)'

/**
 * Archive fiscale d'une année (?annee=2026) ou de tout l'historique, au format JSON ouvert :
 * opérations chaînées, clôtures, tickets ligne par ligne avec leurs règlements, et vérification
 * des chaînes. L'empreinte SHA-256 du fichier est inscrite au registre des archives, ce qui
 * donne date certaine à l'archive et permet de prouver plus tard qu'elle n'a pas été modifiée.
 */
export async function GET(request: Request) {
  const guard = await requireStaff(['ADMIN', 'VENDEUR'])
  if (!guard.ok) return new Response(guard.error, { status: 403 })

  const year = new URL(request.url).searchParams.get('annee')
  if (year !== null && !/^\d{4}$/.test(year)) return new Response('Année invalide.', { status: 400 })

  const supabase = await createClient()
  const [{ data: settings }, journal] = await Promise.all([
    supabase.from('settings').select('store_name, company_name, address, siret, vat_number, app_version').limit(1).maybeSingle(),
    loadFiscalJournal(supabase),
  ])

  const now = new Date()
  const firstYear = journal.events[0] ? parisDayOf(journal.events[0].occurred_at).slice(0, 4) : parisDayOf(now).slice(0, 4)
  const start = parisDayStartISO(`${year ?? firstYear}-01-01`)
  const yearEnd = year ? parisDayStartISO(`${Number(year) + 1}-01-01`) : null
  const end = yearEnd && new Date(yearEnd) < now ? yearEnd : now.toISOString()
  if (new Date(end) <= new Date(start)) return new Response('Aucune donnée à archiver pour cette période.', { status: 400 })
  const inPeriod = (value: string) => new Date(value) >= new Date(start) && new Date(value) < new Date(end)

  const sales: unknown[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('sales')
      .select(SALE_COLUMNS)
      .eq('status', 'FINALIZED')
      .gte('finalized_at', start)
      .lt('finalized_at', end)
      .order('finalized_at')
      .order('receipt_number')
      .range(from, from + PAGE - 1)
    if (error) return new Response(`Archive impossible : ${error.message}`, { status: 500 })
    sales.push(...(data ?? []))
    if (!data || data.length < PAGE) break
  }

  const body = JSON.stringify(
    {
      exported_at: now.toISOString(),
      exported_by: guard.profile.full_name,
      fiscal_core_version: FISCAL_CORE_VERSION,
      hash_algorithm: 'SHA-256',
      store: settings,
      period: { start, end, year },
      verification: {
        fiscal_events: journal.eventsCheck,
        fiscal_closures: journal.closuresCheck,
        fiscal_archives: journal.archivesCheck,
      },
      fiscal_events: journal.events.filter((e) => inPeriod(e.occurred_at)),
      fiscal_closures: journal.closures.filter((c) => inPeriod(c.period_start)),
      sales,
    },
    null,
    2
  )
  const sha256 = createHash('sha256').update(body, 'utf8').digest('hex')

  // Le registre arrive avec la migration 20261015100000_fiscal_audit.sql : sans elle, le fichier reste téléchargeable
  const { data: record, error: recordError } = await supabase.rpc('record_archive', { p_start: start, p_end: end, p_file_sha256: sha256 })
  if (recordError && recordError.code !== 'PGRST202') return new Response(`Archive non enregistrée : ${recordError.message}`, { status: 500 })

  const label = year ?? 'historique'
  const filename = record
    ? `archive-fiscale-${label}-n${record.sequence_number}-${sha256.slice(0, 8)}.json`
    : `archive-fiscale-${label}-${now.toISOString().slice(0, 10)}.json`

  return new Response(body, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
      'X-Archive-Sha256': sha256,
    },
  })
}
