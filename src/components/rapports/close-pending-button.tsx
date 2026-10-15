'use client'

import { useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast'
import { closePendingPeriods } from '@/app/actions/rapports'

export function closedSummary({ days, months, years }: { days: number; months: number; years: number }) {
  return [days && `${days} journée(s)`, months && `${months} mois`, years && `${years} année(s)`].filter(Boolean).join(', ')
}

/** Clôture d'un coup toutes les périodes terminées : journées, puis mois, puis années. */
export function ClosePendingButton() {
  const [pending, startTransition] = useTransition()

  const submit = () => {
    if (!window.confirm('Clôturer toutes les périodes terminées (journées, mois, années) ? Ces clôtures sont définitives.')) return
    startTransition(async () => {
      const result = await closePendingPeriods()
      if (!result.success) {
        toast.add({ title: 'Clôtures impossibles', description: result.error, type: 'error' })
        return
      }
      const summary = closedSummary(result.closed)
      toast.add({ title: summary ? `Clôturé : ${summary}` : 'Tout était déjà clôturé', type: 'success' })
    })
  }

  return (
    <Button onClick={submit} disabled={pending} className="h-10 sm:h-9">
      {pending ? 'Clôture en cours…' : 'Tout clôturer'}
    </Button>
  )
}
