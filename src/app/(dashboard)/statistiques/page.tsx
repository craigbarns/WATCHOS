import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireStaff } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { formatEuro, parisDay, parisDayStartISO } from '@/lib/format'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

type ServiceStat = { service_id: string; label: string; quantity: number; tickets: number; total_ht: number; total_ttc: number }

export default async function StatistiquesPage({ searchParams }: { searchParams: Promise<{ du?: string; au?: string }> }) {
  const guard = await requireStaff(['ADMIN', 'VENDEUR'])
  if (!guard.ok) redirect('/dashboard')
  const today = parisDay()
  const monthStart = `${today.slice(0, 8)}01`
  const params = await searchParams
  const start = params.du ?? monthStart
  const end = params.au ?? today
  let valid = true
  try { parisDayStartISO(start); parisDayStartISO(end); valid = start <= end } catch { valid = false }
  const supabase = await createClient()
  const result = valid ? await supabase.rpc('service_sales_stats', { p_start: start, p_end: end }) : null
  if (result?.error) throw new Error('Les statistiques ne peuvent pas être chargées.')
  const rows = (result?.data ?? []) as ServiceStat[]
  const quantity = rows.reduce((sum, r) => sum + Number(r.quantity), 0)
  const total = rows.reduce((sum, r) => sum + Number(r.total_ttc), 0)
  const totalHT = rows.reduce((sum, r) => sum + Number(r.total_ht), 0)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-playfair text-2xl font-bold sm:text-3xl">Ventes par poste</h1>
        <p className="mt-1 text-sm text-muted-foreground">Prestations encaissées, après remises. Dates incluses, heure de Paris.</p>
      </div>
      <form className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1.5"><label htmlFor="du" className="text-sm">Du</label><Input id="du" name="du" type="date" defaultValue={start} required /></div>
        <div className="grid gap-1.5"><label htmlFor="au" className="text-sm">Au</label><Input id="au" name="au" type="date" defaultValue={end} required /></div>
        <Button type="submit">Afficher</Button>
        <Link href={`/statistiques?du=${today}&au=${today}`} className="px-2 py-2 text-sm text-primary underline underline-offset-4">Aujourd’hui</Link>
        <Link href={`/statistiques?du=${monthStart}&au=${today}`} className="px-2 py-2 text-sm text-primary underline underline-offset-4">Ce mois</Link>
      </form>
      {!valid ? <p role="alert" className="text-destructive">Choisissez des dates valides, avec une date de début antérieure ou égale à la date de fin.</p> : <>
        <div className="grid gap-3 sm:grid-cols-3">
          {[['Prestations vendues', String(quantity)], ['Chiffre d’affaires TTC', formatEuro(total)], ['Montant moyen par prestation', formatEuro(quantity ? total / quantity : 0)]].map(([title, value]) => (
            <Card key={title}><CardHeader><CardTitle className="text-sm text-muted-foreground">{title}</CardTitle></CardHeader><CardContent className="text-2xl font-semibold tabular-nums">{value}</CardContent></Card>
          ))}
        </div>
        {quantity === 0 && <p className="text-sm text-muted-foreground">Aucune prestation encaissée sur cette période.</p>}
        <Card>
          <CardHeader><CardTitle>Détail des prestations</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow><TableHead className="pl-4">Poste</TableHead><TableHead className="text-right">Quantité</TableHead><TableHead className="text-right">Tickets</TableHead><TableHead className="text-right">CA HT</TableHead><TableHead className="text-right">CA TTC</TableHead><TableHead className="pr-4 text-right">Part du CA</TableHead></TableRow></TableHeader>
              <TableBody>
                {rows.map((r) => <TableRow key={r.service_id}>
                  <TableCell className="max-w-64 whitespace-normal pl-4 font-medium">{r.label}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.quantity}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.tickets}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatEuro(r.total_ht)}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{formatEuro(r.total_ttc)}</TableCell>
                  <TableCell className="pr-4 text-right tabular-nums">{(total ? Number(r.total_ttc) / total * 100 : 0).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %</TableCell>
                </TableRow>)}
                <TableRow className="bg-muted/50 font-semibold"><TableCell className="pl-4">Total</TableCell><TableCell className="text-right">{quantity}</TableCell><TableCell /><TableCell className="text-right">{formatEuro(totalHT)}</TableCell><TableCell className="text-right">{formatEuro(total)}</TableCell><TableCell /></TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <p className="text-xs text-muted-foreground">Un ticket peut contenir plusieurs postes. Les anciennes ventes d’articles restent consultables dans les rapports.</p>
      </>}
    </div>
  )
}
