'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ArrowUpRight, Watch } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Role } from '@/lib/auth'
import { isActive, navFor } from '@/components/layout/nav-items'

export function Sidebar({ role }: { role: Role }) {
  const pathname = usePathname()
  return (
    <aside className="workspace-sidebar hidden h-full w-20 shrink-0 flex-col overflow-y-auto overscroll-contain bg-[#183b32] text-white md:flex lg:w-64">
      <Link href="/dashboard" aria-label="Heures et Passion — accueil" className="flex h-24 items-center justify-center gap-3 border-b border-white/10 px-5 lg:justify-start">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full border border-[#c6b786]/50 text-[#d4c697]"><Watch className="size-5" strokeWidth={1.3} /></span>
        <span className="hidden lg:block"><span className="block font-playfair text-lg">Heures et Passion</span><span className="mt-1 block text-[9px] tracking-[.24em] text-white/50 uppercase">L’espace boutique</span></span>
      </Link>
      <nav aria-label="Navigation principale" className="flex-1 space-y-1.5 px-3 py-7">
        <p className="mb-4 hidden px-3 text-[10px] tracking-[.18em] text-white/40 uppercase lg:block">Votre quotidien</p>
        {navFor(role).map((item) => {
          const active = isActive(pathname, item.href)
          return <Link key={item.href} href={item.href} title={item.name} aria-current={active ? 'page' : undefined} className={cn('group flex items-center justify-center gap-3 rounded-xl px-3 py-3 text-sm transition-colors lg:justify-start', active ? 'bg-[#e9eddf] font-semibold text-[#183b32] shadow-sm' : 'text-white/65 hover:bg-white/10 hover:text-white')}>
            <item.icon className="size-[18px] shrink-0" strokeWidth={1.6} /><span className="hidden lg:inline">{item.name}</span>
            {active && <span className="ml-auto hidden size-1.5 rounded-full bg-[#58765c] lg:block" />}
          </Link>
        })}
      </nav>
      <div className="mx-5 mb-6 hidden rounded-2xl border border-white/10 p-4 lg:block">
        <p className="font-playfair text-base text-[#e3d6ad]">Le sens du détail.</p>
        <p className="mt-2 text-xs leading-relaxed text-white/50">Chaque geste, chaque client,<br />chaque instant compte.</p>
        <Link href="/sav" className="mt-4 inline-flex items-center gap-2 text-xs text-white/80 hover:text-white">Voir les dossiers SAV <ArrowUpRight className="size-3.5" /></Link>
      </div>
    </aside>
  )
}
