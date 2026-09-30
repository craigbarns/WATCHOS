import { whatsappPhone } from '@/lib/whatsapp'

/**
 * Envoi de SMS via SMS Partner (https://api.smspartner.fr/v1/send).
 * La clé d'API reste côté serveur : SMS_PARTNER_API_KEY.
 * Réglages facultatifs :
 *   SMS_SENDER   nom d'expéditeur affiché (3 à 11 caractères, sans accent ni espace)
 *   SMS_SANDBOX  "1" pour tester sans envoyer ni consommer de crédit
 */

export type SmsResult =
  | { success: true; segments: number; cost: number | null; sandbox: boolean }
  | { success: false; error: string }

export const hasSmsKey = () => Boolean(process.env.SMS_PARTNER_API_KEY)

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
  const message = [
    `Bonjour${input.firstName ? ` ${input.firstName}` : ''}, votre montre${watch ? ` ${watch}` : ''} est prete et vous attend en boutique (dossier ${input.caseNumber}).`,
    `${input.storeName}${input.storePhone ? ` - ${input.storePhone}` : ''}`,
  ].join(' ')
  return smsSafeText(message)
}

type PartnerResponse = {
  success?: boolean
  code?: number
  nb_sms?: number
  cost?: number
  message?: string
  errors?: Array<{ message?: string }>
}

const ERRORS: Record<number, string> = {
  1: 'Clé d’API manquante côté serveur.',
  2: 'Numéro de téléphone manquant.',
  9: 'Message ou numéro refusé par l’opérateur.',
  10: 'Clé d’API invalide : vérifiez SMS_PARTNER_API_KEY.',
  11: 'Crédit SMS épuisé : rechargez votre compte SMS Partner.',
}

export async function sendSms(phone: string | null | undefined, message: string): Promise<SmsResult> {
  const apiKey = process.env.SMS_PARTNER_API_KEY
  if (!apiKey) {
    return { success: false, error: 'L’envoi de SMS n’est pas configuré : ajoutez SMS_PARTNER_API_KEY sur le serveur.' }
  }

  const number = whatsappPhone(phone)
  if (!number) return { success: false, error: 'Numéro de téléphone invalide.' }

  const text = smsSafeText(message)
  if (!text) return { success: false, error: 'Message vide.' }

  const sender = (process.env.SMS_SENDER ?? '').replace(/[^A-Za-z0-9]/g, '').slice(0, 11)
  const sandbox = process.env.SMS_SANDBOX === '1'

  let response: Response
  try {
    response = await fetch('https://api.smspartner.fr/v1/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey,
        phoneNumbers: `+${number}`,
        message: text,
        ...(sender.length >= 3 ? { sender } : {}),
        ...(sandbox ? { sandbox: 1 } : {}),
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    return { success: false, error: 'Le service SMS n’a pas répondu. Réessayez dans un instant.' }
  }

  let data: PartnerResponse = {}
  try {
    data = (await response.json()) as PartnerResponse
  } catch {
    return { success: false, error: `Réponse inattendue du service SMS (code ${response.status}).` }
  }

  if (!data.success) {
    const detail = data.errors?.map((e) => e.message).filter(Boolean).join(' · ')
    return { success: false, error: ERRORS[data.code ?? 0] ?? detail ?? 'Envoi refusé par le service SMS.' }
  }

  return {
    success: true,
    segments: Number(data.nb_sms ?? smsSegments(text)),
    cost: data.cost === undefined ? null : Number(data.cost),
    sandbox,
  }
}
