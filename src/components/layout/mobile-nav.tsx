'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { LogOut, MoreHorizontal } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { createClient } from '@/lib/supabase/client'
import type { Profile } from '@/lib/auth'
import { ROLE_LABELS } from '@/lib/format'
import { cn } from '@/lib/utils'
import { isActive, navFor } from '@/components/layout/nav-items'

const PRIMARY = ['/dashboard', '/caisse', '/stock', '/sav']

/** Barre d'onglets en bas d'écran sur téléphone, avec un menu « Plus » pour le reste. */
export function MobileNav({ profile }: { profile: Profile }) {
  const pathname = usePathname()
  const router = useRouter()
  const [moreOpen, setMoreOpen] = useState(false)

  const items = navFor(profile.role)
  const primary = items.filter((i) => PRIMARY.includes(i.href))
  const secondary = items.filter((i) => !PRIMARY.includes(i.href))
  const moreActive = secondary.some((i) => isActive(pathname, i.href))

  const signOut = async () => {
    await createClient().auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const tab = 'flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium transition-colors active:scale-95'

  return (
    <>
      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-lg md:hidden print:hidden"
        aria-label="Navigation principale"
      >
        <div className="flex">
          {primary.map((item) => {
            const active = isActive(pathname, item.href)
            return (
              <Link key={item.href} href={item.href} className={cn(tab, active ? 'text-foreground' : 'text-muted-foreground')}>
                <span className={cn('flex h-7 w-12 items-center justify-center rounded-full transition-colors', active && 'bg-primary text-primary-foreground')}>
                  <item.icon className="size-[18px]" />
                </span>
                {item.short}
              </Link>
            )
          })}
          <button type="button" onClick={() => setMoreOpen(true)} className={cn(tab, moreActive ? 'text-foreground' : 'text-muted-foreground')}>
            <span className={cn('flex h-7 w-12 items-center justify-center rounded-full', moreActive && 'bg-primary text-primary-foreground')}>
              <MoreHorizontal className="size-[18px]" />
            </span>
            Plus
          </button>
        </div>
      </nav>

      <Dialog open={moreOpen} onOpenChange={setMoreOpen}>
        <DialogContent
          showCloseButton={false}
          className="top-auto bottom-0 left-0 max-w-full translate-x-0 translate-y-0 rounded-b-none p-0 pb-[env(safe-area-inset-bottom)] sm:max-w-full data-open:slide-in-from-bottom data-closed:slide-out-to-bottom data-open:zoom-in-100 data-closed:zoom-out-100"
        >
          <DialogTitle className="sr-only">Menu</DialogTitle>
          <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-muted-foreground/30" />
          <div className="flex items-center gap-3 border-b px-5 py-4">
            <div className="flex size-10 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
              {profile.full_name.slice(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="truncate font-medium">{profile.full_name}</div>
              <div className="truncate text-xs text-muted-foreground">
                {ROLE_LABELS[profile.role]} · {profile.email}
              </div>
            </div>
          </div>
          <div className="grid gap-1 p-3">
            {secondary.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMoreOpen(false)}
                className={cn(
                  'flex items-center gap-3 rounded-xl px-3 py-3.5 text-base font-medium',
                  isActive(pathname, item.href) ? 'bg-muted' : 'active:bg-muted'
                )}
              >
                <item.icon className="size-5 text-muted-foreground" />
                {item.name}
              </Link>
            ))}
            <button type="button" onClick={signOut} className="flex items-center gap-3 rounded-xl px-3 py-3.5 text-base font-medium text-destructive active:bg-muted">
              <LogOut className="size-5" /> Déconnexion
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
