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

// ---------------------------------------------------------------------
// Fiche produit
// ---------------------------------------------------------------------

type Result = { success: true } | { success: false; error: string }

/** Erreur lisible si la migration 20260918000000_product_sheet.sql n'a pas été exécutée. */
function rpcError(message: string) {
  return /could not find the function|schema cache/i.test(message)
    ? 'Fonction manquante en base : exécutez la migration supabase/migrations/20260918000000_product_sheet.sql.'
    : message
}

const productUpdateSchema = z.object({
  id: z.guid(),
  brand: optional,
  model: z.string().trim().min(1, 'Modèle requis').max(200),
  reference: optional,
  sku: optional,
  ean: optional,
  collection: optional,
  condition: z.union([z.enum(['NEW', 'USED']), z.literal('')]).transform((v) => v || null),
  movement: optional,
  caliber: optional,
  diameter: optional,
  material: optional,
  bracelet: optional,
  color: optional,
  location: optional,
  description: z.string().trim().max(2000).transform((v) => v || null),
})

export type ProductUpdateInput = z.input<typeof productUpdateSchema>

export async function updateProduct(input: ProductUpdateInput): Promise<Result> {
  const guard = await requireStaff(['ADMIN', 'VENDEUR'])
  if (!guard.ok) return { success: false, error: guard.error }

  const parsed = productUpdateSchema.safeParse(input)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? 'Données invalides.' }
  const { id, ...values } = parsed.data

  const supabase = await createClient()
  const { error } = await supabase.from('products').update({ ...values, updated_at: new Date().toISOString() }).eq('id', id)
  if (error) return { success: false, error: error.message }

  revalidatePath('/stock', 'layout')
  return { success: true }
}

const priceSchema = z.object({
  productId: z.guid(),
  serializedItemId: z.guid().nullable(),
  selling_price_ttc: z.coerce.number().positive('Prix de vente invalide').max(10_000_000),
  purchase_price_ttc: z.union([z.literal(''), z.coerce.number().min(0).max(10_000_000)]).transform((v) => (v === '' ? null : v)),
  vat_rate: z.coerce.number().refine((v) => [0, 5.5, 10, 20].includes(v), 'Taux de TVA invalide'),
})

export async function updateProductPrices(input: z.input<typeof priceSchema>): Promise<Result> {
  const guard = await requireStaff(['ADMIN', 'VENDEUR'])
  if (!guard.ok) return { success: false, error: guard.error }

  const parsed = priceSchema.safeParse(input)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? 'Données invalides.' }
  const p = parsed.data

  const supabase = await createClient()
  const { data: before } = await supabase
    .from('products')
    .select('selling_price_ttc, purchase_price_ttc, vat_rate')
    .eq('id', p.productId)
    .single()
  if (!before) return { success: false, error: 'Article introuvable.' }

  const { error } = await supabase
    .from('products')
    .update({
      selling_price_ttc: p.selling_price_ttc,
      purchase_price_ttc: p.purchase_price_ttc,
      purchase_price_ht: p.purchase_price_ttc === null ? null : Math.round((p.purchase_price_ttc / (1 + p.vat_rate / 100)) * 100) / 100,
      vat_rate: p.vat_rate,
      updated_at: new Date().toISOString(),
    })
    .eq('id', p.productId)
  if (error) return { success: false, error: error.message }

  // Trace des changements de prix dans l'historique de l'article
  const eur = (v: number | null) => (v === null ? '—' : `${Number(v).toFixed(2).replace('.', ',')} €`)
  const changes = [
    Number(before.selling_price_ttc) !== p.selling_price_ttc && `prix de vente ${eur(before.selling_price_ttc)} → ${eur(p.selling_price_ttc)} TTC`,
    (before.purchase_price_ttc === null ? null : Number(before.purchase_price_ttc)) !== p.purchase_price_ttc &&
      `prix d'achat ${eur(before.purchase_price_ttc)} → ${eur(p.purchase_price_ttc)} TTC`,
    Number(before.vat_rate) !== p.vat_rate && `TVA ${before.vat_rate} % → ${p.vat_rate} %`,
  ].filter(Boolean)

  if (changes.length) {
    await supabase.from('stock_movements').insert({
      product_id: p.productId,
      serialized_item_id: p.serializedItemId,
      movement_type: 'ADJUSTMENT',
      quantity: 0,
      user_id: guard.profile.id,
      reason: `Modification : ${changes.join(', ')}`,
    })
  }

  revalidatePath('/stock', 'layout')
  revalidatePath('/dashboard')
  return { success: true }
}

const itemUpdateSchema = z.object({
  id: z.guid(),
  serial_number: z.string().trim().min(1, 'Numéro de série requis').max(100),
  year: optional,
  has_box: z.boolean(),
  has_papers: z.boolean(),
  has_certificate: z.boolean(),
  supplier: optional,
  entry_date: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/, 'Date invalide').transform((v) => v || null),
  notes: z.string().trim().max(2000).transform((v) => v || null),
})

export type SerializedItemUpdateInput = z.input<typeof itemUpdateSchema>

export async function updateSerializedItem(input: SerializedItemUpdateInput): Promise<Result> {
  const guard = await requireStaff(['ADMIN', 'VENDEUR'])
  if (!guard.ok) return { success: false, error: guard.error }

  const parsed = itemUpdateSchema.safeParse(input)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? 'Données invalides.' }
  const { id, ...values } = parsed.data

  const supabase = await createClient()
  const { data: duplicate } = await supabase
    .from('serialized_items')
    .select('id')
    .eq('serial_number', values.serial_number)
    .neq('id', id)
    .maybeSingle()
  if (duplicate) return { success: false, error: `Le numéro de série ${values.serial_number} est déjà utilisé.` }

  const { error } = await supabase.from('serialized_items').update({ ...values, updated_at: new Date().toISOString() }).eq('id', id)
  if (error) return { success: false, error: error.message }

  revalidatePath('/stock', 'layout')
  return { success: true }
}

const statusSchema = z.object({
  id: z.guid(),
  status: z.enum(['AVAILABLE', 'RESERVED', 'IN_SAV', 'ARCHIVED']),
  reason: z.string().trim().max(500),
})

export async function setItemStatus(input: z.input<typeof statusSchema>): Promise<Result> {
  const guard = await requireStaff(['ADMIN', 'VENDEUR'])
  if (!guard.ok) return { success: false, error: guard.error }

  const parsed = statusSchema.safeParse(input)
  if (!parsed.success) return { success: false, error: 'Données invalides.' }

  const supabase = await createClient()
  const { error } = await supabase.rpc('set_serialized_status', {
    p_item_id: parsed.data.id,
    p_status: parsed.data.status,
    p_reason: parsed.data.reason,
  })
  if (error) return { success: false, error: rpcError(error.message) }

  revalidatePath('/stock', 'layout')
  revalidatePath('/dashboard')
  revalidatePath('/caisse')
  return { success: true }
}

const adjustSchema = z.object({
  productId: z.guid(),
  movementType: z.enum(['PURCHASE', 'RETURN', 'ADJUSTMENT', 'INVENTORY']),
  quantity: z.coerce.number().int('Quantité entière attendue'),
  reason: z.string().trim().min(1, 'Le motif est obligatoire.').max(500),
})

export async function adjustStock(input: z.input<typeof adjustSchema>): Promise<{ success: true; stock: number } | { success: false; error: string }> {
  const guard = await requireStaff(['ADMIN', 'VENDEUR'])
  if (!guard.ok) return { success: false, error: guard.error }

  const parsed = adjustSchema.safeParse(input)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? 'Données invalides.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('adjust_product_stock', {
    p_product_id: parsed.data.productId,
    p_movement_type: parsed.data.movementType,
    p_quantity: parsed.data.quantity,
    p_reason: parsed.data.reason,
  })
  if (error) return { success: false, error: rpcError(error.message) }

  revalidatePath('/stock', 'layout')
  revalidatePath('/dashboard')
  revalidatePath('/caisse')
  return { success: true, stock: data.stock_quantity }
}
