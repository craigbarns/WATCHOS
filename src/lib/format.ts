const euroFormatter = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' })

export function formatEuro(value: number | string | null | undefined): string {
  return euroFormatter.format(Number(value ?? 0))
}

/** Montant HT arrondi au centime, calculé comme en base : round(TTC / (1 + taux)) */
export function toHT(ttc: number, vatRate: number): number {
  return Math.round((ttc / (1 + vatRate / 100)) * 100) / 100
}

export function formatDateTime(value: string | Date): string {
  return new Date(value).toLocaleString('fr-FR', {
    timeZone: 'Europe/Paris',
    dateStyle: 'short',
    timeStyle: 'short',
  })
}

/** Date longue et heure à la seconde, heure de Paris : { date: '17/09/2026', time: '14:32:05' } */
export function formatDateAndTime(value: string | Date = new Date()): { date: string; time: string } {
  const d = new Date(value)
  return {
    date: d.toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric' }),
    time: d.toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', second: '2-digit' }),
  }
}

export function formatDate(value: string | Date): string {
  return new Date(value).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' })
}

/** Date du jour (YYYY-MM-DD) dans le fuseau de la boutique */
export function parisDay(date: Date = new Date()): string {
  return date.toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' })
}

/** Veille (YYYY-MM-DD) dans le fuseau de la boutique */
export function parisYesterday(): string {
  return parisDay(new Date(Date.now() - 86_400_000))
}

/** Début de journée à Paris, en ISO UTC */
export function parisDayStartISO(day: string): string {
  // L'offset de Paris est +01:00 ou +02:00 : on le déduit de midi ce jour-là
  const noonUtc = new Date(`${day}T12:00:00Z`)
  const parisNoon = new Date(noonUtc.toLocaleString('en-US', { timeZone: 'Europe/Paris' }))
  const utcNoon = new Date(noonUtc.toLocaleString('en-US', { timeZone: 'UTC' }))
  const offsetMs = parisNoon.getTime() - utcNoon.getTime()
  return new Date(new Date(`${day}T00:00:00Z`).getTime() - offsetMs).toISOString()
}

export const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'Administrateur',
  VENDEUR: 'Vendeur',
  TECHNICIEN: 'Technicien',
}

export const PAYMENT_LABELS: Record<string, string> = {
  CB: 'Carte bancaire',
  'ESPÈCES': 'Espèces',
  VIREMENT: 'Virement',
  'CHÈQUE': 'Chèque',
  AUTRE: 'Autre',
}

export const ITEM_STATUS: Record<string, { label: string; className: string }> = {
  AVAILABLE: { label: 'Disponible', className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' },
  RESERVED: { label: 'Réservée', className: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300' },
  SOLD: { label: 'Vendue', className: 'bg-muted text-muted-foreground' },
  IN_SAV: { label: 'En SAV', className: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300' },
  RETURNED: { label: 'Retournée', className: 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300' },
  ARCHIVED: { label: 'Archivée', className: 'bg-muted text-muted-foreground' },
}

export const SAV_STATUS: Record<string, { label: string; className: string }> = {
  RECU: { label: 'Reçu', className: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300' },
  DIAGNOSTIC: { label: 'Diagnostic', className: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300' },
  DEVIS_A_FAIRE: { label: 'Devis à faire', className: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300' },
  ATTENTE_CLIENT: { label: 'Attente client', className: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300' },
  ACCEPTE: { label: 'Accepté', className: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300' },
  REFUSE: { label: 'Refusé', className: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300' },
  EN_REPARATION: { label: 'En réparation', className: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300' },
  ATTENTE_PIECE: { label: 'Attente pièce', className: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300' },
  CONTROLE: { label: 'Contrôle', className: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300' },
  PRET: { label: 'Prêt', className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' },
  CLIENT_PREVENU: { label: 'Client prévenu', className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' },
  RESTITUE: { label: 'Restitué', className: 'bg-muted text-muted-foreground' },
  ANNULE: { label: 'Annulé', className: 'bg-muted text-muted-foreground' },
}

export const SAV_CLOSED_STATUSES = ['RESTITUE', 'ANNULE']
