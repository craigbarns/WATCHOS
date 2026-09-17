'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Search, Plus, Phone, Mail } from 'lucide-react'
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
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-playfair text-2xl font-bold tracking-tight sm:text-3xl">Clients</h1>
          <p className="text-sm text-muted-foreground">{clients.length} client(s)</p>
        </div>
        <Button onClick={() => setDialogOpen(true)} className="h-10 sm:h-9">
          <Plus /> <span className="max-sm:hidden">Nouveau client</span>
          <span className="sm:hidden">Nouveau</span>
        </Button>
      </div>

      <Card className="gap-0 py-0">
        <CardHeader className="flex flex-row items-center gap-4 border-b py-3">
          <div className="relative flex-1">
            <Search className="absolute top-2 left-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Nom, email, téléphone, ville…"
              className="w-full max-w-md pl-8"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <ul className="divide-y md:hidden">
            {loading ? (
              <li className="py-10 text-center text-sm text-muted-foreground">Chargement des clients…</li>
            ) : filteredClients.length === 0 ? (
              <li className="py-10 text-center text-sm text-muted-foreground">Aucun client trouvé</li>
            ) : (
              filteredClients.map((client) => (
                <li key={client.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold">
                    {client.first_name[0]}
                    {client.last_name[0]}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">
                      {client.first_name} {client.last_name}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {[client.city, client.email].filter(Boolean).join(' · ') || '—'}
                    </div>
                  </div>
                  {client.phone && (
                    <a
                      href={`tel:${client.phone.replace(/\s/g, '')}`}
                      aria-label={`Appeler ${client.first_name} ${client.last_name}`}
                      className="flex size-10 items-center justify-center rounded-full border active:bg-muted"
                    >
                      <Phone className="size-4" />
                    </a>
                  )}
                  {client.email && (
                    <a
                      href={`mailto:${client.email}`}
                      aria-label={`Écrire à ${client.first_name} ${client.last_name}`}
                      className="flex size-10 items-center justify-center rounded-full border active:bg-muted"
                    >
                      <Mail className="size-4" />
                    </a>
                  )}
                </li>
              ))
            )}
          </ul>

          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Nom</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Téléphone</TableHead>
                  <TableHead>Ville</TableHead>
                  <TableHead className="pr-4">Client depuis</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center">Chargement des clients…</TableCell>
                  </TableRow>
                ) : filteredClients.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">Aucun client trouvé</TableCell>
                  </TableRow>
                ) : (
                  filteredClients.map((client) => (
                    <TableRow key={client.id}>
                      <TableCell className="pl-4 font-medium">
                        {client.first_name} {client.last_name}
                      </TableCell>
                      <TableCell>{client.email && <a href={`mailto:${client.email}`} className="hover:underline">{client.email}</a>}</TableCell>
                      <TableCell>{client.phone && <a href={`tel:${client.phone.replace(/\s/g, '')}`} className="hover:underline">{client.phone}</a>}</TableCell>
                      <TableCell>{client.city}</TableCell>
                      <TableCell className="pr-4">{new Date(client.created_at).toLocaleDateString('fr-FR')}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <CustomerFormDialog open={dialogOpen} onOpenChange={setDialogOpen} onCreated={fetchClients} />
    </div>
  )
}
