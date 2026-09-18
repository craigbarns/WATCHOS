'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from '@/components/ui/toast'
import { updateSavPayment } from '@/app/actions/sav'
import { savPaymentSchema } from '@/lib/sav-payment'
import { formatEuro } from '@/lib/format'
import { cn } from '@/lib/utils'

export function SavPaymentForm({ id, amountDue, isPaid }: { id: string; amountDue: number | null; isPaid: boolean }) {
  const initialAmount = amountDue === null ? '' : amountDue.toFixed(2).replace('.', ',')
  const [amount, setAmount] = useState(initialAmount)
  const [paid, setPaid] = useState(isPaid)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const dirty = amount !== initialAmount || paid !== isPaid
  const parsed = savPaymentSchema.safeParse({ id, amount_due: amount, is_paid: paid })

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? 'Montant invalide.'); return }
    startTransition(async () => {
      try {
        const result = await updateSavPayment({ id, amount_due: amount, is_paid: paid })
        if (!result.success) setError(result.error)
        else toast.add({ title: 'Règlement enregistré', type: 'success' })
      } catch { setError('Enregistrement impossible. Réessayez.') }
    })
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <fieldset disabled={pending} className="grid gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="sav-amount-due">Montant à payer (TTC) en €</Label>
          <Input id="sav-amount-due" inputMode="decimal" placeholder="À définir" value={amount} onChange={(e) => { setAmount(e.target.value); setError(null) }} className="h-11 text-right text-lg tabular-nums" />
          <p className="text-xs text-muted-foreground">Laissez vide si le montant n’est pas encore connu.</p>
        </div>
        <div className="flex items-center justify-between gap-3">
          <label className="flex min-h-10 cursor-pointer items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={paid} onChange={(e) => { setPaid(e.target.checked); setError(null) }} className="size-4 accent-primary" />
            Payé
          </label>
          <span className={cn('rounded-full px-2.5 py-1 text-xs font-semibold', paid ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800')}>{paid ? 'Payé' : 'Non payé'}</span>
        </div>
        {parsed.success && parsed.data.amount_due !== null && <p className="flex justify-between border-t pt-3 text-sm"><span>Reste à payer</span><strong className="tabular-nums">{formatEuro(paid ? 0 : parsed.data.amount_due)}</strong></p>}
        <Button type="submit" disabled={!dirty || pending}>{pending ? 'Enregistrement…' : 'Enregistrer le règlement'}</Button>
      </fieldset>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </form>
  )
}
