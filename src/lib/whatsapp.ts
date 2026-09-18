/** Numéros français au format local, ou numéros internationaux avec indicatif. */
export function whatsappPhone(raw: string | null | undefined): string | null {
  if (!raw?.trim() || !/^[+\d\s().-]+$/.test(raw)) return null
  let phone = raw.trim().replace(/[\s().-]/g, '')
  if (phone.startsWith('00')) phone = `+${phone.slice(2)}`
  if (/^0[1-9]\d{8}$/.test(phone)) phone = `+33${phone.slice(1)}`
  if (/^\+330[1-9]\d{8}$/.test(phone)) phone = `+33${phone.slice(4)}`
  phone = phone.replace(/^\+/, '')
  if (!/^[1-9]\d{7,14}$/.test(phone)) return null
  if (phone.startsWith('33') && !/^33[1-9]\d{8}$/.test(phone)) return null
  return phone
}

export function whatsappLink(phone: string | null | undefined, message: string): string | null {
  const number = whatsappPhone(phone)
  return number ? `https://wa.me/${number}?text=${encodeURIComponent(message)}` : null
}

export function savReadyMessage(input: {
  firstName: string | null; caseNumber: string; brand: string | null; model: string | null
  storeName: string; address?: string | null; storePhone?: string | null
}): string {
  const watch = [input.brand, input.model].filter(Boolean).join(' ')
  return [
    `Bonjour${input.firstName ? ` ${input.firstName}` : ''},`,
    `Votre montre${watch ? ` ${watch}` : ''} est prête à être récupérée en boutique (dossier ${input.caseNumber}).`,
    input.address ? `Adresse : ${input.address}` : null,
    input.storePhone ? `Pour nous joindre : ${input.storePhone}` : null,
    `À bientôt,\n${input.storeName}`,
  ].filter(Boolean).join('\n\n')
}
