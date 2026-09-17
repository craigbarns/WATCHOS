import { redirect } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { createClient } from '@/lib/supabase/server'
import { getCurrentProfile } from '@/lib/auth'
import { SettingsForm } from '@/components/parametres/settings-form'
import { TeamTable, type TeamMember } from '@/components/parametres/team-table'
import { AddMemberButton } from '@/components/parametres/team-dialogs'
import { CardAction } from '@/components/ui/card'
import { createAdminClient, hasAdminKey, isArchivedUser } from '@/lib/supabase/admin'
import { TriangleAlert } from 'lucide-react'

export default async function ParametresPage() {
  const profile = await getCurrentProfile()
  if (profile?.role !== 'ADMIN') redirect('/dashboard')

  const supabase = await createClient()
  const [{ data: settings }, { data: members }] = await Promise.all([
    supabase.from('settings').select('store_name, company_name, address, siret, vat_number, phone, email').limit(1).maybeSingle(),
    supabase.from('profiles').select('id, full_name, role, active, created_at').order('active').order('created_at'),
  ])

  // Emails et dernières connexions : uniquement lisibles avec la clé de service (côté serveur)
  const canManageAccounts = hasAdminKey()
  const authUsers = new Map<string, { email: string | null; last_sign_in_at: string | null }>()
  const archivedIds = new Set<string>()
  if (canManageAccounts) {
    const { data } = await createAdminClient().auth.admin.listUsers({ perPage: 200 })
    for (const u of data?.users ?? []) {
      authUsers.set(u.id, { email: u.email ?? null, last_sign_in_at: u.last_sign_in_at ?? null })
      if (isArchivedUser(u)) archivedIds.add(u.id)
    }
  }
  const allMembers: TeamMember[] = (members ?? []).map((m) => ({
    ...(m as Omit<TeamMember, 'email' | 'last_sign_in_at'>),
    email: authUsers.get(m.id)?.email ?? (m.id === profile.id ? profile.email : null),
    last_sign_in_at: authUsers.get(m.id)?.last_sign_in_at ?? null,
  }))

  const team = allMembers.filter((m) => !archivedIds.has(m.id))
  const formerMembers = allMembers.filter((m) => archivedIds.has(m.id))
  const pendingCount = team.filter((m) => !m.active).length

  return (
    <div className="max-w-4xl space-y-6">
      <h1 className="font-playfair text-2xl font-bold tracking-tight sm:text-3xl">Paramètres</h1>

      <Card>
        <CardHeader>
          <CardTitle>Boutique</CardTitle>
          <CardDescription>Identité légale affichée sur les tickets et l&apos;archive fiscale.</CardDescription>
        </CardHeader>
        <CardContent>
          <SettingsForm
            initial={{
              store_name: settings?.store_name ?? '',
              company_name: settings?.company_name ?? '',
              address: settings?.address ?? '',
              siret: settings?.siret ?? '',
              vat_number: settings?.vat_number ?? '',
              phone: settings?.phone ?? '',
              email: settings?.email ?? '',
            }}
          />
        </CardContent>
      </Card>

      <Card className="gap-0 pb-0">
        <CardHeader className="pb-4">
          <CardTitle>Équipe</CardTitle>
          <CardDescription>
            {pendingCount > 0
              ? `${pendingCount} compte(s) suspendu(s) ou en attente.`
              : 'Créez ici les comptes de vos vendeurs et techniciens.'}
          </CardDescription>
          {canManageAccounts && (
            <CardAction>
              <AddMemberButton />
            </CardAction>
          )}
        </CardHeader>
        {!canManageAccounts && (
          <div className="mx-4 mb-4 flex gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <div>
              La création de comptes nécessite la variable <code className="font-mono">SUPABASE_SERVICE_ROLE_KEY</code> sur le
              serveur. Ajoutez-la dans Vercel → Settings → Environment Variables, puis redéployez.
            </div>
          </div>
        )}
        <CardContent className="border-t p-0">
          <TeamTable members={team} currentUserId={profile.id} canManageAccounts={canManageAccounts} />
          {formerMembers.length > 0 && (
            <details className="border-t px-4 py-3 text-sm">
              <summary className="cursor-pointer text-muted-foreground">Anciens membres ({formerMembers.length})</summary>
              <ul className="mt-2 space-y-1 text-muted-foreground">
                {formerMembers.map((m) => (
                  <li key={m.id}>
                    {m.full_name} · compte fermé, conservé pour l&apos;historique des ventes
                  </li>
                ))}
              </ul>
            </details>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
