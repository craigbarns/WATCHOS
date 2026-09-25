'use client'

import { useRef, useState } from 'react'
import { Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { formatDate, formatDateTime, formatEuro } from '@/lib/format'
import { printElement } from '@/lib/print'

export type DepositSlipData = {
  case_number: string
  deposit_date: string
  estimated_date: string | null
  brand: string | null
  model: string | null
  reference: string | null
  serial_number: string | null
  declared_problem: string | null
  visual_condition: string | null
  accessories_left: string | null
  box_left: boolean
  amount_due: number | null
  is_paid: boolean
  customer: { civility: string | null; first_name: string; last_name: string; phone: string | null; email: string | null } | null
  store: { store_name: string; company_name: string | null; address: string | null; phone: string | null; siret: string | null } | null
}

/** Bon de dépôt remis au client, imprimé sur l'imprimante ticket 80 mm. */
export function SavDepositSlipButton({ data }: { data: DepositSlipData }) {
  const [open, setOpen] = useState(false)
  const slipRef = useRef<HTMLDivElement>(null)

  const print = () => {
    const el = slipRef.current?.querySelector<HTMLElement>('.print-area')
    if (el) printElement(el)
  }

  return (
    <>
      <Button variant="outline" className="h-9" onClick={() => setOpen(true)}>
        <Printer /> Bon de dépôt
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg">Bon de dépôt {data.case_number}</DialogTitle>
          </DialogHeader>
          <div ref={slipRef} className="rounded-lg border">
            <DepositSlip data={data} />
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

function DepositSlip({ data }: { data: DepositSlipData }) {
  const rows: Array<[string, string | null]> = [
    ['Marque / modèle', [data.brand, data.model].filter(Boolean).join(' ')],
    ['Référence', data.reference],
    ['N° de série', data.serial_number],
    ['Problème signalé', data.declared_problem],
    ['État au dépôt', data.visual_condition],
    ['Accessoires laissés', [data.accessories_left, data.box_left ? 'Boîte' : null].filter(Boolean).join(' · ') || null],
    ['Restitution estimée', data.estimated_date ? formatDate(data.estimated_date) : 'À confirmer après diagnostic'],
    ['Montant du SAV (TTC)', data.amount_due == null ? 'À définir' : formatEuro(data.amount_due)],
    ['Règlement', data.is_paid ? 'Payé' : 'Non payé'],
  ]

  return (
    <div className="print-area mx-auto w-full max-w-[80mm] bg-white p-4 font-mono text-[11px] leading-relaxed text-black">
      <div className="text-center">
        <div className="font-playfair text-lg font-bold">{data.store?.store_name ?? 'Heures et Passion'}</div>
        {data.store?.address && <div className="whitespace-pre-line">{data.store.address}</div>}
        {data.store?.phone && <div>Tél. {data.store.phone}</div>}
        {data.store?.siret && <div className="text-[9px]">SIRET {data.store.siret}</div>}
      </div>

      <div className="my-2 border-y-2 border-black py-1 text-center text-sm font-bold tracking-[0.2em]">BON DE DÉPÔT</div>

      <div className="flex justify-between font-semibold">
        <span>Dossier</span>
        <span>{data.case_number}</span>
      </div>
      <div className="flex justify-between">
        <span>Déposée le</span>
        <span>{formatDateTime(data.deposit_date)}</span>
      </div>

      <div className="my-2 border-t border-dashed border-black" />
      <div className="font-bold">CLIENT</div>
      <div>{[data.customer?.civility, data.customer?.first_name, data.customer?.last_name].filter(Boolean).join(' ')}</div>
      {data.customer?.phone && <div>{data.customer.phone}</div>}
      {data.customer?.email && <div className="break-all">{data.customer.email}</div>}

      <div className="my-2 border-t border-dashed border-black" />
      {rows.map(([label, value]) => (
        <div key={label} className="mb-1.5">
          <div className="text-[9px] tracking-wide uppercase">{label}</div>
          <div className="whitespace-pre-line">{value || '—'}</div>
        </div>
      ))}

      <div className="my-2 border-t border-dashed border-black" />
      <p className="text-[9px] leading-snug">
        Présentez ce bon pour récupérer votre montre. Un devis vous sera communiqué avant toute intervention payante.
        Montres non réclamées : voir les conditions de la boutique.
      </p>

      <div className="mt-6 border-t border-black pt-1 text-[9px]">Signature du client</div>
      <div className="mt-6 border-t border-black pt-1 text-[9px]">Signature boutique</div>
    </div>
  )
}
