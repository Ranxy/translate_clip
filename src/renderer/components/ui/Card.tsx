import type { ReactNode } from 'react'

import { cn } from '../../utils/cn'

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn('rounded-xl border border-border bg-surface-strong p-4', className)}>{children}</section>
}

export function CardHeader({ title, description, action }: { title: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return (
    <header className="mb-3 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-[13px] font-semibold tracking-wide text-text">{title}</h2>
        {description ? <p className="mt-0.5 text-[12px] leading-relaxed text-muted">{description}</p> : null}
      </div>
      {action}
    </header>
  )
}

export function Divider({ className }: { className?: string }) {
  return <hr className={cn('my-3 border-0 border-t border-border', className)} />
}
