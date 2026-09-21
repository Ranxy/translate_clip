import { useEffect, useState } from 'react'

import { cn } from '../../utils/cn'
import { roundToStepPrecision } from '../../utils/number'

export interface NumberInputProps {
  value: number
  min: number
  max: number
  step?: number
  onCommit: (value: number) => void
  className?: string
  ariaLabel?: string
}

/**
 * Number field that only commits on blur or Enter.
 *
 * Updating on every keystroke fights the sanitizer in the main process — typing
 * "5" into a field whose minimum is 50 would immediately rewrite it to "50" and
 * make the value impossible to edit.
 */
export function NumberInput({ value, min, max, step = 1, onCommit, className, ariaLabel }: NumberInputProps) {
  const [draft, setDraft] = useState(String(value))
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    if (!focused) {
      setDraft(String(value))
    }
  }, [value, focused])

  const commit = () => {
    const parsed = Number(draft)

    if (!Number.isFinite(parsed)) {
      setDraft(String(value))
      return
    }

    const clamped = Math.min(Math.max(roundToStepPrecision(parsed, step), min), max)
    setDraft(String(clamped))

    if (clamped !== value) {
      onCommit(clamped)
    }
  }

  return (
    <input
      type="number"
      aria-label={ariaLabel}
      className={cn(
        'w-24 rounded-lg border border-border bg-surface-sunken px-2.5 py-1.5 text-right text-[13px] text-text',
        'focus:border-accent focus:outline-none',
        className
      )}
      value={draft}
      min={min}
      max={max}
      step={step}
      onFocus={() => setFocused(true)}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        setFocused(false)
        commit()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          commit()
          event.currentTarget.blur()
        }

        if (event.key === 'Escape') {
          setDraft(String(value))
          event.currentTarget.blur()
        }
      }}
    />
  )
}
