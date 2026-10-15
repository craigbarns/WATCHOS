import crypto from 'crypto'

/**
 * Moteur Fiscal (BOFiP)
 * Version 1.1.0
 * Ce noyau est responsable de la création du format canonique et du chaînage cryptographique
 * garantissant l'inaltérabilité des opérations de caisse.
 *
 * Le format canonique DOIT rester strictement identique à celui calculé en SQL
 * (supabase/migrations/*_security_fiscal_hardening.sql : finalize_sale et close_day).
 */

export const FISCAL_CORE_VERSION = '1.1.0'

export interface FiscalPayload {
  entity_id: string
  event_type: 'SALE' | 'REFUND'
  operator_id: string
  occurred_at: string
  amount_ht: number
  vat_amount: number
  amount_ttc: number
}

export interface ClosurePayload {
  closure_type: 'DAILY' | 'MONTHLY' | 'ANNUAL'
  operations_count: number
  perpetual_total: number
  period_start: string
  period_end: string
  total_ht: number
  total_vat: number
  total_ttc: number
}

function amount(value: number | string): string {
  return Number(value).toFixed(2)
}

function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex')
}

/**
 * Crée une représentation textuelle strictement déterministe du payload.
 */
function createCanonicalString(payload: FiscalPayload, sequence_number: number): string {
  // Les clés sont triées par ordre alphabétique pour assurer un ordre parfait
  return [
    `amount_ht:${amount(payload.amount_ht)}`,
    `amount_ttc:${amount(payload.amount_ttc)}`,
    `entity_id:${payload.entity_id}`,
    `event_type:${payload.event_type}`,
    `occurred_at:${payload.occurred_at}`,
    `operator_id:${payload.operator_id}`,
    `sequence_number:${sequence_number}`,
    `vat_amount:${amount(payload.vat_amount)}`
  ].join('|')
}

/** Horodatage UTC à la seconde, format identique à to_char(... 'YYYY-MM-DD"T"HH24:MI:SS"Z"') */
function isoSeconds(value: string): string {
  return new Date(value).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

function createClosureCanonicalString(payload: ClosurePayload, sequence_number: number): string {
  return [
    `closure_type:${payload.closure_type}`,
    `operations_count:${payload.operations_count}`,
    `perpetual_total:${amount(payload.perpetual_total)}`,
    `period_end:${isoSeconds(payload.period_end)}`,
    `period_start:${isoSeconds(payload.period_start)}`,
    `sequence_number:${sequence_number}`,
    `total_ht:${amount(payload.total_ht)}`,
    `total_ttc:${amount(payload.total_ttc)}`,
    `total_vat:${amount(payload.total_vat)}`
  ].join('|')
}

/**
 * Calcule l'empreinte cryptographique (hash) chaînée.
 * L'algorithme standard utilisé ici est SHA-256.
 */
export function generateFiscalHash(
  payload: FiscalPayload,
  sequence_number: number,
  previous_hash: string | null
): string {
  // Le chaînage intègre le hash précédent (ou "GENESIS" pour le tout premier événement)
  return sha256(`${previous_hash || 'GENESIS'}||${createCanonicalString(payload, sequence_number)}`)
}

export function generateClosureHash(
  payload: ClosurePayload,
  sequence_number: number,
  previous_hash: string | null
): string {
  return sha256(`${previous_hash || 'GENESIS'}||${createClosureCanonicalString(payload, sequence_number)}`)
}

export type ChainVerification =
  | { valid: true; count: number }
  | { valid: false; count: number; sequence_number: number; reason: string }

type ChainLink = { sequence_number: number; previous_hash: string | null; current_hash: string }

function verifyChain<T extends ChainLink>(links: T[], computeHash: (link: T) => string): ChainVerification {
  for (let i = 0; i < links.length; i++) {
    const link = links[i]
    const expectedSequence = i === 0 ? 1 : links[i - 1].sequence_number + 1

    if (i === 0 && link.sequence_number === 1 && link.previous_hash !== 'GENESIS') {
      return { valid: false, count: links.length, sequence_number: link.sequence_number, reason: 'Origine de chaîne invalide' }
    }
    if (link.sequence_number !== expectedSequence) {
      return { valid: false, count: links.length, sequence_number: link.sequence_number, reason: 'Numérotation discontinue' }
    }
    if (i > 0 && link.previous_hash !== links[i - 1].current_hash) {
      return { valid: false, count: links.length, sequence_number: link.sequence_number, reason: 'Rupture de chaînage' }
    }
    if (computeHash(link) !== link.current_hash) {
      return { valid: false, count: links.length, sequence_number: link.sequence_number, reason: 'Altération des données' }
    }
  }
  return { valid: true, count: links.length }
}

/**
 * Vérifie l'intégrité d'une chaîne d'événements (triés par sequence_number croissant).
 */
export function verifyFiscalChain(events: Array<ChainLink & { payload: FiscalPayload }>): ChainVerification {
  return verifyChain(events, (e) => generateFiscalHash(e.payload, e.sequence_number, e.previous_hash))
}

export function verifyClosureChain(closures: Array<ChainLink & { payload: ClosurePayload }>): ChainVerification {
  return verifyChain(closures, (c) => generateClosureHash(c.payload, c.sequence_number, c.previous_hash))
}
