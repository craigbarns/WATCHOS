import type { ReceiptData } from '@/app/actions/caisse'
import { formatDateAndTime, formatEuro, PAYMENT_LABELS } from '@/lib/format'

/** Ticket de caisse pour imprimante thermique (80 / 58 mm), imprimé via printElement. */
export function Receipt({ receipt, duplicate = false }: { receipt: ReceiptData; duplicate?: boolean }) {
  const purchase = formatDateAndTime(receipt.finalized_at)
  const reprint = duplicate ? formatDateAndTime() : null
  const vatBreakdown = new Map<number, { ht: number; ttc: number }>()
  for (const line of receipt.lines) {
    const ht = line.total_ht ?? line.total_ttc / (1 + line.vat_rate / 100)
    const entry = vatBreakdown.get(line.vat_rate) ?? { ht: 0, ttc: 0 }
    entry.ht += ht
    entry.ttc += line.total_ttc
    vatBreakdown.set(line.vat_rate, entry)
  }

  return (
    <div className="print-area mx-auto w-full max-w-[80mm] bg-white p-4 font-mono text-[11px] leading-relaxed text-black">
      <div className="text-center">
        <div className="font-playfair text-lg font-bold">{receipt.store?.store_name ?? 'Heures et Passion'}</div>
        {receipt.store?.company_name && <div>{receipt.store.company_name}</div>}
        {receipt.store?.address && <div className="whitespace-pre-line">{receipt.store.address}</div>}
        {receipt.store?.phone && <div>Tél. {receipt.store.phone}</div>}
        {receipt.store?.siret && <div>SIRET {receipt.store.siret}</div>}
        {receipt.store?.vat_number && <div>TVA {receipt.store.vat_number}</div>}
      </div>

      {receipt.is_refund && (
        <div className="mt-2 border-2 border-black py-1 text-center text-sm font-bold tracking-[0.2em]">AVOIR — ANNULATION</div>
      )}
      {receipt.cancelled_by && !receipt.is_refund && (
        <div className="mt-2 border-2 border-black py-1 text-center text-[11px] font-bold">
          TICKET ANNULÉ LE {formatDateAndTime(receipt.cancelled_by.finalized_at).date}
          <div className="font-normal">Avoir {receipt.cancelled_by.receipt_number}</div>
        </div>
      )}
      {duplicate && (
        <div className="mt-2 border-2 border-black py-0.5 text-center text-sm font-bold tracking-[0.3em]">DUPLICATA</div>
      )}
      <div className="my-2 border-t border-dashed border-black" />
      <div className="flex justify-between font-semibold">
        <span>Ticket n°</span>
        <span>{receipt.receipt_number}</span>
      </div>
      <div className="flex justify-between">
        <span>Date d&apos;achat</span>
        <span>{purchase.date}</span>
      </div>
      <div className="flex justify-between">
        <span>Heure d&apos;achat</span>
        <span>{purchase.time}</span>
      </div>
      {reprint && (
        <div className="flex justify-between">
          <span>Réimprimé le</span>
          <span>
            {reprint.date} à {reprint.time}
          </span>
        </div>
      )}
      {receipt.cancels_receipt && (
        <div className="flex justify-between">
          <span>Annule le ticket</span>
          <span>{receipt.cancels_receipt}</span>
        </div>
      )}
      {receipt.cancel_reason && <div className="whitespace-pre-line">Motif : {receipt.cancel_reason}</div>}
      {receipt.seller && <div>{receipt.is_refund ? 'Opérateur' : 'Vendeur'} : {receipt.seller}</div>}
      {receipt.customer && (
        <div>
          Client : {receipt.customer.first_name} {receipt.customer.last_name}
        </div>
      )}
      <div className="my-2 border-t border-dashed border-black" />

      {receipt.lines.map((line, i) => (
        <div key={i} className="mb-1.5">
          <div className="font-semibold">{line.label}</div>
          {line.serial_number && <div>N° série : {line.serial_number}</div>}
          <div className="flex justify-between">
            <span>
              {line.quantity} × {formatEuro(line.unit_price_ttc)}
            </span>
            <span>{formatEuro(line.unit_price_ttc * line.quantity)}</span>
          </div>
          {line.discount_amount > 0 && (
            <div className="flex justify-between">
              <span>Remise</span>
              <span>-{formatEuro(line.discount_amount)}</span>
            </div>
          )}
        </div>
      ))}

      <div className="my-2 border-t border-dashed border-black" />
      <div className="flex justify-between text-sm font-bold">
        <span>{receipt.is_refund ? 'TOTAL REMBOURSÉ' : 'TOTAL TTC'}</span>
        <span>{formatEuro(receipt.total_ttc)}</span>
      </div>
      <div className="mt-1">
        {[...vatBreakdown.entries()].map(([rate, v]) => (
          <div key={rate} className="flex justify-between">
            <span>
              TVA {rate} % sur {formatEuro(v.ht)}
            </span>
            <span>{formatEuro(v.ttc - v.ht)}</span>
          </div>
        ))}
        <div className="flex justify-between">
          <span>Total HT</span>
          <span>{formatEuro(receipt.total_ht)}</span>
        </div>
      </div>

      <div className="my-2 border-t border-dashed border-black" />
      {receipt.payments.map((p, i) => (
        <div key={i} className="flex justify-between">
          <span>{PAYMENT_LABELS[p.method] ?? p.method}</span>
          <span>{formatEuro(p.amount)}</span>
        </div>
      ))}

      <div className="my-2 border-t border-dashed border-black" />
      <div className="text-center text-[9px] break-all">
        {receipt.sequence_number !== null && <div>Opération n° {receipt.sequence_number}</div>}
        {receipt.hash && <div>Empreinte : {receipt.hash.slice(0, 16)}…{receipt.hash.slice(-8)}</div>}
        <div className="mt-2 text-[11px]">Merci de votre visite</div>
      </div>
    </div>
  )
}
