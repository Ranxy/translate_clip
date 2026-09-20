import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { LOCALE_RESOURCES } from '@shared/locales'
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

/** Resolves a dotted key against a locale resource. */
function resolveKey(key: string): string | null {
  let current: unknown = LOCALE_RESOURCES['zh-CN']

  for (const segment of key.split('.')) {
    if (typeof current !== 'object' || current === null) {
      return null
    }

    current = (current as Record<string, unknown>)[segment]
  }

  return typeof current === 'string' ? current : null
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
