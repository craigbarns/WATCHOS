'use client'

import { useState, useSyncExternalStore, useTransition } from 'react'
import { Check, Copy, MessageCircle, Monitor, Send, Smartphone } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { confirmSavWhatsApp, sendSavSms, updateSavCustomerPhone } from '@/app/actions/sav'
import { whatsappTargets } from '@/lib/whatsapp'

/** Vrai sur ordinateur : on y propose WhatsApp Web ou l'application installée. */
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

export function SavWhatsApp({
  id,
  status,
  phone,
  message,
  smsReady = false,
  smsMessage,
}: {
  id: string
  status: string
  phone: string | null
  message: string
  /** Vrai si la clé d'API SMS est configurée sur le serveur */
  smsReady?: boolean
  smsMessage?: string
}) {
  const [smsSent, setSmsSent] = useState<string | null>(null)
  const [smsError, setSmsError] = useState<string | null>(null)
  const [sendingSms, startSms] = useTransition()
  const [opened, setOpened] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editingPhone, setEditingPhone] = useState(false)
  const [phoneInput, setPhoneInput] = useState(phone ?? '')
  const [pending, startTransition] = useTransition()
  const targets = whatsappTargets(phone, message)
  const isDesktop = useIsDesktop()
  const confirmed = status === 'CLIENT_PREVENU'

  const confirm = () =>
    startTransition(async () => {
      setError(null)
      try {
        const result = await confirmSavWhatsApp(id)
        if (!result.success) setError(result.error)
        else setOpened(false)
      } catch {
        setError('Confirmation impossible. Réessayez.')
      }
    })

  const savePhone = () =>
    startTransition(async () => {
      setError(null)
      try {
        const result = await updateSavCustomerPhone(id, phoneInput)
        if (!result.success) setError(result.error)
        else {
          setEditingPhone(false)
          setOpened(false)
        }
      } catch {
        setError('Enregistrement impossible. Réessayez.')
      }
    })

  const copyMessage = async () => {
    try {
      await navigator.clipboard.writeText(message)
      setCopied(true)
      setOpened(true)
    } catch {
      setError('Copie impossible : sélectionnez le texte du message à la main.')
    }
  }

  const sendSms = () =>
    startSms(async () => {
      setSmsError(null)
      const result = await sendSavSms(id)
      if (!result.success) {
        setSmsError(result.error)
        return
      }
      setSmsSent(
        result.sandbox
          ? 'Mode test : le SMS n’a pas été envoyé et rien n’a été débité.'
          : `SMS envoyé${result.cost !== null ? ` (${result.cost.toFixed(3).replace('.', ',')} €)` : ''}.`
      )
    })

  const linkClass =
    'inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800'

  return (
    <div className="space-y-3">
      <p className="rounded-lg bg-muted/60 p-3 text-sm leading-relaxed whitespace-pre-line">{message}</p>

      {targets && !editingPhone ? (
        <>
          <div className="flex flex-wrap gap-2">
            {isDesktop ? (
              <>
                <a href={targets.web} target="_blank" rel="noopener noreferrer" onClick={() => setOpened(true)} className={linkClass}>
                  <Monitor className="size-4" /> WhatsApp Web
                </a>
                <a href={targets.app} onClick={() => setOpened(true)} className={linkClass}>
                  <MessageCircle className="size-4" /> Application WhatsApp
                </a>
              </>
            ) : (
              <a href={targets.mobile} target="_blank" rel="noopener noreferrer" onClick={() => setOpened(true)} className={linkClass}>
                <Smartphone className="size-4" /> Envoyer par WhatsApp
              </a>
            )}
            <Button type="button" variant="outline" className="min-h-10" onClick={copyMessage}>
              {copied ? <Check /> : <Copy />} {copied ? 'Message copié' : 'Copier le message'}
            </Button>
          </div>

          {smsReady && (
            <div className="rounded-lg border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium">Envoyer un SMS à la place</span>
                <Button type="button" variant="outline" className="min-h-10" disabled={sendingSms || smsSent !== null} onClick={sendSms}>
                  {smsSent ? <Check /> : <Send />} {sendingSms ? 'Envoi…' : smsSent ? 'SMS envoyé' : 'Envoyer le SMS'}
                </Button>
              </div>
              {smsMessage && !smsSent && (
                <p className="mt-2 rounded bg-muted/60 p-2 text-xs leading-relaxed">{smsMessage}</p>
              )}
              <p className="mt-2 text-xs text-muted-foreground">
                Départ immédiat vers {phone}, sans rien faire d’autre. Environ 5 centimes par SMS, débités de votre crédit
                SMS Partner.
              </p>
              {smsSent && <p className="mt-2 text-sm text-emerald-700">{smsSent}</p>}
              {smsError && (
                <p role="alert" className="mt-2 text-sm text-destructive">
                  {smsError}
                </p>
              )}
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            {isDesktop
              ? `La conversation avec ${phone} s’ouvre directement, message déjà écrit : il reste à cliquer sur Envoyer. WhatsApp Web demande d’être connecté (QR code scanné depuis le téléphone) ; sinon utilisez l’application WhatsApp installée sur l’ordinateur.`
              : `Ouvre WhatsApp avec le message préparé pour ${phone}. Touchez Envoyer dans WhatsApp, puis confirmez ici.`}
          </p>

          <button
            type="button"
            className="block text-xs text-muted-foreground underline"
            onClick={() => {
              setPhoneInput(phone ?? '')
              setEditingPhone(true)
            }}
          >
            Modifier le numéro du client
          </button>

          {opened && !confirmed && (
            <Button variant="outline" disabled={pending} onClick={confirm}>
              <Check /> {pending ? 'Confirmation…' : 'J’ai envoyé le message'}
            </Button>
          )}
        </>
      ) : (
        <form
          className="grid gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            savePhone()
          }}
        >
          {!targets && (
            <p className="text-sm text-amber-800">
              {phone ? 'Le numéro du client est invalide.' : 'Aucun numéro de téléphone pour ce client.'}
            </p>
          )}
          <label htmlFor="whatsapp-phone" className="text-sm font-medium">
            Téléphone du client
          </label>
          <Input
            id="whatsapp-phone"
            type="tel"
            placeholder="06 12 34 56 78 ou +33…"
            value={phoneInput}
            onChange={(e) => setPhoneInput(e.target.value)}
            required
          />
          <p className="text-xs text-muted-foreground">Ce numéro sera enregistré sur la fiche client.</p>
          <div className="flex gap-2">
            <Button type="submit" disabled={pending}>
              Enregistrer le numéro
            </Button>
            {targets && (
              <Button type="button" variant="ghost" onClick={() => setEditingPhone(false)}>
                Annuler
              </Button>
            )}
          </div>
        </form>
      )}

      {confirmed && (
        <p className="flex items-center gap-2 text-sm text-emerald-700">
          <Check className="size-4" /> Client marqué comme prévenu.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
