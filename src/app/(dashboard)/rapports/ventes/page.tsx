import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft, ChevronLeft, ChevronRight, Ban } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createClient } from '@/lib/supabase/server'
import { requireStaff } from '@/lib/auth'
import { formatDate, formatEuro, PAYMENT_LABELS, parisDay, parisDayStartISO } from '@/lib/format'
import type { CashReport } from '@/lib/cash-report'
import { paymentBreakdown } from '@/lib/cash-report'
import { ReprintButton } from '@/components/caisse/receipt-dialog'
import { cn } from '@/lib/utils'

type SaleRow = {
  id: string
  receipt_number: string
  finalized_at: string
  total_ttc: number
  total_ht: number
  parent_sale_id: string | null
  customer: { first_name: string; last_name: string } | null
  seller: { full_name: string } | null
  sale_lines: Array<{ label: string; quantity: number }>
  payments: Array<{ method: string; amount: number }>
}

const shiftDay = (day: string, days: number) => {
  const d = new Date(`${day}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

const hour = (value: string) =>
  new Date(value).toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' })

export default async function VentesDuJourPage({ searchParams }: { searchParams: Promise<{ jour?: string }> }) {
  const guard = await requireStaff(['ADMIN', 'VENDEUR'])
  if (!guard.ok) redirect('/dashboard')

  const today = parisDay()
  const params = await searchParams
  const day = /^\d{4}-\d{2}-\d{2}$/.test(params.jour ?? '') ? params.jour! : today

  let dayStart: string
  let dayEnd: string
  try {
    dayStart = parisDayStartISO(day)
    dayEnd = parisDayStartISO(shiftDay(day, 1))
  } catch {
    redirect('/rapports/ventes')
  }

  const supabase = await createClient()
  const [{ data: salesData, error }, { data: report }] = await Promise.all([
    supabase
      .from('sales')
      .select(
        'id, receipt_number, finalized_at, total_ttc, total_ht, parent_sale_id, customer:customers(first_name, last_name), seller:profiles(full_name), sale_lines(label, quantity), payments(method, amount)'
      )
      .eq('status', 'FINALIZED')
      .gte('finalized_at', dayStart)
      .lt('finalized_at', dayEnd)
      .order('finalized_at', { ascending: false }),
    supabase.rpc('day_cash_report', { p_day: day }),
  ])
  if (error) throw new Error('Les ventes ne peuvent pas être chargées.')

  const sales = (salesData ?? []) as unknown as SaleRow[]
  const cash = (report ?? null) as CashReport | null

  // Tickets annulés : les avoirs qui les référencent, même créés un autre jour
  const ids = sales.filter((s) => !s.parent_sale_id).map((s) => s.id)
  const { data: refunds } = ids.length
    ? await supabase.from('sales').select('parent_sale_id, receipt_number').in('parent_sale_id', ids)
    : { data: [] }
  const cancelledBy = new Map((refunds ?? []).map((r) => [r.parent_sale_id as string, r.receipt_number as string]))

  const totalTTC = sales.reduce((s, r) => s + Number(r.total_ttc), 0)
  const totalHT = sales.reduce((s, r) => s + Number(r.total_ht), 0)
  const refundCount = sales.filter((s) => s.parent_sale_id).length
  const methods = cash ? paymentBreakdown(cash).filter((m) => m.count > 0) : []

  const linkTo = (target: string) => `/rapports/ventes?jour=${target}`

  return (
    <div className="space-y-6">
      <div>
        <Link href="/rapports" className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Rapports
        </Link>
        <h1 className="font-playfair text-2xl font-bold tracking-tight sm:text-3xl">Ventes du {formatDate(day)}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Toutes les ventes de la journée, de la plus récente à la plus ancienne.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <Link
          href={linkTo(shiftDay(day, -1))}
          className="inline-flex h-10 items-center gap-1 rounded-lg border px-3 text-sm hover:bg-muted"
        >
          <ChevronLeft className="size-4" /> Veille
        </Link>
        <form className="flex items-end gap-2">
          <div className="grid gap-1.5">
            <label htmlFor="jour" className="text-sm">Journée</label>
            <Input id="jour" name="jour" type="date" defaultValue={day} max={today} required />
          </div>
          <Button type="submit" className="h-10 sm:h-9">Afficher</Button>
        </form>
        {day < today && (
          <Link
            href={linkTo(shiftDay(day, 1))}
            className="inline-flex h-10 items-center gap-1 rounded-lg border px-3 text-sm hover:bg-muted"
          >
            Lendemain <ChevronRight className="size-4" />
          </Link>
        )}
        {day !== today && (
          <Link href={linkTo(today)} className="px-1 py-2 text-sm text-primary underline underline-offset-4">
            Aujourd’hui
          </Link>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ['Tickets', String(sales.length)],
          ['Total TTC', formatEuro(totalTTC)],
          ['Total HT', formatEuro(totalHT)],
          ['Panier moyen', formatEuro(sales.length ? totalTTC / sales.length : 0)],
        ].map(([label, value]) => (
          <Card key={label}>
            <CardHeader className="pb-1">
              <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
            </CardHeader>
            <CardContent className="text-lg font-semibold tabular-nums sm:text-2xl">{value}</CardContent>
          </Card>
        ))}
      </div>

      {methods.length > 0 && (
        <p className="text-sm text-muted-foreground">
          {methods.map((m) => `${m.label} ${formatEuro(m.amount)}`).join(' · ')}
          {refundCount > 0 && ` · ${refundCount} annulation(s)`}
          {' · '}
          <Link href={`/rapports/encaissements?du=${day}&au=${day}&mode=TOUS`} className="text-primary underline underline-offset-4">
            détail des règlements
          </Link>
        </p>
      )}

      <Card className="gap-0 py-0">
        <CardHeader className="border-b py-3">
          <CardTitle className="text-base">{sales.length} vente(s)</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <ul className="divide-y md:hidden">
            {sales.length === 0 ? (
              <li className="py-10 text-center text-sm text-muted-foreground">Aucune vente ce jour-là</li>
            ) : (
              sales.map((sale) => {
                const cancelled = cancelledBy.get(sale.id)
                return (
                  <li key={sale.id} className="flex items-start gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-medium">{sale.receipt_number}</span>
                        <span className="text-xs text-muted-foreground">{hour(sale.finalized_at)}</span>
                        {sale.parent_sale_id && (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                            Avoir
                          </span>
                        )}
                        {cancelled && (
                          <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-semibold text-destructive">
                            Annulée
                          </span>
                        )}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {sale.sale_lines.map((l) => `${Math.abs(l.quantity)}× ${l.label}`).join(', ') || '—'}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {sale.customer ? `${sale.customer.first_name} ${sale.customer.last_name}` : 'Comptoir'}
                        {' · '}
                        {sale.payments.map((p) => PAYMENT_LABELS[p.method] ?? p.method).join(' + ') || '—'}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={cn('font-semibold tabular-nums', Number(sale.total_ttc) < 0 && 'text-destructive')}>
                        {formatEuro(sale.total_ttc)}
                      </div>
                      <ReprintButton saleId={sale.id} />
                    </div>
                  </li>
                )
              })
            )}
          </ul>

          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Heure</TableHead>
                  <TableHead>Ticket</TableHead>
                  <TableHead>Articles</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Vendeur</TableHead>
                  <TableHead>Règlement</TableHead>
                  <TableHead className="text-right">Total TTC</TableHead>
                  <TableHead className="pr-4 text-right">Ticket</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sales.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                      Aucune vente ce jour-là
                    </TableCell>
                  </TableRow>
                ) : (
                  sales.map((sale) => {
                    const cancelled = cancelledBy.get(sale.id)
                    return (
                      <TableRow key={sale.id} className={cn(cancelled && 'text-muted-foreground')}>
                        <TableCell className="pl-4 tabular-nums">{hour(sale.finalized_at)}</TableCell>
                        <TableCell className="font-mono text-xs">
                          {sale.receipt_number}
                          {sale.parent_sale_id && <span className="ml-1 text-[11px] text-amber-700 dark:text-amber-400">avoir</span>}
                          {cancelled && (
                            <span className="ml-1 inline-flex items-center gap-1 text-[11px] text-destructive">
                              <Ban className="size-3" /> annulée
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="max-w-72 whitespace-normal">
                          {sale.sale_lines.map((l) => `${Math.abs(l.quantity)}× ${l.label}`).join(', ') || '—'}
                        </TableCell>
                        <TableCell>
                          {sale.customer ? `${sale.customer.first_name} ${sale.customer.last_name}` : 'Comptoir'}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{sale.seller?.full_name ?? '—'}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {sale.payments.map((p) => PAYMENT_LABELS[p.method] ?? p.method).join(' + ') || '—'}
                        </TableCell>
                        <TableCell className={cn('text-right font-medium tabular-nums', Number(sale.total_ttc) < 0 && 'text-destructive')}>
                          {formatEuro(sale.total_ttc)}
                        </TableCell>
                        <TableCell className="pr-4 text-right">
                          <ReprintButton saleId={sale.id} />
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
