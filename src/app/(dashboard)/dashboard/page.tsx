import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Euro, ShoppingBag, Wrench, Package, ArrowRight, ShieldCheck, Watch, Users, Plus, Check, ArrowUpRight } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { getCurrentProfile } from '@/lib/auth'
import { formatDateTime, formatEuro, parisDay, parisDayStartISO, SAV_CLOSED_STATUSES, SAV_STATUS } from '@/lib/format'
import { EmptyState } from '@/components/shared/empty-state'
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

  const canSell = profile?.role === 'ADMIN' || profile?.role === 'VENDEUR'
  const today = parisDay()
  const todayStart = parisDayStartISO(today)
  const monthStart = parisDayStartISO(`${today.slice(0, 8)}01`)

  const [todaySales, monthSales, openSav, serializedStock, accessoryStock, recentSales, recentSav] = await Promise.all([
    supabase.from('sales').select('total_ttc, total_ht').eq('status', 'FINALIZED').gte('finalized_at', todayStart),
    supabase.from('sales').select('total_ttc, total_ht').eq('status', 'FINALIZED').gte('finalized_at', monthStart),
    supabase.from('sav_cases').select('id', { count: 'exact', head: true }).not('status', 'in', `(${SAV_CLOSED_STATUSES.join(',')})`),
    supabase.from('serialized_items').select('product:products!inner(selling_price_ttc, purchase_price_ttc)').eq('status', 'AVAILABLE').neq('products.status', 'ARCHIVED'),
    supabase.from('products').select('stock_quantity, selling_price_ttc, purchase_price_ttc').eq('type', 'NON_SERIALIZED').neq('status', 'ARCHIVED').gt('stock_quantity', 0),
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

  if ([todaySales, monthSales, openSav, serializedStock, accessoryStock, recentSales, recentSav].some((result) => result.error)) {
    throw new Error('Le tableau de bord ne peut pas être chargé.')
  }

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

  const stockUnits = watches.length + (accessoryStock.data ?? []).reduce((n, p) => n + p.stock_quantity, 0)
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
      hint: `${watches.length} montre(s) · ${stockUnits - watches.length} accessoire(s)`,
      icon: Package,
    },
  ]

  const hour = Number(new Date().toLocaleString('fr-FR', { hour: 'numeric', hour12: false, timeZone: 'Europe/Paris' }))

  return (
    <div className="space-y-6">
      <section className="workspace-hero relative isolate overflow-hidden rounded-2xl px-6 py-6 text-white sm:px-9 sm:py-10">
        <div aria-hidden="true" className="workspace-dial pointer-events-none absolute -top-24 -right-12 -z-10 size-96 opacity-70" />
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="mb-3 text-[10px] font-medium tracking-[.25em] text-[#d3c69c] uppercase">Votre boutique, en toute précision</p>
            <h1 className="font-playfair text-[1.7rem] leading-tight font-medium tracking-tight sm:text-4xl">{hour < 18 ? 'Bonjour' : 'Bonsoir'}, {profile?.full_name.split(' ')[0]}.</h1>
            <p className="mt-3 max-w-lg text-sm leading-relaxed text-white/65">Un regard sur votre activité. Du temps pour vos clients.</p>
          </div>
          <Link href={canSell ? '/caisse' : '/sav'} className="inline-flex h-11 items-center justify-center gap-3 rounded-lg bg-[#e8dfc2] px-5 text-sm font-semibold text-[#193e33] transition-colors hover:bg-white">
            {canSell ? 'Ouvrir la caisse' : 'Ouvrir les dossiers SAV'} <ArrowUpRight className="size-4" />
          </Link>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {kpis.map((kpi) => (
          <Card key={kpi.title}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{kpi.title}</CardTitle>
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/5 text-primary"><kpi.icon className="size-4" strokeWidth={1.6} /></span>
            </CardHeader>
            <CardContent>
              <div className="text-xl font-semibold tracking-tight tabular-nums sm:text-3xl">{kpi.value}</div>
              <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                {kpi.hint}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {stockUnits === 0 && canSell && (
        <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-primary/15 bg-[#eef2e8] p-5">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-white text-primary"><Watch className="size-5" /></span>
          <div className="min-w-0 flex-1"><h2 className="font-medium">Votre collection commence ici</h2><p className="mt-1 text-sm text-muted-foreground">Ajoutez votre première pièce pour préparer votre prochaine vente.</p></div>
          <Link href="/stock?ajouter=1" className="inline-flex items-center gap-2 text-sm font-semibold text-primary"><Plus className="size-4" /> Ajouter un article</Link>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        {[{ href: '/stock', icon: Watch, title: 'La collection', text: 'Pièces & inventaire' }, { href: '/clients', icon: Users, title: 'Vos clients', text: 'Relations & coordonnées' }, { href: '/sav', icon: Wrench, title: 'L’atelier', text: 'Suivi & réparations' }].map((item) => (
          <Link key={item.href} href={item.href} className="group flex items-center gap-4 rounded-xl border bg-card px-5 py-4 transition-colors hover:border-primary/30 hover:bg-primary/5">
            <item.icon className="size-5 text-primary" strokeWidth={1.5} /><span className="flex-1"><span className="block text-sm font-semibold">{item.title}</span><span className="text-xs text-muted-foreground">{item.text}</span></span><ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
          </Link>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Dernières ventes</CardTitle>
            {canSell && <Link href="/rapports" className="text-xs text-muted-foreground hover:text-foreground">Journal →</Link>}
          </CardHeader>
          <CardContent>
            {(recentSales.data ?? []).length === 0 ? (
              <EmptyState icon={ShoppingBag} title="Le prochain beau moment" description="Vos ventes apparaîtront ici dès votre premier encaissement." />
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
              <EmptyState icon={Check} title="L’atelier est à jour" description="Retrouvez ici les dernières prises en charge et leur avancement." />
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
