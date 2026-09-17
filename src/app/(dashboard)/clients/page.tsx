'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Search, Plus } from 'lucide-react'
import { CustomerFormDialog } from '@/components/shared/customer-form-dialog'

type Customer = {
  id: string
  first_name: string
  last_name: string
  email: string | null
  phone: string | null
  city: string | null
  created_at: string
}

async function loadClients(): Promise<Customer[]> {
  const { data } = await createClient()
    .from('customers')
    .select('id, first_name, last_name, email, phone, city, created_at')
    .order('created_at', { ascending: false })
  return data ?? []
}

export default function ClientsPage() {
  const [search, setSearch] = useState('')
  const [clients, setClients] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)

  const fetchClients = useCallback(async () => {
    setClients(await loadClients())
    setLoading(false)
  }, [])

  useEffect(() => {
    let ignore = false
    loadClients().then((rows) => {
      if (ignore) return
      setClients(rows)
      setLoading(false)
    })
    return () => {
      ignore = true
    }
  }, [])

  const filteredClients = clients.filter(c => 
    `${c.first_name} ${c.last_name} ${c.email ?? ''} ${c.phone ?? ''} ${c.city ?? ''}`.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-playfair text-3xl font-bold tracking-tight">Clients</h1>
          <p className="text-sm text-muted-foreground">{clients.length} client(s)</p>
        </div>
        <Button onClick={() => setDialogOpen(true)} className="h-9">
          <Plus /> Nouveau client
        </Button>
      </div>

      <Card>
        <CardHeader className="py-3 flex flex-row items-center gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Rechercher par nom, email, téléphone..."
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
                <TableHead>Nom</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Téléphone</TableHead>
                <TableHead>Date création</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-8">Chargement des clients...</TableCell>
                </TableRow>
              ) : filteredClients.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">Aucun client trouvé</TableCell>
                </TableRow>
              ) : (
                filteredClients.map((client) => (
                  <TableRow key={client.id} className="cursor-pointer hover:bg-muted/50">
                    <TableCell className="font-medium">{client.first_name} {client.last_name}</TableCell>
                    <TableCell>{client.email}</TableCell>
                    <TableCell>{client.phone}</TableCell>
                    <TableCell>{new Date(client.created_at).toLocaleDateString('fr-FR')}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <CustomerFormDialog open={dialogOpen} onOpenChange={setDialogOpen} onCreated={fetchClients} />
    </div>
  )
}
