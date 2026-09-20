import type { ClipboardSkipReason } from '@shared/types'

import { hashText } from '../utils/hash'

export interface FilterContext {
  minSourceChars: number
  maxSourceChars: number
  skipSingleToken: boolean
  /** Pre-compiled by the caller; compiling on every clipboard read would be wasteful. */
  ignorePatterns: RegExp[]
}

export type FilterResult =
  | { accepted: true; text: string; hash: string }
  | { accepted: false; reason: ClipboardSkipReason; charCount: number }

const CJK_PATTERN = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uf900-\ufaff]/u
const WHITESPACE_PATTERN = /\s/u
const NUMERIC_ONLY_PATTERN = /^[\d.,:%+\-()\s]+$/u

/**
 * Normalises clipboard text without changing its meaning.
 *
 * Line endings are unified, trailing whitespace per line is dropped (copying from
 * a browser or a terminal very often drags it along) and runs of blank lines are
 * collapsed so the prompt stays compact.
 */
export function normalizeClipboardText(raw: string): string {
  return raw
    .replace(/\r\n?/gu, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/u, ''))
    .join('\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
}

/**
 * Compiles user-supplied patterns, dropping the ones that cannot compile.
 *
 * Invalid patterns are rejected when they are saved, so anything dropped here is
 * either hand-edited config or a pattern that became invalid across versions.
 */
export function compileIgnorePatterns(patterns: string[]): RegExp[] {
  const compiled: RegExp[] = []

  for (const pattern of patterns) {
    try {
      const flags = pattern.startsWith('(?i)') ? 'iu' : 'u'
      const source = pattern.startsWith('(?i)') ? pattern.slice(4) : pattern
      compiled.push(new RegExp(source, flags))
    } catch {
      // Ignored: sanitizeConfig logs this once at load time.
    }
  }

  return compiled
}

/**
 * The filter chain, applied in a fixed order so the reported reason is the most
 * specific one: emptiness and size are cheap and objective, ignore rules are the
 * user's explicit intent, and deduplication comes last.
 */
export function filterClipboardText(raw: string, context: FilterContext, previousHash: string | null): FilterResult {
  const text = normalizeClipboardText(raw)

  if (text.length === 0) {
    return { accepted: false, reason: 'empty', charCount: 0 }
  }

  if (text.length < context.minSourceChars) {
    return { accepted: false, reason: 'too-short', charCount: text.length }
  }

  if (text.length > context.maxSourceChars) {
    // Truncating would silently produce a wrong translation, so the whole read is
    // dropped and the overlay says why.
    return { accepted: false, reason: 'too-long', charCount: text.length }
  }

  if (context.skipSingleToken && isSingleToken(text)) {
    return { accepted: false, reason: 'single-token', charCount: text.length }
  }

  for (const pattern of context.ignorePatterns) {
    pattern.lastIndex = 0
    if (pattern.test(text)) {
      return { accepted: false, reason: 'ignored-pattern', charCount: text.length }
    }
  }

  const hash = hashText(text)
  if (previousHash !== null && hash === previousHash) {
    return { accepted: false, reason: 'same-as-last', charCount: text.length }
  }

  return { accepted: true, text, hash }
}

function isSingleToken(text: string): boolean {
  if (WHITESPACE_PATTERN.test(text)) {
    return false
  }

  // CJK "words" carry meaning on their own; a two-character Chinese phrase is a
  // legitimate translation target, unlike a two-letter identifier.
  if (CJK_PATTERN.test(text)) {
    return false
  }

  return text.length < 3 || NUMERIC_ONLY_PATTERN.test(text)
}
