'use client'

import { useState, useTransition } from 'react'
import { Check, MessageCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { confirmSavWhatsApp, updateSavCustomerPhone } from '@/app/actions/sav'
import { whatsappLink } from '@/lib/whatsapp'

export function SavWhatsApp({ id, status, phone, message }: { id: string; status: string; phone: string | null; message: string }) {
  const [opened, setOpened] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editingPhone, setEditingPhone] = useState(false)
  const [phoneInput, setPhoneInput] = useState(phone ?? '')
  const [pending, startTransition] = useTransition()
  const href = whatsappLink(phone, message)
  const confirmed = status === 'CLIENT_PREVENU'

  const confirm = () => startTransition(async () => {
    setError(null)
    try {
      const result = await confirmSavWhatsApp(id)
      if (!result.success) setError(result.error)
      else setOpened(false)
    } catch { setError('Confirmation impossible. Réessayez.') }
  })

  const savePhone = () => startTransition(async () => {
    setError(null)
    try {
      const result = await updateSavCustomerPhone(id, phoneInput)
      if (!result.success) setError(result.error)
      else { setEditingPhone(false); setOpened(false) }
    } catch { setError('Enregistrement impossible. Réessayez.') }
  })

  return (
    <div className="space-y-3">
      <p className="whitespace-pre-line rounded-lg bg-muted/60 p-3 text-sm leading-relaxed">{message}</p>
      {href && !editingPhone ? <>
        <a href={href} target="_blank" rel="noopener noreferrer" onClick={() => setOpened(true)} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800">
          <MessageCircle className="size-4" /> Envoyer par WhatsApp
        </a>
        <p className="text-xs text-muted-foreground">Ouvre WhatsApp avec le message préparé pour {phone}. Cliquez sur Envoyer dans WhatsApp, puis confirmez ici.</p>
        <button type="button" className="block text-xs text-muted-foreground underline" onClick={() => { setPhoneInput(phone ?? ''); setEditingPhone(true) }}>Modifier le numéro du client</button>
        {opened && !confirmed && <Button variant="outline" disabled={pending} onClick={confirm}><Check /> {pending ? 'Confirmation…' : 'J’ai envoyé le message'}</Button>}
      </> : <form className="grid gap-2" onSubmit={(e) => { e.preventDefault(); savePhone() }}>
        {!href && <p className="text-sm text-amber-800">{phone ? 'Le numéro du client est invalide.' : 'Aucun numéro de téléphone pour ce client.'}</p>}
        <label htmlFor="whatsapp-phone" className="text-sm font-medium">Téléphone du client</label>
        <Input id="whatsapp-phone" type="tel" placeholder="06 12 34 56 78 ou +33…" value={phoneInput} onChange={(e) => setPhoneInput(e.target.value)} required />
        <p className="text-xs text-muted-foreground">Ce numéro sera enregistré sur la fiche client.</p>
        <div className="flex gap-2"><Button type="submit" disabled={pending}>Enregistrer le numéro</Button>{href && <Button type="button" variant="ghost" onClick={() => setEditingPhone(false)}>Annuler</Button>}</div>
      </form>}
      {confirmed && <p className="flex items-center gap-2 text-sm text-emerald-700"><Check className="size-4" /> Client marqué comme prévenu.</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
