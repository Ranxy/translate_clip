import { BrowserWindow } from 'electron'
import { access, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { Logger } from './services/logStore'
import { startStubServer, type StubServer } from './testing/stubServer'

export interface SelfCheckTarget {
  view: 'overlay' | 'settings' | 'onboarding'
  label: string
}

export interface SelfCheckOptions {
  preloadPath: string
  rendererIndexPath: string
  devServerUrl: string | undefined
  userDataPath: string
  trayIconPath: string
  appIconPath: string
  log: Logger
}

export interface SelfCheckEntry {
  name: string
  ok: boolean
  detail: string
}

export interface SelfCheckReport {
  ok: boolean
  entries: SelfCheckEntry[]
}

const VIEWS: SelfCheckTarget[] = [
  { view: 'overlay', label: 'overlay view' },
  { view: 'settings', label: 'settings view' },
  { view: 'onboarding', label: 'onboarding view' }
]

const PIPELINE_SAMPLE_TEXT = 'Hello clipboard pipeline'
const TRANSLATION_MARKER = 'self-check translation marker'

interface BootstrapShape {
  llmProviderState?: { profiles?: Array<{ profileId: string }>; activeProfileId?: string | null }
}

/**
 * Proves the whole translation path without a credential or a network call.
 *
 * A stub OpenAI-compatible endpoint is started on loopback, a throwaway profile
 * pointing at it is saved, and the result is asserted in the overlay. The user's
 * real profiles are never used: the temporary profile is made active for the
 * duration and the previously active profile is restored afterwards, so the check
 * cannot accidentally spend someone's quota on a real provider.
 */
async function checkTranslationFlow(window: BrowserWindow, log: Logger): Promise<SelfCheckEntry> {
  const name = 'translation flow'
  // Unique per run, so a cached translation from an earlier check can never make
  // this pass without the provider actually being called.
  const sampleText = `self-check ${Date.now()}`
  let server: StubServer | null = null
  let createdProfileId: string | null = null
  let previousActiveProfileId: string | null = null

  try {
    const before = (await window.webContents.executeJavaScript('window.translateClip.getBootstrapData()')) as BootstrapShape
    previousActiveProfileId = before.llmProviderState?.activeProfileId ?? null

    server = await startStubServer({
      status: 200,
      body: {
        choices: [
          {
            message: {
              content: JSON.stringify({ detectedLanguage: 'en', translatedText: TRANSLATION_MARKER })
            }
          }
        ]
      }
    })

    const saved = (await window.webContents.executeJavaScript(
      `window.translateClip.saveLlmProviderProfile({
        providerId: 'custom',
        modelName: 'self-check',
        apiKey: 'self-check',
        apiBaseUrl: ${JSON.stringify(server.baseUrl)},
        customLabel: 'self-check'
      })`
    )) as BootstrapShape

    createdProfileId =
      saved.llmProviderState?.profiles?.find((profile) => profile.profileId !== previousActiveProfileId)?.profileId ?? null

    if (!createdProfileId) {
      return { name, ok: false, detail: 'the temporary provider profile was not created' }
    }

    await window.webContents.executeJavaScript(
      `window.translateClip.setActiveLlmProviderProfile(${JSON.stringify(createdProfileId)})`
    )
    await window.webContents.executeJavaScript(
      `window.translateClip.debugInjectClipboard(${JSON.stringify(sampleText)})`
    )

    const deadline = Date.now() + 10_000
    let bodyText = ''

    for (;;) {
      bodyText = await window.webContents.executeJavaScript('document.body.innerText')

      if (bodyText.includes(TRANSLATION_MARKER)) {
        if (server.requests.length === 0) {
          return { name, ok: false, detail: 'the overlay showed a translation without the provider being called' }
        }

        return {
          name,
          ok: true,
          detail: `stubbed provider answered after ${server.requests.length} request(s); the overlay rendered the translation`
        }
      }

      if (Date.now() > deadline) {
        log.warn(`self-check translation body text: ${bodyText.slice(0, 200)}`)
        return { name, ok: false, detail: `the overlay never showed the translation (requests=${server.requests.length})` }
      }

      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  } catch (error) {
    return { name, ok: false, detail: (error as Error).message }
  } finally {
    // Always clean up: the temporary profile and the sample translation must never
    // outlive the check, so a diagnostic run leaves no trace in the user's data.
    try {
      if (createdProfileId) {
        await window.webContents.executeJavaScript(
          `window.translateClip.deleteLlmProviderProfile(${JSON.stringify(createdProfileId)})`
        )
      }

      if (previousActiveProfileId && previousActiveProfileId !== createdProfileId) {
        await window.webContents.executeJavaScript(
          `window.translateClip.setActiveLlmProviderProfile(${JSON.stringify(previousActiveProfileId)})`
        )
      }

      const page = (await window.webContents.executeJavaScript(
        `window.translateClip.listHistory({ query: ${JSON.stringify(sampleText)}, limit: 50 })`
      )) as { items?: Array<{ id: string; sourceText: string }> }

      for (const item of page.items ?? []) {
        if (item.sourceText === sampleText) {
          await window.webContents.executeJavaScript(`window.translateClip.removeHistoryEntry(${JSON.stringify(item.id)})`)
        }
      }
    } catch (error) {
      log.warn('self-check could not fully restore the provider configuration', error)
    }

    await server?.close()
  }
}

/**
 * Drives the real clipboard pipeline (filter → language detection → direction →
 * state broadcast → render) and asserts the overlay reflects it.
 *
 * Injection rather than a real copy keeps the check deterministic and, more
 * importantly, keeps the self-check from reading the user's actual clipboard.
 */
async function checkClipboardPipeline(window: BrowserWindow, log: Logger): Promise<SelfCheckEntry> {
  const name = 'clipboard pipeline'

  try {
    await window.webContents.executeJavaScript(
      `window.translateClip.debugInjectClipboard(${JSON.stringify(PIPELINE_SAMPLE_TEXT)})`
    )
  } catch (error) {
    return { name, ok: false, detail: `injection failed: ${(error as Error).message}` }
  }

  const deadline = Date.now() + 5_000
  let bodyText = ''

  for (;;) {
    bodyText = await window.webContents.executeJavaScript('document.body.innerText')

    const hasSource = bodyText.includes(PIPELINE_SAMPLE_TEXT)
    const hasDirection = bodyText.toUpperCase().includes('ZH-CN')

    if (hasSource && hasDirection) {
      return { name, ok: true, detail: 'source text and resolved direction reached the overlay' }
    }

    if (Date.now() > deadline) {
      log.warn(`self-check pipeline body text: ${bodyText.slice(0, 200)}`)
      return { name, ok: false, detail: `overlay did not render the injected text (source=${hasSource}, direction=${hasDirection})` }
    }

    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function readRootState(window: BrowserWindow): Promise<{ children: number; text: string }> {
  const state: { children: number; text: string } = await window.webContents.executeJavaScript(`(() => {
    const root = document.getElementById('root')
    if (!root) return { children: -1, text: 'no #root element' }
    return { children: root.childElementCount, text: (root.textContent || '').slice(0, 200) }
  })()`)

  return state
}

async function waitForMountedRoot(window: BrowserWindow, timeoutMs = 5_000): Promise<{ children: number; text: string }> {
  const deadline = Date.now() + timeoutMs
  let last = await readRootState(window)

  while (last.children <= 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100))
    last = await readRootState(window)
  }

  return last
}

/**
 * End-to-end smoke test of the packaged wiring.
 *
 * Verifies the files electron-builder must ship, that userData is writable and
 * that every renderer view loads with a working preload bridge and a mounted
 * React tree. It runs the real production entry points, which makes it useful in
 * CI and as a first thing to ask for when a Windows install misbehaves.
 */
export async function runSelfCheck(options: SelfCheckOptions): Promise<SelfCheckReport> {
  const entries: SelfCheckEntry[] = []

  const push = (name: string, ok: boolean, detail: string) => {
    entries.push({ name, ok, detail })
    options.log.info(`self-check ${ok ? 'ok  ' : 'FAIL'} ${name}: ${detail}`)
  }

  for (const [name, path] of [
    ['preload bundle', options.preloadPath],
    ['renderer html', options.rendererIndexPath],
    ['tray icon', options.trayIconPath],
    ['app icon', options.appIconPath]
  ] as const) {
    push(name, await fileExists(path), path)
  }

  const probePath = join(options.userDataPath, '.self-check-probe')
  try {
    await writeFile(probePath, 'ok', 'utf8')
    await rm(probePath, { force: true })
    push('userData writable', true, options.userDataPath)
  } catch (error) {
    push('userData writable', false, `${options.userDataPath}: ${(error as Error).message}`)
  }

  for (const target of VIEWS) {
    const window = new BrowserWindow({
      width: 420,
      height: 320,
      show: false,
      webPreferences: {
        preload: options.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })

    try {
      if (options.devServerUrl) {
        await window.loadURL(`${options.devServerUrl}?view=${target.view}`)
      } else {
        await window.loadFile(options.rendererIndexPath, { query: { view: target.view } })
      }

      const bridge = await window.webContents.executeJavaScript('typeof window.translateClip')
      const root = await waitForMountedRoot(window)

      push(
        target.label,
        bridge === 'object' && root.children > 0,
        `preload bridge=${bridge}, mounted root children=${root.children}${root.children > 0 ? '' : `, root text: ${root.text}`}`
      )

      if (target.view === 'overlay' && bridge === 'object' && root.children > 0) {
        const pipeline = await checkClipboardPipeline(window, options.log)
        push(pipeline.name, pipeline.ok, pipeline.detail)

        const translation = await checkTranslationFlow(window, options.log)
        push(translation.name, translation.ok, translation.detail)
      }
    } catch (error) {
      push(target.label, false, (error as Error).message)
    } finally {
      window.destroy()
    }
  }

  return {
    ok: entries.every((entry) => entry.ok),
    entries
  }
}
