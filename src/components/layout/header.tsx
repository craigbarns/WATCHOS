'use client'

import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { LogOut } from 'lucide-react'
import type { Profile } from '@/lib/auth'
import { ROLE_LABELS } from '@/lib/format'

export function Header({ profile }: { profile: Profile }) {
  const router = useRouter()

  const handleSignOut = async () => {
    await createClient().auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const initials = profile.full_name
    .split(/[\s._-]+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b bg-background/90 px-4 pt-[env(safe-area-inset-top)] backdrop-blur-lg [box-sizing:content-box]">
      <span className="font-playfair text-lg font-bold tracking-tight md:hidden">Heure et Passion</span>
      <span className="hidden text-sm font-medium text-muted-foreground first-letter:uppercase md:inline">
        {new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Paris' })}
      </span>
      <div className="flex items-center gap-3">
        <div className="hidden text-right sm:block">
          <div className="text-sm leading-tight font-medium">{profile.full_name}</div>
          <div className="text-xs leading-tight text-muted-foreground">{ROLE_LABELS[profile.role]}</div>
        </div>
        <div className="flex size-8 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
          {initials}
        </div>
        <Button variant="ghost" size="icon" onClick={handleSignOut} title="Déconnexion" className="hidden md:inline-flex">
          <LogOut className="h-5 w-5 text-destructive" />
        </Button>
      </div>
    </header>
  )
}
