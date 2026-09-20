import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { dirname } from 'node:path'

import type { LogLevel } from '@shared/types'

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3
}

const MAX_LOG_BYTES = 2 * 1024 * 1024

export interface Logger {
  error: (message: string, details?: unknown) => void
  warn: (message: string, details?: unknown) => void
  info: (message: string, details?: unknown) => void
  debug: (message: string, details?: unknown) => void
  setLevel: (level: LogLevel) => void
  getFilePath: () => string
}

function formatDetails(details: unknown): string {
  if (typeof details === 'undefined') {
    return ''
  }

  if (details instanceof Error) {
    return ` | ${details.message}${details.stack ? `\n${details.stack}` : ''}`
  }

  try {
    return ` | ${JSON.stringify(details)}`
  } catch {
    return ` | ${String(details)}`
  }
}

/**
 * Append-only file logger with a single rotation slot.
 *
 * Deliberately synchronous: log volume is tiny (a few lines per translation) and
 * having the last lines on disk when the process dies is worth more than the
 * microseconds an async append would save.
 */
export function createLogger(filePath: string, level: LogLevel = 'info'): Logger {
  let currentLevel = level
  let size = 0

  try {
    mkdirSync(dirname(filePath), { recursive: true })
    size = statSync(filePath).size

    if (size > MAX_LOG_BYTES) {
      renameSync(filePath, `${filePath}.1`)
      size = 0
    }
  } catch {
    // Missing file (or missing rotated slot) is the normal first-run case.
  }

  const write = (entryLevel: LogLevel, message: string, details?: unknown) => {
    if (LEVEL_WEIGHT[entryLevel] > LEVEL_WEIGHT[currentLevel]) {
      return
    }

    const line = `${new Date().toISOString()} [${entryLevel.toUpperCase()}] ${message}${formatDetails(details)}\n`

    try {
      appendFileSync(filePath, line, 'utf8')
      size += Buffer.byteLength(line)

      if (size > MAX_LOG_BYTES) {
        renameSync(filePath, `${filePath}.1`)
        size = 0
      }
    } catch {
      // Never let logging break the app.
    }

    try {
      // Always mirrored to stdout: in a development run that is where the user is
      // looking, and a packaged Windows GUI build simply has no console to reach.
      process.stdout.write(line)
    } catch {
      // No attached console — the file is enough.
    }
  }

  return {
    error: (message, details) => write('error', message, details),
    warn: (message, details) => write('warn', message, details),
    info: (message, details) => write('info', message, details),
    debug: (message, details) => write('debug', message, details),
    setLevel: (nextLevel) => {
      currentLevel = nextLevel
    },
    getFilePath: () => filePath
  }
}
