'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { updateSavDetails } from '@/app/actions/sav'
import { toast } from '@/components/ui/toast'
import type { Technician } from '@/components/sav/sav-create-dialog'

export function SavDetailsForm({
  id,
  initial,
  technicians,
}: {
  id: string
  initial: { diagnostic: string; technician_id: string; estimated_date: string; internal_notes: string }
  technicians: Technician[]
}) {
  const [values, setValues] = useState(initial)
  const [pending, startTransition] = useTransition()
  const dirty = JSON.stringify(values) !== JSON.stringify(initial)

  const set = (key: keyof typeof values) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setValues((v) => ({ ...v, [key]: e.target.value }))

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    startTransition(async () => {
      const result = await updateSavDetails({ id, ...values })
      if (result.success) toast.add({ title: 'Dossier mis à jour', type: 'success' })
      else toast.add({ title: 'Erreur', description: result.error, type: 'error' })
    })
  }

  const textareaClass =
    'rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50'

  return (
    <form onSubmit={submit} className="grid gap-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="technician_id">Technicien</Label>
          <select id="technician_id" value={values.technician_id} onChange={set('technician_id')} className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm">
            <option value="">Non attribué</option>
            {technicians.map((t) => (
              <option key={t.id} value={t.id}>
                {t.full_name}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="estimated_date">Restitution estimée</Label>
          <Input id="estimated_date" type="date" value={values.estimated_date} onChange={set('estimated_date')} />
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="diagnostic">Diagnostic atelier</Label>
        <textarea id="diagnostic" rows={4} value={values.diagnostic} onChange={set('diagnostic')} placeholder="Constat, travaux à prévoir, pièces nécessaires…" className={textareaClass} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="internal_notes">Notes internes</Label>
        <textarea id="internal_notes" rows={2} value={values.internal_notes} onChange={set('internal_notes')} className={textareaClass} />
      </div>
      <div>
        <Button type="submit" disabled={!dirty || pending} className="h-9">
          {pending ? 'Enregistrement…' : 'Enregistrer'}
        </Button>
      </div>
    </form>
  )
}
