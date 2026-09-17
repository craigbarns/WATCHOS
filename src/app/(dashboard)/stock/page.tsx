import { getCurrentProfile } from '@/lib/auth'
import { StockScreen } from '@/components/stock/stock-screen'

export default async function StockPage({ searchParams }: { searchParams: Promise<{ ajouter?: string }> }) {
  const profile = await getCurrentProfile()
  const params = await searchParams
  return <StockScreen initialDialogOpen={params.ajouter === '1'} canManage={!!profile?.active && ['ADMIN', 'VENDEUR'].includes(profile.role)} />
}
