import { test, expect } from '@playwright/test'

test('Dashboard is readable, responsive and provides working shortcuts', async ({ page }, info) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/dashboard')
  await expect(page.getByRole('heading', { name: /Bonjour|Bonsoir/ })).toBeVisible()
  await expect(page.getByText('Votre collection commence ici')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Ouvrir la caisse' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: `test-results/dashboard-${info.project.name}.png`, fullPage: true })
  await page.getByRole('link', { name: 'Ajouter un article', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Nouvel article' })).toBeVisible()
  await expect(page.getByLabel('N° de série *', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Accessoire / pièce', exact: true }).click()
  await expect(page.getByLabel('Quantité en stock')).toBeVisible()
  expect(errors).toEqual([])
})

test('Stock starts empty and handles filters and search', async ({ page }) => {
  await page.goto('/stock')
  await expect(page.getByText('Place à votre collection')).toBeVisible()
  await page.getByRole('button', { name: 'Tout', exact: true }).click()
  await page.getByRole('searchbox', { name: 'Rechercher dans le stock' }).fill('no-match-xyz-709')
  await expect(page.getByText('Aucun article trouvé', { exact: true })).toBeVisible()
  await page.getByRole('searchbox', { name: 'Rechercher dans le stock' }).fill('')
  await page.getByRole('button', { name: /^Disponible/ }).click()
  await expect(page.getByText('Place à votre collection')).toBeVisible()
})

test('Checkout excludes demonstration stock and blocks an empty payment', async ({ page }) => {
  await page.goto('/caisse')
  await expect(page.getByText('Votre collection est prête à accueillir ses premières pièces.')).toBeVisible()
  await expect(page.getByRole('button', { name: /ENCAISSER/ })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Carte bancaire', exact: true })).toBeDisabled()
  await page.getByRole('searchbox', { name: 'Rechercher ou scanner un article' }).fill('DEMO')
  await expect(page.getByText('Aucun article disponible ne correspond.')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('Clients, workshop, reports and settings load without runtime errors', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  for (const [url, heading] of [['/clients', 'Clients'], ['/sav', 'Service après-vente'], ['/rapports', 'Rapports'], ['/parametres', 'Paramètres']]) {
    await page.goto(url)
    await expect(page.getByRole('heading', { level: 1, name: new RegExp(heading) })).toBeVisible()
    await expect(page.getByText('Une interruption momentanée')).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  expect(errors).toEqual([])
})

test('Stock network errors are visible and can be retried', async ({ page }) => {
  await page.route('**/rest/v1/products?**', (route) => route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ message: 'Test: stock inaccessible', code: 'TEST_FAILURE' }) }))
  await page.goto('/stock')
  await expect(page.getByRole('alert').filter({ hasText: 'Impossible de charger les données' })).toBeVisible()
  await page.unroute('**/rest/v1/products?**')
  await page.getByRole('button', { name: 'Réessayer', exact: true }).click()
  await expect(page.getByText('Place à votre collection')).toBeVisible()
})

test('Login exposes password toggle and readable authentication errors', async ({ browser }) => {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  const page = await context.newPage()
  await page.goto('http://127.0.0.1:3100/stock')
  await expect(page).toHaveURL(/\/login/)
  await page.getByLabel('Mot de passe', { exact: true }).fill('invalid-test-password')
  await page.getByRole('button', { name: 'Afficher le mot de passe', exact: true }).click()
  await expect(page.getByLabel('Mot de passe', { exact: true })).toHaveAttribute('type', 'text')
  await page.getByLabel('Email', { exact: true }).fill('browser-test@example.invalid')
  await page.route('**/auth/v1/token?grant_type=password', (route) => route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: 'invalid_credentials', msg: 'Invalid login credentials' }) }))
  await page.getByRole('button', { name: 'Accéder à ma boutique' }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Email ou mot de passe incorrect.' })).toBeVisible()
  await context.close()
})
