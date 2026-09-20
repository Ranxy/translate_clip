import { describe, expect, it } from 'vitest'

import { hashText } from '../utils/hash'
import { compileIgnorePatterns, filterClipboardText, normalizeClipboardText, type FilterContext } from './clipboardFilter'

const baseContext: FilterContext = {
  minSourceChars: 2,
  maxSourceChars: 100,
  skipSingleToken: false,
  ignorePatterns: []
}

function context(patch: Partial<FilterContext> = {}): FilterContext {
  return { ...baseContext, ...patch }
}

describe('normalizeClipboardText', () => {
  it('unifies line endings and drops trailing whitespace per line', () => {
    expect(normalizeClipboardText('first  \r\nsecond\t\r\n')).toBe('first\nsecond')
    expect(normalizeClipboardText('a\rb')).toBe('a\nb')
  })

  it('collapses runs of blank lines', () => {
    expect(normalizeClipboardText('a\n\n\n\n\nb')).toBe('a\n\nb')
  })

  it('trims the whole payload', () => {
    expect(normalizeClipboardText('\n\n  hello  \n\n')).toBe('hello')
  })
})

describe('filterClipboardText', () => {
  it('rejects whitespace-only content', () => {
    expect(filterClipboardText('   \n\t ', context(), null)).toEqual({ accepted: false, reason: 'empty', charCount: 0 })
  })

  it('rejects content shorter than the minimum', () => {
    const result = filterClipboardText('a', context({ minSourceChars: 3 }), null)
    expect(result).toEqual({ accepted: false, reason: 'too-short', charCount: 1 })
  })

  it('rejects over-long content rather than truncating it', () => {
    const result = filterClipboardText('x'.repeat(101), context({ maxSourceChars: 100 }), null)
    expect(result).toEqual({ accepted: false, reason: 'too-long', charCount: 101 })
  })

  it('accepts normal text and reports its hash', () => {
    const result = filterClipboardText('  Hello  World \r\n', context(), null)

    expect(result).toEqual({ accepted: true, text: 'Hello  World', hash: hashText('Hello  World') })
  })

  it('rejects content matching an ignore rule', () => {
    const result = filterClipboardText('https://example.com/a', context({ ignorePatterns: compileIgnorePatterns(['^https?://']) }), null)
    expect(result.accepted).toBe(false)
    expect(result).toMatchObject({ reason: 'ignored-pattern' })
  })

  it('rejects a repeat of the previously accepted text', () => {
    const text = 'same as before'
    const result = filterClipboardText(text, context(), hashText(text))

    expect(result).toMatchObject({ accepted: false, reason: 'same-as-last' })
  })

  it('keeps short tokens unless single-token skipping is enabled', () => {
    expect(filterClipboardText('hi', context({ minSourceChars: 2 }), null).accepted).toBe(true)
    expect(filterClipboardText('hi', context({ minSourceChars: 2, skipSingleToken: true }), null)).toMatchObject({
      accepted: false,
      reason: 'single-token'
    })
  })

  it('keeps short CJK phrases even with single-token skipping enabled', () => {
    expect(filterClipboardText('你好', context({ minSourceChars: 2, skipSingleToken: true }), null).accepted).toBe(true)
  })

  it('skips bare numbers when single-token skipping is enabled', () => {
    expect(filterClipboardText('1234567', context({ skipSingleToken: true }), null)).toMatchObject({
      accepted: false,
      reason: 'single-token'
    })
  })

  it('supports the case-insensitive (?i) pattern prefix', () => {
    const patterns = compileIgnorePatterns(['(?i)^secret'])

    expect(filterClipboardText('SECRET token', context({ ignorePatterns: patterns }), null)).toMatchObject({
      accepted: false,
      reason: 'ignored-pattern'
    })
    expect(filterClipboardText('public token', context({ ignorePatterns: patterns }), null).accepted).toBe(true)
  })

  it('drops patterns that cannot compile', () => {
    expect(compileIgnorePatterns(['[', '^ok$'])).toHaveLength(1)
  })

  it('reports the most specific reason first', () => {
    // Both too-long and matching an ignore rule: size wins because it is objective.
    const result = filterClipboardText(
      'https://example.com/' + 'x'.repeat(200),
      context({ maxSourceChars: 100, ignorePatterns: compileIgnorePatterns(['^https?://']) }),
      null
    )

    expect(result).toMatchObject({ reason: 'too-long' })
  })
})
