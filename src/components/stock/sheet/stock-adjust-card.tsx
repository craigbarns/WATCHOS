'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { adjustStock } from '@/app/actions/products'
import { toast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'

type Mode = 'PURCHASE' | 'ADJUSTMENT' | 'INVENTORY' | 'RETURN'

const MODES: Record<Mode, { label: string; qtyLabel: string; placeholder: string; hint: string }> = {
  PURCHASE: { label: 'Réassort', qtyLabel: 'Quantité reçue', placeholder: 'Livraison fournisseur, facture n°…', hint: 'Ajoute au stock' },
  ADJUSTMENT: { label: 'Correction', qtyLabel: 'Écart (+ ou −)', placeholder: 'Casse, perte, erreur de saisie…', hint: 'Ex. -2 pour retirer deux unités' },
  INVENTORY: { label: 'Inventaire', qtyLabel: 'Quantité comptée', placeholder: 'Inventaire mensuel', hint: 'Le stock prend la valeur comptée' },
  RETURN: { label: 'Retour client', qtyLabel: 'Quantité retournée', placeholder: 'Ticket d’origine, état du produit…', hint: 'Remet l’article en stock (le remboursement se fait à part)' },
}

export function StockAdjustCard({ productId, stock, canEdit }: { productId: string; stock: number; canEdit: boolean }) {
  const [mode, setMode] = useState<Mode>('PURCHASE')
  const [quantity, setQuantity] = useState('')
  const [reason, setReason] = useState('')
  const [pending, startTransition] = useTransition()

  const qty = Number(quantity)
  const valid = quantity !== '' && Number.isInteger(qty)
  const next = !valid ? null : mode === 'INVENTORY' ? qty : mode === 'ADJUSTMENT' ? stock + qty : stock + qty

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    startTransition(async () => {
      const result = await adjustStock({ productId, movementType: mode, quantity, reason })
      if (!result.success) {
        toast.add({ title: 'Stock non modifié', description: result.error, type: 'error' })
        return
      }
      toast.add({ title: `Stock mis à jour : ${result.stock}`, type: 'success' })
      setQuantity('')
      setReason('')
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Stock</CardTitle>
        <CardDescription>Chaque mouvement est tracé avec son motif.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-baseline gap-2">
          <span className={cn('text-4xl font-bold tabular-nums', stock === 0 && 'text-destructive')}>{stock}</span>
          <span className="text-sm text-muted-foreground">{stock === 0 ? 'en rupture' : 'en stock'}</span>
        </div>

        {canEdit && (
          <form onSubmit={submit} className="grid gap-3">
            <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
              {(Object.keys(MODES) as Mode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={cn('rounded-md py-1.5 text-sm font-medium', mode === m ? 'bg-background shadow-sm' : 'text-muted-foreground')}
                >
                  {MODES[m].label}
                </button>
              ))}
            </div>
            <div className="grid gap-1.5">
              <label htmlFor="qty" className="text-sm font-medium">
                {MODES[mode].qtyLabel}
              </label>
              <Input
                id="qty"
                type="number"
                step={1}
                min={mode === 'ADJUSTMENT' ? undefined : mode === 'INVENTORY' ? 0 : 1}
                required
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="h-10 text-lg tabular-nums"
              />
              <span className="text-xs text-muted-foreground">{MODES[mode].hint}</span>
            </div>
            <div className="grid gap-1.5">
              <label htmlFor="reason" className="text-sm font-medium">
                Motif *
              </label>
              <Input id="reason" required value={reason} onChange={(e) => setReason(e.target.value)} placeholder={MODES[mode].placeholder} />
            </div>
            {next !== null && (
              <p className={cn('text-sm', next < 0 ? 'text-destructive' : 'text-muted-foreground')}>
                Stock : {stock} → <strong className="tabular-nums">{next}</strong>
                {next < 0 && ' (impossible)'}
              </p>
            )}
            <Button type="submit" disabled={pending || !valid || (next !== null && next < 0)} className="h-9">
              {pending ? 'Enregistrement…' : `Valider : ${MODES[mode].label.toLowerCase()}`}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  )
}
