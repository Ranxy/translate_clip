// scripts/check-i18n.mjs
//
// Enforces a strict mapping between the source code and the locale modules in
// src/shared/locales:
//
//   1. Catalogue    — the modules on disk, SUPPORTED_LOCALES and UI_LOCALE_OPTIONS
//                     must describe the same set of locales
//   2. Missing keys — t("key") / translate("key") in code but absent from the bundles
//   3. Unused keys  — key in the bundles but never referenced from code
//   4. Consistency  — every locale must carry exactly the reference key set
//   5. Key order    — every locale must list keys in the reference order, so a new
//                     language reviews as a straight line-by-line diff
//   6. Placeholders — every locale must interpolate the same {{names}}, and no
//                     string may use a single {name} brace (react-i18next renders
//                     that literally)
//
// Indirect references the checker cannot trace statically must be listed in
// DYNAMIC_PREFIXES below, with a pointer to the call site.
//
// Locale codes double as file names: `ja` lives in src/shared/locales/ja.ts.
//
// Usage: node scripts/check-i18n.mjs

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import {
  REFERENCE_LOCALE,
  SOURCE_DIR,
  SUPPORTED_LOCALES,
  UI_LOCALE_VALUES,
  flatten,
  loadLocaleObject,
  localeModuleCodes
} from './lib/locale-source.mjs'

// Key families translated through a computed key — exempt from the unused-key
// check, because the checker cannot see the call site.
const DYNAMIC_PREFIXES = [
  // status-bar.tsx: t(`overlay.phase.${translationState.phase}`)
  'overlay.phase.',
  // status-bar.tsx: t(`activity.reasons.${clipboardActivity.reason}`)
  'activity.reasons.',
  // settings-shell.tsx: t(`settings.tabs.${value}`)
  'settings.tabs.',
  // providers-page.tsx: t(`settings.providers.errors.${code}`)
  'settings.providers.errors.'
]

const IGNORED_SOURCE_DIRS = new Set(['locales'])

let errors = 0

function error(message) {
  console.error(message)
  errors++
}

/* ── Source scanning ────────────────────────────────────────────────── */

function collectFiles(directory, predicate) {
  const results = []

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name)

    if (entry.isDirectory()) {
      if (!IGNORED_SOURCE_DIRS.has(entry.name)) {
        results.push(...collectFiles(full, predicate))
      }
      continue
    }

    if (entry.isFile() && predicate(entry.name)) {
      results.push(full)
    }
  }

  return results
}

// Each pattern is paired with the capture group holding the key, so a
// `t(cond ? "a" : "b")` ternary contributes both branches.
const KEY_PATTERNS = [
  { regex: /\b(?:t|translate)\(\s*["']([^"']+)["']/gu, groups: [1] },
  { regex: /\b(?:t|translate)\(\s*[^)]*\?\s*["']([^"']+)["']\s*:\s*["']([^"']+)["']/gu, groups: [1, 2] },
  { regex: /\b(titleKey|descriptionKey|messageKey|labelKey)\s*[:=]\s*["']([^"']+)["']/gu, groups: [2] }
]

function collectSourceKeys() {
  const files = collectFiles(
    SOURCE_DIR,
    (name) => (name.endsWith('.ts') || name.endsWith('.tsx')) && !name.endsWith('.test.ts') && !name.endsWith('.test.tsx')
  )
  const keys = new Set()

  for (const file of files) {
    const source = readFileSync(file, 'utf8')

    for (const { regex, groups } of KEY_PATTERNS) {
      regex.lastIndex = 0
      let match

      while ((match = regex.exec(source))) {
        for (const group of groups) {
          keys.add(match[group])
        }
      }
    }
  }

  return { keys, files: files.length }
}

/* ── Key helpers ────────────────────────────────────────────────────── */

// i18next pluralisation: `key_one` / `key_other` in the bundle answer to `key`.
function baseKey(key) {
  return key.replace(/_(zero|one|two|few|many|other)$/u, '')
}

function isDynamic(key) {
  return DYNAMIC_PREFIXES.some((prefix) => key.startsWith(prefix))
}

/* ── Placeholders ───────────────────────────────────────────────────── */

const PLACEHOLDER = /\{\{\s*([\w.]+)\s*\}\}/gu
const SINGLE_BRACE = /(?<!\{)\{([a-zA-Z_][a-zA-Z0-9_]*)\}(?!\})/gu

function placeholdersOf(value) {
  if (typeof value !== 'string') {
    return []
  }

  return [...value.matchAll(PLACEHOLDER)].map((match) => match[1]).sort()
}

/* ── Check 1: the catalogue ─────────────────────────────────────────── */

const onDisk = localeModuleCodes()

function sameSet(left, right) {
  return left.length === right.length && [...left].sort().join('\u0000') === [...right].sort().join('\u0000')
}

if (!sameSet(SUPPORTED_LOCALES, onDisk)) {
  error('Catalogue mismatch — SUPPORTED_LOCALES and src/shared/locales/*.ts disagree:')
  error(`  declared: ${SUPPORTED_LOCALES.join(', ')}`)
  error(`  on disk:  ${onDisk.join(', ')}`)
  error()
}

if (!sameSet(SUPPORTED_LOCALES, UI_LOCALE_VALUES)) {
  error('Catalogue mismatch — UI_LOCALE_OPTIONS does not offer every supported locale:')
  error(`  SUPPORTED_LOCALES: ${SUPPORTED_LOCALES.join(', ')}`)
  error(`  UI_LOCALE_OPTIONS: ${UI_LOCALE_VALUES.join(', ')}`)
  error()
}

if (SUPPORTED_LOCALES.length === 0) {
  error('SUPPORTED_LOCALES is empty')
  process.exit(1)
}

const bundles = new Map()

for (const code of SUPPORTED_LOCALES) {
  try {
    bundles.set(code, flatten(await loadLocaleObject(code)))
  } catch (cause) {
    error(`Could not load locale "${code}": ${cause.message}`)
  }
}

if (bundles.size !== SUPPORTED_LOCALES.length) {
  console.error('\ni18n audit failed: not every locale bundle could be loaded.')
  process.exit(1)
}

const referenceKeys = [...bundles.get(REFERENCE_LOCALE).keys()]

/* ── Check 2: keys used in code but missing from the bundles ────────── */

const { keys: sourceKeys, files: scannedFiles } = collectSourceKeys()
const effectiveReference = new Set(referenceKeys)
for (const key of referenceKeys) {
  effectiveReference.add(baseKey(key))
}

const missing = [...sourceKeys].filter((key) => !effectiveReference.has(key) && !isDynamic(key)).sort()

if (missing.length > 0) {
  error(`Missing keys (${missing.length}) — used in code but absent from the bundles:\n`)
  for (const key of missing) {
    error(`  - ${key}`)
  }
  error()
}

/* ── Check 3: keys in the bundles that no call site uses ────────────── */

const unused = referenceKeys
  .filter((key) => !sourceKeys.has(key) && !sourceKeys.has(baseKey(key)) && !isDynamic(key))
  .sort()

if (unused.length > 0) {
  error(`Unused keys (${unused.length}) — in the bundles but never referenced from code:\n`)
  for (const key of unused) {
    error(`  - ${key}`)
  }
  error('\nDelete them, or add the family to DYNAMIC_PREFIXES if a call site computes the key.\n')
}

/* ── Checks 4-5: parity with the reference locale ───────────────────── */

for (const code of SUPPORTED_LOCALES) {
  if (code === REFERENCE_LOCALE) {
    continue
  }

  const keys = [...bundles.get(code).keys()]
  const absent = referenceKeys.filter((key) => !keys.includes(key))
  const extra = keys.filter((key) => !referenceKeys.includes(key))

  if (absent.length > 0) {
    error(`${code}: ${absent.length} key(s) missing (present in ${REFERENCE_LOCALE}):\n`)
    for (const key of absent.sort()) {
      error(`  - ${key}`)
    }
    error()
  }

  if (extra.length > 0) {
    error(`${code}: ${extra.length} key(s) not present in ${REFERENCE_LOCALE}:\n`)
    for (const key of extra.sort()) {
      error(`  + ${key}`)
    }
    error()
  }

  if (absent.length === 0 && extra.length === 0 && keys.join('\n') !== referenceKeys.join('\n')) {
    const position = keys.findIndex((key, index) => key !== referenceKeys[index])
    error(
      `${code}: keys are declared in a different order than ${REFERENCE_LOCALE} — run "npm run i18n:sort".\n` +
        `  first difference at position ${position + 1}: ${keys[position]} (expected ${referenceKeys[position]})\n`
    )
  }
}

/* ── Check 6: placeholders ──────────────────────────────────────────── */

for (const code of SUPPORTED_LOCALES) {
  const bundle = bundles.get(code)
  const placeholderIssues = []
  const braceIssues = []

  for (const [key, value] of bundle) {
    const mine = placeholdersOf(value)
    const theirs = placeholdersOf(bundles.get(REFERENCE_LOCALE).get(key))

    if (mine.join('\u0000') !== theirs.join('\u0000')) {
      placeholderIssues.push({ key, mine, theirs })
    }

    if (typeof value === 'string') {
      SINGLE_BRACE.lastIndex = 0
      const names = [...value.matchAll(SINGLE_BRACE)].map((match) => match[1])

      if (names.length > 0) {
        braceIssues.push({ key, value, names })
      }
    }
  }

  if (placeholderIssues.length > 0) {
    error(`${code}: ${placeholderIssues.length} string(s) whose {{placeholders}} differ from ${REFERENCE_LOCALE}:\n`)
    for (const issue of placeholderIssues) {
      error(`  - ${issue.key}: [${issue.mine.join(', ')}] vs [${issue.theirs.join(', ')}]`)
    }
    error()
  }

  if (braceIssues.length > 0) {
    error(`${code}: ${braceIssues.length} string(s) with a single {name} brace — react-i18next needs {{name}}:\n`)
    for (const issue of braceIssues) {
      error(`  - ${issue.key} → ${JSON.stringify(issue.value)} (found: ${issue.names.join(', ')})`)
    }
    error()
  }
}

/* ── Result ─────────────────────────────────────────────────────────── */

if (errors > 0) {
  console.error(`i18n audit failed with ${errors} problem(s).`)
  process.exit(1)
}

console.log(
  `i18n audit passed: ${SUPPORTED_LOCALES.length} locales (${SUPPORTED_LOCALES.join(', ')}), ` +
    `${referenceKeys.length} keys, ${scannedFiles} source files scanned ` +
    '(catalogue, missing, unused, consistency, order, placeholders).'
)
