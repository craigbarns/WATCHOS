import { formatEuro } from '@/lib/format'
import { paymentBreakdown, type CashReport } from '@/lib/cash-report'
import { cn } from '@/lib/utils'

/** Répartition des encaissements par mode de règlement + ventilation de TVA. */
export function CashSummary({ report, compact = false }: { report: CashReport; compact?: boolean }) {
  const rows = paymentBreakdown(report)
  const totalTTC = Number(report.total_ttc)

  return (
    <div className="space-y-4">
      <ul className={cn('grid gap-2', compact ? 'sm:grid-cols-2' : 'sm:grid-cols-3')}>
        {rows.map((row) => (
          <li
            key={row.method}
            className={cn(
              'rounded-lg border px-3 py-2',
              row.amount === 0 ? 'text-muted-foreground' : 'bg-muted/40'
            )}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-medium">{row.label}</span>
              <span className="text-base font-semibold tabular-nums">{formatEuro(row.amount)}</span>
            </div>
            <div className="text-xs text-muted-foreground">
              {row.count === 0 ? 'aucun règlement' : `${row.count} règlement${row.count > 1 ? 's' : ''}`}
              {row.amount > 0 && totalTTC > 0 && ` · ${Math.round((row.amount / totalTTC) * 100)} %`}
            </div>
          </li>
        ))}
      </ul>

      <div className="grid gap-3 sm:grid-cols-2">
        <dl className="space-y-1 text-sm">
          {[
            ['Tickets', String(report.tickets)],
            ['Panier moyen', formatEuro(report.average_ticket)],
            ['Remises accordées', formatEuro(report.discounts)],
            ['Total HT', formatEuro(report.total_ht)],
            ['TVA', formatEuro(report.total_vat)],
          ].map(([label, value]) => (
            <div key={label} className="flex justify-between gap-2">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="tabular-nums">{value}</dd>
            </div>
          ))}
          <div className="flex justify-between gap-2 border-t pt-1 text-base font-bold">
            <dt>Total TTC</dt>
            <dd className="tabular-nums">{formatEuro(totalTTC)}</dd>
          </div>
        </dl>

        <div className="space-y-1 text-sm">
          <div className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Ventilation de TVA</div>
          {report.vat.length === 0 ? (
            <p className="text-muted-foreground">Aucune opération</p>
          ) : (
            report.vat.map((v) => (
              <div key={v.rate} className="flex justify-between gap-2">
                <span className="text-muted-foreground">
                  TVA {Number(v.rate)} % sur {formatEuro(v.base_ht)}
                </span>
                <span className="tabular-nums">{formatEuro(v.vat_amount)}</span>
              </div>
            ))
          )}
          {report.first_receipt && (
            <p className="pt-2 text-xs text-muted-foreground">
              Tickets {report.first_receipt} → {report.last_receipt}
            </p>
          )}
        </div>
      </div>

      {!report.balanced && (
        <p className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">
          Écart détecté : {formatEuro(report.payments_total)} encaissés pour {formatEuro(totalTTC)} de ventes.
        </p>
      )}
    </div>
  )
}
