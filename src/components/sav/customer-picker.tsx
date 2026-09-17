'use client'

import { useEffect, useState } from 'react'
import { User, UserPlus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CustomerFormDialog } from '@/components/shared/customer-form-dialog'
import { searchCustomers, type CustomerSummary } from '@/app/actions/caisse'

export function CustomerPicker({
  value,
  onChange,
}: {
  value: CustomerSummary | null
  onChange: (customer: CustomerSummary | null) => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<CustomerSummary[]>([])
  const [dialogOpen, setDialogOpen] = useState(false)

  useEffect(() => {
    if (!query.trim()) return
    let cancelled = false
    const t = setTimeout(() => {
      searchCustomers(query).then((r) => !cancelled && setResults(r))
    }, 200)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [query])

  if (value) {
    return (
      <div className="flex items-center gap-3 rounded-lg border p-2">
        <div className="flex size-8 items-center justify-center rounded-full bg-muted">
          <User className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">
            {value.first_name} {value.last_name}
          </div>
          <div className="truncate text-xs text-muted-foreground">{value.phone ?? value.email ?? '—'}</div>
        </div>
        <Button type="button" variant="ghost" size="icon-sm" onClick={() => onChange(null)} aria-label="Changer de client">
          <X />
        </Button>
      </div>
    )
  }

  return (
    <div className="relative">
      <Input placeholder="Nom, téléphone ou email du client…" value={query} onChange={(e) => setQuery(e.target.value)} />
      {query.trim() && (
        <div className="absolute inset-x-0 top-9 z-30 overflow-hidden rounded-lg border bg-popover shadow-lg">
          {results.map((c) => (
            <button
              key={c.id}
              type="button"
              className="block w-full px-3 py-2 text-left text-sm hover:bg-muted"
              onClick={() => {
                onChange(c)
                setQuery('')
              }}
            >
              <span className="font-medium">
                {c.first_name} {c.last_name}
              </span>
              <span className="ml-2 text-xs text-muted-foreground">{c.phone ?? c.email}</span>
            </button>
          ))}
          <button
            type="button"
            className="flex w-full items-center gap-2 border-t px-3 py-2 text-left text-sm font-medium hover:bg-muted"
            onClick={() => setDialogOpen(true)}
          >
            <UserPlus className="size-4" /> Créer « {query} »
          </button>
        </div>
      )}
      <CustomerFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        initialName={query}
        onCreated={(c) => {
          onChange(c)
          setQuery('')
        }}
      />
    </div>
  )
}
