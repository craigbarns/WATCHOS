'use client'

import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Search, UserPlus, ShoppingCart, Trash2, CreditCard, Banknote, Landmark, FileSignature, CircleDollarSign,
  Minus, Plus, X, Percent, User, Loader2, Wrench, Pencil,
} from 'lucide-react'
import {
  finalizeSale, searchCatalog, searchCustomers,
  type CatalogItem, type CustomerSummary, type PaymentInput, type PaymentMethod,
} from '@/app/actions/caisse'
import { CustomerFormDialog } from '@/components/shared/customer-form-dialog'
import { ReceiptDialog } from '@/components/caisse/receipt-dialog'
import { formatEuro, PAYMENT_LABELS, toHT } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'

export type CartLine = CatalogItem & { quantity: number; discount: number }

const PAYMENT_BUTTONS: Array<{ method: PaymentMethod; icon: typeof CreditCard }> = [
  { method: 'CB', icon: CreditCard },
  { method: 'ESPÈCES', icon: Banknote },
  { method: 'VIREMENT', icon: Landmark },
  { method: 'CHÈQUE', icon: FileSignature },
  { method: 'AUTRE', icon: CircleDollarSign },
]

const cents = (v: number) => Math.round(v * 100) / 100

function parseAmount(raw: string): number {
  const n = Number(raw.replace(/\s/g, '').replace(',', '.'))
  return Number.isFinite(n) ? cents(n) : 0
}

function useDebounced<T>(value: T, delay = 200) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}

type CatalogSearch = (query: string) => Promise<CatalogItem[]>

function useIsDesktop() {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia('(min-width: 1024px)')
      mq.addEventListener('change', cb)
      return () => mq.removeEventListener('change', cb)
    },
    () => window.matchMedia('(min-width: 1024px)').matches,
    () => true
  )
}

export function CaisseScreen({
  search = searchCatalog,
  initialCart = [],
}: {
  /** Source du catalogue (injectable pour les tests visuels) */
  search?: CatalogSearch
  initialCart?: CartLine[]
} = {}) {
  // --- Catalogue
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebounced(query)
  const [catalogError, setCatalogError] = useState(false)
  const [reloadCatalog, setReloadCatalog] = useState(0)
  const [results, setResults] = useState<{ query: string | null; items: CatalogItem[] }>({ query: null, items: [] })
  const searching = results.query !== debouncedQuery
  const searchRef = useRef<HTMLInputElement>(null)
  const isDesktop = useIsDesktop()

  const [selectedService, setSelectedService] = useState<CatalogItem | null>(null)
  const [serviceAmount, setServiceAmount] = useState('')
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const validServiceAmount = /^\d+(?:[.,]\d{1,2})?$/.test(serviceAmount.trim()) && parseAmount(serviceAmount) > 0 && parseAmount(serviceAmount) <= 999999.99

  // --- Vente
  const [cart, setCart] = useState<CartLine[]>(initialCart)
  const [customer, setCustomer] = useState<CustomerSummary | null>(null)
  const [payments, setPayments] = useState<PaymentInput[]>([])
  const [amountInput, setAmountInput] = useState('')
  const [cashReceived, setCashReceived] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [processing, startProcessing] = useTransition()
  const idempotencyKey = useRef<string>('')
  const checkoutPending = useRef(false)

  // --- Client
  const [customerQuery, setCustomerQuery] = useState('')
  const debouncedCustomerQuery = useDebounced(customerQuery)
  const [customerResults, setCustomerResults] = useState<CustomerSummary[]>([])
  const [customerDialogOpen, setCustomerDialogOpen] = useState(false)

  // --- Ticket
  const [lastSaleId, setLastSaleId] = useState<string | null>(null)

  const subtotal = cents(cart.reduce((s, l) => s + l.price_ttc * l.quantity, 0))
  const totalDiscount = cents(cart.reduce((s, l) => s + l.discount, 0))
  const totalTTC = cents(subtotal - totalDiscount)
  const totalHT = cents(cart.reduce((s, l) => s + toHT(l.price_ttc * l.quantity - l.discount, l.vat_rate), 0))
  const totalVAT = cents(totalTTC - totalHT)
  const totalPaid = cents(payments.reduce((s, p) => s + p.amount, 0))
  const remaining = cents(totalTTC - totalPaid)

  // Toute modification du panier invalide la clé d'idempotence de la tentative précédente
  useEffect(() => {
    idempotencyKey.current = crypto.randomUUID()
  }, [cart, payments, customer])

  useEffect(() => {
    let cancelled = false
    search(debouncedQuery).then((items) => {
      if (!cancelled) { setResults({ query: debouncedQuery, items }); setCatalogError(false) }
    }).catch(() => {
      if (!cancelled) { setCatalogError(true); setResults({ query: debouncedQuery, items: [] }) }
    })
    return () => {
      cancelled = true
    }
  }, [debouncedQuery, search, reloadCatalog])

  useEffect(() => {
    if (!debouncedCustomerQuery) return
    let cancelled = false
    searchCustomers(debouncedCustomerQuery).then((r) => !cancelled && setCustomerResults(r)).catch(() => { if (!cancelled) { setCustomerResults([]); setError('La recherche de clients est indisponible.') } })
    return () => {
      cancelled = true
    }
  }, [debouncedCustomerQuery])

  const addToCart = (item: CatalogItem) => {
    setSelectedService(item)
    setEditingKey(null)
    setServiceAmount('')
  }

  const confirmService = () => {
    if (!selectedService || !validServiceAmount || processing || lastSaleId) return
    const price = parseAmount(serviceAmount)
    if (editingKey) updateLine(editingKey, { price_ttc: price })
    else setCart((c) => [...c, { ...selectedService, key: crypto.randomUUID(), price_ttc: price, quantity: 1, discount: 0 }])
    setPayments([])
    setCashReceived(null)
    setAmountInput('')
    setError(null)
    setSelectedService(null)
    setQuery('')
    if (isDesktop) searchRef.current?.focus()
  }

  const updateLine = (key: string, patch: Partial<CartLine>) => {
    setCart((c) =>
      c.map((l) => {
        if (l.key !== key) return l
        const next = { ...l, ...patch }
        next.quantity = Math.max(1, Math.min(next.quantity, 999))
        next.discount = cents(Math.max(0, Math.min(next.discount, next.price_ttc * next.quantity)))
        return next
      })
    )
    setPayments([])
    setCashReceived(null)
    setAmountInput('')
  }

  const applyDiscount = (line: CartLine) => {
    const raw = window.prompt(`Remise sur « ${line.model} » (montant en € ou pourcentage, ex. 10%)`, line.discount ? String(line.discount) : '')
    if (raw === null) return
    const gross = line.price_ttc * line.quantity
    const discount = raw.trim().endsWith('%') ? (gross * parseAmount(raw.replace('%', ''))) / 100 : parseAmount(raw)
    updateLine(line.key, { discount })
  }

  const addPayment = (method: PaymentMethod) => {
    if (remaining <= 0) return
    const typed = amountInput ? parseAmount(amountInput) : remaining
    if (typed <= 0) return
    if (method === 'ESPÈCES' && typed > remaining) setCashReceived(typed)
    else if (typed > remaining) {
      setError('Seules les espèces permettent un rendu de monnaie.')
      return
    }
    setError(null)
    setPayments((p) => [...p, { method, amount: Math.min(typed, remaining) }])
    setAmountInput('')
  }

  const resetSale = () => {
    setCart([])
    setPayments([])
    setCashReceived(null)
    setAmountInput('')
    setCustomer(null)
    setError(null)
    setLastSaleId(null)
    if (isDesktop) searchRef.current?.focus()
  }

  const checkout = () => {
    if (!cart.length || totalTTC <= 0 || remaining !== 0 || checkoutPending.current || lastSaleId) return
    checkoutPending.current = true
    setError(null)
    startProcessing(async () => {
      try {
        const result = await finalizeSale(
          customer?.id ?? null,
          cart.map((l) => ({
            service_id: l.service_id,
            unit_price_ttc: l.price_ttc,
            quantity: l.quantity,
            discount_amount: l.discount,
          })),
          payments,
          idempotencyKey.current
        )
        if (!result.success) {
          setError(result.error)
          return
        }
        setLastSaleId(result.data.sale_id)
        setReloadCatalog((n) => n + 1)
      } catch {
        setError('Connexion interrompue. Réessayez : la même tentative ne sera pas encaissée deux fois.')
      } finally { checkoutPending.current = false }
    })
  }

  // Raccourcis clavier : F2 / "/" = recherche, F9 = encaisser
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement
      if (e.key === 'F2' || (e.key === '/' && !typing)) {
        e.preventDefault()
        searchRef.current?.focus()
      }
      if (e.key === 'F9' && !selectedService) {
        e.preventDefault()
        checkout()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const change = cashReceived !== null ? cents(cashReceived - (payments.findLast((p) => p.method === 'ESPÈCES')?.amount ?? 0)) : 0

  return (
    <>
    <Dialog open={!!selectedService} onOpenChange={(open) => { if (!open) setSelectedService(null) }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{selectedService?.model}</DialogTitle>
          <DialogDescription>Saisissez le montant unitaire TTC de cette prestation.</DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); confirmService() }} className="grid gap-4">
          <label htmlFor="service-price" className="text-sm font-medium">Montant TTC (€)</label>
          <Input id="service-price" autoFocus inputMode="decimal" placeholder="0,00" value={serviceAmount} onChange={(e) => setServiceAmount(e.target.value)} className="h-14 text-right text-2xl tabular-nums" />
          {serviceAmount && !validServiceAmount && <p role="alert" className="text-sm text-destructive">Saisissez un montant de 0,01 à 999 999,99 €, avec deux décimales maximum.</p>}
          <Button type="submit" disabled={!validServiceAmount || processing}>{editingKey ? 'Modifier le montant' : 'Ajouter au panier'}</Button>
        </form>
      </DialogContent>
    </Dialog>
    <fieldset disabled={processing || !!lastSaleId} aria-label="Nouvelle vente" className="grid min-w-0 grid-cols-1 gap-3 sm:gap-4 lg:h-full lg:grid-cols-[minmax(0,1fr)_22rem]">
      {/* Colonne gauche : catalogue et panier */}
      <div className="flex min-w-0 flex-col gap-3 sm:gap-4 lg:min-h-0">
        <Card className="gap-0 py-0">
          <CardHeader className="border-b py-3">
            <CardTitle className="mb-2">Prestations</CardTitle>
            <div className="relative">
              <Search className="absolute top-2.5 left-3 h-4 w-4 text-muted-foreground" />
              <Input
                aria-label="Rechercher une prestation"
                ref={searchRef}
                autoFocus={isDesktop}
                type="search"
                placeholder={isDesktop ? 'Rechercher un poste de prestation…  (F2)' : 'Rechercher une prestation'}
                className="h-11 pl-9 text-base lg:h-10"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={async (e) => {
                  if (e.key !== 'Enter' || !query.trim()) return
                  e.preventDefault()
                  try {
                    const fresh = await search(query)
                    if (fresh.length === 1) addToCart(fresh[0])
                    else setResults({ query: debouncedQuery, items: fresh })
                  } catch { setCatalogError(true) }
                }}
              />
              {searching && <Loader2 className="absolute top-3 right-3 h-4 w-4 animate-spin text-muted-foreground" />}
            </div>
          </CardHeader>
          <CardContent className="max-h-96 overflow-x-hidden overflow-y-auto p-2">
            {catalogError ? <div role="alert" className="p-5 text-center text-sm"><p>Les prestations n’ont pas pu être chargées.</p><Button variant="outline" className="mt-3" onClick={() => setReloadCatalog((n) => n + 1)}>Réessayer</Button></div> : results.items.length === 0 && !searching ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {query ? 'Aucune prestation ne correspond.' : 'Aucun poste de prestation disponible.'}
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                {results.items.map((item) => {
                  const added = cart.some((line) => line.service_id === item.service_id)
                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => addToCart(item)}
                      className={cn(
                        'flex w-full min-w-0 items-center gap-3 rounded-lg border border-transparent p-2 text-left transition-colors hover:border-border hover:bg-muted active:bg-muted',
                        added && 'bg-muted/60'
                      )}
                    >
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                        <Wrench className="size-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium">
                          {item.model}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          Montant libre · TVA {item.vat_rate} %
                        </div>
                      </div>
                      <Plus className="size-4 shrink-0 text-primary" />
                    </button>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="flex flex-col gap-0 overflow-hidden py-0 lg:min-h-64 lg:flex-1">
          <CardHeader className="flex flex-row items-center justify-between border-b py-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <ShoppingCart className="h-5 w-5" />
              Panier
              {cart.length > 0 && <span className="text-sm font-normal text-muted-foreground">({cart.length})</span>}
            </CardTitle>
            {cart.length > 0 && (
              <Button variant="ghost" size="sm" onClick={resetSale}>
                Vider
              </Button>
            )}
          </CardHeader>
          <CardContent className="p-0 lg:flex-1 lg:overflow-y-auto">
            {cart.length === 0 ? (
              <div className="flex h-full min-h-28 flex-col items-center justify-center gap-2 text-muted-foreground lg:min-h-40">
                <ShoppingCart className="size-8 opacity-40" />
                <p className="text-sm">Choisissez une prestation et saisissez son montant</p>
              </div>
            ) : (
              <ul className="divide-y">
                {cart.map((line) => (
                  <li key={line.key} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
                    <div className="order-1 min-w-0 flex-1 basis-[calc(100%-3.5rem)] sm:basis-0">
                      <div className="truncate font-medium">
                        {line.model}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {formatEuro(toHT(line.price_ttc, line.vat_rate))} HT · {formatEuro(line.price_ttc)} TTC · TVA {line.vat_rate} %
                      </div>
                    </div>

                    <div className="order-3 flex items-center gap-1 sm:order-2 sm:w-24 sm:justify-center">
                      <Button variant="outline" size="icon-sm" className="size-9 sm:size-7" onClick={() => updateLine(line.key, { quantity: line.quantity - 1 })} aria-label="Diminuer">
                        <Minus />
                      </Button>
                      <span className="w-6 text-center tabular-nums">{line.quantity}</span>
                      <Button variant="outline" size="icon-sm" className="size-9 sm:size-7" onClick={() => updateLine(line.key, { quantity: line.quantity + 1 })} aria-label="Augmenter">
                        <Plus />
                      </Button>
                    </div>
                    <Button variant="ghost" size="icon-sm" aria-label={`Modifier le montant de ${line.model}`} className="order-3" onClick={() => { setSelectedService(line); setEditingKey(line.key); setServiceAmount(String(line.price_ttc)) }}><Pencil /></Button>

                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => applyDiscount(line)}
                      aria-label="Remise"
                      title="Appliquer une remise"
                      className={cn('order-4 size-9 sm:order-3 sm:size-7', line.discount > 0 && 'text-emerald-600')}
                    >
                      <Percent />
                    </Button>

                    <div className="order-5 ml-auto w-28 text-right tabular-nums sm:order-4 sm:ml-0">
                      {line.discount > 0 && (
                        <div className="text-xs text-muted-foreground line-through">{formatEuro(line.price_ttc * line.quantity)}</div>
                      )}
                      <div className="font-semibold">{formatEuro(line.price_ttc * line.quantity - line.discount)} <span className="text-[10px] font-normal text-muted-foreground">TTC</span></div>
                      <div className="text-xs text-muted-foreground">{formatEuro(toHT(line.price_ttc * line.quantity - line.discount, line.vat_rate))} HT</div>
                    </div>

                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="order-2 size-9 text-destructive sm:order-5 sm:size-7"
                      aria-label="Retirer"
                      onClick={() => {
                        setCart((c) => c.filter((l) => l.key !== line.key))
                        setPayments([])
                        setCashReceived(null)
                        setAmountInput('')
                      }}
                    >
                      <Trash2 />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
          <CardFooter className="flex-col items-stretch gap-1 border-t bg-muted/40 p-4">
            {totalDiscount > 0 && (
              <>
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>Sous-total TTC</span>
                  <span className="tabular-nums">{formatEuro(subtotal)}</span>
                </div>
                <div className="flex justify-between text-sm text-emerald-700 dark:text-emerald-400">
                  <span>Remises</span>
                  <span className="tabular-nums">-{formatEuro(totalDiscount)}</span>
                </div>
              </>
            )}
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>Total HT</span>
              <span className="tabular-nums">{formatEuro(totalHT)}</span>
            </div>
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>TVA</span>
              <span className="tabular-nums">{formatEuro(totalVAT)}</span>
            </div>
            <div className="flex items-baseline justify-between text-2xl font-bold">
              <span className="font-playfair">Total TTC</span>
              <span className="tabular-nums">{formatEuro(totalTTC)}</span>
            </div>
          </CardFooter>
        </Card>
      </div>

      {/* Colonne droite : client et paiement */}
      <div className="flex min-w-0 flex-col gap-3 sm:gap-4 lg:min-h-0">
        <Card className="gap-0 py-0">
          <CardHeader className="flex flex-row items-center justify-between border-b py-3">
            <CardTitle className="text-lg">Client</CardTitle>
            <Button variant="ghost" size="icon-sm" onClick={() => setCustomerDialogOpen(true)} title="Nouveau client">
              <UserPlus />
            </Button>
          </CardHeader>
          <CardContent className="py-3">
            {customer ? (
              <div className="flex items-center gap-3">
                <div className="flex size-9 items-center justify-center rounded-full bg-muted">
                  <User className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">
                    {customer.first_name} {customer.last_name}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">{customer.phone ?? customer.email}</div>
                </div>
                <Button variant="ghost" size="icon-sm" onClick={() => setCustomer(null)} aria-label="Retirer le client">
                  <X />
                </Button>
              </div>
            ) : (
              <div className="relative">
                <Input
                  aria-label="Rechercher un client"
                  placeholder={isDesktop ? 'Rechercher un client (vente comptoir par défaut)' : 'Client (facultatif)'}
                  value={customerQuery}
                  onChange={(e) => setCustomerQuery(e.target.value)}
                />
                {customerQuery && (
                  <div className="absolute inset-x-0 top-9 z-20 overflow-hidden rounded-lg border bg-popover shadow-lg">
                    {customerResults.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        className="block w-full px-3 py-2 text-left text-sm hover:bg-muted"
                        onClick={() => {
                          setCustomer(c)
                          setCustomerQuery('')
                        }}
                      >
                        <span className="font-medium">
                          {c.first_name} {c.last_name}
                        </span>
                        <span className="ml-2 text-xs text-muted-foreground">{c.phone ?? c.email}</span>
                      </button>
                    ))}
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 border-t px-3 py-2 text-left text-sm font-medium hover:bg-muted"
                      onClick={() => setCustomerDialogOpen(true)}
                    >
                      <UserPlus className="size-4" /> Créer « {customerQuery} »
                    </button>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card id="paiement" className="flex scroll-mt-4 flex-col gap-0 py-0 lg:flex-1">
          <CardHeader className="border-b py-3">
            <CardTitle className="text-lg">Paiement</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 py-4 lg:flex-1">
            {payments.map((p, i) => (
              <div key={i} className="flex items-center justify-between rounded-lg bg-muted px-3 py-2 text-sm">
                <span>{PAYMENT_LABELS[p.method]}</span>
                <span className="flex items-center gap-2 font-medium tabular-nums">
                  {formatEuro(p.amount)}
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-destructive"
                    aria-label="Supprimer le paiement"
                    onClick={() => {
                      setPayments((ps) => ps.filter((_, j) => j !== i))
                      if (p.method === 'ESPÈCES') setCashReceived(null)
                    }}
                  >
                    <X className="size-3.5" />
                  </button>
                </span>
              </div>
            ))}

            <div className="grid gap-1.5">
              <label htmlFor="amount" className="text-xs text-muted-foreground">
                Montant (vide = reste à payer)
              </label>
              <Input
                id="amount"
                inputMode="decimal"
                placeholder={remaining > 0 ? formatEuro(remaining) : '—'}
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
                disabled={remaining <= 0}
                className="h-10 text-right text-lg tabular-nums"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              {PAYMENT_BUTTONS.map(({ method, icon: Icon }) => (
                <Button
                  key={method}
                  variant="outline"
                  className={cn('h-12', method === 'CB' && 'col-span-2')}
                  onClick={() => addPayment(method)}
                  disabled={remaining <= 0 || cart.length === 0}
                >
                  <Icon /> {PAYMENT_LABELS[method]}
                </Button>
              ))}
            </div>

            <div className="mt-auto space-y-1 border-t pt-4">
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>Déjà payé</span>
                <span className="tabular-nums">{formatEuro(totalPaid)}</span>
              </div>
              {change > 0 && (
                <div className="flex justify-between text-sm font-medium text-amber-700 dark:text-amber-400">
                  <span>Rendu monnaie</span>
                  <span className="tabular-nums">{formatEuro(change)}</span>
                </div>
              )}
              <div className="flex justify-between text-lg font-bold">
                <span>Reste à payer</span>
                <span className={cn('tabular-nums', remaining > 0 ? 'text-destructive' : 'text-emerald-600')}>
                  {formatEuro(Math.max(0, remaining))}
                </span>
              </div>
            </div>
          </CardContent>
          <CardFooter className="flex-col gap-2 border-t p-4">
            {error && <div role="alert" className="w-full rounded-md bg-destructive/10 p-2 text-sm text-destructive">{error}</div>}
            <Button
              className="h-14 w-full text-lg font-bold tracking-wide"
              disabled={cart.length === 0 || totalTTC <= 0 || remaining !== 0 || processing || !!lastSaleId}
              onClick={checkout}
            >
              {processing ? <Loader2 className="animate-spin" /> : null}
              {processing ? 'Validation…' : `ENCAISSER ${cart.length ? formatEuro(totalTTC) : ''}`}
              {!processing && <kbd className="ml-1 max-lg:hidden rounded border border-primary-foreground/30 px-1 text-[10px] font-normal opacity-70">F9</kbd>}
            </Button>
          </CardFooter>
        </Card>
      </div>

      {/* Téléphone / tablette : récapitulatif toujours visible */}
      {cart.length > 0 && (
        <>
          <div className="h-16 lg:hidden" aria-hidden />
          <div className="fixed inset-x-0 bottom-[calc(3.9rem+env(safe-area-inset-bottom))] z-30 border-t bg-background/95 px-4 py-2.5 shadow-[0_-4px_16px_rgba(0,0,0,0.06)] backdrop-blur-lg md:bottom-0 md:pb-[calc(0.625rem+env(safe-area-inset-bottom))] lg:hidden">
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-xs text-muted-foreground">
                  {cart.reduce((n, l) => n + l.quantity, 0)} prestation(s) · {formatEuro(totalHT)} HT
                </div>
                <div className="text-xl font-bold tabular-nums">{formatEuro(totalTTC)}</div>
              </div>
              {remaining === 0 && totalTTC > 0 ? (
                <Button className="h-11 px-5 text-base font-bold" disabled={processing} onClick={checkout}>
                  {processing ? <Loader2 className="animate-spin" /> : null} Encaisser
                </Button>
              ) : (
                <Button
                  className="h-11 px-5 text-base font-semibold"
                  onClick={() => document.getElementById('paiement')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                >
                  {totalPaid > 0 ? `Reste ${formatEuro(remaining)}` : 'Payer'}
                </Button>
              )}
            </div>
          </div>
        </>
      )}

    </fieldset>
      <CustomerFormDialog
        open={customerDialogOpen}
        onOpenChange={setCustomerDialogOpen}
        initialName={customerQuery}
        onCreated={(c) => {
          setCustomer(c)
          setCustomerQuery('')
        }}
      />

      <ReceiptDialog saleId={lastSaleId} onClose={resetSale} closeLabel="Nouvelle vente" />
    </>
  )
}
