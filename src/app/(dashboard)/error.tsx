'use client'

import { AlertCircle, RotateCw } from 'lucide-react'
import { EmptyState } from '@/components/shared/empty-state'
import { Button } from '@/components/ui/button'

export default function DashboardError({ retry }: { retry: () => void }) {
  return <div className="rounded-2xl border bg-card"><EmptyState icon={AlertCircle} title="Une interruption momentanée" description="Les données n’ont pas pu être chargées. Vérifiez votre connexion et réessayez."><Button onClick={retry}><RotateCw /> Réessayer</Button></EmptyState></div>
}
