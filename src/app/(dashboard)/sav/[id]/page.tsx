import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Box, Clock, Mail, Phone } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { createClient } from '@/lib/supabase/server'
import { SavStatusPanel } from '@/components/sav/sav-status-panel'
import { SavDetailsForm } from '@/components/sav/sav-details-form'
import { SavDepositSlipButton, type DepositSlipData } from '@/components/sav/sav-deposit-slip'
import { formatDate, formatDateTime, parisDay, SAV_CLOSED_STATUSES, SAV_STATUS } from '@/lib/format'
import { cn } from '@/lib/utils'

type SavCaseDetail = Omit<DepositSlipData, 'store'> & {
  id: string
  status: string
  diagnostic: string | null
  internal_notes: string | null
  technician_id: string | null
  return_date: string | null
  customer: DepositSlipData['customer'] & { id: string }
}

type SavEvent = { id: string; event_type: string; description: string | null; created_at: string; author: { full_name: string } | null }

const STEPS = ['RECU', 'DIAGNOSTIC', 'EN_REPARATION', 'CONTROLE', 'PRET', 'RESTITUE']

export default async function SavCasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()

  const supabase = await createClient()
  const [{ data: sav }, { data: events }, { data: team }, { data: store }] = await Promise.all([
    supabase
      .from('sav_cases')
      .select('*, customer:customers(id, civility, first_name, last_name, phone, email)')
      .eq('id', id)
      .maybeSingle(),
    supabase
      .from('sav_events')
      .select('id, event_type, description, created_at, author:profiles(full_name)')
      .eq('sav_case_id', id)
      .order('created_at', { ascending: false }),
    supabase.from('profiles').select('id, full_name, role').eq('active', true).order('full_name'),
    supabase.from('settings').select('store_name, company_name, address, phone, siret').limit(1).maybeSingle(),
  ])
  if (!sav) notFound()

  const c = sav as unknown as SavCaseDetail
  const timeline = (events ?? []) as unknown as SavEvent[]
  const technicians = [...(team ?? [])].sort((a, b) => Number(b.role === 'TECHNICIEN') - Number(a.role === 'TECHNICIEN'))
  const status = SAV_STATUS[c.status]
  const closed = SAV_CLOSED_STATUSES.includes(c.status)
  const late = !closed && c.estimated_date !== null && c.estimated_date < parisDay()

  // Progression simplifiée pour la frise : on rattache chaque statut à l'étape principale la plus proche
  const stepIndex = (() => {
    const map: Record<string, string> = {
      DEVIS_A_FAIRE: 'DIAGNOSTIC', ATTENTE_CLIENT: 'DIAGNOSTIC', ACCEPTE: 'DIAGNOSTIC', REFUSE: 'CONTROLE',
      ATTENTE_PIECE: 'EN_REPARATION', CLIENT_PREVENU: 'PRET', ANNULE: 'RESTITUE',
    }
    return STEPS.indexOf(map[c.status] ?? c.status)
  })()

  return (
    <div className="max-w-6xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/sav" className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" /> Dossiers SAV
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-mono text-2xl font-bold">{c.case_number}</h1>
            <span className={cn('rounded-full px-2.5 py-0.5 text-sm font-semibold', status?.className)}>{status?.label ?? c.status}</span>
            {late && (
              <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2.5 py-0.5 text-sm font-semibold text-destructive">
                <Clock className="size-3.5" /> En retard
              </span>
            )}
          </div>
          <p className="mt-1 font-playfair text-xl">
            {c.brand} {c.model}
          </p>
        </div>
        <SavDepositSlipButton data={{ ...c, store }} />
      </div>

      <ol className="grid grid-cols-6 gap-1">
        {STEPS.map((step, i) => (
          <li key={step} className="space-y-1.5">
            <div className={cn('h-1.5 rounded-full', c.status === 'ANNULE' ? 'bg-muted' : i <= stepIndex ? 'bg-primary' : 'bg-muted')} />
            <div className={cn('text-xs', i === stepIndex ? 'font-semibold' : 'text-muted-foreground')}>{SAV_STATUS[step].label}</div>
          </li>
        ))}
      </ol>

      <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-4">
          {!closed && (
            <Card>
              <CardHeader>
                <CardTitle>Faire avancer le dossier</CardTitle>
                <CardDescription>Chaque changement est horodaté dans l&apos;historique.</CardDescription>
              </CardHeader>
              <CardContent>
                <SavStatusPanel id={c.id} status={c.status} />
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Atelier</CardTitle>
            </CardHeader>
            <CardContent>
              <SavDetailsForm
                key={`${c.diagnostic}|${c.technician_id}|${c.estimated_date}|${c.internal_notes}`}
                id={c.id}
                technicians={technicians}
                initial={{
                  diagnostic: c.diagnostic ?? '',
                  technician_id: c.technician_id ?? '',
                  estimated_date: c.estimated_date ?? '',
                  internal_notes: c.internal_notes ?? '',
                }}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Historique</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="relative space-y-4 border-l pl-5">
                {timeline.map((e) => (
                  <li key={e.id} className="relative">
                    <span
                      className={cn(
                        'absolute top-1.5 -left-[25px] size-2.5 rounded-full border-2 border-background',
                        e.event_type === 'STATUS' || e.event_type === 'CREATION' ? 'bg-primary' : 'bg-muted-foreground/40'
                      )}
                    />
                    <div className="text-sm">{e.description}</div>
                    <div className="text-xs text-muted-foreground">
                      {formatDateTime(e.created_at)}
                      {e.author && ` · ${e.author.full_name}`}
                    </div>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Client</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="font-medium">
                {[c.customer?.civility, c.customer?.first_name, c.customer?.last_name].filter(Boolean).join(' ')}
              </div>
              {c.customer?.phone && (
                <a href={`tel:${c.customer.phone.replace(/\s/g, '')}`} className="flex items-center gap-2 hover:underline">
                  <Phone className="size-3.5 text-muted-foreground" /> {c.customer.phone}
                </a>
              )}
              {c.customer?.email && (
                <a href={`mailto:${c.customer.email}?subject=${encodeURIComponent(`Votre montre — dossier ${c.case_number}`)}`} className="flex items-center gap-2 hover:underline">
                  <Mail className="size-3.5 text-muted-foreground" /> {c.customer.email}
                </a>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Dépôt</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-3 text-sm">
                {(
                  [
                    ['Déposée le', formatDateTime(c.deposit_date)],
                    ['Restitution estimée', c.estimated_date ? formatDate(c.estimated_date) : null],
                    ['Restituée le', c.return_date ? formatDateTime(c.return_date) : null],
                    ['Référence', c.reference],
                    ['N° de série', c.serial_number],
                    ['Problème signalé', c.declared_problem],
                    ['État au dépôt', c.visual_condition],
                    ['Accessoires', c.accessories_left],
                  ] as Array<[string, string | null]>
                )
                  .filter(([, v]) => v)
                  .map(([label, value]) => (
                    <div key={label}>
                      <dt className="text-xs text-muted-foreground">{label}</dt>
                      <dd className="whitespace-pre-line">{value}</dd>
                    </div>
                  ))}
                {c.box_left && (
                  <div className="flex items-center gap-2">
                    <Box className="size-4 text-muted-foreground" /> Boîte laissée en boutique
                  </div>
                )}
              </dl>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
