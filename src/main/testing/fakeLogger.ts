import type { LogLevel } from '@shared/types'

import type { Logger } from '../services/logStore'

export interface FakeLogger extends Logger {
  readonly lines: string[]
}

/** Logger that records instead of writing files, for tests. */
export function createFakeLogger(): FakeLogger {
  const lines: string[] = []

  const push = (level: LogLevel, message: string, details?: unknown) => {
    const suffix = typeof details === 'undefined' ? '' : ` ${details instanceof Error ? details.message : JSON.stringify(details)}`
    lines.push(`${level} ${message}${suffix}`)
  }

  return {
    lines,
    error: (message, details) => push('error', message, details),
    warn: (message, details) => push('warn', message, details),
    info: (message, details) => push('info', message, details),
    debug: (message, details) => push('debug', message, details),
    setLevel: () => undefined,
    getFilePath: () => ':memory:'
  }
}
