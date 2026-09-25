'use client'

import { useRef, useState } from 'react'
import { FileText, Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { formatDate, formatDateTime, formatEuro } from '@/lib/format'
import { paymentBreakdown, type CashReport } from '@/lib/cash-report'
import { printElement } from '@/lib/print'

export type ZStore = { store_name: string; company_name: string | null; address: string | null; siret: string | null; vat_number: string | null } | null

export type ZClosure = {
  sequence_number: number
  perpetual_total: number
  current_hash: string
  created_at: string
  operator: string | null
} | null

/** Ticket de clôture Z, imprimable sur l'imprimante ticket. */
export function ZTicket({ report, store, closure, day }: { report: CashReport; store: ZStore; closure: ZClosure; day: string }) {
  const rows = paymentBreakdown(report)

  return (
    <div className="print-area mx-auto w-full max-w-[80mm] bg-white p-4 font-mono text-[11px] leading-relaxed text-black">
      <div className="text-center">
        <div className="font-playfair text-lg font-bold">{store?.store_name ?? 'Heures et Passion'}</div>
        {store?.company_name && <div>{store.company_name}</div>}
        {store?.address && <div className="whitespace-pre-line">{store.address}</div>}
        {store?.siret && <div>SIRET {store.siret}</div>}
        {store?.vat_number && <div>TVA {store.vat_number}</div>}
      </div>

      <div className="my-2 border-y-2 border-black py-1 text-center text-sm font-bold tracking-[0.2em]">
        {closure ? `CLÔTURE Z N°${closure.sequence_number}` : 'APERÇU DE CAISSE'}
      </div>

      <div className="flex justify-between">
        <span>Journée</span>
        <span>{formatDate(day)}</span>
      </div>
      {closure ? (
        <div className="flex justify-between">
          <span>Clôturée le</span>
          <span>{formatDateTime(closure.created_at)}</span>
        </div>
      ) : (
        <div className="flex justify-between">
          <span>Édité le</span>
          <span>{formatDateTime(new Date())}</span>
        </div>
      )}
      {closure?.operator && (
        <div className="flex justify-between">
          <span>Par</span>
          <span>{closure.operator}</span>
        </div>
      )}
      {report.first_receipt && (
        <div className="flex justify-between">
          <span>Tickets</span>
          <span>
            {report.first_receipt} → {report.last_receipt}
          </span>
        </div>
      )}

      <div className="my-2 border-t border-dashed border-black" />
      <div className="font-bold">RÈGLEMENTS</div>
      {rows.map((row) => (
        <div key={row.method} className="flex justify-between">
          <span>
            {row.label} {row.count > 0 && `(${row.count})`}
          </span>
          <span>{formatEuro(row.amount)}</span>
        </div>
      ))}
      <div className="mt-1 flex justify-between border-t border-black pt-1 font-bold">
        <span>TOTAL ENCAISSÉ</span>
        <span>{formatEuro(report.payments_total)}</span>
      </div>

      <div className="my-2 border-t border-dashed border-black" />
      <div className="font-bold">VENTES</div>
      <div className="flex justify-between">
        <span>Tickets</span>
        <span>{report.tickets}</span>
      </div>
      <div className="flex justify-between">
        <span>Panier moyen</span>
        <span>{formatEuro(report.average_ticket)}</span>
      </div>
      {Number(report.discounts) > 0 && (
        <div className="flex justify-between">
          <span>Remises</span>
          <span>-{formatEuro(report.discounts)}</span>
        </div>
      )}
      <div className="flex justify-between">
        <span>Total HT</span>
        <span>{formatEuro(report.total_ht)}</span>
      </div>
      {report.vat.map((v) => (
        <div key={v.rate} className="flex justify-between">
          <span>
            TVA {Number(v.rate)} % sur {formatEuro(v.base_ht)}
          </span>
          <span>{formatEuro(v.vat_amount)}</span>
        </div>
      ))}
      <div className="mt-1 flex justify-between border-t border-black pt-1 text-sm font-bold">
        <span>TOTAL TTC</span>
        <span>{formatEuro(report.total_ttc)}</span>
      </div>

      {closure && (
        <>
          <div className="my-2 border-t border-dashed border-black" />
          <div className="flex justify-between">
            <span>Grand total perpétuel</span>
            <span>{formatEuro(closure.perpetual_total)}</span>
          </div>
          <div className="mt-1 text-center text-[9px] break-all">
            Empreinte : {closure.current_hash.slice(0, 16)}…{closure.current_hash.slice(-8)}
          </div>
        </>
      )}

      {!report.balanced && (
        <p className="mt-2 border border-black p-1 text-center text-[10px] font-bold">
          ÉCART : {formatEuro(report.payments_total)} encaissés / {formatEuro(report.total_ttc)} vendus
        </p>
      )}

      {!closure && <p className="mt-2 text-center text-[10px]">Document interne — la journée n&apos;est pas clôturée.</p>}
    </div>
  )
}

export function ZTicketButton({
  report,
  store,
  closure,
  day,
  label = 'Détail',
  variant = 'ghost',
}: {
  report: CashReport
  store: ZStore
  closure: ZClosure
  day: string
  label?: string
  variant?: 'ghost' | 'outline'
}) {
  const [open, setOpen] = useState(false)
  const ticketRef = useRef<HTMLDivElement>(null)

  const print = () => {
    const el = ticketRef.current?.querySelector<HTMLElement>('.print-area')
    if (el) printElement(el)
  }

  return (
    <>
      <Button variant={variant} size="sm" onClick={() => setOpen(true)}>
        <FileText /> {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg">{closure ? `Clôture Z n°${closure.sequence_number}` : 'Caisse du jour'}</DialogTitle>
            <DialogDescription>{formatDate(day)}</DialogDescription>
          </DialogHeader>
          <div ref={ticketRef} className="rounded-lg border">
            <ZTicket report={report} store={store} closure={closure} day={day} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Fermer
            </Button>
            <Button onClick={print}>
              <Printer /> Imprimer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
