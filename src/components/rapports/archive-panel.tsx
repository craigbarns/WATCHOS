'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Download, FileCheck2 } from 'lucide-react'
import { formatDate, formatDateTime, formatEuro } from '@/lib/format'

export type ArchiveSummary = {
  sequence_number: number
  period_start: string
  period_end: string
  sales_count: number
  total_ttc: number
  file_sha256: string
  created_at: string
  author: string | null
}

const linkClass = 'inline-flex h-9 items-center gap-2 rounded-lg border bg-background px-3 text-sm font-medium hover:bg-muted'

/**
 * Archivage (au moins une fois par an) : chaque export enregistre l'empreinte SHA-256
 * du fichier. Un fichier conservé peut ensuite être vérifié : s'il a été modifié,
 * son empreinte ne correspond plus à aucune archive enregistrée.
 */
export function ArchivePanel({ archives, years }: { archives: ArchiveSummary[]; years: string[] }) {
  const router = useRouter()
  const [year, setYear] = useState(years.at(-1) ?? '')
  const [check, setCheck] = useState<{ ok: boolean; text: string } | null>(null)

  const exported = () => setTimeout(() => router.refresh(), 2500)

  const verify = async (file: File | undefined) => {
    setCheck(null)
    if (!file) return
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
    const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
    const match = archives.find((a) => a.file_sha256 === hex)
    setCheck(
      match
        ? { ok: true, text: `Fichier intact : archive n°${match.sequence_number} du ${formatDateTime(match.created_at)}.` }
        : { ok: false, text: 'Aucune archive enregistrée ne correspond : ce fichier a été modifié ou ne vient pas de cette caisse.' }
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        {years.length > 0 && (
          <>
            <label className="grid gap-1.5 text-sm">
              Année
              <select value={year} onChange={(e) => setYear(e.target.value)} className="h-9 rounded-lg border border-input bg-transparent px-2 text-sm">
                {years.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </label>
            <a href={`/rapports/archive?annee=${year}`} onClick={exported} className={linkClass}>
              <Download className="size-4" /> Archiver {year}
            </a>
          </>
        )}
        <a href="/rapports/archive" onClick={exported} className={linkClass}>
          <Download className="size-4" /> Tout l&apos;historique
        </a>
      </div>

      <div className="grid gap-1.5 text-sm">
        <label htmlFor="archive-file" className="flex items-center gap-2 font-medium">
          <FileCheck2 className="size-4" /> Vérifier un fichier d&apos;archive conservé
        </label>
        <input id="archive-file" type="file" accept="application/json,.json" onChange={(e) => verify(e.target.files?.[0])} className="text-sm" />
        {check && <p role="status" className={check.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-destructive'}>{check.text}</p>}
      </div>

      {archives.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucune archive enregistrée pour l&apos;instant.</p>
      ) : (
        <ul className="divide-y rounded-lg border text-sm">
          {[...archives].reverse().map((a) => (
            <li key={a.sequence_number} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-3 py-2">
              <span className="font-medium">
                N°{a.sequence_number} · {formatDate(a.period_start)} → {formatDateTime(a.period_end)}
              </span>
              <span className="text-muted-foreground">
                {a.sales_count} ticket(s) · {formatEuro(a.total_ttc)} · archivé le {formatDateTime(a.created_at)}
                {a.author && ` par ${a.author}`}
              </span>
              <span className="w-full font-mono text-[11px] break-all text-muted-foreground">SHA-256 {a.file_sha256}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
