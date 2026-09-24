import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createClient } from '@/lib/supabase/server'
import { requireStaff } from '@/lib/auth'
import { formatDateTime, formatEuro, PAYMENT_LABELS, parisDay, parisDayStartISO } from '@/lib/format'
import { PAYMENT_ORDER } from '@/lib/cash-report'
import { ReprintButton } from '@/components/caisse/receipt-dialog'
import { cn } from '@/lib/utils'

const MAX_ROWS = 500

type PaymentRow = {
  id: string
  method: string
  amount: number
  sale: {
    id: string
    receipt_number: string
    finalized_at: string
    customer: { first_name: string; last_name: string } | null
    seller: { full_name: string } | null
  }
}

export default async function EncaissementsPage({
  searchParams,
}: {
  searchParams: Promise<{ du?: string; au?: string; mode?: string }>
}) {
  const guard = await requireStaff(['ADMIN', 'VENDEUR'])
  if (!guard.ok) redirect('/dashboard')

  const today = parisDay()
  const params = await searchParams
  const start = params.du ?? today
  const end = params.au ?? today
  const method = PAYMENT_ORDER.includes(params.mode as (typeof PAYMENT_ORDER)[number]) ? params.mode! : 'TOUS'

  let valid = true
  let startISO = ''
  let endISO = ''
  try {
    startISO = parisDayStartISO(start)
    endISO = parisDayStartISO(new Date(`${end}T12:00:00Z`).toISOString().slice(0, 10))
    // borne haute exclusive : lendemain du dernier jour choisi
    endISO = parisDayStartISO(new Date(new Date(`${end}T12:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10))
    valid = start <= end
  } catch {
    valid = false
  }

  const supabase = await createClient()
  let query = supabase
    .from('payments')
    .select(
      'id, method, amount, sale:sales!inner(id, receipt_number, finalized_at, status, customer:customers(first_name, last_name), seller:profiles(full_name))'
    )
    .eq('sale.status', 'FINALIZED')
    .gte('sale.finalized_at', startISO)
    .lt('sale.finalized_at', endISO)
    .order('created_at', { ascending: false })
    .limit(MAX_ROWS)
  if (method !== 'TOUS') query = query.eq('method', method)

  const { data, error } = valid ? await query : { data: [], error: null }
  if (error) throw new Error('Le journal des encaissements ne peut pas être chargé.')
  const rows = (data ?? []) as unknown as PaymentRow[]

  const totals = PAYMENT_ORDER.map((m) => {
    const list = rows.filter((r) => r.method === m)
    return { method: m, label: PAYMENT_LABELS[m], count: list.length, amount: list.reduce((s, r) => s + Number(r.amount), 0) }
  })
  const total = rows.reduce((s, r) => s + Number(r.amount), 0)
  const link = (patch: Record<string, string>) => {
    const next = new URLSearchParams({ du: start, au: end, mode: method, ...patch })
    return `/rapports/encaissements?${next.toString()}`
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/rapports" className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Rapports
        </Link>
        <h1 className="font-playfair text-2xl font-bold tracking-tight sm:text-3xl">Journal des encaissements</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Espèces, carte bancaire, chèque, virement. Dates incluses, heure de Paris.
        </p>
      </div>

      <form className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1.5">
          <label htmlFor="du" className="text-sm">Du</label>
          <Input id="du" name="du" type="date" defaultValue={start} max={today} required />
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="au" className="text-sm">Au</label>
          <Input id="au" name="au" type="date" defaultValue={end} max={today} required />
        </div>
        <input type="hidden" name="mode" value={method} />
        <Button type="submit" className="h-10 sm:h-9">Afficher</Button>
        <Link href={link({ du: today, au: today })} className="px-1 py-2 text-sm text-primary underline underline-offset-4">Aujourd’hui</Link>
        <Link href={link({ du: `${today.slice(0, 8)}01`, au: today })} className="px-1 py-2 text-sm text-primary underline underline-offset-4">Ce mois</Link>
      </form>

      {!valid ? (
        <p role="alert" className="text-destructive">Choisissez des dates valides, la date de début devant précéder la date de fin.</p>
      ) : (
        <>
          <div className="scrollbar-none -mx-3 flex gap-2 overflow-x-auto px-3 sm:mx-0 sm:flex-wrap sm:px-0">
            {[{ method: 'TOUS', label: 'Tous', count: rows.length, amount: total }, ...totals].map((t) => (
              <Link
                key={t.method}
                href={link({ mode: t.method })}
                className={cn(
                  'min-w-36 shrink-0 rounded-xl border px-3 py-2 transition-colors',
                  method === t.method ? 'border-primary bg-primary/5' : 'hover:bg-muted'
                )}
              >
                <div className="text-sm font-medium">{t.label}</div>
                <div className="text-lg font-semibold tabular-nums">{formatEuro(t.amount)}</div>
                <div className="text-xs text-muted-foreground">{t.count} règlement{t.count > 1 ? 's' : ''}</div>
              </Link>
            ))}
          </div>

          <Card className="gap-0 py-0">
            <CardHeader className="border-b py-3">
              <CardTitle className="text-base">
                {method === 'TOUS' ? 'Tous les règlements' : PAYMENT_LABELS[method]} · {formatEuro(total)}
              </CardTitle>
              <CardDescription>
                {rows.length === MAX_ROWS
                  ? `${MAX_ROWS} règlements les plus récents de la période`
                  : `${rows.length} règlement(s) sur la période`}
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <ul className="divide-y md:hidden">
                {rows.length === 0 ? (
                  <li className="py-10 text-center text-sm text-muted-foreground">Aucun encaissement sur cette période</li>
                ) : (
                  rows.map((r) => (
                    <li key={r.id} className="flex items-center gap-3 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium">{PAYMENT_LABELS[r.method] ?? r.method}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          <span className="font-mono">{r.sale.receipt_number}</span> · {formatDateTime(r.sale.finalized_at)}
                        </div>
                      </div>
                      <span className="font-semibold tabular-nums">{formatEuro(r.amount)}</span>
                      <ReprintButton saleId={r.sale.id} />
                    </li>
                  ))
                )}
              </ul>

              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-4">Date</TableHead>
                      <TableHead>Ticket</TableHead>
                      <TableHead>Mode</TableHead>
                      <TableHead>Client</TableHead>
                      <TableHead>Vendeur</TableHead>
                      <TableHead className="text-right">Montant</TableHead>
                      <TableHead className="pr-4 text-right">Ticket</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                          Aucun encaissement sur cette période
                        </TableCell>
                      </TableRow>
                    ) : (
                      rows.map((r) => (
                        <TableRow key={r.id}>
                          <TableCell className="pl-4">{formatDateTime(r.sale.finalized_at)}</TableCell>
                          <TableCell className="font-mono text-xs">{r.sale.receipt_number}</TableCell>
                          <TableCell>{PAYMENT_LABELS[r.method] ?? r.method}</TableCell>
                          <TableCell>
                            {r.sale.customer ? `${r.sale.customer.first_name} ${r.sale.customer.last_name}` : 'Comptoir'}
                          </TableCell>
                          <TableCell className="text-muted-foreground">{r.sale.seller?.full_name ?? '—'}</TableCell>
                          <TableCell className="text-right font-medium tabular-nums">{formatEuro(r.amount)}</TableCell>
                          <TableCell className="pr-4 text-right">
                            <ReprintButton saleId={r.sale.id} />
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
