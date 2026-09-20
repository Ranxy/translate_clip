import { safeStorage } from 'electron'

import type { GlobalShortcutSupport, PlatformCapabilities, PlatformId } from '@shared/types'

import { canManageLaunchAtLogin } from './autoLaunch'
import type { Logger } from './logStore'

export interface CapabilityRegistry {
  get(): PlatformCapabilities
  setTrayAvailable(available: boolean): void
  /** Re-reads the environment; call once after `app.whenReady()`. */
  refresh(): PlatformCapabilities
}

export function toPlatformId(platform: NodeJS.Platform): PlatformId {
  if (platform === 'win32') {
    return 'windows'
  }

  if (platform === 'darwin') {
    return 'macos'
  }

  if (platform === 'linux') {
    return 'linux'
  }

  return 'other'
}

/**
 * Wayland compositors only let a focused client read the clipboard, and
 * Electron's globalShortcut implementation needs X11, so Linux sessions running
 * Wayland (including WSLg) are reported as `limited` and the UI says so instead
 * of silently doing nothing.
 */
function detectGlobalShortcutSupport(platform: PlatformId): GlobalShortcutSupport {
  if (platform !== 'linux') {
    return 'full'
  }

  const sessionType = (process.env.XDG_SESSION_TYPE ?? '').toLowerCase()
  const hasWayland = Boolean(process.env.WAYLAND_DISPLAY) || sessionType === 'wayland'
  const hasX11 = Boolean(process.env.DISPLAY)

  return hasWayland && !hasX11 ? 'limited' : hasX11 ? 'full' : 'limited'
}

export function createCapabilityRegistry(log: Logger): CapabilityRegistry {
  const platform = toPlatformId(process.platform)

  let trayAvailable = platform === 'windows' || platform === 'macos'
  let keyring = false

  const get = (): PlatformCapabilities => ({
    platform,
    tray: trayAvailable,
    globalShortcut: detectGlobalShortcutSupport(platform),
    keyring,
    launchAtLogin: canManageLaunchAtLogin()
  })

  return {
    get,

    setTrayAvailable: (available: boolean) => {
      trayAvailable = available
    },

    refresh: () => {
      try {
        keyring = safeStorage.isEncryptionAvailable()
      } catch (error) {
        log.warn('safeStorage.isEncryptionAvailable() threw', error)
        keyring = false
      }

      const capabilities = get()
      log.info('platform capabilities', capabilities)
      return capabilities
    }
  }
}
