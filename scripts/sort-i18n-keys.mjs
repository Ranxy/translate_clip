// scripts/sort-i18n-keys.mjs
//
// Keeps the locale modules in one canonical key order.
//
// Every bundle follows the reference locale (the first entry of
// SUPPORTED_LOCALES, i.e. zh-CN) — the same nesting and the same key sequence —
// so adding a language or a key produces a straight line-by-line diff instead of
// a reshuffle. Keys that only one bundle has are appended untouched; the audit in
// check-i18n.mjs is what reports them.
//
//   node scripts/sort-i18n-keys.mjs            rewrite the files
//   node scripts/sort-i18n-keys.mjs --check    report and exit 1 if any differ
//
// Writes are verified by re-importing the file and deep-comparing it, so a bug
// here cannot corrupt a bundle.

import { readFileSync } from 'node:fs'

import {
  REFERENCE_LOCALE,
  SUPPORTED_LOCALES,
  loadLocaleObject,
  localeModulePath,
  orderLike,
  serializeLocaleModule,
  writeLocaleObject
} from './lib/locale-source.mjs'

const checkOnly = process.argv.includes('--check')

const reference = await loadLocaleObject(REFERENCE_LOCALE)
const pending = []

for (const code of SUPPORTED_LOCALES) {
  const object = await loadLocaleObject(code)
  const ordered = orderLike(object, reference)

  if (checkOnly) {
    if (serializeLocaleModule(code, ordered) !== readFileSync(localeModulePath(code), 'utf8')) {
      pending.push(code)
    }
    continue
  }

  if (await writeLocaleObject(code, ordered)) {
    pending.push(code)
  }
}

if (checkOnly) {
  if (pending.length === 0) {
    console.log(`Locale order: all ${SUPPORTED_LOCALES.length} file(s) follow ${REFERENCE_LOCALE}.`)
    process.exit(0)
  }

  console.error(
    `Locale order: ${pending.length} file(s) do not follow ${REFERENCE_LOCALE}:\n` +
      pending.map((code) => `  - ${localeModulePath(code)}`).join('\n') +
      '\n\nRun "npm run i18n:sort" to fix.'
  )
  process.exit(1)
}

console.log(
  pending.length === 0
    ? `Locale order: no changes (${SUPPORTED_LOCALES.length} file(s) checked).`
    : `Locale order: reordered ${pending.length} file(s): ${pending.join(', ')}.`
)
