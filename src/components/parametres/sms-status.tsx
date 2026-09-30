'use client'

import { useState, useTransition } from 'react'
import { CheckCircle2, Loader2, MessageSquare, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { testSmsAccount } from '@/app/actions/parametres'
import { formatEuro } from '@/lib/format'

type Result = Awaited<ReturnType<typeof testSmsAccount>>

/** Vérifie que la clé SMS Partner est acceptée, sans envoyer de SMS. */
export function SmsStatus() {
  const [result, setResult] = useState<Result | null>(null)
  const [pending, startTransition] = useTransition()

  const test = () => startTransition(async () => setResult(await testSmsAccount()))

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm text-muted-foreground">
          <MessageSquare className="size-4" /> Envoi de SMS aux clients (AllMySMS)
        </span>
        <Button variant="outline" className="h-9" onClick={test} disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : null} Tester la connexion
        </Button>
      </div>

      {result?.success && (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
          <p className="flex items-center gap-2 font-medium">
            <CheckCircle2 className="size-4" /> Clé valide, l’envoi de SMS fonctionne.
          </p>
          {(result.balance !== null || result.remaining !== null) && (
            <p className="mt-1">
              Crédit :{' '}
              <strong>
                {result.balance !== null ? formatEuro(result.balance) : '—'}
                {result.remaining !== null && ` (environ ${result.remaining} SMS)`}
              </strong>
            </p>
          )}
          {result.company && <p className="mt-1">Compte : {result.company}</p>}
          {result.sandbox && <p className="mt-1">Mode test actif (SMS_SANDBOX=1) : aucun SMS ne part réellement.</p>}
        </div>
      )}

      {result && !result.success && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <p className="flex items-center gap-2 font-medium text-destructive">
            <TriangleAlert className="size-4" /> {result.error}
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
            <li>
              Identifiants lus par le serveur : <strong className="font-mono">{result.keyHint}</strong>. Le login est celui
              de connexion à AllMySMS, la clé est celle affichée dans API &amp; Modules.
            </li>
            <li>
              Les variables <strong className="font-mono">ALLMYSMS_LOGIN</strong> et{' '}
              <strong className="font-mono">ALLMYSMS_API_KEY</strong> doivent être définies en environnement{' '}
              <strong>Production</strong>, puis le site redéployé.
            </li>
            <li>Si vous avez régénéré la clé, remettez la nouvelle valeur.</li>
          </ul>
        </div>
      )}
    </div>
  )
}
