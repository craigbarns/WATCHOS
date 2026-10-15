'use client'

import { useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast'
import { closePendingDays } from '@/app/actions/rapports'

/** Génère d'un coup le Z de toutes les journées terminées qui n'ont pas été clôturées. */
export function ClosePendingButton({ count }: { count: number }) {
  const [pending, startTransition] = useTransition()

  const submit = () => {
    if (!window.confirm(`Générer le Z des ${count} journée(s) non clôturée(s) ? Ces clôtures sont définitives.`)) return
    startTransition(async () => {
      const result = await closePendingDays()
      if (!result.success) {
        toast.add({ title: 'Clôture interrompue', description: `${result.closed} journée(s) clôturée(s). ${result.error}`, type: 'error' })
        return
      }
      toast.add({ title: result.closed ? `${result.closed} journée(s) clôturée(s)` : 'Tout était déjà clôturé', type: 'success' })
    })
  }

  return (
    <Button onClick={submit} disabled={pending} className="h-10 sm:h-9">
      {pending ? 'Clôture en cours…' : 'Tout clôturer'}
    </Button>
  )
}
