'use client'

import { useState, useTransition } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { CustomerPicker } from '@/components/sav/customer-picker'
import { createSavCase } from '@/app/actions/sav'
import type { CustomerSummary } from '@/app/actions/caisse'
import { cn } from '@/lib/utils'

export type Technician = { id: string; full_name: string }

const textareaClass =
  'rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50'
const selectClass = 'h-8 rounded-lg border border-input bg-transparent px-2 text-sm'

export function SavCreateDialog({
  open,
  onOpenChange,
  technicians,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  technicians: Technician[]
  onCreated: (id: string) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        {open && <SavCreateForm technicians={technicians} onCreated={onCreated} onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

function SavCreateForm({
  technicians,
  onCreated,
  onClose,
}: {
  technicians: Technician[]
  onCreated: (id: string) => void
  onClose: () => void
}) {
  const [customer, setCustomer] = useState<CustomerSummary | null>(null)
  const [values, setValues] = useState({
    brand: '',
    model: '',
    reference: '',
    serial_number: '',
    declared_problem: '',
    visual_condition: '',
    accessories_left: '',
    box_left: false,
    technician_id: '',
    estimated_date: '',
    internal_notes: '',
  })
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const set = (key: keyof typeof values) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setValues((v) => ({ ...v, [key]: e.target.value }))

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!customer) {
      setError('Sélectionnez ou créez le client.')
      return
    }
    startTransition(async () => {
      const result = await createSavCase({ ...values, customer_id: customer.id })
      if (!result.success) {
        setError(result.error)
        return
      }
      onClose()
      onCreated(result.id)
    })
  }

  return (
    <form onSubmit={submit} className="grid gap-5">
      <DialogHeader>
        <DialogTitle className="text-lg">Nouveau dossier SAV</DialogTitle>
        <DialogDescription>Dépôt d&apos;une montre en atelier. Un bon de dépôt pourra être imprimé pour le client.</DialogDescription>
      </DialogHeader>

      <Section title="Client">
        <CustomerPicker value={customer} onChange={setCustomer} />
      </Section>

      <Section title="Montre">
        <div className="grid grid-cols-2 gap-3">
          <Field id="brand" label="Marque *">
            <Input id="brand" required value={values.brand} onChange={set('brand')} placeholder="Omega" />
          </Field>
          <Field id="model" label="Modèle">
            <Input id="model" value={values.model} onChange={set('model')} placeholder="Seamaster 300M" />
          </Field>
          <Field id="reference" label="Référence">
            <Input id="reference" value={values.reference} onChange={set('reference')} />
          </Field>
          <Field id="serial_number" label="N° de série">
            <Input id="serial_number" value={values.serial_number} onChange={set('serial_number')} className="font-mono" />
          </Field>
        </div>
      </Section>

      <Section title="Dépôt">
        <Field id="declared_problem" label="Problème signalé par le client *">
          <textarea
            id="declared_problem"
            required
            rows={3}
            value={values.declared_problem}
            onChange={set('declared_problem')}
            placeholder="Retarde de 2 minutes par jour, couronne dure à visser…"
            className={textareaClass}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field id="visual_condition" label="État visuel au dépôt">
            <textarea
              id="visual_condition"
              rows={2}
              value={values.visual_condition}
              onChange={set('visual_condition')}
              placeholder="Rayures bracelet, verre intact…"
              className={textareaClass}
            />
          </Field>
          <Field id="accessories_left" label="Accessoires laissés">
            <textarea
              id="accessories_left"
              rows={2}
              value={values.accessories_left}
              onChange={set('accessories_left')}
              placeholder="Maillons supplémentaires, carte de garantie…"
              className={textareaClass}
            />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={values.box_left} onChange={(e) => setValues((v) => ({ ...v, box_left: e.target.checked }))} />
          Boîte laissée en boutique
        </label>
      </Section>

      <Section title="Atelier">
        <div className="grid grid-cols-2 gap-3">
          <Field id="technician_id" label="Technicien">
            <select id="technician_id" value={values.technician_id} onChange={set('technician_id')} className={selectClass}>
              <option value="">Non attribué</option>
              {technicians.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.full_name}
                </option>
              ))}
            </select>
          </Field>
          <Field id="estimated_date" label="Restitution estimée">
            <Input id="estimated_date" type="date" value={values.estimated_date} onChange={set('estimated_date')} />
          </Field>
        </div>
        <Field id="internal_notes" label="Notes internes (non imprimées)">
          <textarea id="internal_notes" rows={2} value={values.internal_notes} onChange={set('internal_notes')} className={textareaClass} />
        </Field>
      </Section>

      {error && <p className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">{error}</p>}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Annuler
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? 'Création…' : 'Créer le dossier'}
        </Button>
      </DialogFooter>
    </form>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="grid gap-3">
      <legend className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</legend>
      {children}
    </fieldset>
  )
}

function Field({ id, label, className, children }: { id: string; label: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn('grid gap-1.5', className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  )
}
