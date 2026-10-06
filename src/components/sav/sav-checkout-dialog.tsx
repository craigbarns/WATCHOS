'use client'

import { useEffect, useState, useTransition } from 'react'
import { Banknote, CreditCard, CircleDollarSign, FileSignature, Landmark, Receipt, ShieldCheck, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from '@/components/ui/toast'
import { checkoutSav, listServices, type ServiceOption } from '@/app/actions/sav'
import { ReceiptDialog } from '@/components/caisse/receipt-dialog'
import { formatEuro, PAYMENT_LABELS } from '@/lib/format'
import { cn } from '@/lib/utils'

type Method = 'CB' | 'ESPÈCES' | 'VIREMENT' | 'CHÈQUE' | 'AUTRE'

const METHODS: Array<{ method: Method; icon: typeof CreditCard }> = [
  { method: 'CB', icon: CreditCard },
  { method: 'ESPÈCES', icon: Banknote },
  { method: 'CHÈQUE', icon: FileSignature },
  { method: 'VIREMENT', icon: Landmark },
  { method: 'AUTRE', icon: CircleDollarSign },
]

const cents = (v: number) => Math.round(v * 100) / 100
const parseAmount = (raw: string) => {
  const n = Number(raw.replace(/\s/g, '').replace(',', '.'))
  return Number.isFinite(n) ? cents(n) : 0
}

/** Encaisse le SAV en caisse : crée la vente, puis propose l'impression du ticket. */
export function SavCheckoutButton({
  caseId,
  amountDue,
  caseNumber,
}: {
  caseId: string
  amountDue: number | null
  caseNumber: string
}) {
  const [open, setOpen] = useState(false)
  const [saleId, setSaleId] = useState<string | null>(null)

  return (
    <>
      <Button className="h-10 w-full" onClick={() => setOpen(true)}>
        <Receipt /> Encaisser et imprimer le ticket
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-md">
          {open && (
            <CheckoutForm
              caseId={caseId}
              caseNumber={caseNumber}
              amountDue={amountDue}
              onClose={() => setOpen(false)}
              onPaid={(id) => {
                setOpen(false)
                setSaleId(id)
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Ticket de caisse du SAV, prêt à imprimer */}
      {saleId && <ReceiptDialog saleId={saleId} onClose={() => setSaleId(null)} closeLabel="Fermer" />}
    </>
  )
}

function CheckoutForm({
  caseId,
  caseNumber,
  amountDue,
  onClose,
  onPaid,
}: {
  caseId: string
  caseNumber: string
  amountDue: number | null
  onClose: () => void
  onPaid: (saleId: string) => void
}) {
  const [services, setServices] = useState<ServiceOption[]>([])
  const [serviceId, setServiceId] = useState('')
  const [amountInput, setAmountInput] = useState(amountDue === null ? '' : amountDue.toFixed(2).replace('.', ','))
  const [payments, setPayments] = useState<Array<{ method: Method; amount: number }>>([])
  const [warranty, setWarranty] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    let cancelled = false
    listServices().then((list) => {
      if (cancelled) return
      setServices(list)
      setServiceId((current) => current || list[0]?.id || '')
    })
    return () => {
      cancelled = true
    }
  }, [])

  const amount = parseAmount(amountInput)
  const paid = cents(payments.reduce((s, p) => s + p.amount, 0))
  const remaining = cents(amount - paid)

  const addPayment = (method: Method) => {
    if (remaining <= 0) return
    setError(null)
    setPayments((p) => [...p, { method, amount: remaining }])
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (amount <= 0) {
      setError('Saisissez le montant à encaisser.')
      return
    }
    if (remaining !== 0) {
      setError(`Il reste ${formatEuro(remaining)} à répartir entre les modes de règlement.`)
      return
    }
    startTransition(async () => {
      const result = await checkoutSav({ id: caseId, serviceId, amount, payments, warranty, idempotencyKey: crypto.randomUUID() })
      if (!result.success) {
        setError(result.error)
        return
      }
      toast.add({ title: `SAV encaissé — ticket ${result.receiptNumber}`, type: 'success' })
      onPaid(result.saleId)
    })
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle className="text-lg">Encaisser le dossier {caseNumber}</DialogTitle>
        <DialogDescription>
          Crée une vente avec son ticket numéroté, comme un encaissement en caisse. Le dossier est marqué payé.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-1.5">
        <Label htmlFor="sav-service">Prestation facturée</Label>
        <select
          id="sav-service"
          value={serviceId}
          onChange={(e) => setServiceId(e.target.value)}
          required
          className="h-10 rounded-lg border border-input bg-transparent px-2 text-sm"
        >
          {services.length === 0 && <option value="">Chargement…</option>}
          {services.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        <span className="text-xs text-muted-foreground">Elle apparaît sur le ticket et dans les ventes par poste.</span>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="sav-amount">Montant TTC</Label>
        <Input
          id="sav-amount"
          inputMode="decimal"
          required
          value={amountInput}
          onChange={(e) => {
            setAmountInput(e.target.value)
            setPayments([])
            setError(null)
          }}
          className="h-11 text-right text-lg tabular-nums"
        />
      </div>

      <label
        className={cn(
          'flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg border px-3 text-sm transition-colors',
          warranty ? 'border-primary bg-primary/5 font-medium' : 'hover:bg-muted'
        )}
      >
        <input type="checkbox" checked={warranty} onChange={(e) => setWarranty(e.target.checked)} className="size-4 accent-primary" />
        <ShieldCheck className="size-4 text-muted-foreground" />
        Garantie 1 an sur l&apos;intervention
        <span className="ml-auto text-xs text-muted-foreground">imprimée sur le ticket</span>
      </label>

      <div className="grid gap-2">
        <span className="text-sm font-medium">Règlement</span>
        {payments.map((p, i) => (
          <div key={i} className="flex items-center justify-between rounded-lg bg-muted px-3 py-2 text-sm">
            <span>{PAYMENT_LABELS[p.method]}</span>
            <span className="flex items-center gap-2 font-medium tabular-nums">
              {formatEuro(p.amount)}
              <button
                type="button"
                aria-label="Retirer ce règlement"
                className="text-muted-foreground hover:text-destructive"
                onClick={() => setPayments((list) => list.filter((_, j) => j !== i))}
              >
                <X className="size-3.5" />
              </button>
            </span>
          </div>
        ))}
        <div className="grid grid-cols-2 gap-2">
          {METHODS.map(({ method, icon: Icon }) => (
            <Button
              key={method}
              type="button"
              variant="outline"
              className={cn('h-11', method === 'CB' && 'col-span-2')}
              disabled={remaining <= 0}
              onClick={() => addPayment(method)}
            >
              <Icon /> {PAYMENT_LABELS[method]}
              {payments.length === 0 && remaining > 0 && method === 'CB' && (
                <span className="ml-1 text-xs opacity-70">{formatEuro(remaining)}</span>
              )}
            </Button>
          ))}
        </div>
        {remaining !== 0 && amount > 0 && (
          <p className="flex justify-between text-sm">
            <span className="text-muted-foreground">Reste à répartir</span>
            <strong className={cn('tabular-nums', remaining > 0 ? 'text-destructive' : 'text-amber-600')}>
              {formatEuro(remaining)}
            </strong>
          </p>
        )}
      </div>

      {error && <p className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">{error}</p>}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Annuler
        </Button>
        <Button type="submit" disabled={pending || amount <= 0 || remaining !== 0 || !serviceId}>
          {pending ? 'Encaissement…' : `Encaisser ${amount > 0 ? formatEuro(amount) : ''}`}
        </Button>
      </DialogFooter>
    </form>
  )
}
