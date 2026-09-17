'use client'

import { useTransition } from 'react'
import { updateUser } from '@/app/actions/parametres'
import { toast } from '@/components/ui/toast'
import { ROLE_LABELS } from '@/lib/format'
import type { Role } from '@/lib/auth'
import { cn } from '@/lib/utils'
import { DeleteMemberButton, ResetPasswordButton } from '@/components/parametres/team-dialogs'

export type TeamMember = { id: string; full_name: string; role: Role; active: boolean; created_at: string; email: string | null; last_sign_in_at: string | null }

export function TeamTable({ members, currentUserId, canManageAccounts }: { members: TeamMember[]; currentUserId: string; canManageAccounts: boolean }) {
  const [pending, startTransition] = useTransition()

  const update = (member: TeamMember, patch: Partial<TeamMember>) => {
    startTransition(async () => {
      const result = await updateUser({ id: member.id, full_name: member.full_name, role: member.role, active: member.active, ...patch })
      if (!result.success) toast.add({ title: 'Modification refusée', description: result.error, type: 'error' })
      else toast.add({ title: 'Équipe mise à jour', type: 'success' })
    })
  }

  return (
    <ul className="divide-y">
      {members.map((m) => {
        const self = m.id === currentUserId
        return (
          <li key={m.id} className={cn('flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3', !m.active && 'bg-amber-50/60 dark:bg-amber-950/20')}>
            <div className="min-w-0 flex-1 basis-56">
              <div className="truncate font-medium">
                {m.full_name} {self && <span className="text-xs font-normal text-muted-foreground">(vous)</span>}
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {m.email ?? '—'}
                {' · '}
                {m.last_sign_in_at ? `dernière connexion ${new Date(m.last_sign_in_at).toLocaleDateString('fr-FR')}` : 'jamais connecté'}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={m.role}
                disabled={self || pending}
                onChange={(e) => update(m, { role: e.target.value as Role })}
                className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
                aria-label={`Rôle de ${m.full_name}`}
              >
                {Object.entries(ROLE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={self || pending}
                onClick={() => update(m, { active: !m.active })}
                className={cn(
                  'h-8 rounded-full px-3 text-xs font-semibold whitespace-nowrap disabled:opacity-60',
                  m.active
                    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                    : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                )}
                title={m.active ? 'Cliquer pour suspendre l’accès' : 'Cliquer pour activer'}
              >
                {m.active ? 'Actif' : 'Suspendu — activer'}
              </button>
              {canManageAccounts && <ResetPasswordButton memberId={m.id} name={m.full_name} email={m.email} />}
              {canManageAccounts && !self && <DeleteMemberButton memberId={m.id} name={m.full_name} />}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
