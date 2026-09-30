'use server'

import { createClient } from '@/lib/supabase/server'
import { requireStaff } from '@/lib/auth'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { SAV_STATUS } from '@/lib/format'
import { whatsappPhone } from '@/lib/whatsapp'
import { hasSmsKey, savReadySms, sendSms } from '@/lib/sms'
import { savPaymentSchema, type SavPaymentInput } from '@/lib/sav-payment'

type Result<T = object> = ({ success: true } & T) | { success: false; error: string }

const optional = z.string().trim().max(2000).transform((v) => v || null)
const optionalDate = z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/, 'Date invalide').transform((v) => v || null)
const optionalId = z.union([z.literal(''), z.guid()]).transform((v) => v || null)

const createSchema = z.object({
  customer_id: z.guid({ message: 'Sélectionnez un client' }),
  brand: z.string().trim().min(1, 'Marque requise').max(100),
  model: optional,
  reference: optional,
  serial_number: optional,
  declared_problem: z.string().trim().min(1, 'Décrivez le problème signalé').max(2000),
  visual_condition: optional,
  accessories_left: optional,
  box_left: z.boolean(),
  technician_id: optionalId,
  estimated_date: optionalDate,
  internal_notes: optional,
})

export type SavCreateInput = z.input<typeof createSchema>

/** Numéro lisible et continu par année : SAV-2026-0001 (unicité garantie par la contrainte UNIQUE). */
async function nextCaseNumber(supabase: Awaited<ReturnType<typeof createClient>>, offset: number) {
  const year = new Date().toLocaleDateString('fr-FR', { year: 'numeric', timeZone: 'Europe/Paris' })
  const { count } = await supabase
    .from('sav_cases')
    .select('id', { count: 'exact', head: true })
    .like('case_number', `SAV-${year}-%`)
  return `SAV-${year}-${String((count ?? 0) + 1 + offset).padStart(4, '0')}`
}

export async function createSavCase(input: SavCreateInput): Promise<Result<{ id: string }>> {
  const guard = await requireStaff()
  if (!guard.ok) return { success: false, error: guard.error }

  const parsed = createSchema.safeParse(input)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? 'Données invalides.' }

  const supabase = await createClient()

  // Deux créations simultanées peuvent viser le même numéro : on réessaie sur conflit d'unicité
  for (let attempt = 0; attempt < 5; attempt++) {
    const case_number = await nextCaseNumber(supabase, attempt)
    const { data, error } = await supabase
      .from('sav_cases')
      .insert({ ...parsed.data, case_number, status: 'RECU' })
      .select('id')
      .single()

    if (error?.code === '23505') continue
    if (error || !data) return { success: false, error: error?.message ?? 'Création impossible.' }

    await supabase.from('sav_events').insert({
      sav_case_id: data.id,
      event_type: 'CREATION',
      description: `Dossier ${case_number} ouvert — dépôt de la montre`,
      user_id: guard.profile.id,
    })

    revalidatePath('/sav')
    revalidatePath('/dashboard')
    return { success: true, id: data.id }
  }

  return { success: false, error: 'Impossible d’attribuer un numéro de dossier, réessayez.' }
}

const statusSchema = z.object({
  id: z.guid(),
  status: z.enum(Object.keys(SAV_STATUS) as [string, ...string[]]),
  comment: z.string().trim().max(2000),
})

export async function updateSavStatus(input: z.input<typeof statusSchema>): Promise<Result> {
  const guard = await requireStaff()
  if (!guard.ok) return { success: false, error: guard.error }

  const parsed = statusSchema.safeParse(input)
  if (!parsed.success) return { success: false, error: 'Données invalides.' }
  const { id, status, comment } = parsed.data

  const supabase = await createClient()
  const { data: current } = await supabase.from('sav_cases').select('status').eq('id', id).single()
  if (!current) return { success: false, error: 'Dossier introuvable.' }
  if (current.status === status && !comment) return { success: true }

  const now = new Date().toISOString()
  const { error } = await supabase
    .from('sav_cases')
    .update({ status, updated_at: now, return_date: status === 'RESTITUE' ? now : null })
    .eq('id', id)
  if (error) return { success: false, error: error.message }

  await supabase.from('sav_events').insert({
    sav_case_id: id,
    event_type: current.status === status ? 'NOTE' : 'STATUS',
    description:
      current.status === status
        ? comment
        : `${SAV_STATUS[current.status]?.label ?? current.status} → ${SAV_STATUS[status].label}${comment ? ` : ${comment}` : ''}`,
    user_id: guard.profile.id,
  })

  revalidatePath(`/sav/${id}`)
  revalidatePath('/sav')
  revalidatePath('/dashboard')
  return { success: true }
}

const detailsSchema = z.object({
  id: z.guid(),
  diagnostic: optional,
  technician_id: optionalId,
  estimated_date: optionalDate,
  internal_notes: optional,
})

export async function updateSavPayment(input: SavPaymentInput): Promise<Result> {
  const guard = await requireStaff()
  if (!guard.ok) return { success: false, error: guard.error }
  const parsed = savPaymentSchema.safeParse(input)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? 'Règlement invalide.' }
  const supabase = await createClient()
  const { error } = await supabase.rpc('update_sav_payment', {
    p_id: parsed.data.id, p_amount_due: parsed.data.amount_due, p_is_paid: parsed.data.is_paid,
  })
  if (error) return { success: false, error: error.code === 'PGRST202' ? 'Le suivi des règlements SAV doit être activé par l’administrateur.' : error.message }
  revalidatePath(`/sav/${parsed.data.id}`)
  revalidatePath('/sav')
  return { success: true }
}

export async function confirmSavWhatsApp(id: string): Promise<Result> {
  const guard = await requireStaff()
  if (!guard.ok) return { success: false, error: guard.error }
  if (!z.guid().safeParse(id).success) return { success: false, error: 'Dossier invalide.' }
  const supabase = await createClient()
  const { error } = await supabase.rpc('confirm_sav_whatsapp', { p_id: id })
  if (error) return { success: false, error: error.message }
  revalidatePath(`/sav/${id}`)
  revalidatePath('/sav')
  revalidatePath('/dashboard')
  return { success: true }
}

export async function updateSavCustomerPhone(id: string, phone: string): Promise<Result> {
  const guard = await requireStaff()
  if (!guard.ok) return { success: false, error: guard.error }
  const parsed = z.object({ id: z.guid(), phone: z.string().max(50) }).safeParse({ id, phone })
  if (!parsed.success) return { success: false, error: 'Coordonnées invalides.' }
  const number = whatsappPhone(parsed.data.phone)
  if (!number) return { success: false, error: 'Saisissez un numéro français ou international valide (ex. +33 6 12 34 56 78).' }
  const supabase = await createClient()
  const { data: sav, error: loadError } = await supabase.from('sav_cases').select('customer_id').eq('id', id).single()
  if (loadError || !sav) return { success: false, error: 'Dossier introuvable.' }
  const { data: updated, error } = await supabase.from('customers').update({ phone: `+${number}`, updated_at: new Date().toISOString() }).eq('id', sav.customer_id).select('id').single()
  if (error || !updated) return { success: false, error: 'Le numéro n’a pas pu être enregistré.' }
  revalidatePath(`/sav/${id}`)
  revalidatePath('/clients')
  revalidatePath('/sav')
  return { success: true }
}

export async function updateSavDetails(input: z.input<typeof detailsSchema>): Promise<Result> {
  const guard = await requireStaff()
  if (!guard.ok) return { success: false, error: guard.error }

  const parsed = detailsSchema.safeParse(input)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? 'Données invalides.' }
  const { id, ...values } = parsed.data

  const supabase = await createClient()
  const { data: before } = await supabase
    .from('sav_cases')
    .select('diagnostic, technician_id, estimated_date')
    .eq('id', id)
    .single()
  if (!before) return { success: false, error: 'Dossier introuvable.' }

  const { error } = await supabase
    .from('sav_cases')
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) return { success: false, error: error.message }

  const changes = [
    before.diagnostic !== values.diagnostic && 'diagnostic',
    before.technician_id !== values.technician_id && 'technicien',
    before.estimated_date !== values.estimated_date && 'date prévue',
  ].filter(Boolean)
  if (changes.length) {
    await supabase.from('sav_events').insert({
      sav_case_id: id,
      event_type: 'UPDATE',
      description: `Mise à jour : ${changes.join(', ')}`,
      user_id: guard.profile.id,
    })
  }

  revalidatePath(`/sav/${id}`)
  revalidatePath('/sav')
  return { success: true }
}

// ---------------------------------------------------------------------
// Encaissement d'un dossier SAV : crée une vraie vente et son ticket
// ---------------------------------------------------------------------

export type ServiceOption = { id: string; label: string }

export async function listServices(): Promise<ServiceOption[]> {
  const guard = await requireStaff(['ADMIN', 'VENDEUR'])
  if (!guard.ok) return []
  const supabase = await createClient()
  const { data } = await supabase.from('service_categories').select('id, label').eq('active', true).order('sort_order')
  return data ?? []
}

const checkoutSchema = z.object({
  id: z.guid(),
  serviceId: z.guid({ message: 'Choisissez la prestation.' }),
  amount: z.number().positive('Saisissez un montant supérieur à 0.').max(999999.99),
  payments: z
    .array(z.object({ method: z.enum(['CB', 'ESPÈCES', 'VIREMENT', 'CHÈQUE', 'AUTRE']), amount: z.number().positive() }))
    .min(1, 'Ajoutez au moins un règlement.'),
  idempotencyKey: z.string().min(8),
})

export type SavCheckoutInput = z.input<typeof checkoutSchema>

export async function checkoutSav(
  input: SavCheckoutInput
): Promise<{ success: true; saleId: string; receiptNumber: string; replayed?: boolean } | { success: false; error: string }> {
  const guard = await requireStaff(['ADMIN', 'VENDEUR'])
  if (!guard.ok) return { success: false, error: guard.error }

  const parsed = checkoutSchema.safeParse(input)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? 'Données invalides.' }

  const cents = (v: number) => Math.round(v * 100)
  const total = parsed.data.payments.reduce((sum, p) => sum + cents(p.amount), 0)
  if (total !== cents(parsed.data.amount)) {
    return { success: false, error: 'Le total des règlements doit être égal au montant du SAV.' }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('checkout_sav', {
    p_id: parsed.data.id,
    p_service_id: parsed.data.serviceId,
    p_amount_ttc: parsed.data.amount,
    p_payments: parsed.data.payments,
    p_idempotency_key: parsed.data.idempotencyKey,
  })

  if (error) {
    return {
      success: false,
      error:
        error.code === 'PGRST202'
          ? 'L’encaissement des SAV doit d’abord être activé en base (migration 20260924000000_sav_checkout.sql).'
          : error.message,
    }
  }

  revalidatePath(`/sav/${parsed.data.id}`)
  revalidatePath('/sav')
  revalidatePath('/dashboard')
  revalidatePath('/rapports')
  revalidatePath('/rapports/ventes')

  return { success: true, saleId: data.sale_id, receiptNumber: data.receipt_number, replayed: data.replayed }
}

// ---------------------------------------------------------------------
// Prévenir le client par SMS (SMS Partner)
// ---------------------------------------------------------------------

export type SavSmsResult =
  | { success: true; segments: number; cost: number | null; sandbox: boolean }
  | { success: false; error: string }

export async function sendSavSms(id: string): Promise<SavSmsResult> {
  const guard = await requireStaff()
  if (!guard.ok) return { success: false, error: guard.error }
  if (!z.guid().safeParse(id).success) return { success: false, error: 'Dossier invalide.' }

  const supabase = await createClient()
  const [{ data: sav }, { data: store }] = await Promise.all([
    supabase
      .from('sav_cases')
      .select('case_number, brand, model, status, customer:customers(first_name, phone)')
      .eq('id', id)
      .maybeSingle(),
    supabase.from('settings').select('store_name, phone').limit(1).maybeSingle(),
  ])
  if (!sav) return { success: false, error: 'Dossier introuvable.' }

  const c = sav as unknown as {
    case_number: string
    brand: string | null
    model: string | null
    status: string
    customer: { first_name: string; phone: string | null } | null
  }

  const message = savReadySms({
    firstName: c.customer?.first_name ?? null,
    caseNumber: c.case_number,
    brand: c.brand,
    model: c.model,
    storeName: store?.store_name ?? 'Heures et Passion',
    storePhone: store?.phone,
  })

  const result = await sendSms(c.customer?.phone, message)
  if (!result.success) return result

  await supabase.from('sav_events').insert({
    sav_case_id: id,
    event_type: 'SMS',
    description: result.sandbox
      ? `SMS de test (mode bac à sable, non envoyé) : ${message}`
      : `SMS envoyé au ${c.customer?.phone} : ${message}`,
    user_id: guard.profile.id,
  })

  // La montre est prête et le client vient d'être prévenu
  if (c.status === 'PRET' && !result.sandbox) {
    await supabase.from('sav_cases').update({ status: 'CLIENT_PREVENU', updated_at: new Date().toISOString() }).eq('id', id)
  }

  revalidatePath(`/sav/${id}`)
  revalidatePath('/sav')
  revalidatePath('/dashboard')
  return result
}

/** Le serveur sait-il envoyer des SMS ? (clé d'API présente) */
export async function smsConfigured(): Promise<boolean> {
  const guard = await requireStaff()
  return guard.ok && hasSmsKey()
}
