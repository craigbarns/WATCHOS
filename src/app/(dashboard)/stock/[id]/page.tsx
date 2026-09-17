import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft, Receipt as ReceiptIcon, Wrench } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { createClient } from '@/lib/supabase/server'
import { getCurrentProfile } from '@/lib/auth'
import { formatDate, formatDateTime, formatEuro, ITEM_STATUS, SAV_STATUS } from '@/lib/format'
import { cn } from '@/lib/utils'
import { PriceCard } from '@/components/stock/sheet/price-card'
import { DetailsCard, type ItemFields, type ProductFields } from '@/components/stock/sheet/details-card'
import { WatchStatusCard } from '@/components/stock/sheet/watch-status-card'
import { StockAdjustCard } from '@/components/stock/sheet/stock-adjust-card'
import { ReprintButton } from '@/components/caisse/receipt-dialog'

type ProductRow = ProductFields & {
  type: 'SERIALIZED' | 'NON_SERIALIZED'
  selling_price_ttc: number
  purchase_price_ttc: number | null
  vat_rate: number
  stock_quantity: number
  created_at: string
}

type ItemRow = ItemFields & { status: string; product_id: string; created_at: string }

type Movement = {
  id: string
  movement_type: string
  quantity: number
  reason: string | null
  reference_id: string | null
  created_at: string
  author: { full_name: string } | null
}

type SaleLine = {
  quantity: number
  total_ttc: number
  total_ht: number | null
  discount_amount: number
  sale: {
    id: string
    receipt_number: string
    finalized_at: string
    customer: { id: string; first_name: string; last_name: string } | null
    seller: { full_name: string } | null
  } | null
}

const MOVEMENT_LABELS: Record<string, string> = {
  PURCHASE: 'Entrée en stock',
  SALE: 'Vente',
  RETURN: 'Retour client',
  SAV_OUT: 'Départ en SAV',
  SAV_IN: 'Retour de SAV',
  ADJUSTMENT: 'Modification',
  INVENTORY: 'Inventaire',
}

const PRODUCT_COLUMNS =
  'id, type, brand, model, collection, reference, sku, ean, description, movement, caliber, diameter, material, bracelet, color, condition, purchase_price_ttc, selling_price_ttc, vat_rate, location, stock_quantity, created_at'
const ITEM_COLUMNS = 'id, product_id, serial_number, status, year, has_box, has_papers, has_certificate, entry_date, supplier, notes, created_at'

export default async function StockItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()

  const supabase = await createClient()
  const profile = await getCurrentProfile()
  const canEdit = profile?.role === 'ADMIN' || profile?.role === 'VENDEUR'

  // L'identifiant est soit une montre (pièce sérialisée), soit un article (accessoire)
  const { data: itemData } = await supabase
    .from('serialized_items')
    .select(`${ITEM_COLUMNS}, product:products(${PRODUCT_COLUMNS})`)
    .eq('id', id)
    .maybeSingle()

  let product: ProductRow
  let item: ItemRow | null = null

  if (itemData) {
    const { product: p, ...rest } = itemData as unknown as ItemRow & { product: ProductRow }
    product = p
    item = rest
  } else {
    const { data: productData } = await supabase.from('products').select(PRODUCT_COLUMNS).eq('id', id).maybeSingle()
    if (!productData) notFound()
    product = productData as unknown as ProductRow
    if (product.type === 'SERIALIZED') {
      // Lien vers un modèle de montre : on ouvre sa première pièce
      const { data: first } = await supabase.from('serialized_items').select('id').eq('product_id', id).order('created_at').limit(1).maybeSingle()
      if (first) redirect(`/stock/${first.id}`)
      notFound()
    }
  }

  const movementsQuery = supabase
    .from('stock_movements')
    .select('id, movement_type, quantity, reason, reference_id, created_at, author:profiles(full_name)')
    .eq('product_id', product.id)
    .order('created_at', { ascending: false })
    .limit(200)

  const salesQuery = supabase
    .from('sale_lines')
    .select('quantity, total_ttc, total_ht, discount_amount, sale:sales(id, receipt_number, finalized_at, customer:customers(id, first_name, last_name), seller:profiles(full_name))')
    .order('created_at', { ascending: false })

  const [{ data: movementsData }, { data: salesData }, { data: savData }, { count: siblings }] = await Promise.all([
    item ? movementsQuery.or(`serialized_item_id.eq.${item.id},serialized_item_id.is.null`) : movementsQuery,
    item ? salesQuery.eq('serialized_item_id', item.id) : salesQuery.eq('product_id', product.id).limit(100),
    item
      ? supabase
          .from('sav_cases')
          .select('id, case_number, status, deposit_date, declared_problem, customer:customers(first_name, last_name)')
          .eq('serial_number', item.serial_number)
          .order('deposit_date', { ascending: false })
      : Promise.resolve({ data: [] }),
    item
      ? supabase.from('serialized_items').select('id', { count: 'exact', head: true }).eq('product_id', product.id)
      : Promise.resolve({ count: 1 }),
  ])

  const movements = (movementsData ?? []) as unknown as Movement[]
  const saleLines = (salesData ?? []) as unknown as SaleLine[]
  const savCases = (savData ?? []) as unknown as Array<{
    id: string
    case_number: string
    status: string
    deposit_date: string
    declared_problem: string | null
    customer: { first_name: string; last_name: string } | null
  }>

  const sold = item?.status === 'SOLD'
  const watchSale = item ? saleLines[0] ?? null : null
  const unitsSold = saleLines.reduce((s, l) => s + l.quantity, 0)
  const revenueTTC = saleLines.reduce((s, l) => s + Number(l.total_ttc), 0)
  const revenueHT = saleLines.reduce((s, l) => s + Number(l.total_ht ?? 0), 0)

  const title = [product.brand, product.model].filter(Boolean).join(' ')
  const status = item ? ITEM_STATUS[item.status] : product.stock_quantity > 0 ? ITEM_STATUS.AVAILABLE : { label: 'Rupture', className: ITEM_STATUS.SOLD.className }

  return (
    <div className="max-w-6xl space-y-6">
      <div>
        <Link href="/stock" className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Stock
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-playfair text-3xl font-bold tracking-tight">{title}</h1>
          <span className={cn('rounded-full px-2.5 py-0.5 text-sm font-semibold', status?.className)}>{status?.label}</span>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {item ? 'Montre' : 'Accessoire'}
          {product.reference && <> · Réf. <span className="font-mono">{product.reference}</span></>}
          {item && <> · N° <span className="font-mono">{item.serial_number}</span></>}
          {item?.entry_date && <> · entrée le {formatDate(item.entry_date)}</>}
        </p>
        {item && (siblings ?? 1) > 1 && (
          <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
            Ce modèle regroupe {siblings} pièces : un changement de prix ou de caractéristiques s&apos;applique à toutes.
          </p>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-4">
          <DetailsCard
            key={`${product.id}-${item?.id}-${JSON.stringify(product)}-${JSON.stringify(item)}`}
            canEdit={canEdit}
            sold={sold}
            product={{
              id: product.id,
              brand: product.brand,
              model: product.model,
              collection: product.collection,
              reference: product.reference,
              sku: product.sku,
              ean: product.ean,
              condition: product.condition,
              movement: product.movement,
              caliber: product.caliber,
              diameter: product.diameter,
              material: product.material,
              bracelet: product.bracelet,
              color: product.color,
              location: product.location,
              description: product.description,
            }}
            item={
              item && {
                id: item.id,
                serial_number: item.serial_number,
                year: item.year,
                has_box: item.has_box,
                has_papers: item.has_papers,
                has_certificate: item.has_certificate,
                supplier: item.supplier,
                entry_date: item.entry_date,
                notes: item.notes,
              }
            }
          />

          {item && watchSale?.sale && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ReceiptIcon className="size-4" /> Vente
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 text-sm">
                <div className="space-y-0.5">
                  <div>
                    Ticket <span className="font-mono font-medium">{watchSale.sale.receipt_number}</span> du {formatDateTime(watchSale.sale.finalized_at)}
                  </div>
                  <div className="text-muted-foreground">
                    {watchSale.sale.customer ? `${watchSale.sale.customer.first_name} ${watchSale.sale.customer.last_name}` : 'Vente comptoir'}
                    {watchSale.sale.seller && ` · vendue par ${watchSale.sale.seller.full_name}`}
                    {Number(watchSale.discount_amount) > 0 && ` · remise ${formatEuro(watchSale.discount_amount)}`}
                  </div>
                </div>
                <ReprintButton saleId={watchSale.sale.id} label="Ticket" />
              </CardContent>
            </Card>
          )}

          {!item && (
            <Card>
              <CardHeader>
                <CardTitle>Ventes</CardTitle>
                <CardDescription>
                  {unitsSold > 0
                    ? `${unitsSold} unité(s) vendue(s) · ${formatEuro(revenueHT)} HT · ${formatEuro(revenueTTC)} TTC${saleLines.length >= 100 ? ' (100 dernières ventes)' : ''}`
                    : 'Aucune vente pour cet article'}
                </CardDescription>
              </CardHeader>
              {saleLines.length > 0 && (
                <CardContent>
                  <ul className="divide-y text-sm">
                    {saleLines.slice(0, 10).map((l, i) =>
                      l.sale ? (
                        <li key={i} className="flex items-center justify-between gap-2 py-2">
                          <span>
                            <span className="font-mono text-xs">{l.sale.receipt_number}</span>
                            <span className="text-muted-foreground"> · {formatDateTime(l.sale.finalized_at)} · ×{l.quantity}</span>
                          </span>
                          <span className="flex items-center gap-1 tabular-nums">
                            {formatEuro(l.total_ttc)}
                            <ReprintButton saleId={l.sale.id} />
                          </span>
                        </li>
                      ) : null
                    )}
                  </ul>
                </CardContent>
              )}
            </Card>
          )}

          {item && savCases.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Wrench className="size-4" /> Dossiers SAV
                </CardTitle>
                <CardDescription>Dossiers ouverts avec ce numéro de série.</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="divide-y text-sm">
                  {savCases.map((c) => (
                    <li key={c.id}>
                      <Link href={`/sav/${c.id}`} className="-mx-2 flex items-center justify-between gap-2 rounded-md px-2 py-2 hover:bg-muted">
                        <span>
                          <span className="font-mono">{c.case_number}</span>
                          <span className="text-muted-foreground">
                            {' '}
                            · {formatDate(c.deposit_date)} · {c.customer?.first_name} {c.customer?.last_name}
                          </span>
                        </span>
                        <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold', SAV_STATUS[c.status]?.className)}>
                          {SAV_STATUS[c.status]?.label ?? c.status}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Historique</CardTitle>
              <CardDescription>Entrées, ventes, changements de statut, de stock et de prix.</CardDescription>
            </CardHeader>
            <CardContent>
              {movements.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">Aucun mouvement enregistré</p>
              ) : (
                <ol className="relative space-y-4 border-l pl-5">
                  {movements.map((m) => (
                    <li key={m.id} className="relative">
                      <span
                        className={cn(
                          'absolute top-1.5 -left-[25px] size-2.5 rounded-full border-2 border-background',
                          m.quantity > 0 ? 'bg-emerald-500' : m.quantity < 0 ? 'bg-destructive' : 'bg-muted-foreground/40'
                        )}
                      />
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-sm">
                          <span className="font-medium">{MOVEMENT_LABELS[m.movement_type] ?? m.movement_type}</span>
                          {m.quantity !== 0 && (
                            <span className={cn('ml-2 font-mono text-xs', m.quantity > 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-destructive')}>
                              {m.quantity > 0 ? `+${m.quantity}` : m.quantity}
                            </span>
                          )}
                          {m.reason && <div className="text-muted-foreground">{m.reason}</div>}
                        </div>
                        {m.movement_type === 'SALE' && m.reference_id && <ReprintButton saleId={m.reference_id} />}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatDateTime(m.created_at)}
                        {m.author && ` · ${m.author.full_name}`}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          {item ? (
            <WatchStatusCard itemId={item.id} status={item.status} serialNumber={item.serial_number} canEdit={canEdit} />
          ) : (
            <StockAdjustCard productId={product.id} stock={product.stock_quantity} canEdit={canEdit} />
          )}
          <PriceCard
            key={`${product.selling_price_ttc}-${product.purchase_price_ttc}-${product.vat_rate}`}
            productId={product.id}
            serializedItemId={item?.id ?? null}
            sellingTTC={Number(product.selling_price_ttc)}
            purchaseTTC={product.purchase_price_ttc === null ? null : Number(product.purchase_price_ttc)}
            vatRate={Number(product.vat_rate)}
            canEdit={canEdit}
            soldPrice={sold && watchSale ? { ttc: Number(watchSale.total_ttc), ht: watchSale.total_ht === null ? null : Number(watchSale.total_ht) } : null}
          />
        </div>
      </div>
    </div>
  )
}
