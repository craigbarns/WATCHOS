import { redirect } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { createClient } from '@/lib/supabase/server'
import { getCurrentProfile } from '@/lib/auth'
import { SettingsForm } from '@/components/parametres/settings-form'
import { TeamTable, type TeamMember } from '@/components/parametres/team-table'

export default async function ParametresPage() {
  const profile = await getCurrentProfile()
  if (profile?.role !== 'ADMIN') redirect('/dashboard')

  const supabase = await createClient()
  const [{ data: settings }, { data: members }] = await Promise.all([
    supabase.from('settings').select('store_name, company_name, address, siret, vat_number, phone, email').limit(1).maybeSingle(),
    supabase.from('profiles').select('id, full_name, role, active, created_at').order('active').order('created_at'),
  ])

  const pendingCount = (members ?? []).filter((m) => !m.active).length

  return (
    <div className="max-w-4xl space-y-6">
      <h1 className="font-playfair text-3xl font-bold tracking-tight">Paramètres</h1>

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
              ? `${pendingCount} compte(s) en attente de validation.`
              : 'Les nouveaux comptes doivent être activés ici avant de pouvoir utiliser la caisse.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="border-t p-0">
          <TeamTable members={(members ?? []) as TeamMember[]} currentUserId={profile.id} />
        </CardContent>
      </Card>
    </div>
  )
}
