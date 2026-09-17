'use client'

import { useState, useTransition } from 'react'
import { Check, Copy, Eye, EyeOff, KeyRound, RefreshCw, UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createStaffMember, resetStaffPassword } from '@/app/actions/parametres'
import { toast } from '@/components/ui/toast'
import { ROLE_LABELS } from '@/lib/format'
import type { Role } from '@/lib/auth'

/** Mot de passe lisible (sans caractères ambigus), à transmettre au collaborateur. */
function generatePassword() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  const bytes = crypto.getRandomValues(new Uint32Array(12))
  const raw = Array.from(bytes, (b) => chars[b % chars.length]).join('')
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}`
}

function PasswordField({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  const [visible, setVisible] = useState(true)
  return (
    <div className="flex gap-2">
      <div className="relative flex-1">
        <Input
          id={id}
          type={visible ? 'text' : 'password'}
          autoComplete="new-password"
          required
          minLength={8}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="pr-9 font-mono"
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground"
          aria-label={visible ? 'Masquer' : 'Afficher'}
        >
          {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
      <Button type="button" variant="outline" size="icon" onClick={() => onChange(generatePassword())} title="Générer un mot de passe">
        <RefreshCw />
      </Button>
    </div>
  )
}

function CredentialsSummary({ email, password, onDone }: { email: string; password: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false)
  const text = `Accès caisse Heure et Passion\nAdresse : ${window.location.origin}\nEmail : ${email}\nMot de passe : ${password}`
  return (
    <div className="grid gap-4">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2 text-lg">
          <Check className="size-5 text-emerald-600" /> Compte créé
        </DialogTitle>
        <DialogDescription>Transmettez ces identifiants au collaborateur. Le mot de passe ne sera plus affiché ensuite.</DialogDescription>
      </DialogHeader>
      <pre className="rounded-lg bg-muted p-3 font-mono text-sm whitespace-pre-wrap">{text}</pre>
      <DialogFooter>
        <Button
          variant="outline"
          onClick={async () => {
            await navigator.clipboard.writeText(text)
            setCopied(true)
          }}
        >
          {copied ? <Check /> : <Copy />} {copied ? 'Copié' : 'Copier'}
        </Button>
        <Button onClick={onDone}>Terminé</Button>
      </DialogFooter>
    </div>
  )
}

export function AddMemberButton() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button onClick={() => setOpen(true)} className="h-9">
        <UserPlus /> Ajouter un membre
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">{open && <AddMemberForm onClose={() => setOpen(false)} />}</DialogContent>
      </Dialog>
    </>
  )
}

function AddMemberForm({ onClose }: { onClose: () => void }) {
  const [values, setValues] = useState({ full_name: '', email: '', role: 'VENDEUR' as Role, password: generatePassword() })
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  if (created) return <CredentialsSummary email={created.email} password={created.password} onDone={onClose} />

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const result = await createStaffMember(values)
      if (!result.success) {
        setError(result.error)
        return
      }
      toast.add({ title: `${values.full_name} peut se connecter`, type: 'success' })
      setCreated({ email: values.email.trim().toLowerCase(), password: values.password })
    })
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle className="text-lg">Nouveau membre de l&apos;équipe</DialogTitle>
        <DialogDescription>Le compte est actif immédiatement, sans email de confirmation.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-1.5">
        <Label htmlFor="member-name">Nom *</Label>
        <Input id="member-name" required autoFocus value={values.full_name} onChange={(e) => setValues((v) => ({ ...v, full_name: e.target.value }))} placeholder="Sophie Martin" />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="member-email">Email de connexion *</Label>
        <Input
          id="member-email"
          type="email"
          inputMode="email"
          autoCapitalize="none"
          required
          value={values.email}
          onChange={(e) => setValues((v) => ({ ...v, email: e.target.value }))}
          placeholder="sophie@boutique.fr"
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="member-role">Rôle</Label>
        <select
          id="member-role"
          value={values.role}
          onChange={(e) => setValues((v) => ({ ...v, role: e.target.value as Role }))}
          className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
        >
          {Object.entries(ROLE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <span className="text-xs text-muted-foreground">
          Vendeur : caisse, stock, clients, SAV, rapports · Technicien : SAV et consultation · Administrateur : tout.
        </span>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="member-password">Mot de passe provisoire *</Label>
        <PasswordField id="member-password" value={values.password} onChange={(password) => setValues((v) => ({ ...v, password }))} />
      </div>
      {error && <p className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">{error}</p>}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Annuler
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? 'Création…' : 'Créer le compte'}
        </Button>
      </DialogFooter>
    </form>
  )
}

export function ResetPasswordButton({ memberId, name, email }: { memberId: string; name: string; email: string | null }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant="ghost" size="icon-sm" onClick={() => setOpen(true)} title="Nouveau mot de passe" aria-label={`Nouveau mot de passe pour ${name}`}>
        <KeyRound />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          {open && <ResetPasswordForm memberId={memberId} name={name} email={email} onClose={() => setOpen(false)} />}
        </DialogContent>
      </Dialog>
    </>
  )
}

function ResetPasswordForm({ memberId, name, email, onClose }: { memberId: string; name: string; email: string | null; onClose: () => void }) {
  const [password, setPassword] = useState(generatePassword)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  if (done && email) return <CredentialsSummary email={email} password={password} onDone={onClose} />

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const result = await resetStaffPassword({ id: memberId, password })
      if (!result.success) {
        setError(result.error)
        return
      }
      toast.add({ title: `Mot de passe de ${name} modifié`, type: 'success' })
      if (email) setDone(true)
      else onClose()
    })
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle className="text-lg">Nouveau mot de passe</DialogTitle>
        <DialogDescription>
          Pour {name}
          {email && ` (${email})`}. L&apos;ancien mot de passe ne fonctionnera plus.
        </DialogDescription>
      </DialogHeader>
      <PasswordField id="reset-password" value={password} onChange={setPassword} />
      {error && <p className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">{error}</p>}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Annuler
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? 'Enregistrement…' : 'Changer le mot de passe'}
        </Button>
      </DialogFooter>
    </form>
  )
}
