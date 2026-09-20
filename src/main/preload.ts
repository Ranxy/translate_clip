import { contextBridge, ipcRenderer } from 'electron'

import type {
  AppConfig,
  BootstrapPayload,
  DiagnosticsInfo,
  FetchLlmProviderModelsInput,
  GlossaryEntry,
  HistoryPage,
  HistoryQuery,
  LlmConnectionTestInput,
  LlmConnectionTestResult,
  LlmProviderModel,
  RendererEventMap,
  SaveLlmProviderProfileInput,
  ShortcutAction,
  TranslateClipApi
} from '@shared/types'

function applyColorScheme(): void {
  if (!document?.documentElement) {
    return
  }

  // The main process drives nativeTheme.themeSource from the user's setting, so
  // prefers-color-scheme already reflects 'system' | 'light' | 'dark' here.
  const dark = window.matchMedia('(prefers-color-scheme: dark)').matches
  document.documentElement.classList.toggle('dark', dark)
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    applyColorScheme()
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyColorScheme)
  })
} else {
  applyColorScheme()
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyColorScheme)
}

const api: TranslateClipApi = {
  getBootstrapData: (): Promise<BootstrapPayload> => ipcRenderer.invoke('app:getBootstrapData'),
  getDiagnostics: (): Promise<DiagnosticsInfo> => ipcRenderer.invoke('app:getDiagnostics'),

  updateConfig: (patch: Partial<AppConfig>) => ipcRenderer.invoke('app:updateConfig', patch),

  setClipboardWatch: (enabled: boolean) => ipcRenderer.invoke('app:setClipboardWatch', enabled),
  translateClipboardNow: () => ipcRenderer.invoke('app:translateClipboardNow'),
  retranslateLast: () => ipcRenderer.invoke('app:retranslateLast'),
  cancelTranslation: () => ipcRenderer.invoke('app:cancelTranslation'),

  listHistory: (query: HistoryQuery): Promise<HistoryPage> => ipcRenderer.invoke('history:list', query),
  toggleHistoryPin: (id: string) => ipcRenderer.invoke('history:togglePin', id),
  removeHistoryEntry: (id: string) => ipcRenderer.invoke('history:remove', id),
  clearHistory: (keepPinned: boolean) => ipcRenderer.invoke('history:clear', keepPinned),
  copyHistoryTranslation: (id: string) => ipcRenderer.invoke('history:copyTranslation', id),
  copyText: (text: string) => ipcRenderer.invoke('clipboard:writeText', text),

  saveLlmProviderProfile: (input: SaveLlmProviderProfileInput) => ipcRenderer.invoke('llm:saveProviderProfile', input),
  deleteLlmProviderProfile: (profileId: string) => ipcRenderer.invoke('llm:deleteProviderProfile', profileId),
  setActiveLlmProviderProfile: (profileId: string) => ipcRenderer.invoke('llm:setActiveProviderProfile', profileId),
  fetchLlmProviderModels: (input: FetchLlmProviderModelsInput): Promise<LlmProviderModel[]> =>
    ipcRenderer.invoke('llm:fetchModels', input),
  getLlmApiKey: (profileId: string) => ipcRenderer.invoke('llm:getApiKey', profileId),
  testLlmConnection: (input: LlmConnectionTestInput): Promise<LlmConnectionTestResult> =>
    ipcRenderer.invoke('llm:testConnection', input),

  saveGlossaryEntry: (entry: GlossaryEntry) => ipcRenderer.invoke('glossary:save', entry),
  deleteGlossaryEntry: (id: string) => ipcRenderer.invoke('glossary:delete', id),
  importGlossary: (json: string) => ipcRenderer.invoke('glossary:import', json),
  exportGlossary: () => ipcRenderer.invoke('glossary:export'),

  setShortcut: (action: ShortcutAction, accelerator: string | null) =>
    ipcRenderer.invoke('shortcut:set', action, accelerator),
  testShortcut: (accelerator: string) => ipcRenderer.invoke('shortcut:test', accelerator),

  setOverlayCollapsed: (collapsed: boolean) => ipcRenderer.invoke('overlay:setCollapsed', collapsed),
  setOverlayClickThrough: (clickThrough: boolean) => ipcRenderer.invoke('overlay:setClickThrough', clickThrough),
  setOverlayOpacity: (opacity: number) => ipcRenderer.invoke('overlay:setOpacity', opacity),
  resizeOverlayBy: (deltaY: number) => ipcRenderer.invoke('overlay:resizeBy', deltaY),
  hideOverlay: () => ipcRenderer.invoke('overlay:hide'),
  showOverlay: () => ipcRenderer.invoke('overlay:show'),

  completeOnboarding: () => ipcRenderer.invoke('onboarding:complete'),
  skipOnboarding: () => ipcRenderer.invoke('onboarding:skip'),
  openOnboarding: () => ipcRenderer.invoke('window:openOnboarding'),
  restartOnboarding: () => ipcRenderer.invoke('onboarding:restart'),

  openSettings: () => ipcRenderer.invoke('window:openSettings'),
  closeSettings: () => ipcRenderer.invoke('window:closeSettings'),
  openDataFolder: () => ipcRenderer.invoke('window:openDataFolder'),
  openLogFolder: () => ipcRenderer.invoke('window:openLogFolder'),
  openLlmDebugFolder: () => ipcRenderer.invoke('window:openLlmDebugFolder'),
  openExternal: (url: string) => ipcRenderer.invoke('app:openExternal', url),
  quit: () => ipcRenderer.invoke('app:quit'),

  debugInjectClipboard: (text: string) => ipcRenderer.invoke('debug:injectClipboard', text),
  debugIsEnabled: () => ipcRenderer.invoke('debug:isEnabled'),

  on: <K extends keyof RendererEventMap>(event: K, listener: (payload: RendererEventMap[K]) => void) => {
    const subscription = (_event: Electron.IpcRendererEvent, payload: RendererEventMap[K]) => {
      listener(payload)
    }

    ipcRenderer.on(event as string, subscription)

    return () => {
      ipcRenderer.removeListener(event as string, subscription)
    }
  }
}

contextBridge.exposeInMainWorld('translateClip', api)
