'use client'

import { useState, useTransition } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createCustomer, type CustomerFormInput } from '@/app/actions/customers'
import type { CustomerSummary } from '@/app/actions/caisse'

const EMPTY: CustomerFormInput = {
  civility: '',
  first_name: '',
  last_name: '',
  phone: '',
  email: '',
  address: '',
  postal_code: '',
  city: '',
  internal_notes: '',
}

export function CustomerFormDialog({
  open,
  onOpenChange,
  onCreated,
  initialName = '',
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: (customer: CustomerSummary) => void
  initialName?: string
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {open && <CustomerForm initialName={initialName} onCreated={onCreated} onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

function initialValues(name: string): CustomerFormInput {
  const [first = '', ...rest] = name.trim().split(/\s+/)
  return { ...EMPTY, first_name: rest.length ? first : '', last_name: rest.length ? rest.join(' ') : first }
}

function CustomerForm({
  initialName,
  onCreated,
  onClose,
}: {
  initialName: string
  onCreated?: (customer: CustomerSummary) => void
  onClose: () => void
}) {
  const [values, setValues] = useState<CustomerFormInput>(() => initialValues(initialName))
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const set = (key: keyof CustomerFormInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setValues((v) => ({ ...v, [key]: e.target.value }))

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    startTransition(async () => {
      const result = await createCustomer(values)
      if (!result.success) {
        setError(result.error)
        return
      }
      onCreated?.(result.customer)
      onClose()
    })
  }

  return (
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle className="text-lg">Nouveau client</DialogTitle>
            <DialogDescription>Les champs marqués * sont obligatoires.</DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-[4.5rem_1fr] gap-3 sm:grid-cols-[5rem_1fr_1fr]">
            <div className="grid gap-1.5">
              <Label htmlFor="civility">Civilité</Label>
              <select
                id="civility"
                value={values.civility}
                onChange={(e) => setValues((v) => ({ ...v, civility: e.target.value }))}
                className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
              >
                <option value=""></option>
                <option value="M.">M.</option>
                <option value="Mme">Mme</option>
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="first_name">Prénom *</Label>
              <Input id="first_name" required autoFocus value={values.first_name} onChange={set('first_name')} />
            </div>
            <div className="grid gap-1.5 max-sm:col-span-2">
              <Label htmlFor="last_name">Nom *</Label>
              <Input id="last_name" required value={values.last_name} onChange={set('last_name')} />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="phone">Téléphone</Label>
              <Input id="phone" type="tel" value={values.phone} onChange={set('phone')} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={values.email} onChange={set('email')} />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="address">Adresse</Label>
            <Input id="address" value={values.address} onChange={set('address')} />
          </div>
          <div className="grid grid-cols-[7rem_1fr] gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="postal_code">Code postal</Label>
              <Input id="postal_code" value={values.postal_code} onChange={set('postal_code')} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="city">Ville</Label>
              <Input id="city" value={values.city} onChange={set('city')} />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="internal_notes">Notes internes</Label>
            <textarea
              id="internal_notes"
              rows={2}
              value={values.internal_notes}
              onChange={set('internal_notes')}
              placeholder="Préférences, collection, tour de poignet…"
              className="rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </div>

          {error && <p className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Annuler
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Enregistrement…' : 'Créer le client'}
            </Button>
          </DialogFooter>
        </form>
  )
}
