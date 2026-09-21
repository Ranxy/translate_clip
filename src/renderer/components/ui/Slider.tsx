import { useEffect, useRef, type InputHTMLAttributes } from 'react'

import { cn } from '../../utils/cn'

export interface SliderProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'defaultValue' | 'onChange' | 'type' | 'min' | 'max' | 'step'> {
  value: number
  min: number
  max: number
  step?: number
  /**
   * Fires on every move, before the value is stored.
   *
   * A setting the user has to judge by eye — how opaque the overlay is — has to be visible
   * while the thumb moves, but persisting on every intermediate step would rewrite the config
   * file dozens of times per drag. This is the cheap half: apply it, do not save it.
   */
  onPreview?: (value: number) => void
  /** Fires once the interaction ends (pointer release, key release or blur), for the saved value. */
  onCommit: (value: number) => void
}

/**
 * Range control with a two-phase contract: preview while moving, commit once on release.
 *
 * The committed value is read from a ref rather than from the `value` prop, because a pointer
 * release can arrive before React has re-rendered the parent with the value the last `input`
 * event reported — which would persist the second-to-last position instead of the last one.
 */
export function Slider({ value, min, max, step = 1, onPreview, onCommit, className, ...rest }: SliderProps) {
  const latest = useRef(value)

  useEffect(() => {
    latest.current = value
  }, [value])

  const commit = () => onCommit(latest.current)

  return (
    <input
      type="range"
      className={cn(
        'h-5 cursor-pointer accent-accent disabled:cursor-default disabled:opacity-45',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
        className
      )}
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(event) => {
        const next = Number(event.target.value)
        latest.current = next
        onPreview?.(next)
      }}
      onPointerUp={commit}
      onPointerCancel={commit}
      onKeyUp={commit}
      onBlur={commit}
      {...rest}
    />
  )
}
