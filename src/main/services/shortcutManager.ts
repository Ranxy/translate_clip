import { globalShortcut } from 'electron'

import type { ShortcutAction, ShortcutConfig, ShortcutState } from '@shared/types'

import type { Logger } from './logStore'

const ACTIONS: ShortcutAction[] = ['toggleOverlay', 'translateClipboard']

export interface ShortcutManagerOptions {
  handlers: Record<ShortcutAction, () => void>
  log: Logger
  /** Defaults to Electron's `globalShortcut`; tests pass a fake. */
  shortcuts?: GlobalShortcutAdapter
}

export interface RegisterResult {
  ok: boolean
  error: string | null
}

/**
 * The slice of Electron's `globalShortcut` this service uses.
 *
 * Injected so the logic can be tested without Electron — and specifically so a test can reproduce
 * the native behaviour that made recording the *first* shortcut impossible: `unregister('')`
 * throws rather than being a no-op, which is not obvious from the call site.
 */
export interface GlobalShortcutAdapter {
  register: (accelerator: string, handler: () => void) => boolean
  unregister: (accelerator: string) => void
  unregisterAll: () => void
  isRegistered: (accelerator: string) => boolean
}

function createEmptyState(): Record<ShortcutAction, ShortcutState> {
  return {
    toggleOverlay: { accelerator: null, registered: false, error: null },
    translateClipboard: { accelerator: null, registered: false, error: null }
  }
}

/**
 * Global shortcut registration.
 *
 * Both shortcuts default to `null`: nothing is registered unless the user records
 * one. Every action reachable by a shortcut is also reachable from the tray menu
 * and the overlay itself, so an empty configuration is a complete experience
 * rather than a degraded one.
 */
export class ShortcutManager {
  private state = createEmptyState()
  private readonly shortcuts: GlobalShortcutAdapter

  constructor(private readonly options: ShortcutManagerOptions) {
    this.shortcuts = options.shortcuts ?? globalShortcut
  }

  getState(): Record<ShortcutAction, ShortcutState> {
    return structuredClone(this.state)
  }

  apply(config: ShortcutConfig): Record<ShortcutAction, ShortcutState> {
    this.shortcuts.unregisterAll()
    const next = createEmptyState()

    for (const action of ACTIONS) {
      const accelerator = config[action]
      if (!accelerator) {
        continue
      }

      const result = this.registerOne(action, accelerator)
      next[action] = {
        accelerator,
        registered: result.ok,
        error: result.error
      }
    }

    this.state = next
    return this.getState()
  }

  set(action: ShortcutAction, accelerator: string | null): RegisterResult {
    // A blank string means "none": Electron rejects an empty accelerator outright, and the renderer
    // is not trusted to send a well-formed one (see DESIGN §8 on input validation).
    const next = accelerator?.trim() ? accelerator.trim() : null

    // Only when there is something to release: both actions default to `null`, and passing the
    // empty string that stands in for "nothing" makes Electron throw a native argument-conversion
    // error instead of doing nothing — which took out the whole IPC call and made recording a
    // first shortcut impossible.
    const previous = this.state[action].accelerator
    if (previous) {
      this.shortcuts.unregister(previous)
    }

    if (!next) {
      this.state = {
        ...this.state,
        [action]: { accelerator: null, registered: false, error: null }
      }
      return { ok: true, error: null }
    }

    const result = this.registerOne(action, next)
    this.state = {
      ...this.state,
      [action]: { accelerator: next, registered: result.ok, error: result.error }
    }

    return result
  }

  /** Attempts a throwaway registration so the settings UI can validate a binding. */
  test(accelerator: string): RegisterResult {
    const candidate = accelerator?.trim()

    if (!candidate) {
      return { ok: false, error: 'registration-failed' }
    }

    if (this.shortcuts.isRegistered(candidate)) {
      const ownedByUs = ACTIONS.some((action) => this.state[action].accelerator === candidate)

      if (ownedByUs) {
        return { ok: true, error: null }
      }

      return { ok: false, error: 'already-registered' }
    }

    try {
      const registered = this.shortcuts.register(candidate, () => undefined)
      if (!registered) {
        return { ok: false, error: 'registration-failed' }
      }

      this.shortcuts.unregister(candidate)
      return { ok: true, error: null }
    } catch (error) {
      return { ok: false, error: (error as Error).message }
    }
  }

  dispose(): void {
    this.shortcuts.unregisterAll()
    this.state = createEmptyState()
  }

  private registerOne(action: ShortcutAction, accelerator: string): RegisterResult {
    try {
      const registered = this.shortcuts.register(accelerator, this.options.handlers[action])

      if (!registered) {
        this.options.log.warn(`global shortcut is unavailable: ${action} = ${accelerator}`)
        return { ok: false, error: 'registration-failed' }
      }

      return { ok: true, error: null }
    } catch (error) {
      this.options.log.warn(`global shortcut registration threw: ${action} = ${accelerator}`, error)
      return { ok: false, error: (error as Error).message }
    }
  }
}
