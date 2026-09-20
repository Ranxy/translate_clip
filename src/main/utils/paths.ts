import { app } from 'electron'
import { join } from 'node:path'

/**
 * Resolves a path inside the bundled `resources/` directory.
 *
 * In development the folder sits next to the source tree; in a packaged build
 * electron-builder copies it via `extraResources`, which lands next to the asar
 * inside `process.resourcesPath`.
 */
export function resolveResourcePath(...segments: string[]): string {
  const root = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources')
  return join(root, ...segments)
}

export function getUserDataPath(...segments: string[]): string {
  return join(app.getPath('userData'), ...segments)
}

export function getLogsPath(...segments: string[]): string {
  return getUserDataPath('logs', ...segments)
}
