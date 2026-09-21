import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  FALLBACK_LOCALE,
  LOCALE_RESOURCES,
  SUPPORTED_LOCALES,
  UI_LOCALE_OPTIONS,
  isSupportedLocale,
  resolveLocale,
  type LocaleResource
} from '@shared/locales'
import {
  SUPPORTED_LLM_PROVIDER_IDS,
  type ClipboardSkipReason,
  type TranslationPhase
} from '@shared/types'

const sourceRoot = fileURLToPath(new URL('.', import.meta.url))

function collectSourceFiles(directory: string): string[] {
  const found: string[] = []

  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry)

    if (statSync(path).isDirectory()) {
      found.push(...collectSourceFiles(path))
      continue
    }

    if ((entry.endsWith('.ts') || entry.endsWith('.tsx')) && !entry.endsWith('.test.ts')) {
      found.push(path)
    }
  }

  return found
}

/** Dotted key → value, in declaration order, for every locale. */
function flattenKeys(resource: unknown, prefix = ''): string[] {
  const keys: string[] = []

  if (!resource || typeof resource !== 'object') {
    return keys
  }

  for (const [key, value] of Object.entries(resource as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key

    if (value && typeof value === 'object') {
      keys.push(...flattenKeys(value, path))
    } else {
      keys.push(path)
    }
  }

  return keys
}

/** Resolves a dotted key against a locale resource. */
function resolveKey(key: string, resource: LocaleResource = LOCALE_RESOURCES[FALLBACK_LOCALE]): string | null {
  let current: unknown = resource

  for (const segment of key.split('.')) {
    if (typeof current !== 'object' || current === null) {
      return null
    }

    current = (current as Record<string, unknown>)[segment]
  }

  return typeof current === 'string' ? current : null
}

function placeholdersIn(value: string): string[] {
  return [...value.matchAll(/\{\{\s*([\w.]+)\s*\}\}/gu)].map((match) => match[1]).sort()
}

/**
 * Every literal translation key used in the code must exist.
 *
 * A missing key is invisible until a user reaches that screen, and then they see the
 * raw key (`settings.foo.bar`) instead of text. `en` is checked by the compiler (it is
 * typed as the Chinese resource), but nothing else connects call sites to the bundles —
 * this does. Template keys like `activity.reasons.${reason}` are covered by the
 * completeness checks below rather than by this regex.
 */
const LITERAL_CALL = /\b(?:t|translate)\(\s*'([^']+)'/gu

describe('translation keys', () => {
  it('resolves every literal key used in the source', () => {
    const missing: string[] = []

    for (const file of collectSourceFiles(sourceRoot)) {
      const source = readFileSync(file, 'utf8')

      for (const match of source.matchAll(LITERAL_CALL)) {
        const key = match[1]

        // Ignore interpolated fragments the regex can catch by accident.
        if (key.includes('${')) {
          continue
        }

        if (resolveKey(key) === null) {
          missing.push(`${file.replace(sourceRoot, '')}: ${key}`)
        }
      }
    }

    expect(missing).toEqual([])
  })

  it('labels every translation phase', () => {
    const phases: TranslationPhase[] = ['idle', 'translating', 'done', 'error', 'skipped', 'canceled', 'unconfigured']

    for (const phase of phases) {
      expect(resolveKey(`overlay.phase.${phase}`), `overlay.phase.${phase}`).not.toBeNull()
    }
  })

  it('explains every reason a clipboard read can be skipped', () => {
    const reasons: ClipboardSkipReason[] = [
      'disabled',
      'file-list',
      'empty',
      'too-short',
      'too-long',
      'single-token',
      'ignored-pattern',
      'same-as-last',
      'self-write'
    ]

    for (const reason of reasons) {
      expect(resolveKey(`activity.reasons.${reason}`), `activity.reasons.${reason}`).not.toBeNull()
    }
  })

  it('explains every provider error code', () => {
    const codes = ['unconfigured', 'auth', 'rate-limit', 'timeout', 'server', 'network', 'bad-response', 'canceled', 'unknown']

    for (const code of codes) {
      expect(resolveKey(`settings.providers.errors.${code}`), `settings.providers.errors.${code}`).not.toBeNull()
    }
  })

  it('names every settings tab and provider', () => {
    for (const tab of ['general', 'clipboard', 'providers', 'prompt', 'glossary', 'shortcuts', 'about']) {
      expect(resolveKey(`settings.tabs.${tab}`), `settings.tabs.${tab}`).not.toBeNull()
    }

    // Provider labels come from the catalogue, not the locale bundle, but the page needs
    // a heading for every provider it can render.
    expect(SUPPORTED_LLM_PROVIDER_IDS).toHaveLength(5)
  })
})

/**
 * Every bundle must be a complete translation of the reference one.
 *
 * `check-i18n.mjs` runs the same checks over the source tree and is the CI gate; these
 * assertions keep the invariants inside `npm test`, where a mistake is caught before a
 * commit rather than in CI.
 */
describe('locale bundles', () => {
  it('ships a bundle for every supported locale and nothing else', () => {
    expect(Object.keys(LOCALE_RESOURCES).sort()).toEqual([...SUPPORTED_LOCALES].sort())
  })

  it('offers every supported locale in the language picker', () => {
    expect(UI_LOCALE_OPTIONS.map((option) => option.value).sort()).toEqual([...SUPPORTED_LOCALES].sort())
  })

  it('has a fallback locale that is actually shipped', () => {
    expect(SUPPORTED_LOCALES).toContain(FALLBACK_LOCALE)
  })

  it.each(SUPPORTED_LOCALES.filter((locale) => locale !== 'zh-CN'))(
    '%s carries exactly the reference key set, in the reference order',
    (locale) => {
      expect(flattenKeys(LOCALE_RESOURCES[locale])).toEqual(flattenKeys(LOCALE_RESOURCES['zh-CN']))
    }
  )

  it.each(SUPPORTED_LOCALES)('%s leaves no string empty', (locale) => {
    const empty = flattenKeys(LOCALE_RESOURCES[locale]).filter((key) => {
      const value = resolveKey(key, LOCALE_RESOURCES[locale])
      return value === null || value.trim().length === 0
    })

    expect(empty).toEqual([])
  })

  it.each(SUPPORTED_LOCALES.filter((locale) => locale !== 'zh-CN'))(
    '%s interpolates the same placeholders as the reference',
    (locale) => {
      const mismatched: string[] = []

      for (const key of flattenKeys(LOCALE_RESOURCES['zh-CN'])) {
        const reference = resolveKey(key, LOCALE_RESOURCES['zh-CN'])
        const mine = resolveKey(key, LOCALE_RESOURCES[locale])

        if (reference === null || mine === null) {
          continue
        }

        if (placeholdersIn(reference).join(',') !== placeholdersIn(mine).join(',')) {
          mismatched.push(`${key}: [${placeholdersIn(mine)}] vs [${placeholdersIn(reference)}]`)
        }
      }

      expect(mismatched).toEqual([])
    }
  )

  it.each(SUPPORTED_LOCALES)('%s uses {{double}} braces for every placeholder', (locale) => {
    const single = flattenKeys(LOCALE_RESOURCES[locale]).filter((key) => {
      const value = resolveKey(key, LOCALE_RESOURCES[locale])
      return value !== null && /(?<!\{)\{[a-zA-Z_][a-zA-Z0-9_]*\}(?!\})/u.test(value)
    })

    expect(single).toEqual([])
  })
})

describe('resolveLocale', () => {
  it('maps a system tag onto a shipped bundle', () => {
    expect(resolveLocale('zh-CN')).toBe('zh-CN')
    expect(resolveLocale('zh-Hans-CN')).toBe('zh-CN')
    expect(resolveLocale('zh-TW')).toBe('zh-CN')
    expect(resolveLocale('en-US')).toBe('en')
    expect(resolveLocale('ja-JP')).toBe('ja')
    expect(resolveLocale('ru_RU')).toBe('ru')
  })

  it('falls back for a locale we do not ship', () => {
    expect(resolveLocale('de-DE')).toBe(FALLBACK_LOCALE)
    expect(resolveLocale('')).toBe(FALLBACK_LOCALE)
    expect(resolveLocale(null)).toBe(FALLBACK_LOCALE)
    expect(resolveLocale(undefined)).toBe(FALLBACK_LOCALE)
  })

  it('recognises exactly the shipped locales', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(isSupportedLocale(locale)).toBe(true)
    }

    expect(isSupportedLocale('system')).toBe(false)
    expect(isSupportedLocale('de')).toBe(false)
  })
})
