import type { LucideIcon } from 'lucide-react'

export function EmptyState({ icon: Icon, title, description, children }: {
  icon: LucideIcon
  title: string
  description: string
  children?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center px-5 py-12 text-center">
      <div className="mb-4 flex size-14 items-center justify-center rounded-2xl border border-primary/10 bg-primary/5 text-primary"><Icon className="size-6" strokeWidth={1.5} /></div>
      <p className="font-playfair text-xl font-medium text-foreground">{title}</p>
      <p className="mt-2 max-w-xs text-sm leading-relaxed text-muted-foreground">{description}</p>
      {children && <div className="mt-5">{children}</div>}
    </div>
  )
}
