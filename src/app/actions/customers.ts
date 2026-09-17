'use server'

import { createClient } from '@/lib/supabase/server'
import { requireStaff } from '@/lib/auth'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import type { CustomerSummary } from '@/app/actions/caisse'

const optional = z.string().trim().max(200).transform((v) => v || null)

const customerSchema = z.object({
  civility: optional,
  first_name: z.string().trim().min(1, 'Prénom requis').max(100),
  last_name: z.string().trim().min(1, 'Nom requis').max(100),
  phone: optional,
  email: z.union([z.literal(''), z.email('Email invalide')]).transform((v) => v || null),
  address: optional,
  postal_code: optional,
  city: optional,
  internal_notes: z.string().trim().max(2000).transform((v) => v || null),
})

export type CustomerFormInput = z.input<typeof customerSchema>

export async function createCustomer(
  input: CustomerFormInput
): Promise<{ success: true; customer: CustomerSummary } | { success: false; error: string }> {
  const guard = await requireStaff()
  if (!guard.ok) return { success: false, error: guard.error }

  const parsed = customerSchema.safeParse(input)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? 'Données invalides.' }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('customers')
    .insert(parsed.data)
    .select('id, first_name, last_name, phone, email')
    .single()

  if (error) return { success: false, error: error.message }

  revalidatePath('/clients')
  return { success: true, customer: data }
}
