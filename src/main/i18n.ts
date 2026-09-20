import { FALLBACK_LOCALE, LOCALE_RESOURCES, resolveLocale } from '@shared/locales'

export type Translator = (key: string, params?: Record<string, string | number>) => string

function lookup(resource: unknown, key: string): string | null {
  let current: unknown = resource

  for (const segment of key.split('.')) {
    if (typeof current !== 'object' || current === null) {
      return null
    }

    current = (current as Record<string, unknown>)[segment]
  }

  return typeof current === 'string' ? current : null
}

function interpolate(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/gu, (match, name: string) => {
    const value = params[name]
    return typeof value === 'undefined' ? match : String(value)
  })
}

/**
 * Minimal translator for the main process: tray menus, notifications and
 * dialogs need strings, but pulling i18next into the main bundle for a handful
 * of labels is not worth it. The renderer keeps using i18next over the same
 * locale resources.
 */
export function createTranslator(locale: string | null | undefined): Translator {
  const selected = resolveLocale(locale)
  const primary = LOCALE_RESOURCES[selected]
  const fallback = LOCALE_RESOURCES[FALLBACK_LOCALE]

  return (key, params) => {
    const value = lookup(primary, key) ?? lookup(fallback, key) ?? key
    return params ? interpolate(value, params) : value
  }
}
