'use server'

import { createClient } from '@/lib/supabase/server'
import { requireStaff } from '@/lib/auth'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { sanitizeSearchTerm as sanitizeTerm } from '@/lib/search'

export type PaymentMethod = 'CB' | 'ESPÈCES' | 'VIREMENT' | 'CHÈQUE' | 'AUTRE'

export type PaymentInput = {
  method: PaymentMethod
  amount: number
}

/** Le montant TTC est saisi en caisse ; le poste et la TVA sont vérifiés en base. */
export type SaleLineInput = {
  service_id: string
  unit_price_ttc: number
  quantity: number
  discount_amount?: number
}

export type CatalogItem = {
  key: string
  service_id: string
  model: string
  price_ttc: number
  vat_rate: number
}

export type CustomerSummary = {
  id: string
  first_name: string
  last_name: string
  phone: string | null
  email: string | null
}

export async function searchCatalog(query: string): Promise<CatalogItem[]> {
  const guard = await requireStaff()
  if (!guard.ok) return []

  const term = sanitizeTerm(query)
  const supabase = await createClient()
  let request = supabase.from('service_categories').select('id, label, vat_rate').eq('active', true).order('sort_order')
  if (term) request = request.ilike('label', `%${term}%`)
  const { data, error } = await request
  if (error) throw new Error('Les prestations sont momentanément indisponibles.')
  return (data ?? []).map((service) => ({
    key: service.id, service_id: service.id, model: service.label, price_ttc: 0, vat_rate: Number(service.vat_rate),
  }))
}

export async function searchCustomers(query: string): Promise<CustomerSummary[]> {
  const guard = await requireStaff()
  if (!guard.ok) return []

  const term = sanitizeTerm(query)
  const supabase = await createClient()
  let q = supabase.from('customers').select('id, first_name, last_name, phone, email').limit(8)
  if (term) {
    q = q.or(`first_name.ilike.%${term}%,last_name.ilike.%${term}%,phone.ilike.%${term}%,email.ilike.%${term}%`)
  } else {
    q = q.order('created_at', { ascending: false })
  }
  const { data, error } = await q
  if (error) throw new Error('La recherche de clients est indisponible.')
  return data ?? []
}

const finalizeSchema = z.object({
  customerId: z.guid().nullable(),
  lines: z
    .array(
      z.object({
        service_id: z.guid(),
        unit_price_ttc: z.number().min(0.01).max(999999.99).refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-7, 'Deux décimales maximum.'),
        quantity: z.number().int().min(1).max(999),
        discount_amount: z.number().min(0).optional(),
      })
    )
    .min(1, 'Le panier est vide.'),
  payments: z
    .array(
      z.object({
        method: z.enum(['CB', 'ESPÈCES', 'VIREMENT', 'CHÈQUE', 'AUTRE']),
        amount: z.number().positive(),
      })
    )
    .min(1, 'Aucun paiement saisi.'),
  idempotencyKey: z.string().min(8),
})

export type FinalizeSaleResult =
  | { success: true; data: { sale_id: string; receipt_number: string; hash?: string; total_ttc?: number } }
  | { success: false; error: string }

export async function finalizeSale(
  customerId: string | null,
  lines: SaleLineInput[],
  payments: PaymentInput[],
  idempotencyKey: string
): Promise<FinalizeSaleResult> {
  const guard = await requireStaff(['ADMIN', 'VENDEUR'])
  if (!guard.ok) return { success: false, error: guard.error }

  const parsed = finalizeSchema.safeParse({ customerId, lines, payments, idempotencyKey })
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? 'Données de vente invalides.' }
  }

  // L'opérateur, le poste, la TVA, les totaux et le chaînage fiscal sont
  // déterminés côté base, dans une seule transaction (RPC finalize_sale).
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('finalize_sale', {
    p_customer_id: parsed.data.customerId,
    p_lines: parsed.data.lines,
    p_payments: parsed.data.payments,
    p_idempotency_key: parsed.data.idempotencyKey,
  })

  if (error) {
    console.error('Finalize sale error:', error)
    return { success: false, error: error.message }
  }

  revalidatePath('/caisse')
  revalidatePath('/dashboard')
  revalidatePath('/stock')
  revalidatePath('/rapports')
  revalidatePath('/statistiques')

  return { success: true, data }
}

export type ReceiptData = {
  receipt_number: string
  /** Vrai pour un avoir (annulation) : montants négatifs */
  is_refund: boolean
  /** Ticket annulé par cet avoir */
  cancels_receipt: string | null
  cancel_reason: string | null
  /** Avoir ayant annulé cette vente (le ticket n'est alors plus valable) */
  cancelled_by: { id: string; receipt_number: string; finalized_at: string; reason: string | null } | null
  finalized_at: string
  total_ht: number
  total_vat: number
  total_ttc: number
  hash: string | null
  sequence_number: number | null
  seller: string | null
  customer: { first_name: string; last_name: string } | null
  lines: Array<{ label: string; quantity: number; unit_price_ttc: number; discount_amount: number; total_ttc: number; total_ht: number | null; vat_rate: number; serial_number: string | null }>
  payments: Array<{ method: string; amount: number }>
  store: { store_name: string; company_name: string | null; address: string | null; siret: string | null; vat_number: string | null; phone: string | null } | null
}

export async function getReceipt(saleId: string): Promise<ReceiptData | null> {
  const guard = await requireStaff()
  if (!guard.ok || !z.guid().safeParse(saleId).success) return null

  const supabase = await createClient()
  const SALE_COLUMNS =
    'receipt_number, finalized_at, total_ht, total_vat, total_ttc, parent_sale_id, seller:profiles(full_name), customer:customers(first_name, last_name), sale_lines(label, quantity, unit_price_ttc, discount_amount, total_ttc, total_ht, vat_rate, created_at, item:serialized_items(serial_number)), payments(method, amount)'
  // cancel_reason n'existe qu'à partir de la migration 20260923000000_refund_sale.sql
  const saleQuery = async () => {
    const withReason = await supabase.from('sales').select(`${SALE_COLUMNS}, cancel_reason`).eq('id', saleId).maybeSingle()
    if (!withReason.error) return withReason
    return supabase.from('sales').select(SALE_COLUMNS).eq('id', saleId).maybeSingle()
  }

  const [{ data: sale }, { data: store }, { data: event }] = await Promise.all([
    saleQuery(),
    supabase.from('settings').select('store_name, company_name, address, siret, vat_number, phone').limit(1).maybeSingle(),
    supabase.from('fiscal_events').select('current_hash, sequence_number').eq('entity_id', saleId).maybeSingle(),
  ])
  if (!sale) return null

  type Row = {
    receipt_number: string
    parent_sale_id: string | null
    cancel_reason?: string | null
    finalized_at: string
    total_ht: number
    total_vat: number
    total_ttc: number
    payments: Array<{ method: string; amount: number }>
    seller: { full_name: string } | null
    customer: { first_name: string; last_name: string } | null
    sale_lines: Array<{ label: string; quantity: number; unit_price_ttc: number; discount_amount: number; total_ttc: number; total_ht: number | null; vat_rate: number; item: { serial_number: string } | null }>
  }
  const s = sale as unknown as Row

  // Lien avec l'avoir : requêtes explicites (l'auto-jointure sales → sales est ambiguë côté API)
  const refundQuery = async () => {
    const withReason = await supabase
      .from('sales')
      .select('id, receipt_number, finalized_at, cancel_reason')
      .eq('parent_sale_id', saleId)
      .maybeSingle()
    if (!withReason.error) return withReason
    return supabase.from('sales').select('id, receipt_number, finalized_at').eq('parent_sale_id', saleId).maybeSingle()
  }

  const [{ data: parent }, { data: refund }] = await Promise.all([
    s.parent_sale_id
      ? supabase.from('sales').select('receipt_number').eq('id', s.parent_sale_id).maybeSingle()
      : Promise.resolve({ data: null }),
    refundQuery(),
  ])

  return {
    receipt_number: s.receipt_number,
    is_refund: s.parent_sale_id !== null,
    cancels_receipt: parent?.receipt_number ?? null,
    cancel_reason: s.cancel_reason ?? null,
    cancelled_by: refund
      ? { id: refund.id, receipt_number: refund.receipt_number, finalized_at: refund.finalized_at, reason: ('cancel_reason' in refund ? refund.cancel_reason : null) as string | null }
      : null,
    finalized_at: s.finalized_at,
    total_ht: Number(s.total_ht),
    total_vat: Number(s.total_vat),
    total_ttc: Number(s.total_ttc),
    hash: event?.current_hash ?? null,
    sequence_number: event?.sequence_number ?? null,
    seller: s.seller?.full_name ?? null,
    customer: s.customer,
    lines: s.sale_lines.map((l) => ({
      label: l.label,
      quantity: l.quantity,
      unit_price_ttc: Number(l.unit_price_ttc),
      discount_amount: Number(l.discount_amount ?? 0),
      total_ttc: Number(l.total_ttc),
      total_ht: l.total_ht === null ? null : Number(l.total_ht),
      vat_rate: Number(l.vat_rate),
      serial_number: l.item?.serial_number ?? null,
    })),
    payments: (s.payments ?? []).map((p) => ({ method: p.method, amount: Number(p.amount) })),
    store,
  }
}

const refundSchema = z.object({
  saleId: z.guid(),
  reason: z.string().trim().min(3, 'Indiquez le motif de l’annulation.').max(500),
  idempotencyKey: z.string().min(8),
})

export type RefundResult =
  | { success: true; refundId: string; receiptNumber: string; replayed?: boolean }
  | { success: false; error: string }

/** Annule une vente en créant un avoir : la vente d'origine reste intacte. */
export async function refundSale(saleId: string, reason: string, idempotencyKey: string): Promise<RefundResult> {
  const guard = await requireStaff(['ADMIN', 'VENDEUR'])
  if (!guard.ok) return { success: false, error: guard.error }

  const parsed = refundSchema.safeParse({ saleId, reason, idempotencyKey })
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? 'Données invalides.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('refund_sale', {
    p_sale_id: parsed.data.saleId,
    p_reason: parsed.data.reason,
    p_idempotency_key: parsed.data.idempotencyKey,
  })

  if (error) {
    return {
      success: false,
      error:
        error.code === 'PGRST202'
          ? 'L’annulation de vente doit d’abord être activée en base (migration 20260923000000_refund_sale.sql).'
          : error.message,
    }
  }

  revalidatePath('/caisse')
  revalidatePath('/dashboard')
  revalidatePath('/rapports')
  revalidatePath('/rapports/encaissements')
  revalidatePath('/stock', 'layout')

  return { success: true, refundId: data.refund_id, receiptNumber: data.receipt_number, replayed: data.replayed }
}
