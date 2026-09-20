/**
 * The single source of truth for every type that crosses a process boundary.
 *
 * Main, preload and renderer all import from here, so a change made in one place
 * immediately shows up as a type error in the others. Keep it free of runtime
 * imports from `electron` so the renderer bundle stays clean.
 */

/* ── Platform ──────────────────────────────────────────────────────── */

export type PlatformId = 'windows' | 'macos' | 'linux' | 'other'

export type GlobalShortcutSupport = 'full' | 'limited'

export interface PlatformCapabilities {
  platform: PlatformId
  /** False when no system tray host is available (e.g. WSLg), so the UI can hide tray-only affordances. */
  tray: boolean
  /**
   * `limited` means global shortcuts may not reach the host OS (Wayland/WSLg).
   * Windows and macOS are always `full`.
   */
  globalShortcut: GlobalShortcutSupport
  /** True when Electron's safeStorage can actually encrypt (a system keyring is present). */
  keyring: boolean
  /** False in a development run, where registering a startup entry would be meaningless. */
  launchAtLogin: boolean
}

/* ── LLM providers ─────────────────────────────────────────────────── */

export const SUPPORTED_LLM_PROVIDER_IDS = ['openai', 'deepseek', 'openrouter', 'ollama', 'custom'] as const

export type LlmProviderId = (typeof SUPPORTED_LLM_PROVIDER_IDS)[number]

export function isLlmProviderId(value: string): value is LlmProviderId {
  return SUPPORTED_LLM_PROVIDER_IDS.includes(value as LlmProviderId)
}

export interface LlmProviderDefinition {
  providerId: LlmProviderId
  label: string
  description: string
  defaultApiBaseUrl: string
  /** Ollama runs locally and accepts any bearer token, so the UI hides the key field. */
  requiresApiKey: boolean
  docsUrl: string | null
}

export interface LlmProviderModel {
  modelId: string
  label: string
  ownedBy: string | null
}

export interface LlmProviderProfile {
  profileId: string
  providerId: LlmProviderId
  apiBaseUrl: string
  modelName: string
  customLabel: string | null
  hasApiKey: boolean
  createdAt: string
  updatedAt: string
  isActive: boolean
}

export interface LlmProviderState {
  providers: LlmProviderDefinition[]
  profiles: LlmProviderProfile[]
  activeProfileId: string | null
}

export interface SaveLlmProviderProfileInput {
  profileId?: string
  providerId: LlmProviderId
  modelName: string
  apiKey?: string
  copyApiKeyFromProfileId?: string
  customLabel?: string
  apiBaseUrl?: string
}

export interface FetchLlmProviderModelsInput {
  providerId: LlmProviderId
  profileId?: string
  apiKey?: string
  apiBaseUrl?: string
}

export interface LlmConnectionTestInput {
  providerId: LlmProviderId
  profileId?: string
  apiKey?: string
  apiBaseUrl?: string
  modelName: string
}

export type LlmErrorCode =
  | 'unconfigured'
  | 'auth'
  | 'rate-limit'
  | 'timeout'
  | 'server'
  | 'network'
  | 'bad-response'
  | 'canceled'
  | 'unknown'

export interface LlmError {
  code: LlmErrorCode
  message: string
  status: number | null
  retryable: boolean
}

export interface LlmConnectionTestResult {
  ok: boolean
  latencyMs: number | null
  error: LlmError | null
}

/* ── Translation ───────────────────────────────────────────────────── */

export type TranslationPhase =
  | 'idle'
  | 'translating'
  | 'done'
  | 'error'
  | 'skipped'
  | 'canceled'
  | 'unconfigured'

export type TranslationStatus = 'translating' | 'done' | 'error'

export interface TranslationDirection {
  /** BCP-47-ish tag resolved for the source text (may be an approximation from script detection). */
  sourceLanguage: string
  targetLanguage: string
  /** True when the source text was already in the configured target language and the fallback was used. */
  reversed: boolean
}

export interface TranslationRecord {
  id: string
  sourceText: string
  sourceHash: string
  translatedText: string | null
  detectedLanguage: string | null
  sourceLanguage: string
  targetLanguage: string
  providerId: LlmProviderId
  modelName: string
  status: TranslationStatus
  errorCode: LlmErrorCode | null
  errorMessage: string | null
  cached: boolean
  pinned: boolean
  charCount: number
  latencyMs: number | null
  createdAt: string
  updatedAt: string
}

export interface TranslationState {
  phase: TranslationPhase
  sourceText: string | null
  translatedText: string | null
  direction: TranslationDirection | null
  providerId: LlmProviderId | null
  modelName: string | null
  historyId: string | null
  error: LlmError | null
  skipReason: ClipboardSkipReason | null
  latencyMs: number | null
  cached: boolean
}

export interface PromptPreviewInput {
  text: string
  /** Overrides the saved template so the preview can follow unsaved edits. */
  translationPrompt?: string
}

export interface HistoryQuery {
  query?: string
  cursor?: string | null
  limit?: number
  onlyPinned?: boolean
}

export interface HistoryPage {
  items: TranslationRecord[]
  hasMore: boolean
  nextCursor: string | null
}

/* ── Clipboard ─────────────────────────────────────────────────────── */

export type ClipboardSkipReason =
  | 'disabled'
  /** The clipboard holds a file list: copying a file in Explorer also puts its path in as text. */
  | 'file-list'
  | 'empty'
  | 'too-short'
  | 'too-long'
  | 'single-token'
  | 'ignored-pattern'
  | 'same-as-last'
  | 'self-write'

export type ClipboardActivitySource = 'watch' | 'manual' | 'debug'

export interface ClipboardActivity {
  at: string
  accepted: boolean
  reason: ClipboardSkipReason | null
  charCount: number
  preview: string | null
  source: ClipboardActivitySource
}

export interface ClipboardStatus {
  watching: boolean
  lastActivityAt: string | null
  acceptedCount: number
  skippedCount: number
}

/* ── Glossary ──────────────────────────────────────────────────────── */

export interface GlossaryEntry {
  id: string
  notes?: string
  terms: Record<string, string[]>
}

/* ── Configuration ─────────────────────────────────────────────────── */

export type DirectionMode = 'auto' | 'fixed'
export type UiLanguage = 'system' | 'zh-CN' | 'en'
export type ThemeMode = 'system' | 'light' | 'dark'
export type ShortcutAction = 'toggleOverlay' | 'translateClipboard'

export interface OverlayConfig {
  width: number
  height: number
  opacity: number
  /** Solid background instead of the glass effect; escape hatch for GPU/driver quirks. */
  opaque: boolean
  fontSize: number
  collapsed: boolean
  clickThrough: boolean
}

export type ShortcutConfig = Record<ShortcutAction, string | null>

export interface AppConfig {
  // Appearance / first run
  uiLanguage: UiLanguage
  theme: ThemeMode
  onboardingCompleted: boolean

  // Clipboard
  clipboardWatchEnabled: boolean
  pollIntervalMs: number
  minSourceChars: number
  maxSourceChars: number
  skipSingleToken: boolean
  ignorePatterns: string[]

  // Translation
  directionMode: DirectionMode
  targetLanguage: string
  fallbackLanguage: string
  translationPrompt: string
  temperature: number
  requestTimeoutMs: number
  retryCount: number
  streamEnabled: boolean
  translationCacheEnabled: boolean
  cacheTtlHours: number
  glossaryEnabled: boolean
  glossaryMaxTerms: number
  glossary: GlossaryEntry[]

  // Overlay
  overlay: OverlayConfig

  // System integration
  shortcuts: ShortcutConfig
  launchAtLogin: boolean
  closeToTray: boolean
  notificationsEnabled: boolean
  historyLimit: number
  llmDebugEnabled: boolean
  logLevel: LogLevel
}

export type LogLevel = 'error' | 'warn' | 'info' | 'debug'

export interface ShortcutState {
  accelerator: string | null
  registered: boolean
  error: string | null
}

export interface DiagnosticsInfo {
  appVersion: string
  electronVersion: string
  platform: PlatformId
  arch: string
  userDataPath: string
  logsPath: string
  capabilities: PlatformCapabilities
}

/* ── Bootstrap ─────────────────────────────────────────────────────── */

export interface BootstrapPayload {
  config: AppConfig
  llmProviderState: LlmProviderState
  capabilities: PlatformCapabilities
  diagnostics: DiagnosticsInfo
  translationState: TranslationState
  clipboardStatus: ClipboardStatus
  recentHistory: TranslationRecord[]
  pendingOnboarding: boolean
  shortcutState: Record<ShortcutAction, ShortcutState>
}

/* ── Events pushed from main to renderer ───────────────────────────── */

export interface RendererEventMap {
  'translation:state': TranslationState
  'history:update': TranslationRecord
  'config:update': AppConfig
  'clipboard:activity': ClipboardActivity
  'clipboard:status': ClipboardStatus
  'llm:state': LlmProviderState
  'shortcut:state': Record<ShortcutAction, ShortcutState>
  'theme:update': ThemeMode
}

/* ── Preload surface ───────────────────────────────────────────────── */

export interface TranslateClipApi {
  getBootstrapData: () => Promise<BootstrapPayload>
  getDiagnostics: () => Promise<DiagnosticsInfo>

  updateConfig: (patch: Partial<AppConfig>) => Promise<BootstrapPayload>

  setClipboardWatch: (enabled: boolean) => Promise<BootstrapPayload>
  translateClipboardNow: () => Promise<void>
  retranslateLast: () => Promise<void>
  cancelTranslation: () => Promise<void>

  listHistory: (query: HistoryQuery) => Promise<HistoryPage>
  toggleHistoryPin: (id: string) => Promise<void>
  removeHistoryEntry: (id: string) => Promise<void>
  clearHistory: (keepPinned: boolean) => Promise<void>
  copyHistoryTranslation: (id: string) => Promise<void>
  copyText: (text: string) => Promise<void>

  saveLlmProviderProfile: (input: SaveLlmProviderProfileInput) => Promise<BootstrapPayload>
  deleteLlmProviderProfile: (profileId: string) => Promise<BootstrapPayload>
  setActiveLlmProviderProfile: (profileId: string) => Promise<BootstrapPayload>
  fetchLlmProviderModels: (input: FetchLlmProviderModelsInput) => Promise<LlmProviderModel[]>
  getLlmApiKey: (profileId: string) => Promise<string | null>
  testLlmConnection: (input: LlmConnectionTestInput) => Promise<LlmConnectionTestResult>

  saveGlossaryEntry: (entry: GlossaryEntry) => Promise<BootstrapPayload>
  deleteGlossaryEntry: (id: string) => Promise<BootstrapPayload>
  importGlossary: (json: string) => Promise<BootstrapPayload>
  exportGlossary: () => Promise<string>

  /** Renders the real system prompt for a sample text, including glossary matches. */
  previewPrompt: (input: PromptPreviewInput) => Promise<string>

  setShortcut: (action: ShortcutAction, accelerator: string | null) => Promise<{ ok: boolean; error: string | null }>
  testShortcut: (accelerator: string) => Promise<{ ok: boolean; error: string | null }>

  setOverlayCollapsed: (collapsed: boolean) => Promise<void>
  setOverlayClickThrough: (clickThrough: boolean) => Promise<void>
  setOverlayOpacity: (opacity: number) => Promise<void>
  resizeOverlayBy: (deltaY: number) => Promise<void>
  hideOverlay: () => Promise<void>
  showOverlay: () => Promise<void>

  completeOnboarding: () => Promise<BootstrapPayload>
  skipOnboarding: () => Promise<BootstrapPayload>
  openOnboarding: () => Promise<void>
  restartOnboarding: () => Promise<void>

  openSettings: () => Promise<void>
  closeSettings: () => Promise<void>
  openDataFolder: () => Promise<void>
  openLogFolder: () => Promise<void>
  openLlmDebugFolder: () => Promise<void>
  openExternal: (url: string) => Promise<void>
  quit: () => Promise<void>

  /** Dev-only helpers (no-ops in packaged builds). */
  debugInjectClipboard: (text: string) => Promise<void>
  debugIsEnabled: () => Promise<boolean>

  on: <K extends keyof RendererEventMap>(event: K, listener: (payload: RendererEventMap[K]) => void) => () => void
}
