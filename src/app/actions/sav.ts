'use server'

import { createClient } from '@/lib/supabase/server'
import { requireStaff } from '@/lib/auth'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { SAV_STATUS } from '@/lib/format'

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
