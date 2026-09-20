import { app, clipboard, nativeTheme, shell } from 'electron'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { DEFAULT_CONFIG } from '@shared/constants'
import type {
  AppConfig,
  BootstrapPayload,
  ClipboardActivity,
  ClipboardActivitySource,
  ClipboardStatus,
  DiagnosticsInfo,
  FetchLlmProviderModelsInput,
  GlossaryEntry,
  HistoryPage,
  HistoryQuery,
  LlmConnectionTestInput,
  LlmConnectionTestResult,
  LlmProviderId,
  LlmProviderState,
  PromptPreviewInput,
  SaveLlmProviderProfileInput,
  ShortcutAction,
  ShortcutState,
  TranslationRecord,
  TranslationState
} from '@shared/types'

import { createTranslator, type Translator } from './i18n'
import { registerIpcRouter, type IpcHandler } from './ipc/ipcRouter'
import { canManageLaunchAtLogin, getLaunchAtLogin, setLaunchAtLogin } from './services/autoLaunch'
import { createCapabilityRegistry, type CapabilityRegistry } from './services/capabilityRegistry'
import { ClipboardWatcher, type ClipboardContext } from './services/clipboardWatcher'
import { compileIgnorePatterns, filterClipboardText, type FilterContext } from './services/clipboardFilter'
import { ConfigStore } from './services/configStore'
import { createCredentialStore, type CredentialStore } from './services/credentialStore'
import { createDatabaseService, type DatabaseService } from './services/database'
import { notifyTranslationFailure } from './services/desktopNotifier'
import { HistoryRepository } from './services/historyRepository'
import { detectLanguage, resolveDirection } from './services/languageDetector'
import { checkProviderConnection, toLlmError } from './services/llmClient'
import { LlmConfigStore } from './services/llmConfigStore'
import { fetchProviderModels, resolveApiBaseUrl } from './services/llmProviderCatalog'
import { buildSystemPrompt } from './services/promptBuilder'
import { TranslationQueue } from './services/translationQueue'
import { createLogger, type Logger } from './services/logStore'
import { ShortcutManager } from './services/shortcutManager'
import { TrayController } from './services/trayController'
import { WindowManager } from './services/windowManager'
import { WindowStateStore } from './services/windowStateStore'
import { runSelfCheck, type SelfCheckReport } from './selfCheck'
import { toPreview } from './utils/hash'
import { getLogsPath, getUserDataPath, resolveResourcePath } from './utils/paths'

/* ── Command line switches (must run before app is ready) ──────────── */

if (process.env.TRANSLATE_CLIP_DISABLE_GPU === '1') {
  // Escape hatch for WSLg and for drivers where the translucent overlay
  // composites badly.
  app.commandLine.appendSwitch('disable-gpu')
}

if (process.platform === 'linux' && typeof process.getuid === 'function' && process.getuid() === 0) {
  app.commandLine.appendSwitch('no-sandbox')
}

const STARTED_HIDDEN = process.argv.includes('--hidden')
const SELF_CHECK = process.argv.includes('--self-check')

function resolveUiLanguage(config: AppConfig): string {
  return config.uiLanguage === 'system' ? app.getLocale() : config.uiLanguage
}

function createIdleTranslationState(): TranslationState {
  return {
    phase: 'idle',
    sourceText: null,
    translatedText: null,
    direction: null,
    providerId: null,
    modelName: null,
    historyId: null,
    error: null,
    skipReason: null,
    latencyMs: null,
    cached: false
  }
}

class TranslateClipApp {
  private readonly logger: Logger
  private readonly configStore: ConfigStore
  private readonly windowStateStore: WindowStateStore
  private readonly capabilities: CapabilityRegistry
  private readonly windowManager: WindowManager
  private readonly shortcutManager: ShortcutManager
  private readonly tray: TrayController
  private readonly credentialStore: CredentialStore
  private readonly clipboardWatcher: ClipboardWatcher
  private readonly database: DatabaseService
  private readonly llmConfigStore: LlmConfigStore
  private readonly history: HistoryRepository
  private readonly translationQueue: TranslationQueue

  private config: AppConfig = structuredClone(DEFAULT_CONFIG)
  private translator: Translator
  private translationState: TranslationState = createIdleTranslationState()
  private clipboardLastActivityAt: string | null = null
  private clipboardAcceptedCount = 0
  private clipboardSkippedCount = 0
  private ignorePatterns: RegExp[] = []
  private lastAcceptedHash: string | null = null
  private failureNotifiedAt = new Map<string, number>()
  private quitting = false
  private flushedBeforeQuit = false

  constructor() {
    this.logger = createLogger(getLogsPath('main.log'), DEFAULT_CONFIG.logLevel)
    this.configStore = new ConfigStore(ConfigStore.createDefaultFilePath(app.getPath('userData')), (message) =>
      this.logger.warn(`config: ${message}`)
    )
    this.windowStateStore = new WindowStateStore(WindowStateStore.createDefaultFilePath(app.getPath('userData')))
    this.capabilities = createCapabilityRegistry(this.logger)
    this.credentialStore = createCredentialStore(this.logger)
    this.translator = createTranslator(null)

    this.database = createDatabaseService({ filePath: getUserDataPath('data.sqlite'), log: this.logger })
    this.llmConfigStore = new LlmConfigStore(this.database, this.credentialStore, this.logger)
    this.history = new HistoryRepository(this.database, this.logger)
    this.translationQueue = new TranslationQueue({
      log: this.logger,
      getConfig: () => this.config,
      getActiveConfig: () => this.llmConfigStore.getResolvedConfig(),
      history: this.history,
      buildSystemPrompt: (direction, text) => buildSystemPrompt(this.config, direction, text),
      onState: (state) => this.setTranslationState(state)
    })

    this.clipboardWatcher = new ClipboardWatcher({
      adapter: {
        readText: () => clipboard.readText(),
        writeText: (text) => clipboard.writeText(text),
        readFormats: () => clipboard.availableFormats()
      },
      pollIntervalMs: this.config.pollIntervalMs,
      isEnabled: () => this.config.clipboardWatchEnabled,
      onCandidate: (text, source, context) => this.handleClipboardCandidate(text, source, context),
      onError: (error) => this.logger.warn('clipboard read failed', error)
    })

    this.windowManager = new WindowManager({
      preloadPath: this.preloadPath,
      rendererIndexPath: this.rendererIndexPath,
      devServerUrl: process.env.ELECTRON_RENDERER_URL,
      windowStateStore: this.windowStateStore,
      getConfig: () => this.config,
      log: this.logger,
      shouldKeepRunningInTray: () => this.config.closeToTray && this.capabilities.get().tray,
      isQuitting: () => this.quitting
    })

    this.shortcutManager = new ShortcutManager({
      handlers: {
        toggleOverlay: () => this.windowManager.toggleOverlay(),
        translateClipboard: () => this.translateClipboardNow()
      },
      log: this.logger
    })

    this.tray = new TrayController({
      getConfig: () => this.config,
      getTranslator: () => this.translator,
      isOverlayVisible: () => this.windowManager.isOverlayVisible(),
      isLaunchAtLoginAvailable: () => canManageLaunchAtLogin(),
      log: this.logger,
      actions: {
        toggleOverlay: () => {
          this.windowManager.toggleOverlay()
          this.tray.refresh()
        },
        translateClipboard: () => this.translateClipboardNow(),
        toggleWatching: () => {
          void this.updateConfig({ clipboardWatchEnabled: !this.config.clipboardWatchEnabled })
        },
        setCollapsed: (collapsed) => {
          void this.updateConfig({ overlay: { ...this.config.overlay, collapsed } })
        },
        setClickThrough: (enabled) => {
          void this.updateConfig({ overlay: { ...this.config.overlay, clickThrough: enabled } })
        },
        setLaunchAtLogin: (enabled) => {
          void this.updateConfig({ launchAtLogin: enabled })
        },
        openSettings: () => this.windowManager.openSettingsWindow(),
        openLogFolder: () => void this.openFolder(getLogsPath()),
        quit: () => app.quit()
      }
    })
  }

  /* ── Boot ────────────────────────────────────────────────────────── */

  private get preloadPath(): string {
    return join(app.getAppPath(), 'out', 'preload', 'preload.cjs')
  }

  private get rendererIndexPath(): string {
    return join(app.getAppPath(), 'out', 'renderer', 'index.html')
  }

  async initialize(): Promise<void> {
    this.config = await this.configStore.load()
    await this.database.load()
    await this.windowStateStore.load()

    this.logger.setLevel(this.config.logLevel)
    this.translator = createTranslator(resolveUiLanguage(this.config))
    this.capabilities.refresh()

    nativeTheme.themeSource = this.config.theme
    this.logger.info('starting TranslateClip', {
      version: app.getVersion(),
      platform: process.platform,
      packaged: app.isPackaged,
      hidden: STARTED_HIDDEN
    })

    await this.syncLaunchAtLogin()
    this.shortcutManager.apply(this.config.shortcuts)

    const trayIconPath = resolveResourcePath('tray', 'tray.png')
    const trayCreated = this.tray.create(trayIconPath)
    this.capabilities.setTrayAvailable(trayCreated)
    this.logger.info(trayCreated ? 'system tray ready' : 'running without a system tray')

    this.ignorePatterns = compileIgnorePatterns(this.config.ignorePatterns)

    if (SELF_CHECK) {
      // A diagnostic run must not read (and therefore never send) whatever the
      // user happens to have on their clipboard.
      this.logger.info('self-check mode: clipboard watching is not started')
      return
    }

    this.clipboardWatcher.applyPollInterval(this.config.pollIntervalMs)
    this.clipboardWatcher.start()
    this.logger.info('clipboard watcher started', {
      pollIntervalMs: this.config.pollIntervalMs,
      enabled: this.config.clipboardWatchEnabled
    })
  }

  createWindows(): void {
    this.windowManager.createOverlayWindow()
    if (this.config.onboardingCompleted || STARTED_HIDDEN) {
      return
    }

    // First run: the wizard owns the translation direction, so it opens before
    // the user ever sees a "not configured" overlay.
    //
    // Closing the window by any means other than the wizard's own buttons does
    // NOT count as "setup finished" — an unexpected close (window manager, crash,
    // remote session disconnect) must not silently swallow the first-run flow.
    this.windowManager.openOnboardingWindow(() => {
      this.logger.warn('onboarding window closed without an explicit finish; first-run setup stays pending')
    })  }

  /* ── Config ──────────────────────────────────────────────────────── */

  async updateConfig(patch: Partial<AppConfig>): Promise<BootstrapPayload> {
    const previous = this.config
    const next = await this.configStore.update(patch)
    this.config = next

    this.logger.setLevel(next.logLevel)

    if (next.uiLanguage !== previous.uiLanguage) {
      this.translator = createTranslator(resolveUiLanguage(next))
    }

    if (next.theme !== previous.theme || nativeTheme.themeSource !== next.theme) {
      nativeTheme.themeSource = next.theme
    }

    this.windowManager.applyOverlayBehaviour(next, previous)

    // Value comparisons, not references: sanitizeConfig rebuilds every array and object
    // on each write, so `!==` on them is always true and the work below would run on
    // every unrelated settings change.
    if (next.ignorePatterns.join('\n') !== previous.ignorePatterns.join('\n')) {
      this.ignorePatterns = compileIgnorePatterns(next.ignorePatterns)
    }

    if (next.pollIntervalMs !== previous.pollIntervalMs) {
      this.clipboardWatcher.applyPollInterval(next.pollIntervalMs)
    }

    if (next.clipboardWatchEnabled !== previous.clipboardWatchEnabled) {
      // Restarting re-seeds whatever is currently on the clipboard, so resuming
      // never fires a translation for something copied while watching was paused.
      this.clipboardWatcher.stop()

      // A diagnostic run never reads the clipboard (see initialize()), so it must not
      // start watching here either — the watch-toggle self-check probe flips this very
      // setting, and would otherwise hand the user's clipboard to the pipeline.
      if (next.clipboardWatchEnabled && !SELF_CHECK) {
        this.clipboardWatcher.start()
      }

      this.logger.info(`clipboard watching ${next.clipboardWatchEnabled ? 'resumed' : 'paused'}`)
    }

    if (next.overlay.collapsed !== previous.overlay.collapsed) {
      this.windowManager.setOverlayCollapsed(next.overlay.collapsed)
    }

    if (
      next.shortcuts.toggleOverlay !== previous.shortcuts.toggleOverlay ||
      next.shortcuts.translateClipboard !== previous.shortcuts.translateClipboard
    ) {
      // Re-applying releases and re-acquires the global shortcuts, so doing it while the
      // user changes an unrelated setting risks losing a working combination to whatever
      // grabs it in that instant.
      this.windowManager.broadcast('shortcut:state', this.shortcutManager.apply(next.shortcuts))
    }

    if (next.launchAtLogin !== previous.launchAtLogin) {
      await setLaunchAtLogin(next.launchAtLogin, this.logger)
    }

    if (next.historyLimit !== previous.historyLimit) {
      // Lowering the limit should take effect now rather than after the next translation.
      this.history.prune(next.historyLimit)
    }

    this.windowManager.refreshWindowBackgroundColors()
    this.tray.refresh()
    this.windowManager.broadcast('config:update', next)
    this.windowManager.broadcast('clipboard:status', this.getClipboardStatus())

    return this.buildBootstrapPayload()
  }

  private async syncLaunchAtLogin(): Promise<void> {
    try {
      const actual = await getLaunchAtLogin()
      // null means this environment cannot be queried (a development run); the stored
      // preference is then simply left alone instead of being "corrected".
      if (actual !== null && actual !== this.config.launchAtLogin) {
        await setLaunchAtLogin(this.config.launchAtLogin, this.logger)
      }
    } catch (error) {
      this.logger.warn('failed to reconcile the launch-at-login setting', error)
    }
  }

  private async markOnboardingCompleted(): Promise<void> {
    if (this.config.onboardingCompleted) {
      return
    }

    this.logger.info('onboarding finished')
    await this.updateConfig({ onboardingCompleted: true })
  }

  /* ── Clipboard ───────────────────────────────────────────────────── */

  /**
   * Single entry point for "some text showed up".
   *
   * Every path — the watcher, the tray entry, the overlay button and the debug
   * injector — funnels through here, so the filter chain and the direction
   * decision can never be bypassed. Phase 2 inserts the translation queue between
   * the state update below and the broadcast.
   */
  private handleClipboardCandidate(
    text: string,
    source: ClipboardActivitySource,
    context: ClipboardContext = { hasFileList: false }
  ): void {
    // A file copy carries its path as text. Automatic watching skips it, but an
    // explicit "translate clipboard now" does what it says.
    if (context.hasFileList && source === 'watch') {
      this.publishClipboardActivity({
        at: new Date().toISOString(),
        accepted: false,
        reason: 'file-list',
        charCount: text.length,
        preview: null,
        source
      })

      this.setTranslationState({ ...this.translationState, skipReason: 'file-list' })
      return
    }

    const result = filterClipboardText(text, this.getFilterContext(), this.lastAcceptedHash)

    if (!result.accepted) {
      this.publishClipboardActivity({
        at: new Date().toISOString(),
        accepted: false,
        reason: result.reason,
        charCount: result.charCount,
        preview: null,
        source
      })

      this.setTranslationState({ ...this.translationState, skipReason: result.reason })
      return
    }

    this.lastAcceptedHash = result.hash
    this.publishClipboardActivity({
      at: new Date().toISOString(),
      accepted: true,
      reason: null,
      charCount: result.text.length,
      preview: toPreview(result.text),
      source
    })

    const activeProfile = this.getActiveProfile()
    const detection = detectLanguage(result.text)
    const direction = resolveDirection(detection, {
      directionMode: this.config.directionMode,
      targetLanguage: this.config.targetLanguage,
      fallbackLanguage: this.config.fallbackLanguage
    })

    this.logger.debug('clipboard candidate accepted', {
      chars: result.text.length,
      detected: detection.language,
      script: detection.script,
      confidence: Number(detection.confidence.toFixed(2)),
      direction
    })

    if (this.config.llmDebugEnabled) {
      this.logger.info('translation request prepared', {
        direction,
        providerId: activeProfile?.providerId ?? null,
        systemPrompt: buildSystemPrompt(this.config, direction, result.text)
      })
    }

    if (!activeProfile) {
      // Nothing to send to yet: show what was captured plus the setup call to action.
      this.setTranslationState({
        phase: 'unconfigured',
        sourceText: result.text,
        translatedText: null,
        direction,
        providerId: null,
        modelName: null,
        historyId: null,
        error: null,
        skipReason: null,
        latencyMs: null,
        cached: false
      })
      return
    }

    // The queue owns the state from here: it reports translating → done/error and
    // aborts any request that a newer copy has already made obsolete.
    this.translationQueue.submit({ text: result.text, hash: result.hash, direction })
  }

  private setTranslationState(next: TranslationState): void {
    this.translationState = next
    this.windowManager.broadcast('translation:state', next)

    // A finished job is a new history row: push it so an open history list updates
    // without polling.
    if (next.phase === 'error' && next.error) {
      const lastNotifiedAt = this.failureNotifiedAt.get(next.error.code) ?? null
      const shown = notifyTranslationFailure(next, this.config, this.translator, lastNotifiedAt, () =>
        this.windowManager.showOverlay()
      )

      if (shown) {
        this.failureNotifiedAt.set(next.error.code, Date.now())
      }
    }

    if (next.historyId && (next.phase === 'done' || next.phase === 'error')) {
      const record = this.history.getById(next.historyId)

      if (record) {
        this.windowManager.broadcast('history:update', record)
      }
    }
  }

  private getFilterContext(): FilterContext {
    return {
      minSourceChars: this.config.minSourceChars,
      maxSourceChars: this.config.maxSourceChars,
      skipSingleToken: this.config.skipSingleToken,
      ignorePatterns: this.ignorePatterns
    }
  }

  private getActiveProfile(): LlmProviderState['profiles'][number] | null {
    const state = this.llmConfigStore.getState()
    return state.profiles.find((profile) => profile.profileId === state.activeProfileId) ?? null
  }

  private publishProviderState(): BootstrapPayload {
    this.windowManager.broadcast('llm:state', this.llmConfigStore.getState())
    return this.buildBootstrapPayload()
  }

  private getApiBaseUrlFor(providerId: LlmProviderId, profileId?: string, explicit?: string): string {
    const fromProfile = profileId
      ? this.llmConfigStore.getState().profiles.find((profile) => profile.profileId === profileId)?.apiBaseUrl
      : undefined

    return resolveApiBaseUrl(providerId, explicit ?? fromProfile)
  }

  /**
   * Prefers a key the user just typed (not saved yet), then the profile's stored
   * key, then the active profile's — so "test connection" works before saving.
   */
  private resolveApiKeyFor(input: { profileId?: string; apiKey?: string }): string | null {
    if (typeof input.apiKey === 'string' && input.apiKey.trim().length > 0) {
      return input.apiKey.trim()
    }

    if (input.profileId) {
      return this.llmConfigStore.getApiKey(input.profileId)
    }

    return this.llmConfigStore.getResolvedConfig()?.apiKey ?? null
  }

  private saveGlossaryEntry(entry: GlossaryEntry): Promise<BootstrapPayload> {
    const others = this.configStore.getConfig().glossary.filter((existing) => existing.id !== entry.id)
    return this.updateConfig({ glossary: [...others, entry] })
  }

  private importGlossary(json: string): Promise<BootstrapPayload> {
    let parsed: unknown

    try {
      parsed = JSON.parse(json) as unknown
    } catch {
      throw new Error('The glossary file is not valid JSON.')
    }

    const incoming = Array.isArray(parsed) ? parsed : (parsed as { glossary?: unknown })?.glossary

    if (!Array.isArray(incoming)) {
      throw new Error('The glossary file does not contain a list of entries.')
    }

    const merged = new Map(this.configStore.getConfig().glossary.map((entry) => [entry.id, entry]))

    for (const entry of incoming) {
      if (entry && typeof entry === 'object' && typeof (entry as GlossaryEntry).id === 'string') {
        merged.set((entry as GlossaryEntry).id, entry as GlossaryEntry)
      }
    }

    return this.updateConfig({ glossary: [...merged.values()] })
  }

  private publishClipboardActivity(activity: ClipboardActivity): void {
    this.clipboardLastActivityAt = activity.at

    if (activity.accepted) {
      this.clipboardAcceptedCount += 1
    } else {
      this.clipboardSkippedCount += 1
    }

    this.windowManager.broadcast('clipboard:activity', activity)
    this.windowManager.broadcast('clipboard:status', this.getClipboardStatus())
  }

  private getClipboardStatus(): ClipboardStatus {
    return {
      watching: this.config.clipboardWatchEnabled,
      lastActivityAt: this.clipboardLastActivityAt,
      acceptedCount: this.clipboardAcceptedCount,
      skippedCount: this.clipboardSkippedCount
    }
  }

  translateClipboardNow(): void {
    this.clipboardWatcher.readNow('manual')
  }

  /**
   * Empties the overlay's current view.
   *
   * An in-flight request is aborted first: otherwise the answer arrives a moment later and
   * refills the panel the user just cleared. The history entry is left alone — this clears what
   * is on screen, and the history panel has its own way to remove entries.
   */
  clearTranslation(): void {
    this.translationQueue.cancel()
    this.logger.info('current translation cleared')
    this.setTranslationState(createIdleTranslationState())
  }

  /* ── Snapshots ───────────────────────────────────────────────────── */

  private buildProviderState(): LlmProviderState {
    return this.llmConfigStore.getState()
  }

  /**
   * History for the bootstrap payload.
   *
   * Guarded because the overlay must be able to start even if the database could
   * not be opened — a broken history file must never take the whole app down.
   */
  private getRecentHistory(): TranslationRecord[] {
    try {
      return this.history.list({ limit: 20 }).items
    } catch (error) {
      this.logger.warn('history is unavailable', error)
      return []
    }
  }

  private getDiagnostics(): DiagnosticsInfo {
    return {
      appVersion: app.getVersion(),
      electronVersion: process.versions.electron,
      platform: this.capabilities.get().platform,
      arch: process.arch,
      userDataPath: app.getPath('userData'),
      logsPath: getLogsPath(),
      capabilities: this.capabilities.get()
    }
  }

  private buildBootstrapPayload(): BootstrapPayload {
    return {
      config: this.configStore.getConfig(),
      llmProviderState: this.buildProviderState(),
      capabilities: this.capabilities.get(),
      diagnostics: this.getDiagnostics(),
      translationState: this.translationState,
      clipboardStatus: this.getClipboardStatus(),
      recentHistory: this.getRecentHistory(),
      pendingOnboarding: !this.config.onboardingCompleted,
      shortcutState: this.shortcutManager.getState()
    }
  }

  /* ── IPC surface ─────────────────────────────────────────────────── */

  private buildIpcHandlers(): Record<string, IpcHandler> {
    return {
      'app:getBootstrapData': () => this.buildBootstrapPayload(),
      'app:getDiagnostics': () => this.getDiagnostics(),
      'app:updateConfig': (patch: Partial<AppConfig>) => this.updateConfig(patch),
      'app:openExternal': async (url: string) => {
        const parsed = new URL(url)
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
          throw new Error('Only http(s) links can be opened')
        }

        await shell.openExternal(url)
      },
      'app:quit': () => {
        app.quit()
      },

      'app:setClipboardWatch': (enabled: boolean) => this.updateConfig({ clipboardWatchEnabled: enabled }),
      'app:translateClipboardNow': () => this.translateClipboardNow(),
      'app:retranslateLast': () => this.translationQueue.retranslate(),
      'app:cancelTranslation': () => this.translationQueue.cancel(),
      'app:clearTranslation': () => this.clearTranslation(),

      'clipboard:writeText': (text: string) => {
        // Goes through the watcher so the app's own write is suppressed instead of
        // being picked up as a fresh copy.
        this.clipboardWatcher.writeText(text)
      },

      /* ── History ─────────────────────────────────────────────────── */

      'history:list': (query: HistoryQuery): HistoryPage => this.history.list(query ?? {}),
      'history:togglePin': (id: string) => this.history.togglePin(id),
      'history:remove': (id: string) => this.history.remove(id),
      'history:clear': (keepPinned: boolean) => this.history.clear(keepPinned !== false),
      'history:copyTranslation': (id: string) => {
        const record = this.history.getById(id)

        if (!record?.translatedText) {
          throw new Error('That entry has no translation to copy.')
        }

        this.clipboardWatcher.writeText(record.translatedText)
      },

      /* ── Providers ───────────────────────────────────────────────── */

      'llm:saveProviderProfile': async (input: SaveLlmProviderProfileInput) => {
        await this.llmConfigStore.saveProfile(input)
        return this.publishProviderState()
      },
      'llm:deleteProviderProfile': async (profileId: string) => {
        await this.llmConfigStore.deleteProfile(profileId)
        return this.publishProviderState()
      },
      'llm:setActiveProviderProfile': async (profileId: string) => {
        await this.llmConfigStore.setActiveProfile(profileId)
        return this.publishProviderState()
      },
      'llm:getApiKey': (profileId: string) => this.llmConfigStore.getApiKey(profileId),
      'llm:fetchModels': (input: FetchLlmProviderModelsInput) =>
        fetchProviderModels({
          apiBaseUrl: this.getApiBaseUrlFor(input.providerId, input.profileId, input.apiBaseUrl),
          apiKey: this.resolveApiKeyFor(input)
        }),
      'llm:testConnection': async (input: LlmConnectionTestInput): Promise<LlmConnectionTestResult> => {
        const startedAt = Date.now()

        try {
          await checkProviderConnection({
            apiBaseUrl: this.getApiBaseUrlFor(input.providerId, input.profileId, input.apiBaseUrl),
            apiKey: this.resolveApiKeyFor(input),
            timeoutMs: 15_000
          })

          return { ok: true, latencyMs: Date.now() - startedAt, error: null }
        } catch (error) {
          return { ok: false, latencyMs: Date.now() - startedAt, error: toLlmError(error) }
        }
      },

      /* ── Glossary ────────────────────────────────────────────────── */

      'glossary:save': (entry: GlossaryEntry) => this.saveGlossaryEntry(entry),
      'glossary:delete': (id: string) =>
        this.updateConfig({ glossary: this.configStore.getConfig().glossary.filter((entry) => entry.id !== id) }),
      'glossary:import': (json: string) => this.importGlossary(json),
      'glossary:export': () => JSON.stringify(this.configStore.getConfig().glossary, null, 2),

      'prompt:preview': (input: PromptPreviewInput): string => {
        // Routes through the real detection and prompt assembly, so the preview can
        // never drift from what is actually sent. The template may be overridden so
        // the preview follows unsaved edits.
        const text = input.text
        const detection = detectLanguage(text)
        const direction = resolveDirection(detection, {
          directionMode: this.config.directionMode,
          targetLanguage: this.config.targetLanguage,
          fallbackLanguage: this.config.fallbackLanguage
        })

        return buildSystemPrompt(
          { ...this.config, translationPrompt: input.translationPrompt?.trim() || DEFAULT_CONFIG.translationPrompt },
          direction,
          text
        )
      },

      'shortcut:set': async (action: ShortcutAction, accelerator: string | null) => {
        const result = this.shortcutManager.set(action, accelerator)

        if (result.ok) {
          const shortcuts = { ...this.config.shortcuts, [action]: accelerator }
          await this.updateConfig({ shortcuts })
        }

        this.windowManager.broadcast('shortcut:state', this.shortcutManager.getState())
        return result
      },
      'shortcut:test': (accelerator: string) => this.shortcutManager.test(accelerator),

      'overlay:setCollapsed': (collapsed: boolean) =>
        this.updateConfig({ overlay: { ...this.config.overlay, collapsed } }).then(() => undefined),
      'overlay:setClickThrough': (clickThrough: boolean) =>
        this.updateConfig({ overlay: { ...this.config.overlay, clickThrough } }).then(() => undefined),
      'overlay:setOpacity': (opacity: number) =>
        this.updateConfig({ overlay: { ...this.config.overlay, opacity } }).then(() => undefined),
      'overlay:resizeBy': (deltaY: number) => this.windowManager.resizeOverlayBy(deltaY),
      'overlay:hide': () => this.windowManager.hideOverlay(),
      'overlay:show': () => this.windowManager.showOverlay(),

      'window:openSettings': () => this.windowManager.openSettingsWindow(),
      'window:closeSettings': () => this.windowManager.closeSettingsWindow(),
      'window:openOnboarding': () =>
        this.windowManager.openOnboardingWindow(() => {
          this.logger.warn('onboarding window closed without an explicit finish; first-run setup stays pending')
        }),
      'window:openDataFolder': () => this.openFolder(app.getPath('userData')),
      'window:openLogFolder': () => this.openFolder(getLogsPath()),
      'window:openLlmDebugFolder': () => this.openFolder(getLogsPath('llm')),

      'onboarding:complete': async () => {
        this.windowManager.closeOnboardingWindow()
        await this.markOnboardingCompleted()
        return this.buildBootstrapPayload()
      },
      'onboarding:skip': async () => {
        this.logger.info('onboarding skipped by the user')
        this.windowManager.closeOnboardingWindow()
        await this.markOnboardingCompleted()
        return this.buildBootstrapPayload()
      },
      'onboarding:restart': async () => {
        await this.updateConfig({ onboardingCompleted: false })
        this.windowManager.openOnboardingWindow(() => {
          this.logger.warn('onboarding window closed without an explicit finish; first-run setup stays pending')
        })
      },

      // The injector is only reachable from our own renderer frames (see
      // isTrustedSender) and only meaningful for diagnostics, so it is allowed in
      // development and for an explicit `--self-check` run of a packaged build.
      'debug:isEnabled': () => !app.isPackaged || SELF_CHECK,
      'debug:injectClipboard': (text: string) => {
        if (app.isPackaged && !SELF_CHECK) {
          return
        }

        this.logger.debug('injecting clipboard candidate', { length: text.length })
        this.handleClipboardCandidate(text, 'debug')
      }
    }
  }

  getIpcChannelNames(): string[] {
    return Object.keys(this.buildIpcHandlers())
  }

  registerIpc(): void {
    registerIpcRouter(this.buildIpcHandlers(), {
      isTrustedSender: (event) => this.isTrustedSender(event),
      log: this.logger
    })
  }

  /**
   * Only top-level frames that actually point at our renderer entry may call IPC.
   *
   * Checking the frame URL (rather than a registry of windows we created) is both
   * stricter — no nested frame can reach the bridge — and independent of how a
   * window was spawned, which also covers the diagnostic windows used by
   * `--self-check`.
   */
  private isTrustedSender(event: Electron.IpcMainInvokeEvent): boolean {
    const frame = event.senderFrame

    if (!frame || frame.parent !== null) {
      return false
    }

    return this.isTrustedRendererUrl(frame.url)
  }

  private isTrustedRendererUrl(rawUrl: string): boolean {
    const devServerUrl = process.env.ELECTRON_RENDERER_URL

    try {
      const url = new URL(rawUrl)

      if (devServerUrl) {
        const dev = new URL(devServerUrl)
        return url.origin === dev.origin && url.pathname.startsWith(dev.pathname)
      }

      if (url.protocol !== 'file:') {
        return false
      }

      return fileURLToPath(url) === this.rendererIndexPath
    } catch {
      return false
    }
  }

  /* ── Diagnostics ─────────────────────────────────────────────────── */

  /**
   * Forces pending writes to disk.
   *
   * Needed before `app.exit()`, which skips the `before-quit` hook and would
   * otherwise drop everything still sitting in the debounced write buffer.
   */
  async flushDatabase(): Promise<void> {
    await this.database.flush()
  }

  async runSelfCheck(): Promise<SelfCheckReport> {
    return runSelfCheck({
      preloadPath: this.preloadPath,
      rendererIndexPath: this.rendererIndexPath,
      devServerUrl: process.env.ELECTRON_RENDERER_URL,
      userDataPath: app.getPath('userData'),
      trayIconPath: resolveResourcePath('tray', 'tray.png'),
      appIconPath: resolveResourcePath('icons', 'icon.png'),
      iconAssets: [
        { label: 'icons/icon.png', path: resolveResourcePath('icons', 'icon.png'), expectedSize: 512 },
        { label: 'icons/256x256.png', path: resolveResourcePath('icons', '256x256.png'), expectedSize: 256 },
        { label: 'icons/32x32.png', path: resolveResourcePath('icons', '32x32.png'), expectedSize: 32 },
        { label: 'tray/tray.png', path: resolveResourcePath('tray', 'tray.png'), expectedSize: 32 },
        { label: 'tray/tray@2x.png', path: resolveResourcePath('tray', 'tray@2x.png'), expectedSize: 32 }
      ],
      log: this.logger
    })
  }

  /* ── Lifecycle ───────────────────────────────────────────────────── */

  /**
   * Surfaces the app when a second instance starts (clicking its icon again, for
   * example). The overlay is normally already visible, so the settings window is
   * what the user is actually asking for.
   */
  focusPrimaryWindow(options: { silent?: boolean } = {}): void {
    this.windowManager.showOverlay()

    if (!options.silent) {
      this.windowManager.openSettingsWindow()
    }
  }

  handleThemeUpdated(): void {
    this.windowManager.refreshWindowBackgroundColors()
    this.windowManager.broadcast('theme:update', this.config.theme)
  }

  handleBeforeQuit(event: Electron.Event): void {
    this.quitting = true

    if (this.flushedBeforeQuit) {
      return
    }

    // History writes are debounced, so the newest translations are still only in
    // memory at this point. Block the quit exactly once to get them onto disk.
    event.preventDefault()
    this.clipboardWatcher.stop()
    this.translationQueue.dispose()

    void this.database
      .flush()
      .catch((error) => this.logger.warn('failed to flush the database during shutdown', error))
      .finally(() => {
        this.flushedBeforeQuit = true
        this.shortcutManager.dispose()
        this.tray.destroy()
        app.quit()
      })
  }

  shouldQuitOnAllWindowsClosed(): boolean {
    if (process.platform === 'darwin') {
      return false
    }

    return !(this.capabilities.get().tray && this.config.closeToTray)
  }

  private async openFolder(path: string): Promise<void> {
    const error = await shell.openPath(path)
    if (error) {
      this.logger.warn(`failed to open folder ${path}: ${error}`)
    }
  }

  /** Exposed for the tray/diagnostics so "the same key" is used everywhere. */
  getTranslator(): Translator {
    return this.translator
  }

  getShortcutState(): Record<ShortcutAction, ShortcutState> {
    return this.shortcutManager.getState()
  }

  getConfig(): AppConfig {
    return this.configStore.getConfig()
  }

  getCredentialStore(): CredentialStore {
    return this.credentialStore
  }

  getLogger(): Logger {
    return this.logger
  }
}

const translateClip = new TranslateClipApp()

const hasSingleInstanceLock = app.requestSingleInstanceLock()

if (!hasSingleInstanceLock) {
  if (SELF_CHECK) {
    // Otherwise the diagnostic would exit silently and look like it passed (or did
    // nothing), while the running instance keeps holding the database.
    process.stderr.write('\n[self-check] SKIPPED: another TranslateClip instance is running. Quit it and run again.\n')
    app.exit(2)
  } else {
    app.quit()
  }
} else {
  app.on('second-instance', (_event, argv) => {
    // Only a user-initiated launch (clicking the icon again) should surface the app.
    // `--hidden` is the autostart path, and `--self-check` is a diagnostic run: neither
    // should pop a window in the instance that already owns the lock.
    const silent = argv.includes('--hidden') || argv.includes('--self-check')
    translateClip.focusPrimaryWindow({ silent })
  })

  app.whenReady().then(async () => {
    if (process.platform === 'win32') {
      app.setAppUserModelId('com.ranxy.translateclip')
    }

    await translateClip.initialize()
    translateClip.registerIpc()

    if (SELF_CHECK) {
      const report = await translateClip.runSelfCheck()
      await translateClip.flushDatabase()
      process.stdout.write(`\n[self-check] ${report.ok ? 'PASSED' : 'FAILED'} ${JSON.stringify(report.entries, null, 2)}\n`)
      app.exit(report.ok ? 0 : 1)
      return
    }

    translateClip.createWindows()

    nativeTheme.on('updated', () => {
      translateClip.handleThemeUpdated()
    })

    app.on('activate', () => {
      translateClip.focusPrimaryWindow()
    })
  })

  app.on('before-quit', (event) => {
    translateClip.handleBeforeQuit(event)
  })

  app.on('window-all-closed', () => {
    if (translateClip.shouldQuitOnAllWindowsClosed()) {
      app.quit()
    }
  })
}

export { translateClip }
