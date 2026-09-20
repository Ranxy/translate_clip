import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { APP_LIMITS, DEFAULT_CONFIG, isSupportedLanguage } from '@shared/constants'
import type {
  AppConfig,
  DirectionMode,
  GlossaryEntry,
  LogLevel,
  OverlayConfig,
  ShortcutConfig,
  ThemeMode,
  UiLanguage
} from '@shared/types'

import { writeFileAtomic } from '../utils/atomicWrite'

type Warn = (message: string) => void

interface NumericLimit {
  min: number
  max: number
}

function clampNumber(value: unknown, fallback: number, limit: NumericLimit, integer: boolean, warn: Warn, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback
  }

  const clamped = Math.min(Math.max(value, limit.min), limit.max)
  if (clamped !== value) {
    warn(`${label} out of range (${limit.min}–${limit.max}), clamped to ${clamped}`)
  }

  return integer ? Math.round(clamped) : clamped
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T, warn: Warn, label: string): T {
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) {
    return value as T
  }

  if (typeof value !== 'undefined') {
    warn(`${label} had an unsupported value, using "${fallback}"`)
  }

  return fallback
}

function sanitizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function sanitizeLanguage(value: unknown, fallback: string, warn: Warn, label: string): string {
  if (typeof value === 'string' && isSupportedLanguage(value)) {
    return value
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    // Unknown but well-formed tags are kept so power users are not blocked by
    // our catalogue; only structurally bogus values fall back.
    return value.trim()
  }

  if (typeof value !== 'undefined') {
    warn(`${label} was not a usable language tag, using "${fallback}"`)
  }

  return fallback
}

function sanitizeString(value: unknown, fallback: string, maxLength: number): string {
  if (typeof value !== 'string') {
    return fallback
  }

  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return fallback
  }

  return trimmed.slice(0, maxLength)
}

function sanitizeIgnorePatterns(value: unknown, warn: Warn): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  const seen = new Set<string>()
  const patterns: string[] = []

  for (const entry of value) {
    if (typeof entry !== 'string') {
      continue
    }

    const pattern = entry.trim()
    if (pattern.length === 0 || pattern.length > 500 || seen.has(pattern)) {
      continue
    }

    try {
      new RegExp(pattern)
    } catch {
      warn(`dropped invalid ignore pattern: ${pattern}`)
      continue
    }

    seen.add(pattern)
    patterns.push(pattern)

    if (patterns.length >= 50) {
      break
    }
  }

  return patterns
}

function sanitizeShortcuts(value: unknown, warn: Warn): ShortcutConfig {
  const defaults = DEFAULT_CONFIG.shortcuts
  if (!value || typeof value !== 'object') {
    return { ...defaults }
  }

  const source = value as Record<string, unknown>

  const sanitizeAccelerator = (raw: unknown, label: string): string | null => {
    if (raw === null || typeof raw === 'undefined' || raw === '') {
      return null
    }

    if (typeof raw !== 'string' || raw.length > 64) {
      warn(`${label} shortcut was not a valid accelerator`)
      return null
    }

    return raw
  }

  return {
    toggleOverlay: sanitizeAccelerator(source.toggleOverlay, 'toggleOverlay'),
    translateClipboard: sanitizeAccelerator(source.translateClipboard, 'translateClipboard')
  }
}

function sanitizeOverlay(value: unknown, warn: Warn): OverlayConfig {
  const source = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const defaults = DEFAULT_CONFIG.overlay

  return {
    width: clampNumber(source.width, defaults.width, APP_LIMITS.overlayWidth, true, warn, 'overlay.width'),
    height: clampNumber(source.height, defaults.height, APP_LIMITS.overlayHeight, true, warn, 'overlay.height'),
    opacity: clampNumber(source.opacity, defaults.opacity, APP_LIMITS.overlayOpacity, false, warn, 'overlay.opacity'),
    opaque: sanitizeBoolean(source.opaque, defaults.opaque),
    fontSize: clampNumber(source.fontSize, defaults.fontSize, APP_LIMITS.overlayFontSize, true, warn, 'overlay.fontSize'),
    collapsed: sanitizeBoolean(source.collapsed, defaults.collapsed),
    clickThrough: sanitizeBoolean(source.clickThrough, defaults.clickThrough)
  }
}

function sanitizeGlossary(value: unknown): GlossaryEntry[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .filter(
      (entry): entry is GlossaryEntry =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as GlossaryEntry).id === 'string' &&
        (entry as GlossaryEntry).id.trim().length > 0 &&
        typeof (entry as GlossaryEntry).terms === 'object' &&
        (entry as GlossaryEntry).terms !== null
    )
    .map((entry) => ({
      id: entry.id.trim(),
      notes: typeof entry.notes === 'string' ? entry.notes.trim() || undefined : undefined,
      terms: sanitizeTermsMap(entry.terms)
    }))
    .filter((entry) => Object.keys(entry.terms).length > 0)
}

function sanitizeTermsMap(input: unknown): Record<string, string[]> {
  if (!input || typeof input !== 'object') {
    return {}
  }

  const result: Record<string, string[]> = {}

  for (const [language, variants] of Object.entries(input as Record<string, unknown>)) {
    const key = language.trim()
    if (key.length === 0) {
      continue
    }

    const values = (Array.isArray(variants) ? variants : [variants])
      .filter((variant): variant is string => typeof variant === 'string')
      .map((variant) => variant.trim())
      .filter((variant) => variant.length > 0)

    if (values.length > 0) {
      result[key] = values
    }
  }

  return result
}

const UI_LANGUAGES: UiLanguage[] = ['system', 'zh-CN', 'en']
const THEMES: ThemeMode[] = ['system', 'light', 'dark']
const DIRECTION_MODES: DirectionMode[] = ['auto', 'fixed']
const LOG_LEVELS: LogLevel[] = ['error', 'warn', 'info', 'debug']

/**
 * Validates and clamps an arbitrary object into a usable AppConfig.
 *
 * This is the only place configuration is validated: the renderer sends patches,
 * the IPC layer forwards them, and every path funnels through here.
 */
export function sanitizeConfig(input: unknown, warn: Warn = () => undefined): AppConfig {
  const source = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const minChars = clampNumber(source.minSourceChars, DEFAULT_CONFIG.minSourceChars, APP_LIMITS.minSourceChars, true, warn, 'minSourceChars')
  let maxChars = clampNumber(source.maxSourceChars, DEFAULT_CONFIG.maxSourceChars, APP_LIMITS.maxSourceChars, true, warn, 'maxSourceChars')
  if (maxChars <= minChars) {
    warn('maxSourceChars was not larger than minSourceChars, reset to default')
    maxChars = Math.max(DEFAULT_CONFIG.maxSourceChars, minChars + 1)
  }

  return {
    uiLanguage: oneOf(source.uiLanguage, UI_LANGUAGES, DEFAULT_CONFIG.uiLanguage, warn, 'uiLanguage'),
    theme: oneOf(source.theme, THEMES, DEFAULT_CONFIG.theme, warn, 'theme'),
    onboardingCompleted: sanitizeBoolean(source.onboardingCompleted, DEFAULT_CONFIG.onboardingCompleted),

    clipboardWatchEnabled: sanitizeBoolean(source.clipboardWatchEnabled, DEFAULT_CONFIG.clipboardWatchEnabled),
    pollIntervalMs: clampNumber(source.pollIntervalMs, DEFAULT_CONFIG.pollIntervalMs, APP_LIMITS.pollIntervalMs, true, warn, 'pollIntervalMs'),
    minSourceChars: minChars,
    maxSourceChars: maxChars,
    skipSingleToken: sanitizeBoolean(source.skipSingleToken, DEFAULT_CONFIG.skipSingleToken),
    ignorePatterns: sanitizeIgnorePatterns(source.ignorePatterns, warn),

    directionMode: oneOf(source.directionMode, DIRECTION_MODES, DEFAULT_CONFIG.directionMode, warn, 'directionMode'),
    targetLanguage: sanitizeLanguage(source.targetLanguage, DEFAULT_CONFIG.targetLanguage, warn, 'targetLanguage'),
    fallbackLanguage: sanitizeLanguage(source.fallbackLanguage, DEFAULT_CONFIG.fallbackLanguage, warn, 'fallbackLanguage'),
    translationPrompt: sanitizeString(source.translationPrompt, DEFAULT_CONFIG.translationPrompt, 8_000),
    temperature: clampNumber(source.temperature, DEFAULT_CONFIG.temperature, APP_LIMITS.temperature, false, warn, 'temperature'),
    requestTimeoutMs: clampNumber(source.requestTimeoutMs, DEFAULT_CONFIG.requestTimeoutMs, APP_LIMITS.requestTimeoutMs, true, warn, 'requestTimeoutMs'),
    retryCount: clampNumber(source.retryCount, DEFAULT_CONFIG.retryCount, APP_LIMITS.retryCount, true, warn, 'retryCount'),
    streamEnabled: sanitizeBoolean(source.streamEnabled, DEFAULT_CONFIG.streamEnabled),
    translationCacheEnabled: sanitizeBoolean(source.translationCacheEnabled, DEFAULT_CONFIG.translationCacheEnabled),
    autoReplaceClipboard: sanitizeBoolean(source.autoReplaceClipboard, DEFAULT_CONFIG.autoReplaceClipboard),
    cacheTtlHours: clampNumber(source.cacheTtlHours, DEFAULT_CONFIG.cacheTtlHours, APP_LIMITS.cacheTtlHours, true, warn, 'cacheTtlHours'),
    glossaryEnabled: sanitizeBoolean(source.glossaryEnabled, DEFAULT_CONFIG.glossaryEnabled),
    glossaryMaxTerms: clampNumber(source.glossaryMaxTerms, DEFAULT_CONFIG.glossaryMaxTerms, APP_LIMITS.glossaryMaxTerms, true, warn, 'glossaryMaxTerms'),
    glossary: sanitizeGlossary(source.glossary),

    overlay: sanitizeOverlay(source.overlay, warn),

    shortcuts: sanitizeShortcuts(source.shortcuts, warn),
    launchAtLogin: sanitizeBoolean(source.launchAtLogin, DEFAULT_CONFIG.launchAtLogin),
    closeToTray: sanitizeBoolean(source.closeToTray, DEFAULT_CONFIG.closeToTray),
    notificationsEnabled: sanitizeBoolean(source.notificationsEnabled, DEFAULT_CONFIG.notificationsEnabled),
    historyLimit: clampNumber(source.historyLimit, DEFAULT_CONFIG.historyLimit, APP_LIMITS.historyLimit, true, warn, 'historyLimit'),
    llmDebugEnabled: sanitizeBoolean(source.llmDebugEnabled, DEFAULT_CONFIG.llmDebugEnabled),
    logLevel: oneOf(source.logLevel, LOG_LEVELS, DEFAULT_CONFIG.logLevel, warn, 'logLevel')
  }
}

export class ConfigStore {
  private config: AppConfig

  constructor(
    private readonly filePath: string,
    private readonly warn: Warn = () => undefined
  ) {
    this.config = structuredClone(DEFAULT_CONFIG)
  }

  async load(): Promise<AppConfig> {
    try {
      const raw = await readFile(this.filePath, 'utf8')
      this.config = sanitizeConfig(JSON.parse(raw) as unknown, this.warn)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') {
        this.warn(`failed to read config, falling back to defaults: ${(error as Error).message}`)
      }
      this.config = structuredClone(DEFAULT_CONFIG)
    }

    return this.getConfig()
  }

  getConfig(): AppConfig {
    return structuredClone(this.config)
  }

  async update(patch: Partial<AppConfig>): Promise<AppConfig> {
    const merged: Record<string, unknown> = {
      ...this.config,
      ...patch
    }

    if (patch.overlay) {
      merged.overlay = { ...this.config.overlay, ...patch.overlay }
    }

    if (patch.shortcuts) {
      merged.shortcuts = { ...this.config.shortcuts, ...patch.shortcuts }
    }

    this.config = sanitizeConfig(merged, this.warn)
    await this.persist()
    return this.getConfig()
  }

  async persist(): Promise<void> {
    await writeFileAtomic(this.filePath, JSON.stringify(this.config, null, 2))
  }

  static createDefaultFilePath(userDataDirectory: string): string {
    return join(userDataDirectory, 'config.json')
  }
}
