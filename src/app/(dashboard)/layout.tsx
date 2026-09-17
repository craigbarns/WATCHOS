import { redirect } from 'next/navigation'
import { Clock } from 'lucide-react'
import { Sidebar } from '@/components/layout/sidebar'
import { Header } from '@/components/layout/header'
import { MobileNav } from '@/components/layout/mobile-nav'
import { Toaster } from '@/components/ui/toast'
import { getCurrentProfile } from '@/lib/auth'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')

  if (!profile.active) {
    return (
      <div className="flex min-h-screen flex-col bg-muted/40">
        <Header profile={profile} />
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="max-w-sm space-y-3 text-center">
            <Clock className="mx-auto size-10 text-muted-foreground" />
            <h1 className="font-playfair text-2xl font-bold">Compte en attente</h1>
            <p className="text-sm text-muted-foreground">
              Votre compte <strong>{profile.email}</strong> a bien été créé. Un administrateur doit l&apos;activer depuis
              Paramètres → Équipe avant que vous puissiez accéder à la caisse.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <Toaster>
      <a href="#main-content" className="workspace-skip sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-white focus:p-3">Aller au contenu</a>
      <div className="flex h-dvh overflow-hidden bg-background">
        <Sidebar role={profile.role} />
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <Header profile={profile} />
          <main id="main-content" className="flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-3 pt-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))] sm:px-5 md:p-7 lg:px-8">
            {children}
          </main>
        </div>
        <MobileNav profile={profile} />
      </div>
    </Toaster>
  )
}
