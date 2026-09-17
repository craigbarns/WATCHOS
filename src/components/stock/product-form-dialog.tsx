'use client'

import { useState, useTransition } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createProduct, type ProductFormInput } from '@/app/actions/products'
import { formatEuro } from '@/lib/format'
import { cn } from '@/lib/utils'

const EMPTY: ProductFormInput = {
  type: 'SERIALIZED',
  brand: '',
  model: '',
  reference: '',
  sku: '',
  ean: '',
  condition: 'NEW',
  movement: '',
  diameter: '',
  material: '',
  purchase_price_ttc: undefined,
  selling_price_ttc: 0,
  vat_rate: 20,
  serial_number: '',
  year: '',
  has_box: false,
  has_papers: false,
  supplier: '',
  stock_quantity: 1,
}

const selectClass = 'h-8 rounded-lg border border-input bg-transparent px-2 text-sm'

export function ProductFormDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        {open && <ProductForm onClose={() => onOpenChange(false)} onCreated={onCreated} />}
      </DialogContent>
    </Dialog>
  )
}

function ProductForm({ onClose, onCreated }: { onClose: () => void; onCreated?: () => void }) {
  const [values, setValues] = useState<ProductFormInput>(EMPTY)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const isWatch = values.type === 'SERIALIZED'

  const set = (key: keyof ProductFormInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setValues((v) => ({ ...v, [key]: e.target.value }))

  const purchase = Number(values.purchase_price_ttc || 0)
  const selling = Number(values.selling_price_ttc || 0)
  const margin = purchase > 0 && selling > 0 ? selling - purchase : null

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    startTransition(async () => {
      const result = await createProduct({
        ...values,
        purchase_price_ttc: values.purchase_price_ttc === '' ? undefined : values.purchase_price_ttc,
      })
      if (!result.success) {
        setError(result.error)
        return
      }
      onCreated?.()
      onClose()
    })
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle className="text-lg">Nouvel article</DialogTitle>
        <DialogDescription>Une montre est suivie individuellement par son numéro de série.</DialogDescription>
      </DialogHeader>

      <div className="grid grid-cols-2 gap-2 rounded-lg bg-muted p-1">
        {(['SERIALIZED', 'NON_SERIALIZED'] as const).map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => setValues((v) => ({ ...v, type }))}
            className={cn(
              'rounded-md py-1.5 text-sm font-medium transition-colors',
              values.type === type ? 'bg-background shadow-sm' : 'text-muted-foreground'
            )}
          >
            {type === 'SERIALIZED' ? 'Montre' : 'Accessoire / pièce'}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Field label="Marque" id="brand">
          <Input id="brand" value={values.brand} onChange={set('brand')} placeholder="Rolex" />
        </Field>
        <Field label="Modèle *" id="model">
          <Input id="model" required value={values.model} onChange={set('model')} placeholder="Submariner Date" />
        </Field>
        <Field label="Référence" id="reference">
          <Input id="reference" value={values.reference} onChange={set('reference')} placeholder="126610LN" />
        </Field>
      </div>

      {isWatch ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="N° de série *" id="serial_number" className="col-span-2">
              <Input id="serial_number" required value={values.serial_number} onChange={set('serial_number')} className="font-mono" />
            </Field>
            <Field label="Année" id="year">
              <Input id="year" inputMode="numeric" value={values.year} onChange={set('year')} placeholder="2023" />
            </Field>
            <Field label="État" id="condition">
              <select id="condition" value={values.condition} onChange={set('condition')} className={selectClass}>
                <option value="NEW">Neuve</option>
                <option value="USED">Occasion</option>
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="Mouvement" id="movement">
              <Input id="movement" value={values.movement} onChange={set('movement')} placeholder="Automatique" />
            </Field>
            <Field label="Diamètre" id="diameter">
              <Input id="diameter" value={values.diameter} onChange={set('diameter')} placeholder="41 mm" />
            </Field>
            <Field label="Matière" id="material">
              <Input id="material" value={values.material} onChange={set('material')} placeholder="Acier" />
            </Field>
            <Field label="Fournisseur" id="supplier">
              <Input id="supplier" value={values.supplier} onChange={set('supplier')} />
            </Field>
          </div>
          <div className="flex gap-6 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={values.has_box} onChange={(e) => setValues((v) => ({ ...v, has_box: e.target.checked }))} />
              Boîte
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={values.has_papers} onChange={(e) => setValues((v) => ({ ...v, has_papers: e.target.checked }))} />
              Papiers / garantie
            </label>
          </div>
        </>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          <Field label="SKU" id="sku">
            <Input id="sku" value={values.sku} onChange={set('sku')} />
          </Field>
          <Field label="Code-barres (EAN)" id="ean">
            <Input id="ean" value={values.ean} onChange={set('ean')} inputMode="numeric" />
          </Field>
          <Field label="Quantité en stock" id="stock_quantity">
            <Input id="stock_quantity" type="number" min={0} value={values.stock_quantity as number} onChange={set('stock_quantity')} />
          </Field>
        </div>
      )}

      <div className="grid grid-cols-3 gap-3 rounded-lg border p-3">
        <Field label="Prix d'achat TTC" id="purchase_price_ttc">
          <Input id="purchase_price_ttc" type="number" min={0} step="0.01" value={(values.purchase_price_ttc as number | undefined) ?? ''} onChange={set('purchase_price_ttc')} />
        </Field>
        <Field label="Prix de vente TTC *" id="selling_price_ttc">
          <Input id="selling_price_ttc" type="number" min={0.01} step="0.01" required value={(values.selling_price_ttc as number) || ''} onChange={set('selling_price_ttc')} />
        </Field>
        <Field label="TVA" id="vat_rate">
          <select id="vat_rate" value={values.vat_rate as number} onChange={set('vat_rate')} className={selectClass}>
            <option value={20}>20 %</option>
            <option value={10}>10 %</option>
            <option value={5.5}>5,5 %</option>
            <option value={0}>0 %</option>
          </select>
        </Field>
        {margin !== null && (
          <p className={cn('col-span-3 text-xs', margin >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-destructive')}>
            Marge brute : {formatEuro(margin)} ({((margin / selling) * 100).toFixed(1)} % du prix de vente)
          </p>
        )}
      </div>

      {error && <p className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">{error}</p>}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Annuler
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? 'Enregistrement…' : 'Ajouter au stock'}
        </Button>
      </DialogFooter>
    </form>
  )
}

function Field({ label, id, className, children }: { label: string; id: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn('grid gap-1.5', className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  )
}
