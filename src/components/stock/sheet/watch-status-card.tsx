'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { Archive, BookmarkCheck, RotateCcw, ShoppingCart, Wrench } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { setItemStatus } from '@/app/actions/products'
import { toast } from '@/components/ui/toast'
import { ITEM_STATUS } from '@/lib/format'
import { cn } from '@/lib/utils'

type Target = 'AVAILABLE' | 'RESERVED' | 'IN_SAV' | 'ARCHIVED'

const ACTIONS: Record<Target, { label: string; icon: typeof Archive; reasonLabel: string; reasonRequired: boolean; placeholder: string }> = {
  RESERVED: { label: 'Réserver', icon: BookmarkCheck, reasonLabel: 'Pour qui / conditions', reasonRequired: true, placeholder: 'M. Moreau, acompte de 1 000 € versé, jusqu’au 30/09' },
  IN_SAV: { label: 'Envoyer en SAV / révision', icon: Wrench, reasonLabel: 'Motif', reasonRequired: false, placeholder: 'Révision complète avant mise en vente, envoi horloger X' },
  ARCHIVED: { label: 'Retirer de la vente', icon: Archive, reasonLabel: 'Motif', reasonRequired: true, placeholder: 'Rendue au déposant, pièce défectueuse, erreur de saisie…' },
  AVAILABLE: { label: 'Remettre en vente', icon: RotateCcw, reasonLabel: 'Commentaire', reasonRequired: false, placeholder: 'Réservation annulée, retour de révision…' },
}

const NEXT: Record<string, Target[]> = {
  AVAILABLE: ['RESERVED', 'IN_SAV', 'ARCHIVED'],
  RESERVED: ['AVAILABLE', 'IN_SAV', 'ARCHIVED'],
  IN_SAV: ['AVAILABLE', 'ARCHIVED'],
  ARCHIVED: ['AVAILABLE'],
  RETURNED: ['AVAILABLE', 'IN_SAV', 'ARCHIVED'],
  SOLD: [],
}

export function WatchStatusCard({
  itemId,
  status,
  serialNumber,
  canEdit,
}: {
  itemId: string
  status: string
  serialNumber: string
  canEdit: boolean
}) {
  const [target, setTarget] = useState<Target | null>(null)
  const [reason, setReason] = useState('')
  const [pending, startTransition] = useTransition()
  const current = ITEM_STATUS[status]

  const confirm = () => {
    if (!target) return
    if (ACTIONS[target].reasonRequired && !reason.trim()) {
      toast.add({ title: `${ACTIONS[target].reasonLabel} : champ obligatoire`, type: 'error' })
      return
    }
    startTransition(async () => {
      const result = await setItemStatus({ id: itemId, status: target, reason })
      if (!result.success) {
        toast.add({ title: 'Statut non modifié', description: result.error, type: 'error' })
        return
      }
      toast.add({ title: `Montre : ${ITEM_STATUS[target].label.toLowerCase()}`, type: 'success' })
      setTarget(null)
      setReason('')
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Disponibilité</CardTitle>
        <CardDescription>
          {status === 'SOLD'
            ? 'Montre vendue : statut verrouillé.'
            : status === 'RESERVED'
              ? 'Réservée : elle n’apparaît plus dans la caisse.'
              : status === 'AVAILABLE'
                ? 'En vitrine, vendable depuis la caisse.'
                : 'Hors vente : elle n’apparaît pas dans la caisse.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <span className={cn('inline-block rounded-full px-3 py-1 text-sm font-semibold', current?.className)}>{current?.label ?? status}</span>

        {status === 'AVAILABLE' && canEdit && (
          <Link
            href={`/caisse?serie=${encodeURIComponent(serialNumber)}`}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary text-sm font-medium text-primary-foreground hover:bg-primary/85"
          >
            <ShoppingCart className="size-4" /> Vendre cette montre
          </Link>
        )}

        {canEdit && (NEXT[status] ?? []).length > 0 && (
          <div className="grid gap-2">
            {(NEXT[status] ?? []).map((t) => {
              const a = ACTIONS[t]
              return (
                <Button
                  key={t}
                  variant={target === t ? 'secondary' : 'outline'}
                  className="h-9 justify-start"
                  onClick={() => {
                    setTarget(target === t ? null : t)
                    setReason('')
                  }}
                >
                  <a.icon /> {a.label}
                </Button>
              )
            })}
          </div>
        )}

        {target && (
          <div className="grid gap-2 rounded-lg border p-3">
            <label htmlFor="status-reason" className="text-sm font-medium">
              {ACTIONS[target].reasonLabel}
              {ACTIONS[target].reasonRequired ? ' *' : ''}
            </label>
            <textarea
              id="status-reason"
              rows={2}
              autoFocus
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={ACTIONS[target].placeholder}
              className="rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
            <div className="flex gap-2">
              <Button onClick={confirm} disabled={pending} className="h-9">
                {pending ? 'Enregistrement…' : `Confirmer : ${ACTIONS[target].label.toLowerCase()}`}
              </Button>
              <Button variant="ghost" onClick={() => setTarget(null)} className="h-9">
                Annuler
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
