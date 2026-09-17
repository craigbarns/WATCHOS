'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Search, Plus, AlertTriangle } from 'lucide-react'
import { SavCreateDialog, type Technician } from '@/components/sav/sav-create-dialog'
import { formatDate, parisDay, SAV_CLOSED_STATUSES, SAV_STATUS } from '@/lib/format'
import { cn } from '@/lib/utils'

type SavCase = {
  id: string
  case_number: string
  brand: string | null
  model: string | null
  serial_number: string | null
  status: string
  deposit_date: string
  estimated_date: string | null
  customer: { first_name: string; last_name: string; phone: string | null } | null
  technician: { full_name: string } | null
}

const FILTERS = [
  { value: 'OPEN', label: 'En cours' },
  { value: 'READY', label: 'Prêts' },
  { value: 'CLOSED', label: 'Clôturés' },
  { value: 'ALL', label: 'Tous' },
] as const

async function loadSav() {
  const supabase = createClient()
  const [{ data: cases }, { data: technicians }] = await Promise.all([
    supabase
      .from('sav_cases')
      .select('id, case_number, brand, model, serial_number, status, deposit_date, estimated_date, customer:customers(first_name, last_name, phone), technician:profiles(full_name)')
      .order('created_at', { ascending: false }),
    supabase.from('profiles').select('id, full_name, role').eq('active', true).order('full_name'),
  ])
  return {
    cases: (cases ?? []) as unknown as SavCase[],
    // Techniciens en premier, puis le reste de l'équipe (petites boutiques : le gérant répare aussi)
    technicians: [...(technicians ?? [])].sort((a, b) => Number(b.role === 'TECHNICIEN') - Number(a.role === 'TECHNICIEN')) as Technician[],
  }
}

export default function SavPage() {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['value']>('OPEN')
  const [cases, setCases] = useState<SavCase[]>([])
  const [technicians, setTechnicians] = useState<Technician[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)

  useEffect(() => {
    let ignore = false
    loadSav().then((data) => {
      if (ignore) return
      setCases(data.cases)
      setTechnicians(data.technicians)
      setLoading(false)
    })
    return () => {
      ignore = true
    }
  }, [])

  const today = parisDay()

  const counts = useMemo(
    () => ({
      OPEN: cases.filter((c) => !SAV_CLOSED_STATUSES.includes(c.status)).length,
      READY: cases.filter((c) => ['PRET', 'CLIENT_PREVENU'].includes(c.status)).length,
      CLOSED: cases.filter((c) => SAV_CLOSED_STATUSES.includes(c.status)).length,
      ALL: cases.length,
    }),
    [cases]
  )

  const filteredCases = useMemo(() => {
    const term = search.toLowerCase()
    return cases.filter((c) => {
      const matchesFilter =
        filter === 'ALL' ||
        (filter === 'OPEN' && !SAV_CLOSED_STATUSES.includes(c.status)) ||
        (filter === 'READY' && ['PRET', 'CLIENT_PREVENU'].includes(c.status)) ||
        (filter === 'CLOSED' && SAV_CLOSED_STATUSES.includes(c.status))
      const haystack = `${c.case_number} ${c.brand} ${c.model} ${c.serial_number} ${c.customer?.first_name} ${c.customer?.last_name} ${c.customer?.phone}`
      return matchesFilter && haystack.toLowerCase().includes(term)
    })
  }, [cases, search, filter])

  const openCase = useCallback((id: string) => router.push(`/sav/${id}`), [router])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-playfair text-2xl font-bold tracking-tight sm:text-3xl">Service après-vente</h1>
          <p className="text-sm text-muted-foreground">
            {counts.OPEN} dossier(s) en cours · {counts.READY} prêt(s) à restituer
          </p>
        </div>
        <Button onClick={() => setDialogOpen(true)} className="h-10 sm:h-9">
          <Plus /> <span className="max-sm:hidden">Nouveau dossier SAV</span><span className="sm:hidden">Nouveau</span>
        </Button>
      </div>

      <Card className="gap-0 py-0">
        <CardHeader className="flex flex-row flex-wrap items-center gap-3 border-b py-3">
          <div className="relative w-full min-w-0 flex-1 sm:min-w-60">
            <Search className="absolute top-2 left-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="N° dossier, client, téléphone, marque, n° de série…"
              className="w-full max-w-md pl-8"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="scrollbar-none -mx-4 flex w-[calc(100%+2rem)] overflow-x-auto px-4 sm:mx-0 sm:w-auto sm:px-0"><div className="flex shrink-0 rounded-lg bg-muted p-0.5">
            {FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => setFilter(f.value)}
                className={cn('rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap sm:py-1', filter === f.value ? 'bg-background shadow-sm' : 'text-muted-foreground')}
              >
                {f.label} <span className="text-xs opacity-60">{counts[f.value]}</span>
              </button>
            ))}
          </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <ul className="divide-y md:hidden">
            {loading ? (
              <li className="py-10 text-center text-sm text-muted-foreground">Chargement des dossiers…</li>
            ) : filteredCases.length === 0 ? (
              <li className="px-4 py-10 text-center text-sm text-muted-foreground">
                {cases.length === 0 ? 'Aucun dossier SAV. Créez le premier avec « Nouveau ».' : 'Aucun dossier trouvé'}
              </li>
            ) : (
              filteredCases.map((sav) => {
                const late = sav.estimated_date && sav.estimated_date < today && !SAV_CLOSED_STATUSES.includes(sav.status)
                return (
                  <li key={sav.id}>
                    <button type="button" onClick={() => openCase(sav.id)} className="w-full px-4 py-3 text-left active:bg-muted">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-sm font-medium">{sav.case_number}</span>
                        <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap', SAV_STATUS[sav.status]?.className)}>
                          {SAV_STATUS[sav.status]?.label ?? sav.status}
                        </span>
                      </div>
                      <div className="mt-0.5 truncate font-medium">
                        {sav.brand} {sav.model}
                      </div>
                      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                        <span className="truncate">
                          {sav.customer?.first_name} {sav.customer?.last_name} · déposée le {formatDate(sav.deposit_date)}
                        </span>
                        {sav.estimated_date && (
                          <span className={cn('inline-flex shrink-0 items-center gap-1', late && 'font-semibold text-destructive')}>
                            {late && <AlertTriangle className="size-3" />}
                            {formatDate(sav.estimated_date)}
                          </span>
                        )}
                      </div>
                    </button>
                  </li>
                )
              })
            )}
          </ul>

          <div className="hidden md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">N° dossier</TableHead>
                <TableHead>Dépôt</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Montre</TableHead>
                <TableHead>Technicien</TableHead>
                <TableHead>Prévu le</TableHead>
                <TableHead className="pr-4">Statut</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">Chargement des dossiers…</TableCell>
                </TableRow>
              ) : filteredCases.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                    {cases.length === 0 ? 'Aucun dossier SAV. Créez le premier avec « Nouveau dossier SAV ».' : 'Aucun dossier trouvé'}
                  </TableCell>
                </TableRow>
              ) : (
                filteredCases.map((sav) => {
                  const late = sav.estimated_date && sav.estimated_date < today && !SAV_CLOSED_STATUSES.includes(sav.status)
                  return (
                    <TableRow key={sav.id} className="cursor-pointer" onClick={() => openCase(sav.id)}>
                      <TableCell className="pl-4 font-mono font-medium">{sav.case_number}</TableCell>
                      <TableCell>{formatDate(sav.deposit_date)}</TableCell>
                      <TableCell>
                        <div>
                          {sav.customer?.first_name} {sav.customer?.last_name}
                        </div>
                        <div className="text-xs text-muted-foreground">{sav.customer?.phone}</div>
                      </TableCell>
                      <TableCell>
                        <div>
                          {sav.brand} {sav.model}
                        </div>
                        {sav.serial_number && <div className="font-mono text-xs text-muted-foreground">{sav.serial_number}</div>}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{sav.technician?.full_name ?? '—'}</TableCell>
                      <TableCell className={cn(late && 'font-medium text-destructive')}>
                        {sav.estimated_date ? (
                          <span className="inline-flex items-center gap-1">
                            {late && <AlertTriangle className="size-3.5" />}
                            {formatDate(sav.estimated_date)}
                          </span>
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      <TableCell className="pr-4">
                        <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap', SAV_STATUS[sav.status]?.className)}>
                          {SAV_STATUS[sav.status]?.label ?? sav.status}
                        </span>
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
          </div>
        </CardContent>
      </Card>

      <SavCreateDialog open={dialogOpen} onOpenChange={setDialogOpen} technicians={technicians} onCreated={openCase} />
    </div>
  )
}
