'use client'

import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, Copy, Loader2, Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Receipt } from '@/components/caisse/receipt'
import { getReceipt, type ReceiptData } from '@/app/actions/caisse'
import { printElement } from '@/lib/print'
import { setPrinterPrefs, usePrinterPrefs } from '@/lib/printer-prefs'
import { toast } from '@/components/ui/toast'

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
    await printElement(el, prefs.paper)
    setPrinting(false)
  }

  // Impression automatique après encaissement (une seule fois par vente)
  useEffect(() => {
    if (!loaded || duplicate || !prefs.autoPrint || !saleId || autoPrinted.current === saleId) return
    autoPrinted.current = saleId
    const el = ticketRef.current?.querySelector<HTMLElement>('.print-area')
    if (el) printElement(el, prefs.paper)
  }, [loaded, duplicate, prefs.autoPrint, prefs.paper, saleId])

  return (
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

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg bg-muted/60 px-3 py-2 text-sm">
          <span className="text-muted-foreground">Imprimante de ce poste :</span>
          <select
            value={prefs.paper}
            onChange={(e) => setPrinterPrefs({ paper: e.target.value as '80mm' | '58mm' })}
            className="h-7 rounded-md border border-input bg-background px-1.5 text-sm"
            aria-label="Largeur du rouleau"
          >
            <option value="80mm">Rouleau 80 mm</option>
            <option value="58mm">Rouleau 58 mm</option>
          </select>
          {!duplicate && (
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={prefs.autoPrint} onChange={(e) => setPrinterPrefs({ autoPrint: e.target.checked })} />
              Imprimer automatiquement
            </label>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={print} disabled={!loaded || printing}>
            {printing ? <Loader2 className="animate-spin" /> : <Printer />} {duplicate ? 'Imprimer le duplicata' : 'Imprimer le ticket'}
          </Button>
          <Button onClick={onClose} autoFocus>
            {closeLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
