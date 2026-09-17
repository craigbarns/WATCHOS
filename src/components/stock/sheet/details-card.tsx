'use client'

import { useState, useTransition } from 'react'
import { Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { updateProduct, updateSerializedItem, type ProductUpdateInput, type SerializedItemUpdateInput } from '@/app/actions/products'
import { toast } from '@/components/ui/toast'
import { formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'

export type ProductFields = Omit<ProductUpdateInput, 'id'> & { id: string }
export type ItemFields = Omit<SerializedItemUpdateInput, 'id'> & { id: string }

type TextKey<T> = { [K in keyof T]: T[K] extends string | null | undefined ? K : never }[keyof T]

const PRODUCT_FIELDS: Array<{ key: TextKey<ProductFields>; label: string; watchOnly?: boolean; accessoryOnly?: boolean }> = [
  { key: 'brand', label: 'Marque' },
  { key: 'model', label: 'Modèle *' },
  { key: 'collection', label: 'Collection', watchOnly: true },
  { key: 'reference', label: 'Référence' },
  { key: 'movement', label: 'Mouvement', watchOnly: true },
  { key: 'caliber', label: 'Calibre', watchOnly: true },
  { key: 'diameter', label: 'Diamètre', watchOnly: true },
  { key: 'material', label: 'Matière' },
  { key: 'bracelet', label: 'Bracelet', watchOnly: true },
  { key: 'color', label: 'Couleur / cadran' },
  { key: 'sku', label: 'SKU', accessoryOnly: true },
  { key: 'ean', label: 'Code-barres (EAN)', accessoryOnly: true },
  { key: 'location', label: 'Emplacement' },
]

const nullToEmpty = <T extends object>(o: T) =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v === null || v === undefined ? '' : v])) as T

export function DetailsCard({
  product,
  item,
  canEdit,
  sold,
}: {
  product: ProductFields
  item: ItemFields | null
  canEdit: boolean
  sold: boolean
}) {
  const isWatch = item !== null
  const [editing, setEditing] = useState(false)
  const [p, setP] = useState(() => nullToEmpty(product))
  const [it, setIt] = useState(() => (item ? nullToEmpty(item) : null))
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const fields = PRODUCT_FIELDS.filter((f) => (isWatch ? !f.accessoryOnly : !f.watchOnly))

  const startEdit = () => {
    setP(nullToEmpty(product))
    setIt(item ? nullToEmpty(item) : null)
    setError(null)
    setEditing(true)
  }

  const save = () => {
    setError(null)
    startTransition(async () => {
      const productResult = await updateProduct({ ...p, id: product.id } as ProductUpdateInput)
      if (!productResult.success) {
        setError(productResult.error)
        return
      }
      if (it) {
        const itemResult = await updateSerializedItem({
          ...it,
          id: it.id,
          has_box: Boolean(it.has_box),
          has_papers: Boolean(it.has_papers),
          has_certificate: Boolean(it.has_certificate),
        } as SerializedItemUpdateInput)
        if (!itemResult.success) {
          setError(itemResult.error)
          return
        }
      }
      toast.add({ title: 'Fiche mise à jour', type: 'success' })
      setEditing(false)
    })
  }

  const conditionLabel = product.condition === 'USED' ? 'Occasion' : product.condition === 'NEW' ? 'Neuf' : 'Non précisé'
  const textarea =
    'rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50'

  return (
    <Card>
      <CardHeader>
        <CardTitle>Caractéristiques</CardTitle>
        {canEdit && !editing && (
          <CardAction>
            <Button variant="ghost" size="sm" onClick={startEdit}>
              <Pencil /> Modifier
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        {editing ? (
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {fields.map((f) => (
                <div key={f.key} className="grid gap-1.5">
                  <Label htmlFor={f.key}>{f.label}</Label>
                  <Input id={f.key} value={(p[f.key] as string) ?? ''} onChange={(e) => setP((v) => ({ ...v, [f.key]: e.target.value }))} />
                </div>
              ))}
              <div className="grid gap-1.5">
                <Label htmlFor="condition">État</Label>
                <select
                  id="condition"
                  value={p.condition || ''}
                  onChange={(e) => setP((v) => ({ ...v, condition: e.target.value as 'NEW' | 'USED' | '' }))}
                  className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
                >
                  <option value="">Non précisé</option>
                  <option value="NEW">Neuf</option>
                  <option value="USED">Occasion</option>
                </select>
              </div>
            </div>

            {it && (
              <div className="grid gap-3 rounded-lg border p-3">
                <div className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Cette pièce</div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <div className="grid gap-1.5">
                    <Label htmlFor="serial_number">N° de série *</Label>
                    <Input
                      id="serial_number"
                      className="font-mono"
                      disabled={sold}
                      title={sold ? 'Verrouillé : montre vendue' : undefined}
                      value={it.serial_number}
                      onChange={(e) => setIt((v) => v && { ...v, serial_number: e.target.value })}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="year">Année</Label>
                    <Input id="year" value={it.year ?? ''} onChange={(e) => setIt((v) => v && { ...v, year: e.target.value })} />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="entry_date">Entrée en stock</Label>
                    <Input id="entry_date" type="date" value={it.entry_date ?? ''} onChange={(e) => setIt((v) => v && { ...v, entry_date: e.target.value })} />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="supplier">Fournisseur / provenance</Label>
                    <Input id="supplier" value={it.supplier ?? ''} onChange={(e) => setIt((v) => v && { ...v, supplier: e.target.value })} />
                  </div>
                </div>
                <div className="flex flex-wrap gap-5 text-sm">
                  {(
                    [
                      ['has_box', 'Boîte'],
                      ['has_papers', 'Papiers / garantie'],
                      ['has_certificate', 'Certificat'],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key} className="flex items-center gap-2">
                      <input type="checkbox" checked={Boolean(it[key])} onChange={(e) => setIt((v) => v && { ...v, [key]: e.target.checked })} />
                      {label}
                    </label>
                  ))}
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="notes">Notes sur la pièce</Label>
                  <textarea id="notes" rows={2} value={it.notes ?? ''} onChange={(e) => setIt((v) => v && { ...v, notes: e.target.value })} className={textarea} />
                </div>
              </div>
            )}

            <div className="grid gap-1.5">
              <Label htmlFor="description">Description</Label>
              <textarea id="description" rows={3} value={p.description ?? ''} onChange={(e) => setP((v) => ({ ...v, description: e.target.value }))} className={textarea} />
            </div>

            {error && <p className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">{error}</p>}

            <div className="flex gap-2">
              <Button onClick={save} disabled={pending} className="h-9">
                {pending ? 'Enregistrement…' : 'Enregistrer'}
              </Button>
              <Button variant="outline" onClick={() => setEditing(false)} className="h-9">
                Annuler
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
              {fields
                .filter((f) => product[f.key])
                .map((f) => (
                  <div key={f.key}>
                    <dt className="text-xs text-muted-foreground">{f.label.replace(' *', '')}</dt>
                    <dd className={cn(f.key === 'reference' || f.key === 'ean' || f.key === 'sku' ? 'font-mono' : '')}>{product[f.key] as string}</dd>
                  </div>
                ))}
              <div>
                <dt className="text-xs text-muted-foreground">État</dt>
                <dd>{conditionLabel}</dd>
              </div>
              {item && (
                <>
                  <div>
                    <dt className="text-xs text-muted-foreground">N° de série</dt>
                    <dd className="font-mono">{item.serial_number}</dd>
                  </div>
                  {item.year && (
                    <div>
                      <dt className="text-xs text-muted-foreground">Année</dt>
                      <dd>{item.year}</dd>
                    </div>
                  )}
                  {item.entry_date && (
                    <div>
                      <dt className="text-xs text-muted-foreground">Entrée en stock</dt>
                      <dd>{formatDate(item.entry_date)}</dd>
                    </div>
                  )}
                  {item.supplier && (
                    <div>
                      <dt className="text-xs text-muted-foreground">Fournisseur</dt>
                      <dd>{item.supplier}</dd>
                    </div>
                  )}
                  <div>
                    <dt className="text-xs text-muted-foreground">Accessoires</dt>
                    <dd>{[item.has_box && 'Boîte', item.has_papers && 'Papiers', item.has_certificate && 'Certificat'].filter(Boolean).join(' · ') || 'Montre seule'}</dd>
                  </div>
                </>
              )}
            </dl>
            {product.description && <p className="text-sm whitespace-pre-line text-muted-foreground">{product.description}</p>}
            {item?.notes && (
              <p className="rounded-md bg-muted p-2 text-sm whitespace-pre-line">
                <span className="text-xs text-muted-foreground">Notes : </span>
                {item.notes}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
