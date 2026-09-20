import { app } from 'electron'
import { access, mkdir, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type { Logger } from './logStore'

const AUTOSTART_FILE_NAME = 'translate-clip.desktop'

function getAutostartFilePath(): string {
  const configHome = process.env.XDG_CONFIG_HOME?.trim() || join(homedir(), '.config')
  return join(configHome, 'autostart', AUTOSTART_FILE_NAME)
}

/**
 * The executable to relaunch at login.
 *
 * An AppImage is started through its own launcher, so `process.execPath` points
 * at the extracted bundle; `APPIMAGE` holds the file the user actually keeps.
 */
function getLaunchCommand(): string {
  return process.env.APPIMAGE?.trim() || process.execPath
}

function getLaunchArgs(): string[] {
  return ['--hidden']
}

export function isLaunchAtLoginSupported(): boolean {
  return process.platform === 'win32' || process.platform === 'darwin' || process.platform === 'linux'
}

/**
 * True only where the setting can actually be applied.
 *
 * In a development run `process.execPath` is Electron itself, so registering
 * autostart would add a bare `electron` entry that launches nothing useful — and
 * on Windows it would silently pollute the user's startup items. The UI uses this
 * to disable the switch instead of pretending the toggle worked.
 */
export function canManageLaunchAtLogin(): boolean {
  return app.isPackaged && isLaunchAtLoginSupported()
}

/**
 * Reads the current state, or `null` when this environment cannot be queried.
 *
 * On Windows the query must repeat the path and args the entry was registered
 * with, otherwise `openAtLogin` reports the default entry rather than ours and the
 * toggle would show "off" right after being turned on.
 */
export async function getLaunchAtLogin(): Promise<boolean | null> {
  if (!canManageLaunchAtLogin()) {
    return null
  }

  if (process.platform === 'win32' || process.platform === 'darwin') {
    try {
      return app.getLoginItemSettings({ path: process.execPath, args: getLaunchArgs() }).openAtLogin
    } catch {
      return null
    }
  }

  if (process.platform === 'linux') {
    try {
      await access(getAutostartFilePath())
      return true
    } catch {
      return false
    }
  }

  return null
}

export async function setLaunchAtLogin(enabled: boolean, log: Logger): Promise<void> {
  if (!canManageLaunchAtLogin()) {
    log.info(`launch at login is not managed in this environment (packaged=${app.isPackaged}); ignoring ${enabled}`)
    return
  }

  if (process.platform === 'win32' || process.platform === 'darwin') {
    try {
      app.setLoginItemSettings(
        enabled
          ? { openAtLogin: true, path: process.execPath, args: getLaunchArgs() }
          : { openAtLogin: false, path: process.execPath, args: getLaunchArgs() }
      )
    } catch (error) {
      log.warn('failed to update the login item', error)
    }

    return
  }

  if (process.platform !== 'linux') {
    return
  }

  const filePath = getAutostartFilePath()

  try {
    if (!enabled) {
      await rm(filePath, { force: true })
      return
    }

    await mkdir(join(filePath, '..'), { recursive: true })
    await writeFile(
      filePath,
      [
        '[Desktop Entry]',
        'Type=Application',
        'Name=TranslateClip',
        `Exec="${getLaunchCommand()}" ${getLaunchArgs().join(' ')}`,
        'X-GNOME-Autostart-enabled=true',
        'Terminal=false',
        'NoDisplay=false',
        ''
      ].join('\n'),
      'utf8'
    )
  } catch (error) {
    log.warn('failed to write the autostart desktop entry', error)
  }
}
