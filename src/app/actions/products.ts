'use server'

import { createClient } from '@/lib/supabase/server'
import { requireStaff } from '@/lib/auth'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

const optional = z.string().trim().max(200).transform((v) => v || null)
const money = z.coerce.number().min(0).max(10_000_000)

const productSchema = z
  .object({
    type: z.enum(['SERIALIZED', 'NON_SERIALIZED']),
    brand: optional,
    model: z.string().trim().min(1, 'Modèle requis').max(200),
    reference: optional,
    sku: optional,
    ean: optional,
    condition: z.enum(['NEW', 'USED']),
    movement: optional,
    diameter: optional,
    material: optional,
    purchase_price_ttc: money.optional(),
    selling_price_ttc: money.refine((v) => v > 0, 'Prix de vente requis'),
    vat_rate: z.coerce.number().refine((v) => [0, 5.5, 10, 20].includes(v), 'Taux de TVA invalide'),
    // Montre
    serial_number: optional,
    year: optional,
    has_box: z.boolean().default(false),
    has_papers: z.boolean().default(false),
    supplier: optional,
    // Accessoire
    stock_quantity: z.coerce.number().int().min(0).max(100_000).default(0),
  })
  .refine((p) => p.type !== 'SERIALIZED' || !!p.serial_number, {
    message: 'Numéro de série requis pour une montre',
    path: ['serial_number'],
  })

export type ProductFormInput = z.input<typeof productSchema>

export async function createProduct(input: ProductFormInput): Promise<{ success: true } | { success: false; error: string }> {
  const guard = await requireStaff(['ADMIN', 'VENDEUR'])
  if (!guard.ok) return { success: false, error: guard.error }

  const parsed = productSchema.safeParse(input)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? 'Données invalides.' }
  const p = parsed.data
  const supabase = await createClient()

  if (p.type === 'SERIALIZED') {
    const { data: existing } = await supabase
      .from('serialized_items')
      .select('id')
      .eq('serial_number', p.serial_number!)
      .maybeSingle()
    if (existing) return { success: false, error: `Le numéro de série ${p.serial_number} existe déjà.` }
  }

  const purchaseTtc = p.purchase_price_ttc ?? null
  const { data: product, error } = await supabase
    .from('products')
    .insert({
      type: p.type,
      brand: p.brand,
      model: p.model,
      reference: p.reference,
      sku: p.sku,
      ean: p.ean,
      condition: p.condition,
      movement: p.movement,
      diameter: p.diameter,
      material: p.material,
      purchase_price_ttc: purchaseTtc,
      purchase_price_ht: purchaseTtc === null ? null : Math.round((purchaseTtc / (1 + p.vat_rate / 100)) * 100) / 100,
      selling_price_ttc: p.selling_price_ttc,
      vat_rate: p.vat_rate,
      stock_quantity: p.type === 'SERIALIZED' ? 0 : p.stock_quantity,
    })
    .select('id')
    .single()

  if (error || !product) return { success: false, error: error?.message ?? 'Création impossible.' }

  let serializedId: string | null = null
  if (p.type === 'SERIALIZED') {
    const { data: item, error: itemError } = await supabase
      .from('serialized_items')
      .insert({
        product_id: product.id,
        serial_number: p.serial_number,
        year: p.year,
        has_box: p.has_box,
        has_papers: p.has_papers,
        supplier: p.supplier,
        entry_date: new Date().toISOString().slice(0, 10),
      })
      .select('id')
      .single()
    if (itemError) return { success: false, error: itemError.message }
    serializedId = item.id
  }

  const quantity = p.type === 'SERIALIZED' ? 1 : p.stock_quantity
  if (quantity > 0) {
    await supabase.from('stock_movements').insert({
      product_id: product.id,
      serialized_item_id: serializedId,
      movement_type: 'PURCHASE',
      quantity,
      user_id: guard.profile.id,
      reason: 'Entrée en stock',
    })
  }

  revalidatePath('/stock')
  revalidatePath('/dashboard')
  return { success: true }
}
