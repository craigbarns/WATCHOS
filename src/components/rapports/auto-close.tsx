'use client'

import { useEffect } from 'react'
import { toast } from '@/components/ui/toast'
import { closePendingDays } from '@/app/actions/rapports'
import { parisDay } from '@/lib/format'

const KEY = 'hp:auto-close'
let started = false

/**
 * Pas de Z oublié : à la première ouverture de la journée, les journées terminées
 * qui ont des ventes mais pas de clôture sont clôturées automatiquement.
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
    closePendingDays()
      .then((result) => {
        if (!result.success) return
        try {
          localStorage.setItem(KEY, today)
        } catch {}
        if (result.closed) toast.add({ title: 'Clôtures automatiques', description: `${result.closed} journée(s) clôturée(s) (Z).`, type: 'success' })
      })
      .catch(() => {})
  }, [])

  return null
}
