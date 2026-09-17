'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard,
  MonitorSmartphone,
  Package,
  Users,
  Wrench,
  FileText,
  Settings
} from 'lucide-react'
import type { Role } from '@/lib/auth'

const navigation: Array<{ name: string; href: string; icon: typeof Settings; roles?: Role[] }> = [
  { name: 'Tableau de bord', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Caisse', href: '/caisse', icon: MonitorSmartphone, roles: ['ADMIN', 'VENDEUR'] },
  { name: 'Stock', href: '/stock', icon: Package },
  { name: 'Clients', href: '/clients', icon: Users },
  { name: 'SAV', href: '/sav', icon: Wrench },
  { name: 'Rapports', href: '/rapports', icon: FileText, roles: ['ADMIN', 'VENDEUR'] },
  { name: 'Paramètres', href: '/parametres', icon: Settings, roles: ['ADMIN'] },
]

export function Sidebar({ role }: { role: Role }) {
  const pathname = usePathname()

  return (
    <div className="flex h-full w-16 shrink-0 flex-col border-r bg-background lg:w-60">
      <div className="flex h-14 items-center justify-center border-b px-2">
        <span className="font-playfair text-xl font-bold tracking-tight lg:hidden">H&amp;P</span>
        <span className="hidden font-playfair text-xl font-bold tracking-tight lg:inline">Heure et Passion</span>
      </div>
      <nav className="flex-1 space-y-1 p-2">
        {navigation
          .filter((item) => !item.roles || item.roles.includes(role))
          .map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`)
            return (
              <Link
                key={item.name}
                href={item.href}
                title={item.name}
                className={cn(
                  'flex items-center justify-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors lg:justify-start',
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                )}
              >
                <item.icon className="h-4 w-4 shrink-0" />
                <span className="hidden lg:inline">{item.name}</span>
              </Link>
            )
          })}
      </nav>
      <div className="hidden border-t p-4 text-center text-xs text-muted-foreground lg:block">v1.1.0</div>
    </div>
  )
}
