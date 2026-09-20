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
  HistoryPage,
  HistoryQuery,
  LlmProviderState,
  ShortcutAction,
  ShortcutState,
  TranslationState
} from '@shared/types'

import { createTranslator, type Translator } from './i18n'
import { registerIpcRouter, type IpcHandler } from './ipc/ipcRouter'
import { createCapabilityRegistry, type CapabilityRegistry } from './services/capabilityRegistry'
import { ConfigStore } from './services/configStore'
import { createCredentialStore, type CredentialStore } from './services/credentialStore'
import { getLaunchAtLogin, setLaunchAtLogin } from './services/autoLaunch'
import { createEmptyProviderState } from './services/llmProviderCatalog'
import { createLogger, type Logger } from './services/logStore'
import { ShortcutManager } from './services/shortcutManager'
import { TrayController } from './services/trayController'
import { WindowManager } from './services/windowManager'
import { WindowStateStore } from './services/windowStateStore'
import { runSelfCheck, type SelfCheckReport } from './selfCheck'
import { getLogsPath, resolveResourcePath } from './utils/paths'

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

  private config: AppConfig = structuredClone(DEFAULT_CONFIG)
  private translator: Translator
  private translationState: TranslationState = createIdleTranslationState()
  private clipboardLastActivityAt: string | null = null
  private clipboardAcceptedCount = 0
  private clipboardSkippedCount = 0
  private quitting = false

  constructor() {
    this.logger = createLogger(getLogsPath('main.log'), DEFAULT_CONFIG.logLevel)
    this.configStore = new ConfigStore(ConfigStore.createDefaultFilePath(app.getPath('userData')), (message) =>
      this.logger.warn(`config: ${message}`)
    )
    this.windowStateStore = new WindowStateStore(WindowStateStore.createDefaultFilePath(app.getPath('userData')))
    this.capabilities = createCapabilityRegistry(this.logger)
    this.credentialStore = createCredentialStore(this.logger)
    this.translator = createTranslator(null)

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
    })
  }

  /* ── Config ──────────────────────────────────────────────────────── */

  async updateConfig(patch: Partial<AppConfig>): Promise<BootstrapPayload> {
    const previous = this.config
    const next = await this.configStore.update(patch)
    this.config = next

    this.logger.setLevel(next.logLevel)

    if (next.uiLanguage !== previous.uiLanguage || next.uiLanguage === 'system') {
      this.translator = createTranslator(resolveUiLanguage(next))
    }

    if (next.theme !== previous.theme || nativeTheme.themeSource !== next.theme) {
      nativeTheme.themeSource = next.theme
    }

    this.windowManager.applyOverlayBehaviour(next)

    if (next.overlay.collapsed !== previous.overlay.collapsed) {
      this.windowManager.setOverlayCollapsed(next.overlay.collapsed)
    }

    if (next.shortcuts !== previous.shortcuts) {
      this.windowManager.broadcast('shortcut:state', this.shortcutManager.apply(next.shortcuts))
    }

    if (next.launchAtLogin !== previous.launchAtLogin) {
      await setLaunchAtLogin(next.launchAtLogin, this.logger)
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
      if (actual !== this.config.launchAtLogin) {
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
   * Phase 1 inserts the filter chain, language detection and the translation
   * queue between this method and the activity broadcast; the seam exists now so
   * the debug injector exercises exactly the production path.
   */
  private handleClipboardCandidate(text: string, source: ClipboardActivitySource): void {
    const normalized = text.replace(/\r\n/gu, '\n').trim()

    if (normalized.length === 0) {
      this.publishClipboardActivity({
        at: new Date().toISOString(),
        accepted: false,
        reason: 'empty',
        charCount: 0,
        preview: null,
        source
      })
      return
    }

    this.publishClipboardActivity({
      at: new Date().toISOString(),
      accepted: true,
      reason: null,
      charCount: normalized.length,
      preview: normalized.slice(0, 160),
      source
    })
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
    this.handleClipboardCandidate(clipboard.readText(), 'manual')
  }

  /* ── Snapshots ───────────────────────────────────────────────────── */

  private buildProviderState(): LlmProviderState {
    // Phase 1 replaces this with the sql.js profile store snapshot.
    return createEmptyProviderState()
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
      recentHistory: [],
      pendingOnboarding: !this.config.onboardingCompleted,
      shortcutState: this.shortcutManager.getState()
    }
  }

  /* ── IPC surface ─────────────────────────────────────────────────── */

  private buildIpcHandlers(): Record<string, IpcHandler> {
    const notImplemented = (feature: string) => (): never => {
      throw new Error(`${feature} is not available in this build yet`)
    }

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
      'app:retranslateLast': notImplemented('Re-translation'),
      'app:cancelTranslation': notImplemented('Cancelling a translation'),

      'clipboard:writeText': (text: string) => {
        clipboard.writeText(text)
      },

      'history:list': notImplemented('Translation history') as unknown as (
        query: HistoryQuery
      ) => Promise<HistoryPage>,
      'history:togglePin': notImplemented('Translation history'),
      'history:remove': notImplemented('Translation history'),
      'history:clear': notImplemented('Translation history'),
      'history:copyTranslation': notImplemented('Translation history'),

      'llm:saveProviderProfile': notImplemented('Provider profiles'),
      'llm:deleteProviderProfile': notImplemented('Provider profiles'),
      'llm:setActiveProviderProfile': notImplemented('Provider profiles'),
      'llm:fetchModels': notImplemented('Fetching provider models'),
      'llm:getApiKey': () => null,
      'llm:testConnection': notImplemented('Connection tests'),

      'glossary:save': notImplemented('The glossary'),
      'glossary:delete': notImplemented('The glossary'),
      'glossary:import': notImplemented('The glossary'),
      'glossary:export': notImplemented('The glossary'),

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

      'debug:isEnabled': () => !app.isPackaged,
      'debug:injectClipboard': (text: string) => {
        if (app.isPackaged) {
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

  async runSelfCheck(): Promise<SelfCheckReport> {
    return runSelfCheck({
      preloadPath: this.preloadPath,
      rendererIndexPath: this.rendererIndexPath,
      devServerUrl: process.env.ELECTRON_RENDERER_URL,
      userDataPath: app.getPath('userData'),
      trayIconPath: resolveResourcePath('tray', 'tray.png'),
      appIconPath: resolveResourcePath('icons', 'icon.png'),
      log: this.logger
    })
  }

  /* ── Lifecycle ───────────────────────────────────────────────────── */

  focusPrimaryWindow(): void {
    this.windowManager.showOverlay()

    if (this.windowManager.getSettingsWindow()) {
      this.windowManager.openSettingsWindow()
    }
  }

  handleThemeUpdated(): void {
    this.windowManager.refreshWindowBackgroundColors()
    this.windowManager.broadcast('theme:update', this.config.theme)
  }

  handleBeforeQuit(): void {
    this.quitting = true
    this.shortcutManager.dispose()
    this.tray.destroy()
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
  app.quit()
} else {
  app.on('second-instance', () => {
    translateClip.focusPrimaryWindow()
  })

  app.whenReady().then(async () => {
    if (process.platform === 'win32') {
      app.setAppUserModelId('com.ranxy.translateclip')
    }

    await translateClip.initialize()
    translateClip.registerIpc()

    if (SELF_CHECK) {
      const report = await translateClip.runSelfCheck()
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

  app.on('before-quit', () => {
    translateClip.handleBeforeQuit()
  })

  app.on('window-all-closed', () => {
    if (translateClip.shouldQuitOnAllWindowsClosed()) {
      app.quit()
    }
  })
}

export { translateClip }
