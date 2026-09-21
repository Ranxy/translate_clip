import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react'
import { createElement } from 'react'

import type {
  AppConfig,
  BootstrapPayload,
  ClipboardActivity,
  ClipboardStatus,
  HistoryPage,
  HistoryQuery,
  LlmProviderState,
  ShortcutAction,
  ShortcutState,
  TranslationRecord,
  TranslationState
} from '@shared/types'

import { changeLanguage } from '../i18n'

export interface AppStoreState {
  bootstrap: BootstrapPayload
  translationState: TranslationState
  llmProviderState: LlmProviderState
  shortcutState: Record<ShortcutAction, ShortcutState>
  clipboardStatus: ClipboardStatus
  clipboardActivity: ClipboardActivity | null
  recentHistory: TranslationRecord[]
  /** Last failure surfaced to the user, if any. */
  error: string | null
}

type Listener = () => void

/**
 * Tiny external store rather than a state library.
 *
 * Main-process pushes (config changes, translation state, clipboard activity) and
 * renderer-initiated updates both funnel through here, so every window sees the
 * exact same snapshot without a synchronisation layer.
 */
export class AppStore {
  private state: AppStoreState
  private readonly listeners = new Set<Listener>()
  private readonly disposers: Array<() => void> = []

  constructor(bootstrap: BootstrapPayload) {
    this.state = {
      bootstrap,
      translationState: bootstrap.translationState,
      llmProviderState: bootstrap.llmProviderState,
      shortcutState: bootstrap.shortcutState,
      clipboardStatus: bootstrap.clipboardStatus,
      clipboardActivity: null,
      recentHistory: bootstrap.recentHistory,
      error: null
    }

    this.attach()
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = (): AppStoreState => this.state

  dispose(): void {
    for (const dispose of this.disposers) {
      dispose()
    }

    this.disposers.length = 0
    this.listeners.clear()
  }

  /* ── Derived accessors ───────────────────────────────────────────── */

  get config(): AppConfig {
    return this.state.bootstrap.config
  }

  get activeProfile(): LlmProviderState['profiles'][number] | null {
    const { profiles, activeProfileId } = this.state.llmProviderState
    return profiles.find((profile) => profile.profileId === activeProfileId) ?? null
  }

  get isProviderConfigured(): boolean {
    return this.activeProfile !== null
  }

  /* ── Actions ─────────────────────────────────────────────────────── */

  async updateConfig(patch: Partial<AppConfig>): Promise<void> {
    this.applyBootstrap(await window.translateClip.updateConfig(patch))
  }

  async setClipboardWatch(enabled: boolean): Promise<void> {
    this.applyBootstrap(await window.translateClip.setClipboardWatch(enabled))
  }

  async listHistory(query: HistoryQuery): Promise<HistoryPage> {
    return window.translateClip.listHistory(query)
  }

  reportError(message: string): void {
    this.setState({ error: message })
  }

  dismissError(): void {
    this.setState({ error: null })
  }

  /** Applies a bootstrap payload returned by a mutating IPC call. */
  applyBootstrap(bootstrap: BootstrapPayload): void {
    const previousLanguage = this.state.bootstrap.config.uiLanguage
    this.setState({
      bootstrap,
      translationState: bootstrap.translationState,
      llmProviderState: bootstrap.llmProviderState,
      shortcutState: bootstrap.shortcutState,
      clipboardStatus: bootstrap.clipboardStatus,
      recentHistory: bootstrap.recentHistory
    })

    if (bootstrap.config.uiLanguage !== previousLanguage) {
      changeLanguage(bootstrap.config.uiLanguage)
    }
  }

  private setState(patch: Partial<AppStoreState>): void {
    this.state = { ...this.state, ...patch }

    for (const listener of this.listeners) {
      listener()
    }
  }

  private attach(): void {
    const api = window.translateClip

    this.disposers.push(
      api.on('translation:state', (translationState) => this.setState({ translationState })),
      api.on('clipboard:status', (clipboardStatus) => this.setState({ clipboardStatus })),
      api.on('clipboard:activity', (clipboardActivity) => this.setState({ clipboardActivity })),
      api.on('shortcut:state', (shortcutState) => this.setState({ shortcutState })),
      api.on('llm:state', (llmProviderState) => this.setState({ llmProviderState })),
      api.on('config:update', (config) => {
        const previousLanguage = this.state.bootstrap.config.uiLanguage
        this.setState({ bootstrap: { ...this.state.bootstrap, config } })

        if (config.uiLanguage !== previousLanguage) {
          changeLanguage(config.uiLanguage)
        }
      }),
      api.on('history:update', (record) => {
        const others = this.state.recentHistory.filter((entry) => entry.id !== record.id)
        this.setState({ recentHistory: [record, ...others].slice(0, 50) })
      })
    )
  }
}

const AppStoreContext = createContext<AppStore | null>(null)

export function AppStoreProvider({ store, children }: { store: AppStore; children: ReactNode }) {
  return createElement(AppStoreContext.Provider, { value: store }, children)
}

export function useAppStore(): AppStore {
  const store = useContext(AppStoreContext)

  if (!store) {
    throw new Error('useAppStore must be used inside <AppStoreProvider>')
  }

  return store
}

export function useAppState(): AppStoreState {
  const store = useAppStore()
  return useStoreSnapshot(store)
}

/**
 * Subscribes to a store that is already in hand.
 *
 * `App` creates the store and therefore sits above the provider, so it cannot reach `useAppStore`;
 * it still needs the live snapshot, because the overlay window's click-through state can be flipped
 * from the tray while the window is running.
 */
export function useStoreSnapshot(store: AppStore): AppStoreState {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
}
