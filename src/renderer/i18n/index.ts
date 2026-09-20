import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'

import { LOCALE_RESOURCES, resolveLocale } from '@shared/locales'

/** Resolves the configured UI language, expanding the 'system' pseudo-value. */
export function resolveUiLanguage(uiLanguage: string): string {
  return uiLanguage === 'system' ? navigator.language : uiLanguage
}

export async function initI18n(uiLanguage: string): Promise<void> {
  await i18next.use(initReactI18next).init({
    resources: {
      'zh-CN': { translation: LOCALE_RESOURCES['zh-CN'] },
      en: { translation: LOCALE_RESOURCES.en }
    },
    lng: resolveLocale(resolveUiLanguage(uiLanguage)),
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    returnNull: false
  })
}

export function changeLanguage(uiLanguage: string): void {
  void i18next.changeLanguage(resolveLocale(resolveUiLanguage(uiLanguage)))
}

export default i18next
