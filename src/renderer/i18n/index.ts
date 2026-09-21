import i18next, { type Resource } from 'i18next'
import { initReactI18next } from 'react-i18next'

import {
  FALLBACK_LOCALE,
  LOCALE_RESOURCES,
  SUPPORTED_LOCALES,
  resolveLocale,
  type SupportedLocale
} from '@shared/locales'

/**
 * Resolves the configured UI language, expanding the 'system' pseudo-value with
 * the locale the OS reports for this window.
 */
export function resolveUiLanguage(uiLanguage: string): SupportedLocale {
  return resolveLocale(uiLanguage === 'system' ? navigator.language : uiLanguage)
}

/**
 * Keeps the document's `lang` attribute in step with the interface language.
 *
 * Chromium picks fonts, line-breaking and hyphenation rules from it, which is
 * visible in CJK and Cyrillic text — a Japanese interface left marked
 * `lang="en"` gets Chinese glyph variants for the shared ideographs.
 */
function applyDocumentLanguage(locale: SupportedLocale): void {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale
  }
}

/** Every shipped bundle, keyed the way i18next expects. Built once, at import. */
const resources: Resource = Object.fromEntries(
  SUPPORTED_LOCALES.map((locale) => [locale, { translation: LOCALE_RESOURCES[locale] }])
)

export async function initI18n(uiLanguage: string): Promise<void> {
  const locale = resolveUiLanguage(uiLanguage)

  if (!i18next.isInitialized) {
    await i18next.use(initReactI18next).init({
      resources,
      lng: locale,
      // Both are already resolved to a shipped bundle by `resolveUiLanguage`, so
      // i18next never has to guess; the fallback only covers a future catalogue
      // entry that ships a resource file but no translation yet.
      fallbackLng: FALLBACK_LOCALE,
      supportedLngs: [...SUPPORTED_LOCALES],
      load: 'currentOnly',
      interpolation: { escapeValue: false },
      returnNull: false
    })
  } else {
    await i18next.changeLanguage(locale)
  }

  applyDocumentLanguage(locale)
}

export function changeLanguage(uiLanguage: string): void {
  const locale = resolveUiLanguage(uiLanguage)
  void i18next.changeLanguage(locale).then(() => applyDocumentLanguage(locale))
}

/** The interface language currently rendering, for diagnostics and tests. */
export function currentLanguage(): SupportedLocale {
  return resolveLocale(i18next.resolvedLanguage ?? i18next.language)
}

export default i18next
