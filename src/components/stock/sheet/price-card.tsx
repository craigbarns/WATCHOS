'use client'

import { useState, useTransition } from 'react'
import { Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { updateProductPrices } from '@/app/actions/products'
import { toast } from '@/components/ui/toast'
import { formatEuro, toHT } from '@/lib/format'
import { cn } from '@/lib/utils'

export function PriceCard({
  productId,
  serializedItemId,
  sellingTTC,
  purchaseTTC,
  vatRate,
  canEdit,
  soldPrice,
}: {
  productId: string
  serializedItemId: string | null
  sellingTTC: number
  purchaseTTC: number | null
  vatRate: number
  canEdit: boolean
  /** Prix réellement encaissé (montre vendue), affiché à la place du prix catalogue */
  soldPrice?: { ttc: number; ht: number | null } | null
}) {
  const [editing, setEditing] = useState(false)
  const [values, setValues] = useState({ selling: String(sellingTTC), purchase: purchaseTTC === null ? '' : String(purchaseTTC), vat: String(vatRate) })
  const [pending, startTransition] = useTransition()

  const rate = editing ? Number(values.vat) : vatRate
  const selling = editing ? Number(values.selling.replace(',', '.')) || 0 : sellingTTC
  const purchase = editing ? (values.purchase === '' ? null : Number(values.purchase.replace(',', '.')) || 0) : purchaseTTC
  const sellingHT = toHT(selling, rate)
  const purchaseHT = purchase === null ? null : toHT(purchase, rate)
  const margin = purchaseHT === null ? null : sellingHT - purchaseHT
  const marginRate = margin !== null && sellingHT > 0 ? (margin / sellingHT) * 100 : null

  const save = () => {
    startTransition(async () => {
      const result = await updateProductPrices({
        productId,
        serializedItemId,
        selling_price_ttc: values.selling.replace(',', '.'),
        purchase_price_ttc: values.purchase.replace(',', '.'),
        vat_rate: values.vat,
      })
      if (!result.success) {
        toast.add({ title: 'Prix non enregistrés', description: result.error, type: 'error' })
        return
      }
      toast.add({ title: 'Prix mis à jour', type: 'success' })
      setEditing(false)
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Prix</CardTitle>
        {canEdit && !editing && !soldPrice && (
          <CardAction>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setValues({ selling: String(sellingTTC), purchase: purchaseTTC === null ? '' : String(purchaseTTC), vat: String(vatRate) })
                setEditing(true)
              }}
            >
              <Pencil /> Modifier
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {soldPrice && (
          <div className="rounded-lg bg-muted p-3">
            <div className="text-xs text-muted-foreground">Prix encaissé</div>
            <div className="text-2xl font-bold tabular-nums">{formatEuro(soldPrice.ttc)} TTC</div>
            {soldPrice.ht !== null && <div className="text-sm text-muted-foreground tabular-nums">{formatEuro(soldPrice.ht)} HT</div>}
          </div>
        )}

        {editing ? (
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="selling">Prix de vente TTC</Label>
                <Input id="selling" inputMode="decimal" value={values.selling} onChange={(e) => setValues((v) => ({ ...v, selling: e.target.value }))} />
                <span className="text-xs text-muted-foreground tabular-nums">{formatEuro(sellingHT)} HT</span>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="purchase">Prix d&apos;achat TTC</Label>
                <Input id="purchase" inputMode="decimal" value={values.purchase} onChange={(e) => setValues((v) => ({ ...v, purchase: e.target.value }))} />
                <span className="text-xs text-muted-foreground tabular-nums">{purchaseHT === null ? 'Non renseigné' : `${formatEuro(purchaseHT)} HT`}</span>
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="vat">TVA</Label>
              <select id="vat" value={values.vat} onChange={(e) => setValues((v) => ({ ...v, vat: e.target.value }))} className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm">
                <option value="20">20 %</option>
                <option value="10">10 %</option>
                <option value="5.5">5,5 %</option>
                <option value="0">0 %</option>
              </select>
            </div>
          </div>
        ) : (
          <dl className="grid grid-cols-2 gap-3">
            <div>
              <dt className="text-xs text-muted-foreground">{soldPrice ? 'Prix catalogue' : 'Prix de vente'}</dt>
              <dd className={cn('font-bold tabular-nums', soldPrice ? 'text-base' : 'text-2xl')}>{formatEuro(sellingTTC)} <span className="text-xs font-normal text-muted-foreground">TTC</span></dd>
              <dd className="text-sm text-muted-foreground tabular-nums">{formatEuro(sellingHT)} HT</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Prix d&apos;achat</dt>
              <dd className="text-base font-semibold tabular-nums">{purchaseTTC === null ? '—' : <>{formatEuro(purchaseTTC)} <span className="text-xs font-normal text-muted-foreground">TTC</span></>}</dd>
              {purchaseHT !== null && <dd className="text-sm text-muted-foreground tabular-nums">{formatEuro(purchaseHT)} HT</dd>}
            </div>
          </dl>
        )}

        <div className="flex items-center justify-between border-t pt-3 text-sm">
          <span className="text-muted-foreground">TVA {rate} %</span>
          {margin !== null ? (
            <span className={cn('font-semibold tabular-nums', margin < 0 ? 'text-destructive' : 'text-emerald-700 dark:text-emerald-400')}>
              Marge {formatEuro(margin)} HT{marginRate !== null && ` · ${marginRate.toFixed(1)} %`}
            </span>
          ) : (
            <span className="text-muted-foreground">Marge : prix d&apos;achat non renseigné</span>
          )}
        </div>

        {editing && (
          <div className="flex gap-2">
            <Button onClick={save} disabled={pending} className="h-9">
              {pending ? 'Enregistrement…' : 'Enregistrer'}
            </Button>
            <Button
              variant="outline"
              className="h-9"
              onClick={() => {
                setValues({ selling: String(sellingTTC), purchase: purchaseTTC === null ? '' : String(purchaseTTC), vat: String(vatRate) })
                setEditing(false)
              }}
            >
              Annuler
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
