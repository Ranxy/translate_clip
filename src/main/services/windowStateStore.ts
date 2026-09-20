import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { writeFileAtomic } from '../utils/atomicWrite'

export type WindowKind = 'overlay' | 'settings' | 'onboarding'

export interface WindowStateSnapshot {
  width: number
  height: number
  x?: number
  y?: number
  isMaximized: boolean
}

type PersistedWindowState = Partial<Record<WindowKind, WindowStateSnapshot>>

function sanitizeSnapshot(input: unknown): WindowStateSnapshot | undefined {
  if (!input || typeof input !== 'object') {
    return undefined
  }

  const snapshot = input as Record<string, unknown>
  const width = typeof snapshot.width === 'number' && Number.isFinite(snapshot.width) ? snapshot.width : null
  const height = typeof snapshot.height === 'number' && Number.isFinite(snapshot.height) ? snapshot.height : null

  if (!width || !height) {
    return undefined
  }

  return {
    width,
    height,
    x: typeof snapshot.x === 'number' && Number.isFinite(snapshot.x) ? snapshot.x : undefined,
    y: typeof snapshot.y === 'number' && Number.isFinite(snapshot.y) ? snapshot.y : undefined,
    isMaximized: snapshot.isMaximized === true
  }
}

function sanitizeWindowState(input: unknown): PersistedWindowState {
  if (!input || typeof input !== 'object') {
    return {}
  }

  const state = input as Record<string, unknown>

  return {
    overlay: sanitizeSnapshot(state.overlay),
    settings: sanitizeSnapshot(state.settings),
    onboarding: sanitizeSnapshot(state.onboarding)
  }
}

export class WindowStateStore {
  private state: PersistedWindowState = {}

  constructor(private readonly filePath: string) {}

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.filePath, 'utf8')
      this.state = sanitizeWindowState(JSON.parse(raw) as unknown)
    } catch {
      this.state = {}
    }
  }

  getWindowState(kind: WindowKind): WindowStateSnapshot | null {
    const snapshot = this.state[kind]
    return snapshot ? { ...snapshot } : null
  }

  async updateWindowState(kind: WindowKind, snapshot: WindowStateSnapshot): Promise<void> {
    this.state = {
      ...this.state,
      [kind]: { ...snapshot }
    }

    await writeFileAtomic(this.filePath, JSON.stringify(this.state, null, 2))
  }

  static createDefaultFilePath(userDataDirectory: string): string {
    return join(userDataDirectory, 'window-state.json')
  }
}
