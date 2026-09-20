import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ClipboardWatcher } from './clipboardWatcher'

function createHarness(
  options: { initial?: string; failReads?: boolean; enabled?: boolean; formats?: string[]; failFormatReads?: boolean } = {}
) {
  let clipboardText = options.initial ?? ''
  let failReads = options.failReads ?? false
  let failFormatReads = options.failFormatReads ?? false
  let enabled = options.enabled ?? true
  let formats = options.formats ?? ['text/plain']

  const emitted: Array<{ text: string; source: string; hasFileList: boolean }> = []
  const errors: Error[] = []

  const watcher = new ClipboardWatcher({
    adapter: {
      readText: () => {
        if (failReads) {
          throw new Error('clipboard unavailable')
        }

        return clipboardText
      },
      writeText: (text: string) => {
        clipboardText = text
      },
      readFormats: () => {
        if (failFormatReads) {
          throw new Error('formats unavailable')
        }

        return formats
      }
    },
    pollIntervalMs: 400,
    isEnabled: () => enabled,
    onCandidate: (text, source, context) => emitted.push({ text, source, hasFileList: context.hasFileList }),
    onError: (error) => errors.push(error)
  })

  return {
    watcher,
    emitted,
    errors,
    setClipboard: (text: string) => {
      clipboardText = text
    },
    getClipboard: () => clipboardText,
    setFailReads: (value: boolean) => {
      failReads = value
    },
    setFormats: (value: string[]) => {
      formats = value
    },
    setEnabled: (value: boolean) => {
      enabled = value
    }
  }
}

describe('ClipboardWatcher', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('seeds the clipboard on start instead of translating stale content', () => {
    const harness = createHarness({ initial: 'text from before the app started' })

    harness.watcher.start()
    vi.advanceTimersByTime(2_000)

    expect(harness.emitted).toHaveLength(0)
  })

  it('emits once when the clipboard changes', () => {
    const harness = createHarness({ initial: '' })

    harness.watcher.start()
    harness.setClipboard('hello world')
    vi.advanceTimersByTime(2_000)

    expect(harness.emitted).toEqual([{ text: 'hello world', source: 'watch', hasFileList: false }])
  })

  it('does not re-emit identical content', () => {
    const harness = createHarness()

    harness.watcher.start()
    harness.setClipboard('hello')
    vi.advanceTimersByTime(2_000)
    vi.advanceTimersByTime(2_000)

    expect(harness.emitted).toHaveLength(1)
  })

  it('emits again when the content changes away and back', () => {
    const harness = createHarness()

    harness.watcher.start()
    harness.setClipboard('first')
    vi.advanceTimersByTime(500)
    harness.setClipboard('second')
    vi.advanceTimersByTime(500)
    harness.setClipboard('first')
    vi.advanceTimersByTime(500)

    expect(harness.emitted.map((entry) => entry.text)).toEqual(['first', 'second', 'first'])
  })

  it('suppresses the echo of text the app wrote itself', () => {
    const harness = createHarness({ initial: 'source text' })

    harness.watcher.start()
    harness.watcher.writeText('translated text')
    vi.advanceTimersByTime(2_000)

    expect(harness.getClipboard()).toBe('translated text')
    expect(harness.emitted).toHaveLength(0)
  })

  it('still ignores a copied translation after the suppression window', () => {
    const harness = createHarness({ initial: 'source text' })

    harness.watcher.start()
    harness.watcher.writeText('translated text')
    vi.advanceTimersByTime(5_000)
    harness.setClipboard('translated text')
    vi.advanceTimersByTime(2_000)

    expect(harness.emitted).toHaveLength(0)
  })

  it('emits for an explicit manual read even when nothing changed', () => {
    const harness = createHarness({ initial: 'already here' })

    harness.watcher.start()
    vi.advanceTimersByTime(1_000)
    harness.watcher.readNow()
    harness.watcher.readNow()

    expect(harness.emitted).toEqual([
      { text: 'already here', source: 'manual', hasFileList: false },
      { text: 'already here', source: 'manual', hasFileList: false }
    ])
  })

  it('flags a clipboard that also holds a file list', () => {
    const harness = createHarness({ formats: ['text/plain', 'CF_HDROP'] })

    harness.watcher.start()
    harness.setClipboard('C:\\Users\\ran\\report.pdf')
    vi.advanceTimersByTime(1_000)

    // Windows puts a copied file's path on the clipboard as text as well.
    expect(harness.emitted).toEqual([{ text: 'C:\\Users\\ran\\report.pdf', source: 'watch', hasFileList: true }])
  })

  it('does not flag ordinary text', () => {
    const harness = createHarness({ formats: ['text/plain', 'text/html'] })

    harness.watcher.start()
    harness.setClipboard('just some text')
    vi.advanceTimersByTime(1_000)

    expect(harness.emitted[0]?.hasFileList).toBe(false)
  })

  it('treats an unreadable format list as "no file list"', () => {
    const harness = createHarness({ failFormatReads: true })

    harness.watcher.start()
    harness.setClipboard('still works')
    vi.advanceTimersByTime(1_000)

    expect(harness.emitted[0]).toMatchObject({ text: 'still works', hasFileList: false })
  })

  it('does not emit while watching is disabled', () => {
    const harness = createHarness({ enabled: false })

    harness.watcher.start()
    harness.setClipboard('copied while paused')
    vi.advanceTimersByTime(2_000)

    expect(harness.emitted).toHaveLength(0)
  })

  it('survives a failing clipboard read and recovers', () => {
    const harness = createHarness({ failReads: true })

    harness.watcher.start()
    vi.advanceTimersByTime(1_000)

    expect(harness.errors.length).toBeGreaterThan(0)

    harness.setFailReads(false)
    harness.setClipboard('recovered')
    vi.advanceTimersByTime(1_000)

    expect(harness.emitted.map((entry) => entry.text)).toEqual(['recovered'])
  })

  it('restarts polling when the interval changes', () => {
    const harness = createHarness()

    harness.watcher.start()
    harness.watcher.applyPollInterval(1_000)

    expect(harness.watcher.isRunning()).toBe(true)
    expect(harness.emitted).toHaveLength(0)

    harness.setClipboard('after interval change')
    vi.advanceTimersByTime(1_000)

    expect(harness.emitted).toHaveLength(1)
  })

  it('stops polling when stopped', () => {
    const harness = createHarness()

    harness.watcher.start()
    harness.watcher.stop()
    harness.setClipboard('after stop')
    vi.advanceTimersByTime(2_000)

    expect(harness.watcher.isRunning()).toBe(false)
    expect(harness.emitted).toHaveLength(0)
  })
})
