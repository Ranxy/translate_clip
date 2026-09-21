import type { SupportedLocale } from './locales'
import type { AppConfig, LlmProviderId } from './types'

/* ── Language catalogue ────────────────────────────────────────────── */

export interface LanguageOption {
  value: string
  label: string
  /** Base language used for "already in the target language?" comparisons. */
  base: string
  nativeLabel: string
}

export const LANGUAGE_OPTIONS: LanguageOption[] = [
  { value: 'zh-CN', label: 'Chinese (Simplified)', base: 'zh', nativeLabel: '简体中文' },
  { value: 'zh-TW', label: 'Chinese (Traditional)', base: 'zh', nativeLabel: '繁體中文' },
  { value: 'en-US', label: 'English', base: 'en', nativeLabel: 'English' },
  { value: 'ja-JP', label: 'Japanese', base: 'ja', nativeLabel: '日本語' },
  { value: 'ko-KR', label: 'Korean', base: 'ko', nativeLabel: '한국어' },
  { value: 'de-DE', label: 'German', base: 'de', nativeLabel: 'Deutsch' },
  { value: 'fr-FR', label: 'French', base: 'fr', nativeLabel: 'Français' },
  { value: 'es-ES', label: 'Spanish', base: 'es', nativeLabel: 'Español' },
  { value: 'ru-RU', label: 'Russian', base: 'ru', nativeLabel: 'Русский' },
  { value: 'pt-BR', label: 'Portuguese (Brazil)', base: 'pt', nativeLabel: 'Português' },
  { value: 'it-IT', label: 'Italian', base: 'it', nativeLabel: 'Italiano' },
  { value: 'ar-SA', label: 'Arabic', base: 'ar', nativeLabel: 'العربية' },
  { value: 'hi-IN', label: 'Hindi', base: 'hi', nativeLabel: 'हिन्दी' },
  { value: 'th-TH', label: 'Thai', base: 'th', nativeLabel: 'ไทย' },
  { value: 'vi-VN', label: 'Vietnamese', base: 'vi', nativeLabel: 'Tiếng Việt' },
  { value: 'tr-TR', label: 'Turkish', base: 'tr', nativeLabel: 'Türkçe' }
]

export const DEFAULT_TARGET_LANGUAGE = 'zh-CN'
export const DEFAULT_FALLBACK_LANGUAGE = 'en-US'

export function isSupportedLanguage(value: string): boolean {
  return LANGUAGE_OPTIONS.some((option) => option.value === value)
}

export function getLanguageOption(value: string): LanguageOption | null {
  const normalized = value.trim().toLowerCase()
  return (
    LANGUAGE_OPTIONS.find((option) => option.value.toLowerCase() === normalized) ??
    LANGUAGE_OPTIONS.find((option) => option.base === normalized) ??
    null
  )
}

/** 'zh-CN' → 'zh'; unknown tags fall back to the tag itself lowercased. */
export function baseLanguage(value: string): string {
  const option = getLanguageOption(value)
  if (option) {
    return option.base
  }

  return value.trim().toLowerCase().split(/[-_]/u)[0] ?? value.trim().toLowerCase()
}

/**
 * Names a translation language in the interface language.
 *
 * The catalogue only carries the native and English names, so Chinese gets the
 * native one and every other interface language falls back to the English name —
 * which is why the parameter is the whole locale catalogue rather than a pair.
 */
export function languageLabel(value: string, locale: SupportedLocale): string {
  const option = getLanguageOption(value)
  if (!option) {
    return value
  }

  return locale === 'zh-CN' ? option.nativeLabel : option.label
}

/* ── Provider catalogue ────────────────────────────────────────────── */

export const LLM_PROVIDER_DEFINITIONS: ReadonlyArray<{
  providerId: LlmProviderId
  label: string
  description: string
  defaultApiBaseUrl: string
  requiresApiKey: boolean
  docsUrl: string | null
}> = [
  {
    providerId: 'openai',
    label: 'OpenAI',
    description: 'OpenAI GPT models.',
    defaultApiBaseUrl: 'https://api.openai.com/v1',
    requiresApiKey: true,
    docsUrl: 'https://platform.openai.com/api-keys'
  },
  {
    providerId: 'deepseek',
    label: 'DeepSeek',
    description: 'DeepSeek chat and reasoner models.',
    defaultApiBaseUrl: 'https://api.deepseek.com',
    requiresApiKey: true,
    docsUrl: 'https://platform.deepseek.com/api_keys'
  },
  {
    providerId: 'openrouter',
    label: 'OpenRouter',
    description: 'Hundreds of models from many vendors behind one OpenAI-compatible API.',
    defaultApiBaseUrl: 'https://openrouter.ai/api/v1',
    requiresApiKey: true,
    docsUrl: 'https://openrouter.ai/settings/keys'
  },
  {
    providerId: 'ollama',
    label: 'Ollama (local)',
    description: 'Local models served by Ollama. No API key, nothing leaves this machine.',
    defaultApiBaseUrl: 'http://127.0.0.1:11434/v1',
    requiresApiKey: false,
    docsUrl: 'https://ollama.com/download'
  },
  {
    providerId: 'custom',
    label: 'Custom',
    description: 'Any other OpenAI-compatible endpoint.',
    defaultApiBaseUrl: '',
    requiresApiKey: true,
    docsUrl: null
  }
]

/* ── Defaults ──────────────────────────────────────────────────────── */

export const DEFAULT_TRANSLATION_PROMPT = [
  'You are a professional translator. Translate the text the user sends into {{targetLanguage}}.',
  'Preserve names, numbers, units, code identifiers, URLs and markdown structure.',
  'Keep the original line breaks and paragraph structure. Do not add explanations or notes.',
  'Respond with JSON only, exactly: {"detectedLanguage":"<BCP-47 tag of the source text>","translatedText":"<translation>"}'
].join('\n')

export const APP_LIMITS = {
  pollIntervalMs: { min: 200, max: 2000, step: 50 },
  minSourceChars: { min: 1, max: 50, step: 1 },
  maxSourceChars: { min: 10, max: 50_000, step: 10 },
  temperature: { min: 0, max: 1, step: 0.05 },
  requestTimeoutMs: { min: 3_000, max: 180_000, step: 1_000 },
  retryCount: { min: 0, max: 5, step: 1 },
  cacheTtlHours: { min: 1, max: 720, step: 1 },
  glossaryMaxTerms: { min: 5, max: 80, step: 1 },
  historyLimit: { min: 50, max: 5_000, step: 50 },
  overlayWidth: { min: 300, max: 720, step: 10 },
  overlayHeight: { min: 200, max: 900, step: 10 },
  overlayOpacity: { min: 0.6, max: 1, step: 0.02 },
  overlayFontSize: { min: 11, max: 20, step: 1 }
} as const

export const DEFAULT_OVERLAY_WIDTH = 380
export const DEFAULT_OVERLAY_HEIGHT = 520
export const OVERLAY_EDGE_MARGIN = 24

/** Built-in ignore patterns are offered in the UI but deliberately not enabled by default. */
export const SUGGESTED_IGNORE_PATTERNS = [
  { label: 'URL only', pattern: '^https?://\\S+$' },
  { label: 'Numbers only', pattern: '^[\\d\\s.,:%+-]+$' }
]

export const DEFAULT_CONFIG: AppConfig = {
  uiLanguage: 'system',
  theme: 'system',
  onboardingCompleted: false,

  clipboardWatchEnabled: true,
  pollIntervalMs: 400,
  minSourceChars: 2,
  maxSourceChars: 5_000,
  skipSingleToken: false,
  ignorePatterns: [],

  directionMode: 'auto',
  targetLanguage: DEFAULT_TARGET_LANGUAGE,
  fallbackLanguage: DEFAULT_FALLBACK_LANGUAGE,
  translationPrompt: DEFAULT_TRANSLATION_PROMPT,
  temperature: 0.2,
  requestTimeoutMs: 30_000,
  retryCount: 2,
  streamEnabled: false,
  translationCacheEnabled: true,
  autoReplaceClipboard: false,
  cacheTtlHours: 24,
  glossaryEnabled: true,
  glossaryMaxTerms: 30,
  glossary: [],

  overlay: {
    width: DEFAULT_OVERLAY_WIDTH,
    height: DEFAULT_OVERLAY_HEIGHT,
    opacity: 0.96,
    opaque: false,
    fontSize: 14,
    collapsed: false,
    clickThrough: false
  },

  shortcuts: {
    toggleOverlay: null,
    translateClipboard: null
  },
  launchAtLogin: false,
  closeToTray: true,
  notificationsEnabled: false,
  historyLimit: 500,
  llmDebugEnabled: false,
  logLevel: 'info'
}
