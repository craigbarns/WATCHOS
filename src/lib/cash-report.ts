import { PAYMENT_LABELS } from '@/lib/format'

/** Rapport de caisse renvoyé par les fonctions SQL cash_report / day_cash_report. */
export type CashReport = {
  period_start: string
  period_end: string
  /** Tickets de vente, avoirs exclus depuis la migration 20261015000000_report_tickets.sql */
  tickets: number
  /** Avoirs (annulations) de la période et leur montant ; absents des clôtures plus anciennes */
  refunds?: number
  refunds_ttc?: number
  total_ht: number
  total_vat: number
  total_ttc: number
  discounts: number
  average_ticket: number
  first_receipt: string | null
  last_receipt: string | null
  payments: Array<{ method: string; count: number; amount: number }>
  payments_total: number
  vat: Array<{ rate: number; base_ht: number; vat_amount: number; total_ttc: number }>
  balanced: boolean
  /** Cumul TTC depuis le 1er janvier, scellé dans les clôtures depuis la migration 20261015100000_fiscal_audit.sql */
  year_to_date_ttc?: number
}

export const PAYMENT_ORDER = ['ESPÈCES', 'CB', 'CHÈQUE', 'VIREMENT', 'AUTRE'] as const

/** Tous les moyens de règlement, y compris ceux à zéro, dans un ordre stable. */
export function paymentBreakdown(report: Pick<CashReport, 'payments'>) {
  return PAYMENT_ORDER.map((method) => {
    const row = report.payments?.find((p) => p.method === method)
    return {
      method,
      label: PAYMENT_LABELS[method] ?? method,
      count: Number(row?.count ?? 0),
      amount: Number(row?.amount ?? 0),
    }
  })
}

export function isEmptyReport(report: CashReport | null): boolean {
  return !report || Number(report.tickets) === 0
}
