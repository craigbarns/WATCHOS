'use client'

import { useEffect } from 'react'
import { toast } from '@/components/ui/toast'
import { closePendingPeriods } from '@/app/actions/rapports'
import { closedSummary } from '@/components/rapports/close-pending-button'
import { parisDay } from '@/lib/format'

const KEY = 'hp:auto-close'
let started = false

/**
 * Clôtures obligatoires sans oubli : à la première ouverture de la journée, les
 * journées, mois et années terminés qui ne sont pas clôturés le sont automatiquement.
 */
export function AutoClose() {
  useEffect(() => {
    const today = parisDay()
    let done: string | null = null
    try {
      done = localStorage.getItem(KEY)
    } catch {
      // stockage indisponible : la vérification se fait à chaque ouverture
    }
    if (started || done === today) return
    started = true
    closePendingPeriods()
      .then((result) => {
        if (!result.success) return
        try {
          localStorage.setItem(KEY, today)
        } catch {}
        const summary = closedSummary(result.closed)
        if (summary) toast.add({ title: 'Clôtures automatiques', description: `Clôturé : ${summary}.`, type: 'success' })
      })
      .catch(() => {})
  }, [])

  return null
}
