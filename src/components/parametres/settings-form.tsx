'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { saveSettings } from '@/app/actions/parametres'
import { toast } from '@/components/ui/toast'

export type StoreSettings = {
  store_name: string
  company_name: string
  address: string
  siret: string
  vat_number: string
  phone: string
  email: string
}

const FIELDS: Array<{ key: keyof StoreSettings; label: string; placeholder?: string; wide?: boolean }> = [
  { key: 'store_name', label: 'Nom de la boutique *', placeholder: 'Heure et Passion' },
  { key: 'company_name', label: 'Raison sociale', placeholder: 'Heure et Passion SAS' },
  { key: 'address', label: 'Adresse', placeholder: '12 rue de la Paix, 75002 Paris', wide: true },
  { key: 'siret', label: 'SIRET', placeholder: '14 chiffres' },
  { key: 'vat_number', label: 'N° TVA intracommunautaire', placeholder: 'FR…' },
  { key: 'phone', label: 'Téléphone' },
  { key: 'email', label: 'Email' },
]

export function SettingsForm({ initial }: { initial: StoreSettings }) {
  const [values, setValues] = useState(initial)
  const [pending, startTransition] = useTransition()

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    startTransition(async () => {
      const result = await saveSettings(values)
      if (result.success) toast.add({ title: 'Paramètres enregistrés', type: 'success' })
      else toast.add({ title: 'Erreur', description: result.error, type: 'error' })
    })
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {FIELDS.map((f) => (
          <div key={f.key} className={f.wide ? 'grid gap-1.5 sm:col-span-2' : 'grid gap-1.5'}>
            <Label htmlFor={f.key}>{f.label}</Label>
            <Input
              id={f.key}
              required={f.key === 'store_name'}
              placeholder={f.placeholder}
              value={values[f.key]}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
            />
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">Ces informations apparaissent sur les tickets de caisse (mentions obligatoires).</p>
      <div>
        <Button type="submit" disabled={pending} className="h-9">
          {pending ? 'Enregistrement…' : 'Enregistrer'}
        </Button>
      </div>
    </form>
  )
}
