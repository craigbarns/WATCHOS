import { CaisseScreen } from '@/components/caisse/caisse-screen'
import { getCurrentProfile } from '@/lib/auth'
import { redirect } from 'next/navigation'

export default async function CaissePage() {
  const profile = await getCurrentProfile()
  if (!profile?.active || !['ADMIN', 'VENDEUR'].includes(profile.role)) redirect('/dashboard')
  return <CaisseScreen />
}
