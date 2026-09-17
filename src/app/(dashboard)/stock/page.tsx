'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Search, Plus } from 'lucide-react'
import { ProductFormDialog } from '@/components/stock/product-form-dialog'
import { formatEuro, ITEM_STATUS, toHT } from '@/lib/format'
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
  condition: string | null
  serialized_items: Array<{ id: string; serial_number: string; status: string; year: string | null; has_box: boolean; has_papers: boolean }>
}

async function loadStock(): Promise<StockRow[]> {
    const { data } = await createClient()
      .from('products')
      .select('id, type, brand, model, reference, selling_price_ttc, purchase_price_ttc, vat_rate, stock_quantity, condition, serialized_items(id, serial_number, status, year, has_box, has_papers)')
      .order('brand')

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
            status: s.status,
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
          status: p.stock_quantity > 0 ? 'AVAILABLE' : 'SOLD',
        })
      }
    }
    return rows
}

const FILTERS = [
  { value: 'AVAILABLE', label: 'Disponible' },
  { value: 'ALL', label: 'Tout' },
  { value: 'SOLD', label: 'Vendu' },
] as const

export default function StockPage() {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['value']>('AVAILABLE')
  const [items, setItems] = useState<StockRow[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)

  const fetchStock = useCallback(async () => {
    setItems(await loadStock())
    setLoading(false)
  }, [])

  useEffect(() => {
    let ignore = false
    loadStock().then((rows) => {
      if (ignore) return
      setItems(rows)
      setLoading(false)
    })
    return () => {
      ignore = true
    }
  }, [])


  const filteredItems = useMemo(() => {
    const term = search.toLowerCase()
    return items.filter(
      (item) =>
        (filter === 'ALL' || item.status === filter) &&
        `${item.brand} ${item.model} ${item.ref} ${item.serial}`.toLowerCase().includes(term)
    )
  }, [items, search, filter])

  const totalValue = filteredItems.reduce((s, i) => s + i.price * i.quantity, 0)
  const totalValueHT = filteredItems.reduce((s, i) => s + toHT(i.price, i.vatRate) * i.quantity, 0)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-playfair text-3xl font-bold tracking-tight">Stock</h1>
          <p className="text-sm text-muted-foreground">
            {filteredItems.length} article(s) · valeur {formatEuro(totalValueHT)} HT · {formatEuro(totalValue)} TTC
          </p>
        </div>
        <Button onClick={() => setDialogOpen(true)} className="h-9">
          <Plus /> Ajouter un article
        </Button>
      </div>

      <Card className="gap-0 py-0">
        <CardHeader className="flex flex-row flex-wrap items-center gap-3 border-b py-3">
          <div className="relative min-w-60 flex-1">
            <Search className="absolute top-2 left-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Marque, modèle, référence, numéro de série…"
              className="w-full max-w-md pl-8"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex rounded-lg bg-muted p-0.5">
            {FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => setFilter(f.value)}
                className={cn(
                  'rounded-md px-3 py-1 text-sm font-medium',
                  filter === f.value ? 'bg-background shadow-sm' : 'text-muted-foreground'
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="p-0">
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
                  <TableRow key={item.id}>
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
                      <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold', ITEM_STATUS[item.status]?.className)}>
                        {item.kind === 'accessory' && item.status === 'SOLD' ? 'Rupture' : ITEM_STATUS[item.status]?.label ?? item.status}
                      </span>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <ProductFormDialog open={dialogOpen} onOpenChange={setDialogOpen} onCreated={fetchStock} />
    </div>
  )
}
