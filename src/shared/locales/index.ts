import { en } from './en'
import { zhCN, type LocaleResource } from './zh-CN'

export type SupportedLocale = 'zh-CN' | 'en'

export const SUPPORTED_LOCALES: SupportedLocale[] = ['zh-CN', 'en']
export const FALLBACK_LOCALE: SupportedLocale = 'en'

export const LOCALE_RESOURCES: Record<SupportedLocale, LocaleResource> = {
  'zh-CN': zhCN,
  en
}

/** Resolves a config/navigator locale tag to a bundle we actually ship. */
export function resolveLocale(value: string | null | undefined): SupportedLocale {
  if (!value) {
    return FALLBACK_LOCALE
  }

  const normalized = value.trim().toLowerCase()
  if (normalized.startsWith('zh')) {
    return 'zh-CN'
  }

  if (normalized.startsWith('en')) {
    return 'en'
  }

  return FALLBACK_LOCALE
}

export { en, zhCN }
export type { LocaleResource }
