'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { Ban, CheckCircle2, Copy, Loader2, Printer, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Receipt } from '@/components/caisse/receipt'
import { getReceipt, refundSale, type ReceiptData } from '@/app/actions/caisse'
import { printElement } from '@/lib/print'
import { setPrinterPrefs, usePrinterPrefs } from '@/lib/printer-prefs'
import { toast } from '@/components/ui/toast'
import { formatEuro } from '@/lib/format'

/**
 * Affiche et imprime le ticket d'une vente.
 * - mode "vente" : juste après l'encaissement, impression automatique possible
 * - mode "duplicata" : réimpression d'un ticket existant, marquée DUPLICATA
 */
export function ReceiptDialog({
  saleId,
  duplicate = false,
  onClose,
  closeLabel = 'Fermer',
}: {
  saleId: string | null
  duplicate?: boolean
  onClose: () => void
  closeLabel?: string
}) {
  const prefs = usePrinterPrefs()
  const [receipt, setReceipt] = useState<{ saleId: string; data: ReceiptData | null } | null>(null)
  const [printing, setPrinting] = useState(false)
  const ticketRef = useRef<HTMLDivElement>(null)
  const autoPrinted = useRef<string | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const [reason, setReason] = useState('')
  const [cancelError, setCancelError] = useState<string | null>(null)
  const [refunding, startRefund] = useTransition()
  const [refundId, setRefundId] = useState<string | null>(null)

  const loaded = receipt && receipt.saleId === saleId ? receipt.data : null
  const loading = saleId !== null && receipt?.saleId !== saleId

  useEffect(() => {
    if (!saleId) return
    let cancelled = false
    getReceipt(saleId).then((data) => {
      if (cancelled) return
      setReceipt({ saleId, data })
      if (!data) toast.add({ title: 'Ticket introuvable', type: 'error' })
    })
    return () => {
      cancelled = true
    }
  }, [saleId])

  const print = async () => {
    const el = ticketRef.current?.querySelector<HTMLElement>('.print-area')
    if (!el) return
    setPrinting(true)
    await printElement(el)
    setPrinting(false)
  }

  // Impression automatique après encaissement (une seule fois par vente)
  useEffect(() => {
    if (!loaded || duplicate || !prefs.autoPrint || !saleId || autoPrinted.current === saleId) return
    autoPrinted.current = saleId
    const el = ticketRef.current?.querySelector<HTMLElement>('.print-area')
    if (el) printElement(el)
  }, [loaded, duplicate, prefs.autoPrint, saleId])

  return (
    <>
    <Dialog open={saleId !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            {duplicate ? (
              <>
                <Copy className="size-5" /> Duplicata {loaded?.receipt_number}
              </>
            ) : (
              <>
                <CheckCircle2 className="size-5 text-emerald-600" /> Vente validée
              </>
            )}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex h-60 items-center justify-center text-muted-foreground">
            <Loader2 className="animate-spin" />
          </div>
        ) : (
          loaded && (
            <div ref={ticketRef} className="rounded-lg border">
              <Receipt receipt={loaded} duplicate={duplicate} />
            </div>
          )
        )}

        {cancelling && loaded && (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              setCancelError(null)
              startRefund(async () => {
                const result = await refundSale(saleId!, reason, crypto.randomUUID())
                if (!result.success) {
                  setCancelError(result.error)
                  return
                }
                toast.add({ title: `Vente annulée — avoir ${result.receiptNumber}`, type: 'success' })
                setCancelling(false)
                setRefundId(result.refundId)
                onClose()
              })
            }}
            className="grid gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm"
          >
            <p className="flex items-start gap-2 font-medium">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
              Annuler le ticket {loaded.receipt_number} ({formatEuro(loaded.total_ttc)}) ?
            </p>
            <p className="text-xs text-muted-foreground">
              La vente reste enregistrée, comme l&apos;impose la réglementation. Un avoir est créé : les règlements sont
              remboursés dans les totaux et les articles reviennent en stock.
            </p>
            <label htmlFor="cancel-reason" className="text-xs font-medium">
              Motif *
            </label>
            <input
              id="cancel-reason"
              required
              minLength={3}
              autoFocus
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Erreur de saisie, client s’est ravisé, mauvais article…"
              className="h-9 rounded-lg border border-input bg-background px-2.5 outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
            {cancelError && <p className="text-sm text-destructive">{cancelError}</p>}
            <div className="flex gap-2">
              <Button type="submit" variant="destructive" disabled={refunding} className="h-9">
                {refunding ? 'Annulation…' : 'Confirmer l’annulation'}
              </Button>
              <Button type="button" variant="ghost" className="h-9" onClick={() => setCancelling(false)}>
                Retour
              </Button>
            </div>
          </form>
        )}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg bg-muted/60 px-3 py-2 text-sm">
          <span className="text-muted-foreground">Imprimante ticket 80 mm</span>
          {!duplicate && (
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={prefs.autoPrint} onChange={(e) => setPrinterPrefs({ autoPrint: e.target.checked })} />
              Imprimer automatiquement
            </label>
          )}
        </div>

        <DialogFooter className="sm:justify-between">
          {loaded && !loaded.is_refund && !loaded.cancelled_by && !cancelling ? (
            <Button variant="ghost" className="text-destructive sm:mr-auto" onClick={() => {
                setReason('')
                setCancelError(null)
                setCancelling(true)
              }}>
              <Ban /> Annuler la vente
            </Button>
          ) : (
            <span className="hidden sm:block" />
          )}
          <Button variant="outline" onClick={print} disabled={!loaded || printing}>
            {printing ? <Loader2 className="animate-spin" /> : <Printer />} {duplicate ? 'Imprimer le duplicata' : 'Imprimer le ticket'}
          </Button>
          <Button onClick={onClose} autoFocus>
            {closeLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* Ticket d'avoir, imprimable et remis au client */}
    {refundId && <ReceiptDialog saleId={refundId} onClose={() => setRefundId(null)} closeLabel="Fermer" />}
    </>
  )
}

/** Bouton « Réimprimer » pour une vente passée (tableau de bord, rapports). */
export function ReprintButton({ saleId, label }: { saleId: string; label?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant="ghost" size={label ? 'sm' : 'icon-sm'} onClick={() => setOpen(true)} title="Réimprimer le ticket (duplicata)">
        <Printer /> {label}
      </Button>
      <ReceiptDialog saleId={open ? saleId : null} duplicate onClose={() => setOpen(false)} />
    </>
  )
}
