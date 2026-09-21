import { en } from './en'
import { ja } from './ja'
import { ru } from './ru'
import { zhCN, type LocaleResource } from './zh-CN'

/** Every locale the interface can be rendered in. Codes are i18next resource keys. */
export type SupportedLocale = 'zh-CN' | 'en' | 'ja' | 'ru'

export const SUPPORTED_LOCALES: readonly SupportedLocale[] = ['zh-CN', 'en', 'ja', 'ru']

export const FALLBACK_LOCALE: SupportedLocale = 'en'

export const LOCALE_RESOURCES: Record<SupportedLocale, LocaleResource> = {
  'zh-CN': zhCN,
  en,
  ja,
  ru
}

/**
 * The interface languages offered in Settings and in the first-run wizard.
 *
 * Ordered the way the picker should render them: the fallback first, then the
 * rest. `nativeLabel` is what the user sees, so the picker stays usable even
 * when the current interface language is one they cannot read.
 */
export interface UiLocaleOption {
  value: SupportedLocale
  /** Name of the language, written in that language. */
  nativeLabel: string
  /** Name of the language in English, for disambiguation. */
  englishLabel: string
}

export const UI_LOCALE_OPTIONS: readonly UiLocaleOption[] = [
  { value: 'en', nativeLabel: 'English', englishLabel: 'English' },
  { value: 'zh-CN', nativeLabel: '简体中文', englishLabel: 'Chinese (Simplified)' },
  { value: 'ja', nativeLabel: '日本語', englishLabel: 'Japanese' },
  { value: 'ru', nativeLabel: 'Русский', englishLabel: 'Russian' }
]

export function isSupportedLocale(value: string | null | undefined): value is SupportedLocale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value)
}

/**
 * Resolves an arbitrary BCP-47 tag to a bundle we actually ship.
 *
 * Accepts both the resource code itself ('ja') and a full system tag
 * ('ja-JP', 'zh-Hans-CN', 'ru_RU'), because `app.getLocale()` and
 * `navigator.language` return the latter while the config stores the former.
 */
export function resolveLocale(value: string | null | undefined): SupportedLocale {
  if (!value) {
    return FALLBACK_LOCALE
  }

  const normalized = value.trim().toLowerCase().replace(/_/gu, '-')

  if (normalized.length === 0) {
    return FALLBACK_LOCALE
  }

  const exact = SUPPORTED_LOCALES.find((locale) => locale.toLowerCase() === normalized)
  if (exact) {
    return exact
  }

  // Language subtag only: 'ja-JP' → 'ja', 'zh-Hans-CN' → 'zh-CN'.
  const language = normalized.split('-')[0]

  switch (language) {
    case 'zh':
      // Traditional Chinese is not a shipped interface language; it reads
      // Simplified, which is the closest thing we have.
      return 'zh-CN'
    case 'en':
      return 'en'
    case 'ja':
      return 'ja'
    case 'ru':
      return 'ru'
    default:
      return FALLBACK_LOCALE
  }
}

/** Display name of a locale for menus and diagnostics. */
export function localeLabel(value: SupportedLocale): string {
  return UI_LOCALE_OPTIONS.find((option) => option.value === value)?.nativeLabel ?? value
}

/**
 * Row label for a language picker: "English" when the English name adds nothing,
 * otherwise "简体中文 — Chinese (Simplified)".
 */
export function uiLocaleOptionLabel(option: UiLocaleOption): string {
  return option.nativeLabel === option.englishLabel
    ? option.nativeLabel
    : `${option.nativeLabel} — ${option.englishLabel}`
}

export { en, ja, ru, zhCN }
export type { LocaleResource }
