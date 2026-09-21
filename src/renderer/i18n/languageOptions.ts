import type { TFunction } from 'i18next'

import { UI_LOCALE_OPTIONS, localeLabel, resolveLocale, uiLocaleOptionLabel, type SupportedLocale } from '@shared/locales'

import type { SelectOption } from '../components/ui/Input'

/** The locale the OS reports for this window, as one of the bundles we ship. */
export function systemLocale(): SupportedLocale {
  return resolveLocale(navigator.language)
}

/** Rows for an interface-language picker, shared by Settings and the wizard. */
export function uiLanguageSelectOptions(t: TFunction): SelectOption[] {
  return [
    { value: 'system', label: t('settings.general.uiLanguageSystem') },
    ...UI_LOCALE_OPTIONS.map((option) => ({ value: option.value, label: uiLocaleOptionLabel(option) }))
  ]
}

/**
 * The hint under a language picker.
 *
 * While "follow system" is selected it names the locale that actually resolves
 * to — the one case where the setting alone does not tell the user what they are
 * looking at.
 */
export function uiLanguageHint(t: TFunction, uiLanguage: string): string | undefined {
  if (uiLanguage !== 'system') {
    return undefined
  }

  return t('settings.general.uiLanguageSystemResolved', { language: localeLabel(systemLocale()) })
}
