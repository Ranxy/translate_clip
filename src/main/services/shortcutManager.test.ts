import { describe, expect, it } from 'vitest'

import type { ShortcutConfig } from '@shared/types'

import { createFakeLogger } from '../testing/fakeLogger'
import { ShortcutManager, type GlobalShortcutAdapter } from './shortcutManager'

/**
 * A stand-in for Electron's `globalShortcut`.
 *
 * It reproduces the behaviour that mattered: an empty accelerator is not "nothing to do", it is an
 * argument conversion failure. The real one threw straight out of `set()` — which is outside the
 * register call's try/catch — so the whole `shortcut:set` IPC rejected with
 * "Error processing argument at index 0, conversion failure from", and since both shortcuts default
 * to `null`, recording the *first* one could never succeed.
 */
function createFakeShortcuts() {
  const registered = new Set<string>()
  const calls: string[] = []

  const assertAccelerator = (accelerator: string) => {
    if (!accelerator) {
      throw new Error('Error processing argument at index 0, conversion failure from ')
    }
  }

  const adapter: GlobalShortcutAdapter = {
    register: (accelerator) => {
      calls.push(`register:${accelerator}`)
      assertAccelerator(accelerator)
      registered.add(accelerator)
      return true
    },
    unregister: (accelerator) => {
      calls.push(`unregister:${accelerator}`)
      assertAccelerator(accelerator)
      registered.delete(accelerator)
    },
    unregisterAll: () => {
      calls.push('unregisterAll')
      registered.clear()
    },
    isRegistered: (accelerator) => registered.has(accelerator)
  }

  return { adapter, registered, calls }
}

function createManager(options: { failRegistration?: boolean; taken?: string[] } = {}) {
  const fake = createFakeShortcuts()
  const fired: string[] = []

  if (options.failRegistration) {
    fake.adapter.register = (accelerator) => {
      fake.calls.push(`register:${accelerator}`)
      return false
    }
  }

  for (const accelerator of options.taken ?? []) {
    fake.registered.add(accelerator)
  }

  const manager = new ShortcutManager({
    handlers: {
      toggleOverlay: () => fired.push('toggleOverlay'),
      translateClipboard: () => fired.push('translateClipboard')
    },
    log: createFakeLogger(),
    shortcuts: fake.adapter
  })

  return { manager, ...fake, fired }
}

describe('ShortcutManager', () => {
  it('records a shortcut for an action that had none', () => {
    const { manager, calls, registered } = createManager()
    const result = manager.set('toggleOverlay', 'Control+Alt+T')

    expect(result).toEqual({ ok: true, error: null })
    expect(manager.getState().toggleOverlay).toEqual({
      accelerator: 'Control+Alt+T',
      registered: true,
      error: null
    })
    expect([...registered]).toEqual(['Control+Alt+T'])
    // The regression: nothing is sent to unregister while there is nothing to release.
    expect(calls.filter((call) => call.startsWith('unregister:'))).toEqual([])
  })

  it('releases the previous shortcut before registering a new one', () => {
    const { manager, calls, registered } = createManager()

    manager.set('toggleOverlay', 'Control+Alt+T')
    manager.set('toggleOverlay', 'Control+Alt+Y')

    expect(calls).toContain('unregister:Control+Alt+T')
    expect([...registered]).toEqual(['Control+Alt+Y'])
    expect(manager.getState().toggleOverlay.accelerator).toBe('Control+Alt+Y')
  })

  it('clears a shortcut, and clearing an unset one is not an error', () => {
    const { manager, registered } = createManager()

    manager.set('translateClipboard', 'Control+Alt+T')
    const cleared = manager.set('translateClipboard', null)

    expect(cleared).toEqual({ ok: true, error: null })
    expect(manager.getState().translateClipboard).toEqual({ accelerator: null, registered: false, error: null })
    expect([...registered]).toEqual([])

    expect(manager.set('translateClipboard', null)).toEqual({ ok: true, error: null })
  })

  it('reports a registration the system refused', () => {
    const { manager } = createManager({ failRegistration: true })

    expect(manager.set('toggleOverlay', 'Control+Alt+T')).toEqual({ ok: false, error: 'registration-failed' })
    expect(manager.getState().toggleOverlay).toEqual({
      accelerator: 'Control+Alt+T',
      registered: false,
      error: 'registration-failed'
    })
  })

  it('treats a blank accelerator as "none" rather than handing it to Electron', () => {
    const { manager, calls, registered } = createManager()

    manager.set('toggleOverlay', 'Control+Alt+T')
    expect(manager.set('toggleOverlay', '   ')).toEqual({ ok: true, error: null })
    expect(manager.getState().toggleOverlay).toEqual({ accelerator: null, registered: false, error: null })
    expect([...registered]).toEqual([])
    // The old empty string would have reached unregister in the "no shortcut" case above.
    expect(calls).not.toContain('unregister:')
    expect(calls).not.toContain('register:')

    expect(manager.test('')).toEqual({ ok: false, error: 'registration-failed' })
    expect(manager.test('  ')).toEqual({ ok: false, error: 'registration-failed' })
  })

  it('applies a config, leaving unset actions alone', () => {
    const config: ShortcutConfig = { toggleOverlay: 'Control+Alt+T', translateClipboard: null }
    const { manager, calls, registered } = createManager()

    const state = manager.apply(config)

    expect(calls[0]).toBe('unregisterAll')
    expect([...registered]).toEqual(['Control+Alt+T'])
    expect(state).toEqual({
      toggleOverlay: { accelerator: 'Control+Alt+T', registered: true, error: null },
      translateClipboard: { accelerator: null, registered: false, error: null }
    })
  })

  it('treats a shortcut it already owns as valid when testing it', () => {
    const { manager } = createManager()

    manager.set('toggleOverlay', 'Control+Alt+T')

    expect(manager.test('Control+Alt+T')).toEqual({ ok: true, error: null })
  })

  it('reports a combination that belongs to something else', () => {
    const { manager } = createManager({ taken: ['Control+Alt+T'] })

    expect(manager.test('Control+Alt+T')).toEqual({ ok: false, error: 'already-registered' })
  })

  it('registers and immediately releases a probe when testing a free combination', () => {
    const { manager, registered } = createManager()

    expect(manager.test('Control+Alt+J')).toEqual({ ok: true, error: null })
    expect([...registered]).toEqual([])
  })
})
