import type { CSSProperties } from 'react'

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

/** CSS properties Electron reads for frameless-window dragging. */
export const dragRegion = { WebkitAppRegion: 'drag' } as CSSProperties
export const noDragRegion = { WebkitAppRegion: 'no-drag' } as CSSProperties
