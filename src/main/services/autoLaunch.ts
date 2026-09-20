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

function getLoginItemOptions(): Electron.Settings {
  return {
    openAtLogin: true,
    path: process.execPath,
    args: ['--hidden']
  }
}

export function isLaunchAtLoginSupported(): boolean {
  return process.platform === 'win32' || process.platform === 'darwin' || process.platform === 'linux'
}

export async function getLaunchAtLogin(): Promise<boolean> {
  if (process.platform === 'win32' || process.platform === 'darwin') {
    try {
      return app.getLoginItemSettings().openAtLogin
    } catch {
      return false
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

  return false
}

export async function setLaunchAtLogin(enabled: boolean, log: Logger): Promise<void> {
  if (process.platform === 'win32' || process.platform === 'darwin') {
    try {
      app.setLoginItemSettings(enabled ? getLoginItemOptions() : { openAtLogin: false })
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
        `Exec="${getLaunchCommand()}" --hidden`,
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
