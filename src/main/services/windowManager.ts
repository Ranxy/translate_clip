import { BrowserWindow, Menu, app, nativeTheme, screen, shell, type MenuItemConstructorOptions } from 'electron'

import { OVERLAY_EDGE_MARGIN } from '@shared/constants'
import type { AppConfig, RendererEventMap } from '@shared/types'

import type { Logger } from './logStore'
import type { WindowKind, WindowStateStore } from './windowStateStore'

export type RendererView = WindowKind

/** Height the overlay shrinks to in collapsed mode (header + one status line). */
const COLLAPSED_OVERLAY_HEIGHT = 76

/**
 * How long a resize event is attributed to us rather than to the user.
 *
 * The OS reports a programmatic `setBounds` back within a frame or two; a drag
 * cannot realistically start and finish inside this window.
 */
const OVERLAY_RESIZE_GUARD_MS = 400

/**
 * Smallest change in either dimension that counts as the user dragging an edge.
 *
 * Windows does not return the size a frameless window was asked for — it comes
 * back a few pixels larger — so anything below this is rounding noise that would
 * otherwise accumulate into growth.
 */
const MIN_DRAG_DELTA_DIP = 8

export interface WindowManagerOptions {
  preloadPath: string
  rendererIndexPath: string
  devServerUrl: string | undefined
  windowStateStore: WindowStateStore
  getConfig: () => AppConfig
  log: Logger
  /** True while the app should stay alive in the tray after the overlay is closed. */
  shouldKeepRunningInTray: () => boolean
  /** True once a real quit is in progress, so close handlers stop intercepting. */
  isQuitting: () => boolean
}

function isSafeExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
  } catch {
    return false
  }
}

/**
 * Owns every window in the app.
 *
 * The overlay is the product's face: frameless, transparent, always on top and
 * never stealing focus. The settings and onboarding windows are ordinary windows
 * so they behave the way users expect from native tooling.
 */
export class WindowManager {
  private overlay: BrowserWindow | null = null
  private settings: BrowserWindow | null = null
  private onboarding: BrowserWindow | null = null

  /**
   * Size the overlay is *meant* to have, in the units the constructor takes.
   *
   * The window's own bounds are not a usable source of truth: on Windows a
   * frameless window comes back from `getBounds()` larger than the size it was
   * created with (4 DIP at 150% scaling), and the offset is not even stable — it
   * changes with the requested size and the window's fractional position. Storing
   * those reported bounds and feeding them into the next launch grows the overlay
   * on every start, forever. Keeping the requested size here breaks that loop.
   */
  private overlaySize: { width: number; height: number } | null = null
  private expandedOverlaySize: { width: number; height: number } | null = null

  /**
   * While set, overlay resize events are ours rather than the user dragging an
   * edge, and must not be mistaken for a new preferred size.
   */
  private overlayResizeGuardUntil = 0

  /**
   * Size the OS last reported for the overlay, used as the baseline a drag is
   * measured against.
   */
  private overlayMeasuredSize: { width: number; height: number } | null = null

  constructor(private readonly options: WindowManagerOptions) {}

  /* ── Overlay ─────────────────────────────────────────────────────── */

  getOverlayWindow(): BrowserWindow | null {
    return this.overlay && !this.overlay.isDestroyed() ? this.overlay : null
  }

  createOverlayWindow(): BrowserWindow {
    const existing = this.getOverlayWindow()
    if (existing) {
      return existing
    }

    const config = this.options.getConfig()
    const bounds = this.resolveOverlayBounds(config)

    const window = new BrowserWindow({
      ...bounds,
      minWidth: 300,
      minHeight: 200,
      maxHeight: 900,
      show: false,
      frame: false,
      transparent: true,
      resizable: true,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: false,
      backgroundColor: '#00000000',
      title: 'TranslateClip',
      webPreferences: this.createWebPreferences()
    })

    this.overlay = window
    this.overlaySize = { width: bounds.width, height: bounds.height }

    // Creating (and later showing) the window makes the OS report a size that is a
    // few pixels off from the one requested. Record it as the baseline and treat
    // the following events as ours, so that offset is never adopted.
    const created = window.getBounds()
    this.overlayMeasuredSize = { width: created.width, height: created.height }
    this.overlayResizeGuardUntil = Date.now() + OVERLAY_RESIZE_GUARD_MS

    // 'screen-saver' is the highest level Windows honours without exclusive
    // fullscreen, and it is accepted (and ignored) on Linux.
    window.setAlwaysOnTop(true, 'screen-saver')

    if (process.platform === 'darwin') {
      window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    }

    this.installContextMenu(window)
    this.installLinkHandler(window)
    this.installRendererDiagnostics(window, 'overlay')
    this.installWindowStatePersistence(window, 'overlay')

    window.on('close', (event) => {
      if (this.options.isQuitting()) {
        return
      }

      if (this.options.shouldKeepRunningInTray()) {
        event.preventDefault()
        window.hide()
      }
    })

    window.on('closed', () => {
      this.overlay = null
      this.overlaySize = null
      this.overlayMeasuredSize = null
      this.expandedOverlaySize = null
    })

    this.applyOverlayBehaviour(config)

    if (config.overlay.collapsed) {
      // Shrink before the first paint so a restart while collapsed looks the same as
      // having collapsed it.
      this.setOverlayCollapsed(true)
    }

    void this.loadView(window, 'overlay').then(() => {
      if (this.overlay && !this.overlay.isDestroyed()) {
        this.showOverlay()
      }
    })

    return window
  }

  showOverlay(): void {
    const window = this.getOverlayWindow()
    if (!window) {
      return
    }

    if (window.isMinimized()) {
      window.restore()
    }

    // showInactive keeps the user's current application focused: a clipboard
    // translator must never steal the caret while someone is typing.
    window.showInactive()
    window.setAlwaysOnTop(true, 'screen-saver')
    window.moveTop()
  }

  hideOverlay(): void {
    this.getOverlayWindow()?.hide()
  }

  isOverlayVisible(): boolean {
    const window = this.getOverlayWindow()
    return Boolean(window?.isVisible())
  }

  toggleOverlay(): boolean {
    if (this.isOverlayVisible()) {
      this.hideOverlay()
      return false
    }

    this.showOverlay()
    return true
  }

  setOverlayCollapsed(collapsed: boolean): void {
    const window = this.getOverlayWindow()
    if (!window) {
      return
    }

    if (collapsed) {
      this.expandedOverlaySize = this.overlaySize ? { ...this.overlaySize } : null
      this.resizeOverlay(window, { height: COLLAPSED_OVERLAY_HEIGHT })
      return
    }

    const restoredHeight = this.expandedOverlaySize?.height ?? this.options.getConfig().overlay.height
    this.expandedOverlaySize = null
    this.resizeOverlay(window, { height: Math.max(restoredHeight, COLLAPSED_OVERLAY_HEIGHT) })
  }

  setOverlayClickThrough(enabled: boolean): void {
    const window = this.getOverlayWindow()
    if (!window) {
      return
    }

    // `forward: true` keeps hover events flowing to the renderer, so the
    // click-through state can still be surfaced visually.
    window.setIgnoreMouseEvents(enabled, { forward: true })
  }

  setOverlayOpacity(opacity: number): void {
    const window = this.getOverlayWindow()
    if (!window) {
      return
    }

    window.setOpacity(Math.min(Math.max(opacity, 0.2), 1))
  }

  resizeOverlayBy(deltaY: number): void {
    const window = this.getOverlayWindow()
    if (!window) {
      return
    }

    const currentHeight = this.overlaySize?.height ?? window.getBounds().height
    this.resizeOverlay(window, { height: Math.min(Math.max(currentHeight + deltaY, 120), 900) })
  }

  /**
   * Applies a size to the overlay and records it as the intended one.
   *
   * Everything that changes the overlay's size goes through here so the value that
   * gets persisted is always the value that was requested, never the size Windows
   * reports back (see `overlaySize`).
   */
  private resizeOverlay(window: BrowserWindow, next: { width?: number; height?: number }): void {
    const bounds = window.getBounds()
    const width = next.width ?? this.overlaySize?.width ?? bounds.width
    const height = next.height ?? this.overlaySize?.height ?? bounds.height

    this.overlaySize = { width, height }
    this.overlayResizeGuardUntil = Date.now() + OVERLAY_RESIZE_GUARD_MS
    window.setBounds({ x: bounds.x, y: bounds.y, width, height })
  }

  /**
   * Re-applies config-driven overlay behaviour.
   *
   * `previous` is omitted when a window is first created and everything must be applied;
   * afterwards only real changes are pushed to the OS, since both calls touch the native
   * window.
   */
  applyOverlayBehaviour(config: AppConfig, previous?: AppConfig): void {
    if (!previous || previous.overlay.opacity !== config.overlay.opacity) {
      this.setOverlayOpacity(config.overlay.opacity)
    }

    if (!previous || previous.overlay.clickThrough !== config.overlay.clickThrough) {
      this.setOverlayClickThrough(config.overlay.clickThrough)
    }
  }

  /* ── Settings ────────────────────────────────────────────────────── */

  getSettingsWindow(): BrowserWindow | null {
    return this.settings && !this.settings.isDestroyed() ? this.settings : null
  }

  openSettingsWindow(): void {
    const existing = this.getSettingsWindow()
    if (existing) {
      if (existing.isMinimized()) {
        existing.restore()
      }

      existing.show()
      existing.focus()
      this.options.log.debug('settings window brought to the front')
      return
    }

    this.options.log.info('settings window opened')

    const saved = this.options.windowStateStore.getWindowState('settings')
    const window = new BrowserWindow({
      width: saved?.width ?? 760,
      height: saved?.height ?? 780,
      minWidth: 640,
      minHeight: 560,
      show: false,
      title: 'TranslateClip Settings',
      backgroundColor: this.getWindowBackgroundColor(),
      autoHideMenuBar: true,
      webPreferences: this.createWebPreferences()
    })

    this.settings = window

    this.installContextMenu(window)
    this.installLinkHandler(window)
    this.installRendererDiagnostics(window, 'settings')
    this.installOverlayZOrderHandoff(window)
    this.installWindowStatePersistence(window, 'settings')

    window.once('ready-to-show', () => {
      window.show()
      window.focus()
    })

    window.on('closed', () => {
      this.settings = null
    })

    void this.loadView(window, 'settings')
  }

  closeSettingsWindow(): void {
    this.getSettingsWindow()?.close()
  }

  /* ── Onboarding ──────────────────────────────────────────────────── */

  getOnboardingWindow(): BrowserWindow | null {
    return this.onboarding && !this.onboarding.isDestroyed() ? this.onboarding : null
  }

  openOnboardingWindow(onClosed?: () => void): void {
    const existing = this.getOnboardingWindow()
    if (existing) {
      existing.show()
      existing.focus()
      return
    }

    const window = new BrowserWindow({
      width: 680,
      height: 580,
      resizable: false,
      maximizable: false,
      fullscreenable: false,
      show: false,
      frame: false,
      title: 'TranslateClip Setup',
      backgroundColor: this.getWindowBackgroundColor(),
      webPreferences: this.createWebPreferences()
    })

    this.onboarding = window

    this.installContextMenu(window)
    this.installLinkHandler(window)
    this.installRendererDiagnostics(window, 'onboarding')
    this.installOverlayZOrderHandoff(window)

    window.once('ready-to-show', () => {
      window.show()
      window.focus()
    })

    window.on('closed', () => {
      this.onboarding = null
      onClosed?.()
    })

    void this.loadView(window, 'onboarding')
  }

  closeOnboardingWindow(): void {
    this.getOnboardingWindow()?.close()
  }

  /* ── Shared plumbing ─────────────────────────────────────────────── */

  /**
   * Pushes an event to every renderer.
   *
   * Deliberately `BrowserWindow.getAllWindows()` rather than the three windows this
   * class owns: any window that loads our renderer is a legitimate consumer, and
   * keeping a private registry here would silently starve windows created
   * elsewhere (diagnostics, future views).
   */
  broadcast<K extends keyof RendererEventMap>(channel: K, payload: RendererEventMap[K]): void {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(channel, payload)
      }
    }
  }

  getAllWindows(): BrowserWindow[] {
    return [this.overlay, this.settings, this.onboarding].filter(
      (window): window is BrowserWindow => Boolean(window && !window.isDestroyed())
    )
  }

  refreshWindowBackgroundColors(): void {
    const background = this.getWindowBackgroundColor()

    for (const window of [this.settings, this.onboarding]) {
      if (window && !window.isDestroyed()) {
        window.setBackgroundColor(background)
      }
    }
  }

  destroyAll(): void {
    for (const window of this.getAllWindows()) {
      window.destroy()
    }

    this.overlay = null
    this.settings = null
    this.onboarding = null
  }

  private createWebPreferences(): Electron.WebPreferences {
    return {
      preload: this.options.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      // The overlay is meant to be overlaid on other apps; a devtools shortcut
      // is still available in development builds via the menu.
      devTools: !app.isPackaged
    }
  }

  private async loadView(window: BrowserWindow, view: RendererView): Promise<void> {
    const devServerUrl = this.options.devServerUrl

    if (devServerUrl) {
      await window.loadURL(`${devServerUrl}?view=${view}`)
      return
    }

    await window.loadFile(this.options.rendererIndexPath, { query: { view } })
  }

  private resolveOverlayBounds(config: AppConfig): { x?: number; y?: number; width: number; height: number } {
    const saved = this.options.windowStateStore.getWindowState('overlay')
    const fallbackSize = {
      width: Math.max(config.overlay.width, 300),
      height: Math.max(config.overlay.height, 200)
    }

    if (!saved) {
      return { ...this.getDefaultOverlayPosition(fallbackSize), ...fallbackSize }
    }

    const size = {
      width: Math.max(saved.width, 300),
      height: Math.max(saved.height, 200)
    }

    if (typeof saved.x !== 'number' || typeof saved.y !== 'number') {
      return { ...this.getDefaultOverlayPosition(size), ...size }
    }

    const candidate = { x: saved.x, y: saved.y, ...size }
    if (!this.isVisibleOnAnyDisplay(candidate)) {
      return { ...this.getDefaultOverlayPosition(size), ...size }
    }

    return candidate
  }

  private getDefaultOverlayPosition(size: { width: number; height: number }): { x: number; y: number } {
    const { workArea } = screen.getPrimaryDisplay()

    return {
      x: Math.round(workArea.x + workArea.width - size.width - OVERLAY_EDGE_MARGIN),
      y: Math.round(workArea.y + workArea.height - size.height - OVERLAY_EDGE_MARGIN)
    }
  }

  private isVisibleOnAnyDisplay(bounds: { x: number; y: number; width: number; height: number }): boolean {
    return screen.getAllDisplays().some((display) => {
      const { workArea } = display

      return !(
        bounds.x + bounds.width <= workArea.x ||
        workArea.x + workArea.width <= bounds.x ||
        bounds.y + bounds.height <= workArea.y ||
        workArea.y + workArea.height <= bounds.y
      )
    })
  }

  private installWindowStatePersistence(window: BrowserWindow, kind: WindowKind): void {
    let timer: NodeJS.Timeout | null = null

    const persistNow = () => {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }

      void this.options.windowStateStore.updateWindowState(kind, this.captureWindowState(window, kind))
    }

    const schedule = () => {
      this.adoptUserResize(window, kind)

      if (timer) {
        clearTimeout(timer)
      }

      timer = setTimeout(persistNow, 200)
    }

    window.on('move', schedule)
    window.on('resize', schedule)
    window.on('maximize', persistNow)
    window.on('unmaximize', persistNow)
    window.on('close', persistNow)
  }

  /**
   * Adopts a size the user dragged the overlay to.
   *
   * `overlaySize` only moves when *we* move it, so without this a drag would be
   * forgotten on the next launch. The drag is expressed as the *change* from the
   * last size the OS reported, so the few pixels Windows adds to whatever it is
   * asked for cancel out instead of accumulating.
   */
  private adoptUserResize(window: BrowserWindow, kind: WindowKind): void {
    if (kind !== 'overlay') {
      return
    }

    const bounds = window.getBounds()
    const baseline = this.overlayMeasuredSize
    this.overlayMeasuredSize = { width: bounds.width, height: bounds.height }

    if (!this.overlaySize || !baseline || this.expandedOverlaySize) {
      return
    }

    if (Date.now() < this.overlayResizeGuardUntil) {
      return
    }

    const deltaWidth = bounds.width - baseline.width
    const deltaHeight = bounds.height - baseline.height

    if (Math.abs(deltaWidth) < MIN_DRAG_DELTA_DIP && Math.abs(deltaHeight) < MIN_DRAG_DELTA_DIP) {
      return
    }

    this.overlaySize = {
      width: Math.max(this.overlaySize.width + deltaWidth, 300),
      height: Math.max(this.overlaySize.height + deltaHeight, 200)
    }
  }

  private captureWindowState(
    window: BrowserWindow,
    kind: WindowKind
  ): { x?: number; y?: number; width: number; height: number; isMaximized: boolean } {
    const bounds = window.isMaximized() ? window.getNormalBounds() : window.getBounds()

    if (kind === 'overlay' && this.overlaySize) {
      // The collapsed height is an artefact of the collapsed bar, not a preference:
      // persisting it would bring the overlay back as a tall empty bar next launch.
      const height =
        this.options.getConfig().overlay.collapsed && this.expandedOverlaySize
          ? this.expandedOverlaySize.height
          : this.overlaySize.height

      return { x: bounds.x, y: bounds.y, width: this.overlaySize.width, height, isMaximized: false }
    }

    return {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      isMaximized: window.isMaximized()
    }
  }

  /**
   * Surfaces renderer failures in the main log.
   *
   * The overlay has no visible chrome, so a renderer that crashed or failed to
   * load would otherwise look like "the app did nothing". Console output is only
   * forwarded in development to keep release logs clean.
   */
  private installRendererDiagnostics(window: BrowserWindow, view: RendererView): void {
    const { log } = this.options

    window.on('closed', () => {
      log.info(`[${view}] window closed`)
    })

    window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedUrl) => {
      log.error(`[${view}] renderer failed to load ${validatedUrl} (${errorCode}): ${errorDescription}`)
    })

    window.webContents.on('preload-error', (_event, preloadPath, error) => {
      log.error(`[${view}] preload failed: ${preloadPath}`, error)
    })

    window.webContents.on('render-process-gone', (_event, details) => {
      log.error(`[${view}] renderer process gone: ${details.reason} (exit code ${details.exitCode})`)
    })

    if (!app.isPackaged) {
      window.webContents.on('console-message', (details) => {
        if (details.level === 'error' || details.level === 'warning') {
          log.warn(`[${view}] console ${details.level}: ${details.message}`)
        }
      })
    }
  }

  /**
   * Lets our own windows come to the front without giving up the overlay's priority.
   *
   * The overlay sits at `screen-saver` level, which is what keeps it above other
   * applications — but it would also float above the settings window the user just
   * opened from it, covering the very controls they are trying to reach. While one of
   * our normal windows has focus the overlay drops to a normal level; when that window
   * blurs (or closes) the overlay takes the top back.
   */
  private installOverlayZOrderHandoff(window: BrowserWindow): void {
    window.on('focus', () => this.setOverlayAlwaysOnTop(false))
    window.on('blur', () => this.setOverlayAlwaysOnTop(true))
    window.on('closed', () => this.setOverlayAlwaysOnTop(true))
  }

  private setOverlayAlwaysOnTop(above: boolean): void {
    const overlay = this.getOverlayWindow()

    if (!overlay) {
      return
    }

    overlay.setAlwaysOnTop(above, 'screen-saver')

    if (above) {
      overlay.moveTop()
    }
  }

  private installContextMenu(window: BrowserWindow): void {
    window.webContents.on('context-menu', (_event, params) => {
      const template: MenuItemConstructorOptions[] = []

      if (params.isEditable) {
        template.push(
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' }
        )
      } else if (params.selectionText.trim().length > 0) {
        template.push({ role: 'copy' }, { type: 'separator' }, { role: 'selectAll' })
      }

      if (template.length === 0) {
        return
      }

      Menu.buildFromTemplate(template).popup({ window })
    })
  }

  private installLinkHandler(window: BrowserWindow): void {
    window.webContents.setWindowOpenHandler(({ url }) => {
      if (isSafeExternalUrl(url)) {
        void shell.openExternal(url)
      }

      return { action: 'deny' }
    })

    window.webContents.on('will-navigate', (event, url) => {
      const currentUrl = window.webContents.getURL()
      if (url === currentUrl) {
        return
      }

      event.preventDefault()

      if (isSafeExternalUrl(url)) {
        void shell.openExternal(url)
      }
    })
  }

  private getWindowBackgroundColor(): string {
    return nativeTheme.shouldUseDarkColors ? '#101418' : '#f7f8fa'
  }
}
