import { FileText, LayoutDashboard, MonitorSmartphone, Package, Settings, Users, Wrench } from 'lucide-react'
import type { Role } from '@/lib/auth'

export type NavItem = { name: string; short: string; href: string; icon: typeof Settings; roles?: Role[] }

export const NAVIGATION: NavItem[] = [
  { name: 'Tableau de bord', short: 'Accueil', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Caisse', short: 'Caisse', href: '/caisse', icon: MonitorSmartphone, roles: ['ADMIN', 'VENDEUR'] },
  { name: 'Stock', short: 'Stock', href: '/stock', icon: Package },
  { name: 'Clients', short: 'Clients', href: '/clients', icon: Users },
  { name: 'SAV', short: 'SAV', href: '/sav', icon: Wrench },
  { name: 'Rapports', short: 'Rapports', href: '/rapports', icon: FileText, roles: ['ADMIN', 'VENDEUR'] },
  { name: 'Paramètres', short: 'Réglages', href: '/parametres', icon: Settings, roles: ['ADMIN'] },
]

export const navFor = (role: Role) => NAVIGATION.filter((item) => !item.roles || item.roles.includes(role))

export const isActive = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`)
