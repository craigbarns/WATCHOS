export default function Loading() {
  return (
    <div role="status" aria-label="Chargement de la page" className="space-y-6 motion-safe:animate-pulse">
      <div className="h-36 rounded-2xl bg-primary/10" />
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">{[1, 2, 3, 4].map((n) => <div key={n} className="h-36 rounded-2xl border bg-card" />)}</div>
      <div className="grid gap-4 lg:grid-cols-2"><div className="h-72 rounded-2xl border bg-card" /><div className="h-72 rounded-2xl border bg-card" /></div>
      <span className="sr-only">Chargement…</span>
    </div>
  )
}
