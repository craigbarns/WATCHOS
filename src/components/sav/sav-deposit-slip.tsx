'use client'

import { useState } from 'react'
import { Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { formatDate, formatDateTime } from '@/lib/format'

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
  customer: { civility: string | null; first_name: string; last_name: string; phone: string | null; email: string | null } | null
  store: { store_name: string; company_name: string | null; address: string | null; phone: string | null; siret: string | null } | null
}

/** Bon de dépôt remis au client (format A5, deux exemplaires : client + boutique). */
export function SavDepositSlipButton({ data }: { data: DepositSlipData }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant="outline" className="h-9" onClick={() => setOpen(true)}>
        <Printer /> Bon de dépôt
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-lg">Bon de dépôt {data.case_number}</DialogTitle>
          </DialogHeader>
          <div className="rounded-lg border">
            <DepositSlip data={data} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Fermer
            </Button>
            <Button onClick={() => window.print()}>
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
  ]

  return (
    <div className="print-area print-a5 bg-white p-6 text-[12px] leading-relaxed text-black">
      <div className="flex items-start justify-between border-b border-black pb-3">
        <div>
          <div className="font-playfair text-xl font-bold">{data.store?.store_name ?? 'Heure et Passion'}</div>
          {data.store?.address && <div>{data.store.address}</div>}
          {data.store?.phone && <div>Tél. {data.store.phone}</div>}
          {data.store?.siret && <div className="text-[10px]">SIRET {data.store.siret}</div>}
        </div>
        <div className="text-right">
          <div className="text-[10px] tracking-widest uppercase">Bon de dépôt SAV</div>
          <div className="font-mono text-lg font-bold">{data.case_number}</div>
          <div>{formatDateTime(data.deposit_date)}</div>
        </div>
      </div>

      <div className="mt-3">
        <div className="text-[10px] tracking-widest uppercase">Client</div>
        <div className="font-semibold">
          {[data.customer?.civility, data.customer?.first_name, data.customer?.last_name].filter(Boolean).join(' ')}
        </div>
        <div>{[data.customer?.phone, data.customer?.email].filter(Boolean).join(' · ')}</div>
      </div>

      <table className="mt-3 w-full border-collapse">
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label} className="border-b border-black/20 align-top">
              <td className="w-40 py-1.5 pr-3 text-[11px] font-semibold">{label}</td>
              <td className="py-1.5 whitespace-pre-line">{value || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="mt-3 text-[10px]">
        Présentez ce bon pour récupérer votre montre. Un devis vous sera communiqué avant toute intervention payante.
        Les montres non réclamées dans un délai d&apos;un an après avis de mise à disposition pourront faire l&apos;objet
        des démarches prévues par la loi.
      </p>

      <div className="mt-6 grid grid-cols-2 gap-6 text-[11px]">
        <div className="h-16 border-t border-black pt-1">Signature du client</div>
        <div className="h-16 border-t border-black pt-1">Signature boutique</div>
      </div>
    </div>
  )
}
