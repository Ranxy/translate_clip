import { globalShortcut } from 'electron'

import type { ShortcutAction, ShortcutConfig, ShortcutState } from '@shared/types'

import type { Logger } from './logStore'

const ACTIONS: ShortcutAction[] = ['toggleOverlay', 'translateClipboard']

export interface ShortcutManagerOptions {
  handlers: Record<ShortcutAction, () => void>
  log: Logger
}

export interface RegisterResult {
  ok: boolean
  error: string | null
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

  constructor(private readonly options: ShortcutManagerOptions) {}

  getState(): Record<ShortcutAction, ShortcutState> {
    return structuredClone(this.state)
  }

  apply(config: ShortcutConfig): Record<ShortcutAction, ShortcutState> {
    globalShortcut.unregisterAll()
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
    globalShortcut.unregister(this.state[action].accelerator ?? '')

    if (!accelerator) {
      this.state = {
        ...this.state,
        [action]: { accelerator: null, registered: false, error: null }
      }
      return { ok: true, error: null }
    }

    const result = this.registerOne(action, accelerator)
    this.state = {
      ...this.state,
      [action]: { accelerator, registered: result.ok, error: result.error }
    }

    return result
  }

  /** Attempts a throwaway registration so the settings UI can validate a binding. */
  test(accelerator: string): RegisterResult {
    if (globalShortcut.isRegistered(accelerator)) {
      const ownedByUs = ACTIONS.some((action) => this.state[action].accelerator === accelerator)

      if (ownedByUs) {
        return { ok: true, error: null }
      }

      return { ok: false, error: 'already-registered' }
    }

    try {
      const registered = globalShortcut.register(accelerator, () => undefined)
      if (!registered) {
        return { ok: false, error: 'registration-failed' }
      }

      globalShortcut.unregister(accelerator)
      return { ok: true, error: null }
    } catch (error) {
      return { ok: false, error: (error as Error).message }
    }
  }

  dispose(): void {
    globalShortcut.unregisterAll()
    this.state = createEmptyState()
  }

  private registerOne(action: ShortcutAction, accelerator: string): RegisterResult {
    try {
      const registered = globalShortcut.register(accelerator, this.options.handlers[action])

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
