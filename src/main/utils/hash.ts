import { createHash } from 'node:crypto'

/**
 * Stable fingerprint of clipboard text.
 *
 * Used for change detection (the watcher reads the clipboard on a timer, so the
 * comparison happens a few times per second) and as the cache key for reusing a
 * previous translation of identical text. SHA-1 truncated to 64 bits is more than
 * enough for a local cache and avoids keeping whole strings around for comparison.
 */
export function hashText(value: string): string {
  return createHash('sha1').update(value, 'utf8').digest('hex').slice(0, 16)
}

/** Single-line, length-capped preview for logs and the clipboard activity event. */
export function toPreview(value: string, maxLength = 160): string {
  const flattened = value.replace(/\s+/gu, ' ').trim()

  if (flattened.length <= maxLength) {
    return flattened
  }

  return `${flattened.slice(0, maxLength - 1)}…`
}
