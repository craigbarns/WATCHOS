import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Euro, ShoppingBag, Wrench, Package, ArrowRight, ShieldCheck, TrendingUp } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { getCurrentProfile } from '@/lib/auth'
import { formatDateTime, formatEuro, parisDay, parisDayStartISO, SAV_CLOSED_STATUSES, SAV_STATUS } from '@/lib/format'
import { cn } from '@/lib/utils'
import { ReprintButton } from '@/components/caisse/receipt-dialog'

type RecentSale = {
  id: string
  receipt_number: string
  total_ttc: number
  finalized_at: string
  customer: { first_name: string; last_name: string } | null
}

type RecentSav = {
  id: string
  case_number: string
  brand: string | null
  model: string | null
  status: string
  customer: { first_name: string; last_name: string } | null
}

export default async function DashboardPage() {
  const supabase = await createClient()
  const profile = await getCurrentProfile()

  const today = parisDay()
  const todayStart = parisDayStartISO(today)
  const monthStart = parisDayStartISO(`${today.slice(0, 8)}01`)

  const [todaySales, monthSales, openSav, serializedStock, accessoryStock, recentSales, recentSav] = await Promise.all([
    supabase.from('sales').select('total_ttc, total_ht').eq('status', 'FINALIZED').gte('finalized_at', todayStart),
    supabase.from('sales').select('total_ttc, total_ht').eq('status', 'FINALIZED').gte('finalized_at', monthStart),
    supabase.from('sav_cases').select('id', { count: 'exact', head: true }).not('status', 'in', `(${SAV_CLOSED_STATUSES.join(',')})`),
    supabase.from('serialized_items').select('product:products(selling_price_ttc, purchase_price_ttc)').eq('status', 'AVAILABLE'),
    supabase.from('products').select('stock_quantity, selling_price_ttc, purchase_price_ttc').eq('type', 'NON_SERIALIZED').gt('stock_quantity', 0),
    supabase
      .from('sales')
      .select('id, receipt_number, total_ttc, finalized_at, customer:customers(first_name, last_name)')
      .eq('status', 'FINALIZED')
      .order('finalized_at', { ascending: false })
      .limit(6),
    supabase
      .from('sav_cases')
      .select('id, case_number, brand, model, status, customer:customers(first_name, last_name)')
      .order('created_at', { ascending: false })
      .limit(6),
  ])

  const sum = (rows: Array<{ total_ttc: number }> | null) => (rows ?? []).reduce((s, r) => s + Number(r.total_ttc), 0)
  const sumHT = (rows: Array<{ total_ht: number }> | null) => (rows ?? []).reduce((s, r) => s + Number(r.total_ht), 0)
  const caToday = sum(todaySales.data)
  const salesCount = todaySales.data?.length ?? 0
  const basket = salesCount ? caToday / salesCount : 0

  type StockProduct = { selling_price_ttc: number; purchase_price_ttc: number | null }
  const watches = (serializedStock.data ?? []) as unknown as Array<{ product: StockProduct }>
  const stockValue =
    watches.reduce((s, w) => s + Number(w.product.selling_price_ttc), 0) +
    (accessoryStock.data ?? []).reduce((s, p) => s + p.stock_quantity * Number(p.selling_price_ttc), 0)
  const stockCost =
    watches.reduce((s, w) => s + Number(w.product.purchase_price_ttc ?? 0), 0) +
    (accessoryStock.data ?? []).reduce((s, p) => s + p.stock_quantity * Number(p.purchase_price_ttc ?? 0), 0)

  const kpis = [
    {
      title: "CA aujourd'hui (TTC)",
      value: formatEuro(caToday),
      hint: `${formatEuro(sumHT(todaySales.data))} HT · mois : ${formatEuro(sumHT(monthSales.data))} HT / ${formatEuro(sum(monthSales.data))} TTC`,
      icon: Euro,
    },
    { title: "Ventes aujourd'hui", value: String(salesCount), hint: salesCount ? `Panier moyen : ${formatEuro(basket)}` : 'Aucune vente', icon: ShoppingBag },
    { title: 'SAV en cours', value: String(openSav.count ?? 0), hint: 'Dossiers non restitués', icon: Wrench },
    {
      title: 'Valeur du stock',
      value: `${formatEuro(stockValue)} TTC`,
      hint: stockCost ? `Marge potentielle : ${formatEuro(stockValue - stockCost)}` : `${watches.length} montre(s) disponible(s)`,
      icon: Package,
    },
  ]

  const hour = Number(new Date().toLocaleString('fr-FR', { hour: 'numeric', hour12: false, timeZone: 'Europe/Paris' }))

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-playfair text-3xl font-bold tracking-tight">
            {hour < 18 ? 'Bonjour' : 'Bonsoir'}, {profile?.full_name}
          </h1>
          <p className="text-sm text-muted-foreground">Voici l&apos;activité de la boutique.</p>
        </div>
        <Link
          href="/caisse"
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/85"
        >
          Ouvrir la caisse <ArrowRight className="size-4" />
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((kpi) => (
          <Card key={kpi.title}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{kpi.title}</CardTitle>
              <kpi.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold tabular-nums">{kpi.value}</div>
              <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                <TrendingUp className="size-3" /> {kpi.hint}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Dernières ventes</CardTitle>
            <Link href="/rapports" className="text-xs text-muted-foreground hover:text-foreground">
              Journal →
            </Link>
          </CardHeader>
          <CardContent>
            {(recentSales.data ?? []).length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">Aucune vente pour le moment</div>
            ) : (
              <ul className="divide-y">
                {(recentSales.data as unknown as RecentSale[]).map((sale) => (
                  <li key={sale.id} className="flex items-center justify-between py-2.5 text-sm">
                    <div>
                      <div className="font-mono text-xs">{sale.receipt_number}</div>
                      <div className="text-muted-foreground">
                        {sale.customer ? `${sale.customer.first_name} ${sale.customer.last_name}` : 'Vente comptoir'} ·{' '}
                        {formatDateTime(sale.finalized_at)}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="font-semibold tabular-nums">{formatEuro(sale.total_ttc)}</span>
                      <ReprintButton saleId={sale.id} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Derniers dossiers SAV</CardTitle>
            <Link href="/sav" className="text-xs text-muted-foreground hover:text-foreground">
              Tous les dossiers →
            </Link>
          </CardHeader>
          <CardContent>
            {(recentSav.data ?? []).length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">Aucun dossier récent</div>
            ) : (
              <ul className="divide-y">
                {(recentSav.data as unknown as RecentSav[]).map((sav) => (
                  <li key={sav.id}>
                    <Link href={`/sav/${sav.id}`} className="-mx-2 flex items-center justify-between rounded-md px-2 py-2.5 text-sm hover:bg-muted">
                    <div>
                      <div className="font-mono text-xs">{sav.case_number}</div>
                      <div className="text-muted-foreground">
                        {sav.brand} {sav.model} · {sav.customer?.first_name} {sav.customer?.last_name}
                      </div>
                    </div>
                    <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold', SAV_STATUS[sav.status]?.className)}>
                      {SAV_STATUS[sav.status]?.label ?? sav.status}
                    </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <ShieldCheck className="size-3.5" /> Opérations de caisse chaînées et inaltérables (SHA-256). Vérification dans Rapports.
      </p>
    </div>
  )
}
