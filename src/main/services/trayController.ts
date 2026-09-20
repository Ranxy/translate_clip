import { Menu, Tray, nativeImage, type MenuItemConstructorOptions } from 'electron'

import type { AppConfig } from '@shared/types'

import type { Translator } from '../i18n'
import type { Logger } from './logStore'

export interface TrayActions {
  toggleOverlay: () => void
  translateClipboard: () => void
  toggleWatching: () => void
  setCollapsed: (collapsed: boolean) => void
  setClickThrough: (enabled: boolean) => void
  setLaunchAtLogin: (enabled: boolean) => void
  openSettings: () => void
  openLogFolder: () => void
  quit: () => void
}

export interface TrayControllerOptions {
  getConfig: () => AppConfig
  getTranslator: () => Translator
  isOverlayVisible: () => boolean
  /** False in a development run; the menu item is then omitted rather than lying. */
  isLaunchAtLoginAvailable: () => boolean
  actions: TrayActions
  log: Logger
}

/**
 * System tray icon.
 *
 * Creation is allowed to fail: environments without a StatusNotifier host (WSLg,
 * headless sessions, some minimal desktop setups) throw or silently produce a
 * dead icon. The rest of the app must keep working there, so failures are logged
 * and reported through the capability registry instead of crashing startup.
 */
export class TrayController {
  private tray: Tray | null = null

  constructor(private readonly options: TrayControllerOptions) {}

  create(iconPath: string): boolean {
    if (this.tray) {
      return true
    }

    try {
      const image = nativeImage.createFromPath(iconPath)

      if (image.isEmpty()) {
        this.options.log.warn(`tray icon was empty: ${iconPath}`)
      }

      const tray = new Tray(image)
      tray.setToolTip('TranslateClip')
      tray.on('click', () => {
        this.options.actions.toggleOverlay()
      })
      tray.on('double-click', () => {
        this.options.actions.openSettings()
      })

      this.tray = tray
      this.refresh()
      return true
    } catch (error) {
      this.options.log.warn('system tray is unavailable in this environment', error)
      this.tray = null
      return false
    }
  }

  refresh(): void {
    if (!this.tray || this.tray.isDestroyed()) {
      return
    }

    const config = this.options.getConfig()
    const t = this.options.getTranslator()

    const template: MenuItemConstructorOptions[] = [
      {
        label: this.options.isOverlayVisible() ? t('tray.hideOverlay') : t('tray.showOverlay'),
        click: () => this.options.actions.toggleOverlay()
      },
      {
        label: t('tray.translateNow'),
        click: () => this.options.actions.translateClipboard()
      },
      { type: 'separator' },
      {
        label: t('tray.watching'),
        type: 'checkbox',
        checked: config.clipboardWatchEnabled,
        click: () => this.options.actions.toggleWatching()
      },
      {
        label: t('overlay.collapse'),
        type: 'checkbox',
        checked: config.overlay.collapsed,
        click: (item) => this.options.actions.setCollapsed(item.checked)
      },
      {
        label: t('tray.clickThrough'),
        type: 'checkbox',
        checked: config.overlay.clickThrough,
        click: (item) => this.options.actions.setClickThrough(item.checked)
      },
      { type: 'separator' },
      {
        label: t('settings.title'),
        click: () => this.options.actions.openSettings()
      },
      {
        label: t('tray.openLogFolder'),
        click: () => this.options.actions.openLogFolder()
      },
      ...(this.options.isLaunchAtLoginAvailable()
        ? [
            {
              label: t('settings.general.launchAtLogin'),
              type: 'checkbox' as const,
              checked: config.launchAtLogin,
              click: (item: { checked: boolean }) => this.options.actions.setLaunchAtLogin(item.checked)
            }
          ]
        : []),
      { type: 'separator' },
      {
        label: t('tray.quit'),
        click: () => this.options.actions.quit()
      }
    ]

    this.tray.setContextMenu(Menu.buildFromTemplate(template))

    // Electron keeps a tray's menu private, so this line is also the only way to see what the user
    // will be shown when the entry that reads "hide overlay" / "show overlay" goes stale.
    this.options.log.debug('tray menu rebuilt', {
      overlayVisible: this.options.isOverlayVisible(),
      firstEntry: template[0]?.label ?? null
    })
  }

  isAvailable(): boolean {
    return Boolean(this.tray && !this.tray.isDestroyed())
  }

  destroy(): void {
    if (this.tray && !this.tray.isDestroyed()) {
      this.tray.destroy()
    }

    this.tray = null
  }
}
