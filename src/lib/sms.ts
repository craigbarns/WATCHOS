import { whatsappPhone } from '@/lib/whatsapp'

/**
 * Envoi de SMS via AllMySMS (API REST, https://doc.allmysms.com/api/fr).
 * Authentification HTTP Basic : base64("login:cléAPI").
 *
 * Variables d'environnement (serveur uniquement) :
 *   ALLMYSMS_LOGIN    identifiant du compte (ex. superhome)
 *   ALLMYSMS_API_KEY  clé d'API affichée dans le compte
 *   ALLMYSMS_SENDER   expéditeur affiché, 3 à 11 caractères (facultatif)
 *   SMS_SANDBOX       "1" pour tester sans envoyer ni débiter
 */

const API = 'https://api.allmysms.com'

export type SmsResult =
  | { success: true; segments: number; cost: number | null; balance: number | null; sandbox: boolean }
  | { success: false; error: string }

function credentials() {
  const login = process.env.ALLMYSMS_LOGIN?.trim()
  const apiKey = (process.env.ALLMYSMS_API_KEY ?? process.env.SMS_PARTNER_API_KEY)?.trim().replace(/^["']|["']$/g, '')
  return { login: login || null, apiKey: apiKey || null }
}

export const hasSmsKey = () => {
  const { login, apiKey } = credentials()
  return Boolean(login && apiKey)
}

function authHeader(login: string, apiKey: string) {
  return `Basic ${Buffer.from(`${login}:${apiKey}`).toString('base64')}`
}

/** GSM-7 : les caractères typographiques coûtent un SMS de plus, on les remplace. */
export function smsSafeText(text: string): string {
  return text
    .replace(/[’‘]/g, "'")
    .replace(/[“”«»]/g, '"')
    .replace(/…/g, '...')
    .replace(/[–—]/g, '-')
    .replace(/œ/g, 'oe')
    .replace(/Œ/g, 'OE')
    .replace(/ /g, ' ')
    .replace(/[^\S\n]+/g, ' ')
    .trim()
}

/** Un SMS = 160 caractères, puis 153 par segment supplémentaire. */
export function smsSegments(text: string): number {
  const length = text.length
  return length <= 160 ? 1 : Math.ceil(length / 153)
}

/** Message court envoyé au client quand sa montre est prête (tient en un SMS). */
export function savReadySms(input: {
  firstName: string | null
  caseNumber: string
  brand: string | null
  model: string | null
  storeName: string
  storePhone?: string | null
}): string {
  const watch = [input.brand, input.model].filter(Boolean).join(' ')
  return smsSafeText(
    [
      `Bonjour${input.firstName ? ` ${input.firstName}` : ''}, votre montre${watch ? ` ${watch}` : ''} est prete et vous attend en boutique (dossier ${input.caseNumber}).`,
      `${input.storeName}${input.storePhone ? ` - ${input.storePhone}` : ''}`,
    ].join(' ')
  )
}

type SendResponse = {
  code?: number
  description?: string
  nbSms?: number
  cost?: number
  balance?: number
  invalidNumbers?: string
  smsId?: string
}

function friendlyError(status: number, data: SendResponse): string {
  if (status === 401 || status === 403) {
    return 'Identifiants refusés : vérifiez ALLMYSMS_LOGIN et ALLMYSMS_API_KEY.'
  }
  const description = data.description?.trim()
  if (description && /credit|solde|balance/i.test(description)) {
    return 'Crédit SMS insuffisant : rechargez votre compte AllMySMS.'
  }
  if (data.invalidNumbers) return `Numéro refusé par l’opérateur : ${data.invalidNumbers}`
  return description ? `AllMySMS : ${description}` : `Envoi refusé par AllMySMS (code HTTP ${status}).`
}

export async function sendSms(phone: string | null | undefined, message: string): Promise<SmsResult> {
  const { login, apiKey } = credentials()
  if (!login || !apiKey) {
    return { success: false, error: 'L’envoi de SMS n’est pas configuré : ajoutez ALLMYSMS_LOGIN et ALLMYSMS_API_KEY sur le serveur.' }
  }

  const number = whatsappPhone(phone)
  if (!number) return { success: false, error: 'Numéro de téléphone invalide.' }

  const text = smsSafeText(message)
  if (!text) return { success: false, error: 'Message vide.' }

  const sender = (process.env.ALLMYSMS_SENDER ?? process.env.SMS_SENDER ?? '').replace(/[^A-Za-z0-9]/g, '').slice(0, 11)
  const sandbox = process.env.SMS_SANDBOX === '1'
  if (sandbox) {
    return { success: true, segments: smsSegments(text), cost: null, balance: null, sandbox: true }
  }

  let response: Response
  try {
    response = await fetch(`${API}/sms/send`, {
      method: 'POST',
      headers: { Authorization: authHeader(login, apiKey), 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: number, text, ...(sender.length >= 3 ? { from: sender } : {}) }),
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    return { success: false, error: 'Le service SMS n’a pas répondu. Réessayez dans un instant.' }
  }

  let data: SendResponse = {}
  try {
    data = (await response.json()) as SendResponse
  } catch {
    return { success: false, error: `Réponse inattendue du service SMS (code ${response.status}).` }
  }

  // 100 = envoyé, 101 = programmé
  if (!response.ok || ![100, 101].includes(Number(data.code))) {
    return { success: false, error: friendlyError(response.status, data) }
  }

  return {
    success: true,
    segments: Number(data.nbSms ?? smsSegments(text)),
    cost: data.cost === undefined ? null : Number(data.cost),
    balance: data.balance === undefined ? null : Number(data.balance),
    sandbox: false,
  }
}

export type SmsAccount =
  | { success: true; balance: number | null; remaining: number | null; company: string | null; keyHint: string; sandbox: boolean }
  | { success: false; error: string; keyHint: string }

/** Empreinte lisible d'une clé, pour la comparer sans l'exposer : « 79f…055 ». */
function keyHint(login: string | null, key: string | null): string {
  if (!key) return '—'
  const short = key.length <= 8 ? `${key.slice(0, 2)}…${key.slice(-2)}` : `${key.slice(0, 3)}…${key.slice(-3)}`
  return login ? `${login} / ${short}` : short
}

/** Vérifie les identifiants auprès d'AllMySMS (/account) : aucun SMS envoyé. */
export async function checkSmsAccount(): Promise<SmsAccount> {
  const { login, apiKey } = credentials()
  const hint = keyHint(login, apiKey)
  if (!login || !apiKey) {
    return {
      success: false,
      error: !login
        ? 'Identifiant manquant : ajoutez ALLMYSMS_LOGIN (le login de connexion à AllMySMS).'
        : 'Clé manquante : ajoutez ALLMYSMS_API_KEY.',
      keyHint: hint,
    }
  }

  let response: Response
  try {
    response = await fetch(`${API}/account`, {
      headers: { Authorization: authHeader(login, apiKey) },
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    return { success: false, error: 'Le service SMS n’a pas répondu.', keyHint: hint }
  }

  let data: { balance?: number; nbSms?: number; company?: string; description?: string; code?: string } = {}
  try {
    data = await response.json()
  } catch {
    return { success: false, error: `Réponse inattendue (code HTTP ${response.status}).`, keyHint: hint }
  }

  if (!response.ok) {
    return {
      success: false,
      error:
        response.status === 401 || response.status === 403
          ? 'Identifiants refusés par AllMySMS : vérifiez le login et la clé d’API.'
          : data.description ?? `AllMySMS a répondu ${response.status}.`,
      keyHint: hint,
    }
  }

  return {
    success: true,
    balance: data.balance === undefined ? null : Number(data.balance),
    remaining: data.nbSms === undefined ? null : Number(data.nbSms),
    company: data.company ?? null,
    keyHint: hint,
    sandbox: process.env.SMS_SANDBOX === '1',
  }
}
