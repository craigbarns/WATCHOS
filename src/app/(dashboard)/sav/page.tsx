'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Search, Plus } from 'lucide-react'
import { SAV_STATUS } from '@/lib/format'
import { cn } from '@/lib/utils'

type SavCase = {
  id: string
  case_number: string
  brand: string | null
  model: string | null
  status: string
  created_at: string
  customer: { first_name: string; last_name: string } | null
}

export default function SavPage() {
  const [search, setSearch] = useState('')
  const [cases, setCases] = useState<SavCase[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchCases() {
      const { data } = await createClient()
        .from('sav_cases')
        .select(`
          *,
          customer:customers(first_name, last_name)
        `)
        .order('created_at', { ascending: false })
      
      setCases((data ?? []) as unknown as SavCase[])
      setLoading(false)
    }
    fetchCases()
  }, [])

  const filteredCases = cases.filter(c => 
    `${c.case_number} ${c.brand} ${c.model} ${c.customer?.first_name} ${c.customer?.last_name}`.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-playfair text-3xl font-bold tracking-tight">Service après-vente</h1>
        <Button disabled title="Prochaine étape : création et suivi des dossiers SAV" className="h-9">
          <Plus /> Créer un dossier SAV
        </Button>
      </div>

      <Card>
        <CardHeader className="py-3 flex flex-row items-center gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="N° SAV, Client, Marque, N° de série..."
              className="pl-8 w-full max-w-md"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>N° Dossier</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Montre</TableHead>
                <TableHead>Statut</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8">Chargement des dossiers...</TableCell>
                </TableRow>
              ) : filteredCases.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Aucun dossier trouvé</TableCell>
                </TableRow>
              ) : (
                filteredCases.map((sav) => (
                  <TableRow key={sav.id} className="cursor-pointer hover:bg-muted/50">
                    <TableCell className="font-medium font-mono">{sav.case_number}</TableCell>
                    <TableCell>{new Date(sav.created_at).toLocaleDateString('fr-FR')}</TableCell>
                    <TableCell>{sav.customer?.first_name} {sav.customer?.last_name}</TableCell>
                    <TableCell>{sav.brand} {sav.model}</TableCell>
                    <TableCell>
                      <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold', SAV_STATUS[sav.status]?.className)}>
                        {SAV_STATUS[sav.status]?.label ?? sav.status}
                      </span>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
