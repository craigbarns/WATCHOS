'use client'

import { AlertCircle, RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function LoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm">
      <AlertCircle className="size-5 shrink-0 text-destructive" />
      <div className="min-w-0 flex-1"><p className="font-medium">Impossible de charger les données</p><p className="text-muted-foreground">Vérifiez votre connexion, puis réessayez.</p></div>
      <Button variant="outline" size="sm" onClick={onRetry}><RotateCw /> Réessayer</Button>
    </div>
  )
}
