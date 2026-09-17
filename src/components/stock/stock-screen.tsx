'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Search, Plus, ChevronRight, Package, Watch, Layers, ArrowUpRight } from 'lucide-react'
import { ProductFormDialog } from '@/components/stock/product-form-dialog'
import { formatEuro, ITEM_STATUS, toHT } from '@/lib/format'
import { EmptyState } from '@/components/shared/empty-state'
import { LoadError } from '@/components/shared/load-error'
import { useRemoteData } from '@/lib/use-remote-data'
import { cn } from '@/lib/utils'

type StockRow = {
  id: string
  kind: 'watch' | 'accessory'
  brand: string | null
  model: string
  ref: string | null
  serial: string | null
  details: string | null
  quantity: number
  price: number
  cost: number | null
  vatRate: number
  status: string
}

type ProductRow = {
  id: string
  type: string
  brand: string | null
  model: string
  reference: string | null
  selling_price_ttc: number
  purchase_price_ttc: number | null
  vat_rate: number
  stock_quantity: number
  status: string
  condition: string | null
  serialized_items: Array<{ id: string; serial_number: string; status: string; year: string | null; has_box: boolean; has_papers: boolean }>
}

async function loadStock(): Promise<StockRow[]> {
    const { data, error } = await createClient()
      .from('products')
      .select('id, type, brand, model, reference, selling_price_ttc, purchase_price_ttc, vat_rate, stock_quantity, status, condition, serialized_items(id, serial_number, status, year, has_box, has_papers)')
      .order('brand')

    if (error) throw new Error(error.message)
    const rows: StockRow[] = []
    for (const p of (data ?? []) as ProductRow[]) {
      if (p.type === 'SERIALIZED') {
        for (const s of p.serialized_items) {
          rows.push({
            id: s.id,
            kind: 'watch',
            brand: p.brand,
            model: p.model,
            ref: p.reference,
            serial: s.serial_number,
            details: [s.year, p.condition === 'USED' ? 'Occasion' : 'Neuve', s.has_box && s.has_papers ? 'Full set' : null].filter(Boolean).join(' · '),
            quantity: s.status === 'AVAILABLE' ? 1 : 0,
            price: Number(p.selling_price_ttc),
            cost: p.purchase_price_ttc === null ? null : Number(p.purchase_price_ttc),
            vatRate: Number(p.vat_rate),
            status: p.status === 'ARCHIVED' ? 'ARCHIVED' : s.status,
          })
        }
      } else {
        rows.push({
          id: p.id,
          kind: 'accessory',
          brand: p.brand,
          model: p.model,
          ref: p.reference,
          serial: null,
          details: 'Accessoire',
          quantity: p.stock_quantity,
          price: Number(p.selling_price_ttc),
          cost: p.purchase_price_ttc === null ? null : Number(p.purchase_price_ttc),
            vatRate: Number(p.vat_rate),
          status: p.status === 'ARCHIVED' ? 'ARCHIVED' : p.stock_quantity > 0 ? 'AVAILABLE' : 'OUT',
        })
      }
    }
    return rows
}

const FILTERS = [
  { value: 'AVAILABLE', label: 'Disponible' },
  { value: 'RESERVED', label: 'Réservé' },
  { value: 'IN_SAV', label: 'En SAV' },
  { value: 'SOLD', label: 'Vendu' },
  { value: 'OUT', label: 'Rupture' },
  { value: 'RETURNED', label: 'Retourné' },
  { value: 'ARCHIVED', label: 'Archivé' },
  { value: 'ALL', label: 'Tout' },
] as const

export function StockScreen({ canManage, initialDialogOpen = false }: { canManage: boolean; initialDialogOpen?: boolean }) {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['value']>('AVAILABLE')
  const { data: items, loading, error, refresh: fetchStock } = useRemoteData(loadStock, [])
  const [dialogOpen, setDialogOpen] = useState(initialDialogOpen && canManage)
  const router = useRouter()

  useEffect(() => {
    if (canManage && new URLSearchParams(window.location.search).get('ajouter') === '1') {
      window.history.replaceState(null, '', '/stock')
    }
  }, [canManage])

  const filteredItems = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('fr')
    return items.filter(
      (item) =>
        (filter === 'ALL' || item.status === filter) &&
        `${item.brand} ${item.model} ${item.ref} ${item.serial}`.toLowerCase().includes(term)
    )
  }, [items, search, filter])

  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const i of items) c[i.status] = (c[i.status] ?? 0) + 1
    return c
  }, [items])

  const totalValue = filteredItems.reduce((s, i) => s + i.price * i.quantity, 0)
  const totalValueHT = filteredItems.reduce((s, i) => s + toHT(i.price, i.vatRate) * i.quantity, 0)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-playfair text-2xl font-bold tracking-tight sm:text-3xl">Stock</h1>
          <p className="text-sm text-muted-foreground">
            {filteredItems.length} article(s) · {formatEuro(totalValueHT)} HT · {formatEuro(totalValue)} TTC
          </p>
        </div>
        {canManage && <Button onClick={() => setDialogOpen(true)} className="h-10 sm:h-9">
          <Plus /> <span className="max-sm:hidden">Ajouter un article</span><span className="sm:hidden">Ajouter</span>
        </Button>}
      </div>

      {error && <LoadError onRetry={fetchStock} />}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {[{ label: 'Montres disponibles', value: items.filter((i) => i.kind === 'watch' && i.status === 'AVAILABLE').length, icon: Watch }, { label: 'Accessoires disponibles', value: items.filter((i) => i.kind === 'accessory' && i.status === 'AVAILABLE').reduce((n, i) => n + i.quantity, 0), icon: Layers }, { label: 'Valeur de la sélection TTC', value: formatEuro(totalValue), icon: ArrowUpRight }].map((stat) => (
          <div key={stat.label} className="rounded-xl border bg-card p-4 last:max-sm:col-span-2"><div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">{stat.label}<stat.icon className="size-4" /></div><p className="mt-3 text-2xl font-semibold tracking-tight tabular-nums">{loading || error ? '—' : stat.value}</p></div>
        ))}
      </div>
      <Card className="gap-0 overflow-hidden py-0">
        <CardHeader className="flex flex-row flex-wrap items-center gap-3 border-b py-3">
          <div className="relative w-full min-w-0 flex-1 sm:min-w-60">
            <Search className="absolute top-2 left-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              aria-label="Rechercher dans le stock"
              type="search"
              placeholder="Marque, modèle, référence, numéro de série…"
              className="w-full max-w-md pl-8"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="scrollbar-none -mx-4 flex w-[calc(100%+2rem)] overflow-x-auto px-4 sm:mx-0 sm:w-auto sm:px-0"><div className="flex shrink-0 rounded-lg bg-muted p-0.5">
            {FILTERS.filter((f) => f.value === 'AVAILABLE' || f.value === 'ALL' || (counts[f.value] ?? 0) > 0 || filter === f.value).map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => setFilter(f.value)}
                aria-pressed={filter === f.value}
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap sm:py-1',
                  filter === f.value ? 'bg-background shadow-sm' : 'text-muted-foreground'
                )}
              >
                {f.label}
                {f.value !== 'ALL' && <span className="ml-1 text-xs opacity-60">{counts[f.value] ?? 0}</span>}
              </button>
            ))}
          </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {!loading && !error && filteredItems.length === 0 ? <EmptyState icon={Package} title={items.filter((i) => i.status !== 'ARCHIVED').length === 0 && !search ? 'Place à votre collection' : 'Aucun article trouvé'} description={search ? 'Essayez une autre marque, référence ou un numéro de série.' : 'Ajoutez vos montres et accessoires pour suivre votre stock et commencer à vendre.'}>
            {canManage && <Button onClick={() => setDialogOpen(true)}><Plus /> Ajouter un article</Button>}
          </EmptyState> : !error && <>
          {/* Téléphone : cartes */}
          <ul className="divide-y md:hidden">
            {loading ? (
              <li className="py-10 text-center text-sm text-muted-foreground">Chargement du stock…</li>
            ) : filteredItems.length === 0 ? (
              <li className="py-10 text-center text-sm text-muted-foreground">Aucun article trouvé</li>
            ) : (
              filteredItems.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => router.push(`/stock/${item.id}`)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-muted"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">
                        {item.brand} {item.model}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {item.serial ? <span className="font-mono">{item.serial}</span> : `${item.quantity} en stock`}
                        {item.ref && ` · ${item.ref}`}
                      </div>
                      <span
                        className={cn(
                          'mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold',
                          item.status === 'OUT' ? 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300' : ITEM_STATUS[item.status]?.className
                        )}
                      >
                        {item.status === 'OUT' ? 'Rupture' : ITEM_STATUS[item.status]?.label ?? item.status}
                      </span>
                    </div>
                    <div className="text-right tabular-nums">
                      <div className="font-semibold">{formatEuro(item.price)}</div>
                      <div className="text-xs text-muted-foreground">{formatEuro(toHT(item.price, item.vatRate))} HT</div>
                    </div>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                  </button>
                </li>
              ))
            )}
          </ul>

          <div className="hidden md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Article</TableHead>
                <TableHead>Référence</TableHead>
                <TableHead>N° série</TableHead>
                <TableHead className="text-right">Qté</TableHead>
                <TableHead className="text-right">Prix HT</TableHead>
                <TableHead className="text-right">Prix TTC</TableHead>
                <TableHead className="text-right">Marge HT</TableHead>
                <TableHead className="pr-4">Statut</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">Chargement du stock…</TableCell>
                </TableRow>
              ) : filteredItems.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">Aucun article trouvé</TableCell>
                </TableRow>
              ) : (
                filteredItems.map((item) => (
                  <TableRow key={item.id} className="cursor-pointer" tabIndex={0} role="link" aria-label={`Ouvrir ${item.brand ?? ''} ${item.model}`} onKeyDown={(e) => { if (e.key === 'Enter') router.push(`/stock/${item.id}`) }} onClick={() => router.push(`/stock/${item.id}`)}>
                    <TableCell className="pl-4">
                      <div className="font-medium">
                        {item.brand} {item.model}
                      </div>
                      <div className="text-xs text-muted-foreground">{item.details}</div>
                    </TableCell>
                    <TableCell>{item.ref}</TableCell>
                    <TableCell className="font-mono text-xs">{item.serial ?? '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{item.quantity}</TableCell>
                    <TableCell className="text-right text-muted-foreground tabular-nums">{formatEuro(toHT(item.price, item.vatRate))}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{formatEuro(item.price)}</TableCell>
                    <TableCell className="text-right text-muted-foreground tabular-nums">
                      {item.cost === null ? '—' : formatEuro(toHT(item.price, item.vatRate) - toHT(item.cost, item.vatRate))}
                    </TableCell>
                    <TableCell className="pr-4">
                      <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap', item.status === 'OUT' ? 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300' : ITEM_STATUS[item.status]?.className)}>
                        {item.status === 'OUT' ? 'Rupture' : ITEM_STATUS[item.status]?.label ?? item.status}
                      </span>
                      <ChevronRight className="ml-2 inline size-4 text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          </div>
          </>}
        </CardContent>
      </Card>

      {canManage && <ProductFormDialog open={dialogOpen} onOpenChange={setDialogOpen} onCreated={fetchStock} />}
    </div>
  )
}
