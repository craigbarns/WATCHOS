import { createClient } from '@supabase/supabase-js'
import { mkdir, writeFile } from 'node:fs/promises'

// Dry-run by default. Only records explicitly marked as demonstration are eligible.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const checked = (result) => { if (result.error) throw new Error(result.error.message); return result.data }
const products = checked(await admin.from('products').select('*').like('sku', 'DEMO-%').eq('description', 'Article de démonstration'))
  .filter((p) => /^DEMO-[WA]\d{2}$/.test(p.sku))
const ids = products.map((p) => p.id)
if (!ids.length) { console.log('Aucun produit de démonstration identifié.'); process.exit(0) }
const items = checked(await admin.from('serialized_items').select('*').in('product_id', ids))
const pending = products.filter((p) => p.status !== 'ARCHIVED' || p.stock_quantity > 0)
const available = items.filter((i) => !['SOLD', 'ARCHIVED'].includes(i.status))
console.log(JSON.stringify({ demoProducts: products.length, productsToArchive: pending.length, watchesToArchive: available.length, accessoriesToRemove: products.reduce((n, p) => n + p.stock_quantity, 0), soldWatchesPreserved: items.filter((i) => i.status === 'SOLD').length }))
if (!process.argv.includes('--apply') || (!pending.length && !available.length)) process.exit(0)

// Back up the targeted rows and immutable journal before any mutation.
const snapshot = { products, items, capturedAt: new Date().toISOString() }
for (const table of ['stock_movements', 'sales', 'sale_lines', 'payments', 'fiscal_events', 'fiscal_closures']) {
  snapshot[table] = checked(await admin.from(table).select('*').order('created_at').range(0, 9999))
}
await mkdir('backups', { recursive: true, mode: 0o700 })
const backup = `backups/demo-${Date.now()}.json`
await writeFile(backup, JSON.stringify(snapshot, null, 2), { mode: 0o600, flag: 'wx' })
console.log(`Sauvegarde privée : ${backup}`)

// Use an existing administrator session for the audited stock RPCs. No email is sent.
const operators = checked(await admin.from('profiles').select('id').eq('role', 'ADMIN').eq('active', true))
const operator = process.env.MAINTENANCE_OPERATOR_ID ? operators.find((p) => p.id === process.env.MAINTENANCE_OPERATOR_ID) : operators.length === 1 ? operators[0] : null
if (!operator) throw new Error('Définissez MAINTENANCE_OPERATOR_ID avec un administrateur actif.')
const user = checked(await admin.auth.admin.getUserById(operator.id)).user
const link = checked(await admin.auth.admin.generateLink({ type: 'magiclink', email: user.email }))
const client = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
checked(await client.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'magiclink' }))
const reason = 'Retrait du stock de démonstration à la demande du propriétaire'
try {
  for (const item of available) checked(await client.rpc('set_serialized_status', { p_item_id: item.id, p_status: 'ARCHIVED', p_reason: reason }))
  for (const product of products) {
    if (product.type === 'NON_SERIALIZED' && product.stock_quantity > 0) checked(await client.rpc('adjust_product_stock', { p_product_id: product.id, p_movement_type: 'INVENTORY', p_quantity: 0, p_reason: reason }))
    checked(await admin.from('products').update({ status: 'ARCHIVED', updated_at: new Date().toISOString() }).eq('id', product.id).eq('sku', product.sku).eq('description', 'Article de démonstration'))
  }
  const remainingProducts = checked(await admin.from('products').select('id,status,stock_quantity').in('id', ids))
  const remainingItems = checked(await admin.from('serialized_items').select('id,status').in('product_id', ids))
  if (remainingProducts.some((p) => p.status !== 'ARCHIVED' || p.stock_quantity !== 0) || remainingItems.some((i) => !['SOLD', 'ARCHIVED'].includes(i.status))) throw new Error('Retrait incomplet, relancez le contrôle.')
  for (const table of ['sales', 'sale_lines', 'payments', 'fiscal_events', 'fiscal_closures']) {
    const after = checked(await admin.from(table).select('*').order('created_at').range(0, 9999))
    if (JSON.stringify(after) !== JSON.stringify(snapshot[table])) throw new Error(`Le journal ${table} a changé pendant l’opération : vérifier la sauvegarde.`)
  }
  console.log('Stock de démonstration retiré. Ventes et chaînes fiscales inchangées.')
} finally {
  await client.auth.signOut({ scope: 'local' })
}
