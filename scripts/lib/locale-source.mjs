// scripts/lib/locale-source.mjs
//
// Reads, reorders and rewrites the locale modules in src/shared/locales.
//
// The locale files are TypeScript, not JSON, on purpose: `en`, `ja` and `ru` are
// typed as the Chinese resource, so a missing or misspelled key is a compile
// error before any check script runs. That leaves the scripts here needing to
// read and write TS source — Node strips the types on import, so the modules can
// be loaded directly, and only the writer has to know the syntax (a plain object
// of strings, which is all these files are allowed to contain).
//
// Writes are verified: the file is re-imported and deep-compared against the
// intended object, so a bug in the writer can never silently corrupt a bundle.

import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

export const ROOT = resolve(__dirname, '../..')
export const SOURCE_DIR = resolve(ROOT, 'src')
export const LOCALES_DIR = resolve(SOURCE_DIR, 'shared/locales')
export const CATALOGUE_FILE = resolve(LOCALES_DIR, 'index.ts')

const catalogueSource = readFileSync(CATALOGUE_FILE, 'utf8')

/** Reads a `['a', 'b']`-shaped string array out of the catalogue source. */
function readStringArray(source, identifier) {
  const match = new RegExp(`${identifier}[^=]*=\\s*\\[([^\\]]*)\\]`, 'u').exec(source)

  if (!match) {
    throw new Error(`could not find ${identifier} in ${CATALOGUE_FILE}`)
  }

  return [...match[1].matchAll(/['"]([^'"]+)['"]/gu)].map((entry) => entry[1])
}

/** The `value:` fields of UI_LOCALE_OPTIONS, in the order the picker renders them. */
function readPickerValues(source) {
  const match = /UI_LOCALE_OPTIONS[^=]*=\s*\[([\s\S]*?)\n\]/u.exec(source)

  if (!match) {
    throw new Error(`could not find UI_LOCALE_OPTIONS in ${CATALOGUE_FILE}`)
  }

  return [...match[1].matchAll(/value:\s*['"]([^'"]+)['"]/gu)].map((entry) => entry[1])
}

export const SUPPORTED_LOCALES = readStringArray(catalogueSource, 'SUPPORTED_LOCALES')
export const UI_LOCALE_VALUES = readPickerValues(catalogueSource)

/** The locale every other bundle is measured against, and whose order is canonical. */
export const REFERENCE_LOCALE = SUPPORTED_LOCALES[0]

export function localeModuleCodes() {
  return readdirSync(LOCALES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts') && entry.name !== 'index.ts')
    .map((entry) => entry.name.replace(/\.ts$/u, ''))
}

export function localeModulePath(code) {
  return join(LOCALES_DIR, `${code}.ts`)
}

// The reference module declares no annotation (every other bundle is typed
// against it), so the declaration is read with the annotation optional and
// re-emitted exactly as it was found.
const DECLARATION = /export const ([A-Za-z0-9_$]+)(\s*:\s*LocaleResource)?\s*=\s*\{/u

/** Reads the `export const name: LocaleResource` declaration out of a module. */
function readDeclaration(text, code) {
  const match = DECLARATION.exec(text)

  if (!match) {
    throw new Error(`${localeModulePath(code)} has no "export const <name>[: LocaleResource] = {" declaration`)
  }

  return { exportName: match[1], annotation: match[2] ?? '', declarationEnd: match.index }
}

let importCounter = 0

/**
 * Loads a locale module.
 *
 * `cacheBust` re-reads a file this process already imported, which is what the
 * writer needs in order to verify what it just wrote.
 */
export async function loadLocaleObject(code, { cacheBust = false } = {}) {
  const url = pathToFileURL(localeModulePath(code))

  if (cacheBust) {
    importCounter += 1
    url.searchParams.set('v', String(importCounter))
  }

  let module

  try {
    module = await import(url.href)
  } catch (cause) {
    // Importing TypeScript directly needs Node's type stripping, which is on by
    // default from 22.18; older runtimes fail with an unhelpful syntax error.
    throw new Error(
      `${localeModulePath(code)} could not be imported (${cause.message}). ` +
        'These scripts read the locale modules directly and need Node 22.18 or newer.'
    )
  }

  const { exportName } = readDeclaration(readFileSync(localeModulePath(code), 'utf8'), code)
  const object = module[exportName]

  if (!object || typeof object !== 'object') {
    throw new Error(`${localeModulePath(code)} does not export an object named "${exportName}"`)
  }

  return object
}

/** `{ a: { b: 'x' } }` → `Map { 'a.b' => 'x' }`, in declaration order. */
export function flatten(object, prefix = '') {
  const result = new Map()

  for (const [key, value] of Object.entries(object)) {
    const path = prefix ? `${prefix}.${key}` : key

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [nested, nestedValue] of flatten(value, path)) {
        result.set(nested, nestedValue)
      }
    } else {
      result.set(path, value)
    }
  }

  return result
}

export function deepEqual(left, right) {
  if (left === right) {
    return true
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => deepEqual(value, right[index]))
    )
  }

  if (left && right && typeof left === 'object' && typeof right === 'object') {
    const leftKeys = Object.keys(left)
    const rightKeys = Object.keys(right)

    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every((key) => Object.hasOwn(right, key) && deepEqual(left[key], right[key]))
    )
  }

  return false
}

/**
 * Reorders `object` so its keys follow `shape`, recursively.
 *
 * Keys absent from `shape` are appended in their original order: the audit
 * reports them as errors, and dropping a translation during a reformat would be
 * a much worse failure than an out-of-order one.
 */
export function orderLike(object, shape) {
  if (Array.isArray(object) || object === null || typeof object !== 'object') {
    return object
  }

  const template = shape && typeof shape === 'object' && !Array.isArray(shape) ? shape : {}
  const ordered = {}

  for (const key of Object.keys(template)) {
    if (Object.hasOwn(object, key)) {
      ordered[key] = orderLike(object[key], template[key])
    }
  }

  for (const key of Object.keys(object)) {
    if (!Object.hasOwn(ordered, key)) {
      ordered[key] = orderLike(object[key], template[key])
    }
  }

  return ordered
}

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/u

function quote(value) {
  return `'${value
    .replace(/\\/gu, '\\\\')
    .replace(/'/gu, "\\'")
    .replace(/\n/gu, '\\n')
    .replace(/\r/gu, '\\r')}'`
}

function serializeValue(value, indent) {
  if (typeof value === 'string') {
    return quote(value)
  }

  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return JSON.stringify(value)
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => serializeValue(entry, indent + 1)).join(', ')}]`
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value)

    if (entries.length === 0) {
      return '{}'
    }

    const pad = '  '.repeat(indent + 1)
    const body = entries
      .map(([key, nested]) => {
        const name = IDENTIFIER.test(key) ? key : quote(key)
        return `${pad}${name}: ${serializeValue(nested, indent + 1)}`
      })
      .join(',\n')

    return `{\n${body}\n${'  '.repeat(indent)}}`
  }

  throw new Error(`cannot serialize a locale value of type ${typeof value}`)
}

/** Rebuilds a locale module's source from an object, keeping its header and footer. */
export function serializeLocaleModule(code, object) {
  const text = readFileSync(localeModulePath(code), 'utf8')
  const { exportName, annotation, declarationEnd } = readDeclaration(text, code)

  // The object literal is the last thing in the file except for an optional
  // trailing `export type`; its closing brace is the only one in column 0.
  const closingBrace = text.lastIndexOf('\n}')

  if (closingBrace < declarationEnd) {
    throw new Error(`could not find the end of the locale object in ${localeModulePath(code)}`)
  }

  const header = text.slice(0, declarationEnd)
  const footer = text.slice(closingBrace + 2)

  // Matches the file's existing line endings, so a reformat never shows up as a
  // whole-file whitespace diff.
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const body = `export const ${exportName}${annotation} = ${serializeValue(object, 0)}`

  return `${header}${body.split('\n').join(eol)}${footer}`
}

/**
 * Writes a locale module and proves the result still parses to the same object.
 *
 * Returns true when the file changed on disk.
 */
export async function writeLocaleObject(code, object) {
  const path = localeModulePath(code)
  const next = serializeLocaleModule(code, object)
  const current = readFileSync(path, 'utf8')

  if (next === current) {
    return false
  }

  writeFileSync(path, next)

  const reloaded = await loadLocaleObject(code, { cacheBust: true })

  if (!deepEqual(reloaded, object)) {
    // Put the original back rather than leave a corrupted bundle behind.
    writeFileSync(path, current)
    throw new Error(`refusing to write ${path}: the result did not read back as the same object (file restored)`)
  }

  return true
}
