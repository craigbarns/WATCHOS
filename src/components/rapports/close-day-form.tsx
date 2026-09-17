'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { closeDay } from '@/app/actions/rapports'
import { toast } from '@/components/ui/toast'

export function CloseDayForm({ defaultDay, maxDay }: { defaultDay: string; maxDay: string }) {
  const [day, setDay] = useState(defaultDay)
  const [pending, startTransition] = useTransition()

  const submit = () => {
    if (!window.confirm(`Générer la clôture (Z) du ${new Date(day).toLocaleDateString('fr-FR')} ? Cette opération est définitive.`)) return
    startTransition(async () => {
      const result = await closeDay(day)
      if (result.success) toast.add({ title: 'Clôture générée', description: result.message, type: 'success' })
      else toast.add({ title: 'Clôture impossible', description: result.error, type: 'error' })
    })
  }

  return (
    <div className="flex gap-2">
      <Input type="date" value={day} max={maxDay} onChange={(e) => setDay(e.target.value)} className="h-9" />
      <Button onClick={submit} disabled={pending || !day} className="h-9">
        {pending ? 'Génération…' : 'Générer le Z'}
      </Button>
    </div>
  )
}
