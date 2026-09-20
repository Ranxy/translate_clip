import type { ClipboardActivitySource } from '@shared/types'

import { hashText } from '../utils/hash'

export interface ClipboardAdapter {
  readText: () => string
  writeText: (text: string) => void
}

export interface ClipboardWatcherOptions {
  adapter: ClipboardAdapter
  pollIntervalMs: number
  /** How long a value we wrote ourselves stays suppressed, in milliseconds. */
  selfWriteWindowMs?: number
  isEnabled: () => boolean
  onCandidate: (text: string, source: ClipboardActivitySource) => void
  onError?: (error: Error) => void
  now?: () => number
}

interface SelfWrite {
  hash: string
  at: number
}

const DEFAULT_SELF_WRITE_WINDOW_MS = 1_500
const MAX_SELF_WRITES = 8

/**
 * Polls the system clipboard.
 *
 * Electron has no clipboard change event, and the native alternatives
 * (`AddClipboardFormatListener` on Windows, becoming the X11 selection owner)
 * require a compiled addon, which would sacrifice the "no native rebuild"
 * packaging story for a few hundred milliseconds of latency. Reading the
 * clipboard is a cheap syscall, and the text is compared by hash, so the polling
 * cost is negligible.
 *
 * Two behaviours matter for correctness:
 *  - content already in the clipboard when watching starts is *seeded*, not
 *    translated, so launching the app never fires a translation for stale text;
 *  - text the app itself wrote (the "copy translation" button) is suppressed, so
 *    copying a translation back does not start a translation loop.
 */
export class ClipboardWatcher {
  private timer: NodeJS.Timeout | null = null
  private lastSignature: string | null = null
  private selfWrites: SelfWrite[] = []
  private intervalMs: number

  constructor(private readonly options: ClipboardWatcherOptions) {
    this.intervalMs = options.pollIntervalMs
  }

  start(): void {
    if (this.timer) {
      return
    }

    this.seedFromClipboard()
    this.timer = setInterval(() => this.poll('watch'), this.intervalMs)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  isRunning(): boolean {
    return this.timer !== null
  }

  getLastSignature(): string | null {
    return this.lastSignature
  }

  applyPollInterval(pollIntervalMs: number): void {
    if (pollIntervalMs === this.intervalMs) {
      return
    }

    this.intervalMs = pollIntervalMs

    if (this.timer) {
      this.stop()
      this.start()
    }
  }

  /** Writes to the clipboard on the app's behalf and suppresses the echo. */
  writeText(text: string): void {
    const signature = hashText(text)

    this.rememberSelfWrite(signature)
    this.options.adapter.writeText(text)
    this.lastSignature = signature
  }

  /**
   * Reads the clipboard right now, ignoring deduplication.
   *
   * Used by the "translate clipboard now" button and the tray entry: the user
   * explicitly asked about the current content, so "we already saw this" is not a
   * reason to stay silent.
   */
  readNow(source: ClipboardActivitySource = 'manual'): void {
    this.poll(source, true)
  }

  private poll(source: ClipboardActivitySource, force = false): void {
    if (!force && !this.options.isEnabled()) {
      return
    }

    let text: string

    try {
      text = this.options.adapter.readText()
    } catch (error) {
      this.options.onError?.(error instanceof Error ? error : new Error(String(error)))
      return
    }

    const signature = hashText(text)

    if (!force) {
      if (signature === this.lastSignature) {
        return
      }

      if (this.isSuppressed(signature)) {
        this.lastSignature = signature
        return
      }
    }

    this.lastSignature = signature
    this.options.onCandidate(text, source)
  }

  private seedFromClipboard(): void {
    try {
      this.lastSignature = hashText(this.options.adapter.readText())
    } catch {
      // A clipboard that cannot be read right now is picked up on the next tick.
    }
  }

  private rememberSelfWrite(hash: string): void {
    const at = this.now()

    this.selfWrites = [...this.selfWrites.filter((entry) => entry.hash !== hash), { hash, at }].slice(-MAX_SELF_WRITES)
  }

  private isSuppressed(hash: string): boolean {
    const window = this.options.selfWriteWindowMs ?? DEFAULT_SELF_WRITE_WINDOW_MS
    const now = this.now()

    return this.selfWrites.some((entry) => entry.hash === hash && now - entry.at < window)
  }

  private now(): number {
    return this.options.now?.() ?? Date.now()
  }
}
