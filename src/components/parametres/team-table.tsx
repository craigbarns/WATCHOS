'use client'

import { useTransition } from 'react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { updateUser } from '@/app/actions/parametres'
import { toast } from '@/components/ui/toast'
import { ROLE_LABELS } from '@/lib/format'
import type { Role } from '@/lib/auth'
import { cn } from '@/lib/utils'

export type TeamMember = { id: string; full_name: string; role: Role; active: boolean; created_at: string }

export function TeamTable({ members, currentUserId }: { members: TeamMember[]; currentUserId: string }) {
  const [pending, startTransition] = useTransition()

  const update = (member: TeamMember, patch: Partial<TeamMember>) => {
    startTransition(async () => {
      const result = await updateUser({ id: member.id, full_name: member.full_name, role: member.role, active: member.active, ...patch })
      if (!result.success) toast.add({ title: 'Modification refusée', description: result.error, type: 'error' })
      else toast.add({ title: 'Équipe mise à jour', type: 'success' })
    })
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="pl-4">Nom</TableHead>
          <TableHead>Rôle</TableHead>
          <TableHead>Inscrit le</TableHead>
          <TableHead className="pr-4 text-right">Accès</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {members.map((m) => {
          const self = m.id === currentUserId
          return (
            <TableRow key={m.id} className={cn(!m.active && 'bg-amber-50/60 dark:bg-amber-950/20')}>
              <TableCell className="pl-4 font-medium">
                {m.full_name} {self && <span className="text-xs text-muted-foreground">(vous)</span>}
              </TableCell>
              <TableCell>
                <select
                  value={m.role}
                  disabled={self || pending}
                  onChange={(e) => update(m, { role: e.target.value as Role })}
                  className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
                >
                  {Object.entries(ROLE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </TableCell>
              <TableCell className="text-muted-foreground">{new Date(m.created_at).toLocaleDateString('fr-FR')}</TableCell>
              <TableCell className="pr-4 text-right">
                <button
                  type="button"
                  disabled={self || pending}
                  onClick={() => update(m, { active: !m.active })}
                  className={cn(
                    'rounded-full px-3 py-1 text-xs font-semibold disabled:opacity-60',
                    m.active
                      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                      : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                  )}
                >
                  {m.active ? 'Actif' : 'En attente — activer'}
                </button>
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
