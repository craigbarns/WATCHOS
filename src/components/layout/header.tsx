'use client'

import { createClient } from '@/lib/supabase/client'
import { usePathname, useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { LogOut } from 'lucide-react'
import type { Profile } from '@/lib/auth'
import { NAVIGATION, isActive } from '@/components/layout/nav-items'
import { ROLE_LABELS } from '@/lib/format'

export function Header({ profile }: { profile: Profile }) {
  const router = useRouter()
  const pathname = usePathname()
  const current = NAVIGATION.find((item) => isActive(pathname, item.href))

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
    <header className="workspace-header flex h-16 shrink-0 md:h-20 items-center justify-between gap-3 border-b bg-card/80 px-4 md:px-8 pt-[env(safe-area-inset-top)] backdrop-blur-lg [box-sizing:content-box]">
      <span className="font-playfair text-lg font-bold tracking-tight md:hidden">Heures et Passion</span>
      <div className="hidden md:block"><p className="text-sm font-medium">{current?.name ?? 'Votre boutique'}</p><span className="text-xs text-muted-foreground first-letter:uppercase">
        {new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Paris' })}
      </span></div>
      <div className="flex items-center gap-3">
        <div className="hidden text-right sm:block">
          <div className="text-sm leading-tight font-medium">{profile.full_name}</div>
          <div className="text-xs leading-tight text-muted-foreground">{ROLE_LABELS[profile.role]}</div>
        </div>
        <div className="flex size-8 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
          {initials}
        </div>
        <Button variant="ghost" size="icon" onClick={handleSignOut} title="Déconnexion" aria-label="Déconnexion" className="inline-flex">
          <LogOut className="h-5 w-5 text-destructive" />
        </Button>
      </div>
    </header>
  )
}
