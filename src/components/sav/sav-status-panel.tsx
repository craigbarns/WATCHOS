'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { updateSavStatus } from '@/app/actions/sav'
import { toast } from '@/components/ui/toast'
import { SAV_STATUS } from '@/lib/format'
import { cn } from '@/lib/utils'

/** Étapes suivantes logiques proposées en un clic selon le statut courant. */
const NEXT_STEPS: Record<string, string[]> = {
  RECU: ['DIAGNOSTIC'],
  DIAGNOSTIC: ['DEVIS_A_FAIRE', 'EN_REPARATION'],
  DEVIS_A_FAIRE: ['ATTENTE_CLIENT'],
  ATTENTE_CLIENT: ['ACCEPTE', 'REFUSE'],
  ACCEPTE: ['EN_REPARATION'],
  REFUSE: ['PRET'],
  EN_REPARATION: ['CONTROLE', 'ATTENTE_PIECE'],
  ATTENTE_PIECE: ['EN_REPARATION'],
  CONTROLE: ['PRET', 'EN_REPARATION'],
  PRET: ['CLIENT_PREVENU'],
  CLIENT_PREVENU: ['RESTITUE'],
  RESTITUE: [],
  ANNULE: [],
}

export function SavStatusPanel({ id, status }: { id: string; status: string }) {
  const [comment, setComment] = useState('')
  const [other, setOther] = useState('')
  const [pending, startTransition] = useTransition()

  const apply = (next: string) => {
    startTransition(async () => {
      const result = await updateSavStatus({ id, status: next, comment })
      if (!result.success) {
        toast.add({ title: 'Erreur', description: result.error, type: 'error' })
        return
      }
      toast.add({ title: next === status ? 'Note ajoutée' : `Statut : ${SAV_STATUS[next].label}`, type: 'success' })
      setComment('')
      setOther('')
    })
  }

  const steps = NEXT_STEPS[status] ?? []

  return (
    <div className="grid gap-3">
      <textarea
        rows={2}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Commentaire (facultatif) : pièce commandée, client appelé, montant du devis…"
        className="rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      />
      {steps.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {steps.map((s) => (
            <Button key={s} onClick={() => apply(s)} disabled={pending} className="h-9">
              → {SAV_STATUS[s].label}
            </Button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={other}
          onChange={(e) => setOther(e.target.value)}
          className="h-9 rounded-lg border border-input bg-transparent px-2 text-sm"
          aria-label="Autre statut"
        >
          <option value="">Autre statut…</option>
          {Object.entries(SAV_STATUS)
            .filter(([s]) => s !== status)
            .map(([s, { label }]) => (
              <option key={s} value={s}>
                {label}
              </option>
            ))}
        </select>
        <Button variant="outline" className="h-9" disabled={!other || pending} onClick={() => apply(other)}>
          Appliquer
        </Button>
        <Button variant="ghost" className={cn('h-9', !comment && 'hidden')} disabled={pending} onClick={() => apply(status)}>
          Ajouter la note seule
        </Button>
      </div>
    </div>
  )
}
