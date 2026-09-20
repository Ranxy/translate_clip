import type { ReactNode } from 'react'

import { cn } from '../../utils/cn'

type BadgeTone = 'neutral' | 'accent' | 'ok' | 'warn' | 'danger'

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-surface-sunken text-muted',
  accent: 'bg-accent-soft text-accent',
  ok: 'bg-accent-soft text-ok',
  warn: 'bg-surface-sunken text-warn',
  danger: 'bg-danger-soft text-danger'
}

export function Badge({ tone = 'neutral', children, className }: { tone?: BadgeTone; children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-5',
        TONES[tone],
        className
      )}
    >
      {children}
    </span>
  )
}
