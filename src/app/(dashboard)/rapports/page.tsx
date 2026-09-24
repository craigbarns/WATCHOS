import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Download, ShieldAlert, ShieldCheck } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { getCurrentProfile } from '@/lib/auth'
import { loadFiscalJournal } from '@/lib/fiscal/load'
import { formatDate, formatDateTime, formatEuro, parisDay, parisDayOf, parisYesterday } from '@/lib/format'
import { CashSummary } from '@/components/rapports/cash-summary'
import { ZTicketButton } from '@/components/rapports/z-ticket'
import type { CashReport } from '@/lib/cash-report'
import { CloseDayForm } from '@/components/rapports/close-day-form'
import { ReprintButton } from '@/components/caisse/receipt-dialog'

export default async function RapportsPage() {
  const profile = await getCurrentProfile()
  if (profile?.role === 'TECHNICIEN') redirect('/dashboard')

  const supabase = await createClient()
  const today = parisDay()
  const [journal, { data: todayReport, error: todayError }, { data: store }] = await Promise.all([
    loadFiscalJournal(supabase),
    supabase.rpc('day_cash_report', { p_day: today }),
    supabase.from('settings').select('store_name, company_name, address, siret, vat_number').limit(1).maybeSingle(),
  ])
  const { events, closures, eventsCheck, closuresCheck } = journal
  const cashToday = (todayReport ?? null) as CashReport | null
  // La fonction SQL day_cash_report arrive avec la migration 20260922000000_cash_report.sql
  const cashReportMissing = todayError?.code === 'PGRST202'

  const yesterday = parisYesterday()
  const lastClosure = closures.at(-1)
  const lastEvents = events.slice(-15).reverse()
  const perpetual = events.reduce((s, e) => s + Number(e.amount_ttc), 0)

  const integrity = [
    { label: 'Journal des opérations', check: eventsCheck },
    { label: 'Journal des clôtures', check: closuresCheck },
  ]

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-playfair text-2xl font-bold tracking-tight sm:text-3xl">Rapports &amp; clôtures</h1>
          <p className="text-sm text-muted-foreground">Journal des encaissements, clôtures et archives.</p>
          <div className="mt-2 flex flex-wrap gap-4">
            <Link href="/rapports/encaissements" className="text-sm font-medium text-primary underline underline-offset-4">Journal des encaissements →</Link>
            <Link href="/statistiques" className="text-sm font-medium text-primary underline underline-offset-4">Ventes par poste →</Link>
          </div>
        </div>
        <a
          href="/rapports/archive"
          className="inline-flex h-9 items-center gap-2 rounded-lg border bg-background px-3 text-sm font-medium hover:bg-muted"
        >
          <Download className="size-4" /> Exporter l&apos;archive fiscale
        </a>
      </div>

      {cashReportMissing && (
        <Card>
          <CardHeader>
            <CardTitle>Détail de caisse indisponible</CardTitle>
            <CardDescription>
              Exécutez la migration <code className="font-mono">supabase/migrations/20260922000000_cash_report.sql</code> dans
              Supabase pour afficher la répartition espèces / CB / chèque et le détail des clôtures Z.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {cashToday && (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
            <div>
              <CardTitle>Caisse du jour</CardTitle>
              <CardDescription>
                Encaissements du {formatDate(today)}, par mode de règlement. Journée non clôturée.
              </CardDescription>
            </div>
            <ZTicketButton report={cashToday} store={store} closure={null} day={today} label="Aperçu Z" variant="outline" />
          </CardHeader>
          <CardContent>
            {Number(cashToday.tickets) === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">Aucun encaissement aujourd&apos;hui pour le moment.</p>
            ) : (
              <CashSummary report={cashToday} />
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Intégrité des données</CardTitle>
            <CardDescription>Recalcul complet des empreintes SHA-256 chaînées.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {integrity.map(({ label, check }) => (
              <div key={label} className="flex items-start gap-2 text-sm">
                {check.valid ? (
                  <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                ) : (
                  <ShieldAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
                )}
                <div>
                  <div className="font-medium">{label}</div>
                  <div className={check.valid ? 'text-muted-foreground' : 'text-destructive'}>
                    {check.valid
                      ? `${check.count} enregistrement(s) vérifié(s)`
                      : `${check.reason} à la séquence n°${check.sequence_number}`}
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Clôture journalière (Z)</CardTitle>
            <CardDescription>
              {lastClosure
                ? `Dernière : ${formatDate(lastClosure.period_start)} (n°${lastClosure.sequence_number})`
                : 'Aucune clôture générée'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CloseDayForm defaultDay={yesterday} maxDay={yesterday} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Grand total perpétuel</CardTitle>
            <CardDescription>Cumul TTC de toutes les opérations enregistrées.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold tabular-nums">{formatEuro(perpetual)}</div>
            <p className="mt-1 text-xs text-muted-foreground">{events.length} opération(s)</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Clôtures</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">N°</TableHead>
                <TableHead>Journée</TableHead>
                <TableHead className="text-right">Opérations</TableHead>
                <TableHead className="text-right">HT</TableHead>
                <TableHead className="text-right">TVA</TableHead>
                <TableHead className="text-right">TTC</TableHead>
                <TableHead className="text-right">Cumul perpétuel</TableHead>
                <TableHead>Empreinte</TableHead>
                <TableHead className="pr-4 text-right">Détail</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {closures.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="py-8 text-center text-muted-foreground">
                    Aucune clôture
                  </TableCell>
                </TableRow>
              ) : (
                [...closures].reverse().map((c) => (
                  <TableRow key={c.sequence_number}>
                    <TableCell className="pl-4 font-mono">{c.sequence_number}</TableCell>
                    <TableCell>{formatDate(c.period_start)}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.operations_count}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatEuro(c.total_ht)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatEuro(c.total_vat)}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{formatEuro(c.total_ttc)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatEuro(c.perpetual_total)}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{c.current_hash.slice(0, 12)}…</TableCell>
                    <TableCell className="pr-4 text-right">
                      {c.details ? (
                        <ZTicketButton
                          report={c.details}
                          store={store}
                          closure={{
                            sequence_number: c.sequence_number,
                            perpetual_total: Number(c.perpetual_total),
                            current_hash: c.current_hash,
                            created_at: c.created_at,
                            operator: null,
                          }}
                          day={parisDayOf(c.period_start)}
                        />
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Journal des opérations</CardTitle>
          <CardDescription>15 dernières opérations fiscales</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Séq.</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">HT</TableHead>
                <TableHead className="text-right">TVA</TableHead>
                <TableHead className="text-right">TTC</TableHead>
                <TableHead>Empreinte</TableHead>
                <TableHead className="pr-4 text-right">Ticket</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lastEvents.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                    Aucune opération
                  </TableCell>
                </TableRow>
              ) : (
                lastEvents.map((e) => (
                  <TableRow key={e.sequence_number}>
                    <TableCell className="pl-4 font-mono">{e.sequence_number}</TableCell>
                    <TableCell>{formatDateTime(e.occurred_at)}</TableCell>
                    <TableCell>{e.event_type === 'SALE' ? 'Vente' : 'Remboursement'}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatEuro(e.amount_ht)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatEuro(e.vat_amount)}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{formatEuro(e.amount_ttc)}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{e.current_hash.slice(0, 12)}…</TableCell>
                    <TableCell className="pr-4 text-right">
                      {e.event_type === 'SALE' && <ReprintButton saleId={e.entity_id} />}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
