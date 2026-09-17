'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import type { Role } from '@/lib/auth'
import { isActive, navFor } from '@/components/layout/nav-items'

/** Navigation latérale (tablette et ordinateur). Sur mobile : MobileNav. */
export function Sidebar({ role }: { role: Role }) {
  const pathname = usePathname()

  return (
    <div className="hidden h-full w-16 shrink-0 flex-col border-r bg-background md:flex lg:w-60">
      <div className="flex h-14 items-center justify-center border-b px-2">
        <span className="font-playfair text-xl font-bold tracking-tight lg:hidden">H&amp;P</span>
        <span className="hidden font-playfair text-xl font-bold tracking-tight lg:inline">Heure et Passion</span>
      </div>
      <nav className="flex-1 space-y-1 p-2">
        {navFor(role).map((item) => (
          <Link
            key={item.href}
            href={item.href}
            title={item.name}
            className={cn(
              'flex items-center justify-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors lg:justify-start',
              isActive(pathname, item.href) ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
          >
            <item.icon className="h-4 w-4 shrink-0" />
            <span className="hidden lg:inline">{item.name}</span>
          </Link>
        ))}
      </nav>
      <div className="hidden border-t p-4 text-center text-xs text-muted-foreground lg:block">v1.1.0</div>
    </div>
  )
}
