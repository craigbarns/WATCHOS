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
  const [{ data: sale }, { data: store }, { data: event }] = await Promise.all([
    supabase
      .from('sales')
      .select('receipt_number, finalized_at, total_ht, total_vat, total_ttc, seller:profiles(full_name), customer:customers(first_name, last_name), sale_lines(label, quantity, unit_price_ttc, discount_amount, total_ttc, total_ht, vat_rate, created_at, item:serialized_items(serial_number)), payments(method, amount)')
      .eq('id', saleId)
      .single(),
    supabase.from('settings').select('store_name, company_name, address, siret, vat_number, phone').limit(1).maybeSingle(),
    supabase.from('fiscal_events').select('current_hash, sequence_number').eq('entity_id', saleId).maybeSingle(),
  ])
  if (!sale) return null

  type Row = {
    receipt_number: string
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

  return {
    receipt_number: s.receipt_number,
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
