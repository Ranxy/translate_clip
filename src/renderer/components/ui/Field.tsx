import type { ReactNode } from 'react'

import { cn } from '../../utils/cn'

export interface FieldProps {
  label: ReactNode
  hint?: ReactNode
  htmlFor?: string
  /** Renders the control full width under the label instead of beside it. */
  stacked?: boolean
  children: ReactNode
  className?: string
}

export function Field({ label, hint, htmlFor, stacked = false, children, className }: FieldProps) {
  if (stacked) {
    return (
      <div className={cn('py-2.5', className)}>
        <label className="block text-[13px] font-medium text-text" htmlFor={htmlFor}>
          {label}
        </label>
        {hint ? <p className="mt-1 text-[12px] leading-relaxed text-muted">{hint}</p> : null}
        <div className="mt-2">{children}</div>
      </div>
    )
  }

  return (
    <div className={cn('flex items-start justify-between gap-6 py-2.5', className)}>
      <div className="min-w-0">
        <label className="block text-[13px] font-medium text-text" htmlFor={htmlFor}>
          {label}
        </label>
        {hint ? <p className="mt-0.5 text-[12px] leading-relaxed text-muted">{hint}</p> : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  )
}
