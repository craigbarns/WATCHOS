import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Download, ShieldAlert, ShieldCheck } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { getCurrentProfile } from '@/lib/auth'
import { loadFiscalJournal } from '@/lib/fiscal/load'
import { formatDate, formatDateTime, formatEuro, parisYesterday } from '@/lib/format'
import { CloseDayForm } from '@/components/rapports/close-day-form'
import { ReprintButton } from '@/components/caisse/receipt-dialog'

export default async function RapportsPage() {
  const profile = await getCurrentProfile()
  if (profile?.role === 'TECHNICIEN') redirect('/dashboard')

  const supabase = await createClient()
  const { events, closures, eventsCheck, closuresCheck } = await loadFiscalJournal(supabase)

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
          <Link href="/statistiques" className="mt-2 inline-block text-sm font-medium text-primary underline underline-offset-4">Voir les ventes par poste →</Link>
        </div>
        <a
          href="/rapports/archive"
          className="inline-flex h-9 items-center gap-2 rounded-lg border bg-background px-3 text-sm font-medium hover:bg-muted"
        >
          <Download className="size-4" /> Exporter l&apos;archive fiscale
        </a>
      </div>

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
                <TableHead className="pr-4">Empreinte</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {closures.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
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
                    <TableCell className="pr-4 font-mono text-xs text-muted-foreground">{c.current_hash.slice(0, 12)}…</TableCell>
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
