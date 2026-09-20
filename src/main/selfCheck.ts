import { BrowserWindow, nativeImage } from 'electron'
import { access, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { Logger } from './services/logStore'
import { startStubServer, type StubServer } from './testing/stubServer'

export interface SelfCheckTarget {
  view: 'overlay' | 'settings' | 'onboarding'
  label: string
}

export interface IconAsset {
  label: string
  path: string
  /** Logical size in DIP; the `@2x` tray file therefore reports its half size. */
  expectedSize: number
}

export interface SelfCheckOptions {
  preloadPath: string
  rendererIndexPath: string
  devServerUrl: string | undefined
  userDataPath: string
  trayIconPath: string
  appIconPath: string
  iconAssets: IconAsset[]
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

/** Provider brand names, so the assertion does not depend on the UI language. */
const PROVIDER_MARKER = 'DeepSeek'

/**
 * Exercises the first-run wizard for real: it walks forward to the provider step
 * and back again, asserting the content actually changed.
 *
 * The wizard is the one screen a new user cannot avoid, so "it mounts" is not
 * enough — a broken step transition would leave them stuck on a blank step.
 */
async function checkOnboardingFlow(window: BrowserWindow, log: Logger): Promise<SelfCheckEntry> {
  const name = 'onboarding wizard'

  const click = (action: string) =>
    window.webContents.executeJavaScript(
      `(() => { const button = document.querySelector('[data-action="${action}"]'); if (!button) return false; button.click(); return true })()`
    )

  const readBody = () => window.webContents.executeJavaScript('document.body.innerText')

  const waitForBody = async (predicate: (text: string) => boolean, timeoutMs = 4_000): Promise<string> => {
    const deadline = Date.now() + timeoutMs
    let body = ''

    for (;;) {
      body = await readBody()

      if (predicate(body) || Date.now() > deadline) {
        return body
      }

      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }

  try {
    const steps = await window.webContents.executeJavaScript('document.querySelectorAll("[data-step]").length')

    if (steps !== 4) {
      return { name, ok: false, detail: `expected 4 wizard steps, found ${steps}` }
    }

    if (!(await click('next'))) {
      return { name, ok: false, detail: 'the "next" button is missing on the first step' }
    }

    const providerBody = await waitForBody((text) => text.includes(PROVIDER_MARKER))

    if (!providerBody.includes(PROVIDER_MARKER)) {
      log.warn(`self-check provider body text: ${providerBody.slice(0, 200)}`)
      return { name, ok: false, detail: 'the provider step did not render the provider list' }
    }

    if (!(await click('back'))) {
      return { name, ok: false, detail: 'the "back" button is missing on the provider step' }
    }

    const directionBody = await waitForBody((text) => !text.includes(PROVIDER_MARKER))

    if (directionBody.includes(PROVIDER_MARKER)) {
      return { name, ok: false, detail: 'the wizard did not navigate back to the direction step' }
    }

    return { name, ok: true, detail: 'four steps present; direction ⇄ provider navigation works' }
  } catch (error) {
    return { name, ok: false, detail: (error as Error).message }
  }
}

interface BootstrapShape {
  llmProviderState?: { profiles?: Array<{ profileId: string }>; activeProfileId?: string | null }
}

/**
 * Measures the overlay at the largest configured text size.
 *
 * The text size is applied as a root `zoom`, which multiplies length values — so the
 * `h-screen`/`w-screen` container would render taller and wider than the window and
 * push the status bar out of view. Only a measurement catches that.
 */
async function checkOverlayScaling(window: BrowserWindow, log: Logger): Promise<SelfCheckEntry> {
  const name = 'overlay scaling'

  const readMetrics = `(() => {
    const footer = document.querySelector('footer')
    const card = document.querySelector('[data-overlay-card]')
    return {
      innerHeight: window.innerHeight,
      innerWidth: window.innerWidth,
      bodyScrollHeight: document.body.scrollHeight,
      bodyScrollWidth: document.body.scrollWidth,
      footerBottom: footer ? Math.round(footer.getBoundingClientRect().bottom) : -1,
      cardRight: card ? Math.round(card.getBoundingClientRect().right) : -1
    }
  })()`

  let original: Record<string, unknown> | null = null

  try {
    const bootstrap = (await window.webContents.executeJavaScript('window.translateClip.getBootstrapData()')) as {
      config?: { overlay?: Record<string, unknown> }
    }
    original = bootstrap.config?.overlay ?? null

    if (!original) {
      return { name, ok: false, detail: 'the bootstrap payload had no overlay config' }
    }

    await window.webContents.executeJavaScript(
      `window.translateClip.updateConfig({ overlay: ${JSON.stringify({ ...original, fontSize: 20 })} })`
    )
    await new Promise((resolve) => setTimeout(resolve, 300))

    const metrics = (await window.webContents.executeJavaScript(readMetrics)) as {
      innerHeight: number
      innerWidth: number
      bodyScrollHeight: number
      bodyScrollWidth: number
      footerBottom: number
      cardRight: number
    }

    const fitsVertically = metrics.footerBottom > 0 && metrics.footerBottom <= metrics.innerHeight + 1
    const fitsHorizontally = metrics.cardRight > 0 && metrics.cardRight <= metrics.innerWidth + 1
    const noOverflow =
      metrics.bodyScrollHeight <= metrics.innerHeight + 1 && metrics.bodyScrollWidth <= metrics.innerWidth + 1

    return {
      name,
      ok: fitsVertically && fitsHorizontally && noOverflow,
      detail: `at fontSize 20: footer bottom ${metrics.footerBottom}/${metrics.innerHeight}, card right ${metrics.cardRight}/${metrics.innerWidth}, content ${metrics.bodyScrollWidth}x${metrics.bodyScrollHeight}`
    }
  } catch (error) {
    return { name, ok: false, detail: (error as Error).message }
  } finally {
    if (original) {
      try {
        // Restores the values captured before the check, not whatever is current now.
        await window.webContents.executeJavaScript(
          `window.translateClip.updateConfig({ overlay: ${JSON.stringify(original)} })`
        )
      } catch (error) {
        log.warn('self-check could not restore the overlay config', error)
      }
    }
  }
}

/**
 * Proves a rejected IPC call becomes visible rather than silent.
 *
 * `history:copyTranslation` throws for an entry that has no translation, which is a
 * convenient real failure: the renderer fires it fire-and-forget, so before the error
 * surface existed it produced nothing but an unhandled rejection.
 */
async function checkErrorSurface(window: BrowserWindow): Promise<SelfCheckEntry> {
  const name = 'error surface'
  const probeMessage = 'self-check error surface probe'

  try {
    const appeared: boolean = await window.webContents.executeJavaScript(`(async () => {
      // Dismiss anything already on screen first: an earlier failure in this run would
      // otherwise be mistaken for this one, since a toast lives for eight seconds.
      const dismiss = document.querySelector('[data-error-toast] button')
      if (dismiss) {
        dismiss.click()
        await new Promise((resolve) => setTimeout(resolve, 100))
      }

      Promise.reject(new Error(${JSON.stringify(probeMessage)}))

      const deadline = Date.now() + 4000
      while (Date.now() < deadline) {
        const toast = document.querySelector('[data-error-toast]')
        if (toast && (toast.textContent || '').includes(${JSON.stringify(probeMessage)})) return true
        await new Promise((resolve) => setTimeout(resolve, 50))
      }

      return false
    })()`)

    return {
      name,
      ok: appeared,
      detail: appeared ? 'a rejected renderer call surfaced as a visible error' : 'the rejection was swallowed'
    }
  } catch (error) {
    return { name, ok: false, detail: (error as Error).message }
  }
}

/**
 * Guards against work being done on every config write.
 *
 * `sanitizeConfig` rebuilds arrays and objects each time, so comparing them by
 * reference makes the condition always true. For the global shortcuts that is not just
 * wasted work: re-applying them releases and re-acquires the keys, so an unrelated
 * settings change could lose a working combination to whatever grabs it in that instant.
 */
async function checkConfigChurn(window: BrowserWindow): Promise<SelfCheckEntry> {
  const name = 'config churn'

  try {
    const bootstrap = (await window.webContents.executeJavaScript('window.translateClip.getBootstrapData()')) as {
      config?: { historyLimit?: number }
    }
    const historyLimit = bootstrap.config?.historyLimit

    if (typeof historyLimit !== 'number') {
      return { name, ok: false, detail: 'the bootstrap payload had no history limit' }
    }

    // Writes the value it already has. A real change is not needed: the bug this guards
    // against was a reference comparison, which fires whether or not the value differs —
    // and writing the same value keeps the probe free of side effects on user data.
    const shortcutEvents: number = await window.webContents.executeJavaScript(`(async () => {
      let events = 0
      const off = window.translateClip.on('shortcut:state', () => { events += 1 })

      await window.translateClip.updateConfig({ historyLimit: ${historyLimit} })
      await new Promise((resolve) => setTimeout(resolve, 250))

      off()
      return events
    })()`)

    return {
      name,
      ok: shortcutEvents === 0,
      detail:
        shortcutEvents === 0
          ? 'a config write with unchanged values left the global shortcuts alone'
          : `the shortcuts were re-applied ${shortcutEvents} time(s) by an unchanged config write`
    }
  } catch (error) {
    return { name, ok: false, detail: (error as Error).message }
  }
}

/** Switches the overlay to its history tab and reports how many entries rendered. */
async function countHistoryItems(window: BrowserWindow): Promise<number> {
  await window.webContents.executeJavaScript(
    `(() => { const tab = document.querySelector('[data-tab="history"]'); if (tab) tab.click(); return Boolean(tab) })()`
  )

  const deadline = Date.now() + 5_000

  for (;;) {
    const count: number = await window.webContents.executeJavaScript('document.querySelectorAll("[data-history-item]").length')

    if (count > 0 || Date.now() > deadline) {
      return count
    }

    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

/**
 * Opens a settings tab and asserts a page-specific condition.
 *
 * Each page is asserted by something only that page produces (the rendered prompt
 * contract, the language rows, the recorder buttons), so a tab that silently
 * renders nothing cannot pass.
 */
async function checkSettingsTab(
  window: BrowserWindow,
  tab: string,
  expression: string,
  successDetail: string
): Promise<SelfCheckEntry> {
  const name = `settings:${tab}`

  try {
    const clicked = await window.webContents.executeJavaScript(
      `(() => { const tab = document.querySelector('[data-settings-tab="${tab}"]'); if (!tab) return false; tab.click(); return true })()`
    )

    if (!clicked) {
      return { name, ok: false, detail: `the ${tab} tab is missing from the settings window` }
    }

    const deadline = Date.now() + 5_000

    for (;;) {
      const satisfied: boolean = await window.webContents.executeJavaScript(`Boolean(${expression})`)

      if (satisfied) {
        return { name, ok: true, detail: successDetail }
      }

      if (Date.now() > deadline) {
        const body = await window.webContents.executeJavaScript('document.body.innerText')
        return { name, ok: false, detail: `the ${tab} tab never rendered its content: ${body.slice(0, 160)}` }
      }

      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  } catch (error) {
    return { name, ok: false, detail: (error as Error).message }
  }
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

        const historyItems = await countHistoryItems(window)

        if (historyItems === 0) {
          return { name, ok: false, detail: 'the finished translation never appeared in the history panel' }
        }

        return {
          name,
          ok: true,
          detail: `stubbed provider answered after ${server.requests.length} request(s); the overlay rendered the translation and listed it in history`
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

/**
 * Clicks the overlay's watch controls.
 *
 * Both of them: the header badge reports the state and the status bar names the action, and
 * each has to relabel itself when the state flips — a button that keeps saying the same thing
 * after being pressed is how this control was unreadable in the first place.
 *
 * `clipboardWatchEnabled` is flipped and put straight back, so the setting is left as the
 * probe found it. The watcher is never started during a self-check (main.ts skips it while
 * `--self-check` is set), which is what keeps this from reading the user's clipboard.
 */
async function checkWatchToggle(window: BrowserWindow): Promise<SelfCheckEntry> {
  const name = 'watch toggle'

  interface Control {
    label: string
    title: string | null
  }

  try {
    const result = (await window.webContents.executeJavaScript(`(async () => {
      const read = async () => (await window.translateClip.getBootstrapData()).config.clipboardWatchEnabled
      const snapshot = () => [...document.querySelectorAll('[data-watch-toggle]')].map((toggle) => ({
        label: (toggle.textContent || '').trim(),
        title: toggle.getAttribute('title')
      }))

      const before = await read()
      const beforeControls = snapshot()
      if (beforeControls.length === 0) return { found: false }

      // Re-queried rather than reused: a stale node would make the second click a no-op and
      // the probe would report "not restored" for the wrong reason.
      document.querySelector('[data-watch-toggle]').click()
      await new Promise((resolve) => setTimeout(resolve, 400))
      const after = await read()
      const afterControls = snapshot()

      document.querySelector('[data-watch-toggle]').click()
      await new Promise((resolve) => setTimeout(resolve, 400))

      return { found: true, before, after, restored: await read(), beforeControls, afterControls }
    })()`)) as {
      found: boolean
      before?: boolean
      after?: boolean
      restored?: boolean
      beforeControls?: Control[]
      afterControls?: Control[]
    }

    if (!result.found) {
      return { name, ok: false, detail: 'the overlay has no [data-watch-toggle] control' }
    }

    if (result.after === result.before) {
      return { name, ok: false, detail: `clicking the control left watching at ${String(result.before)}` }
    }

    if (result.restored !== result.before) {
      return { name, ok: false, detail: 'clicking the control a second time did not restore watching' }
    }

    const before = result.beforeControls ?? []
    const after = result.afterControls ?? []
    const labels = `${before.map((c) => c.label).join(' / ')} -> ${after.map((c) => c.label).join(' / ')}`

    if (before.length !== after.length) {
      return { name, ok: false, detail: `the overlay controls changed in number (${labels})` }
    }

    if (!after.every((control, index) => control.label && control.label !== before[index]?.label)) {
      return { name, ok: false, detail: `a control kept its label after being pressed (${labels})` }
    }

    if (!after.every((control, index) => control.title && control.title !== before[index]?.title)) {
      return { name, ok: false, detail: `a control kept its tooltip after being pressed (${labels})` }
    }

    return { name, ok: true, detail: `the overlay controls relabelled and paused/resumed watching (${labels})` }
  } catch (error) {
    return { name, ok: false, detail: (error as Error).message }
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

  // Decoding is the only check that proves an asset is actually usable: a file can
  // exist, be the right size on disk and still be an image Chromium cannot read
  // (which is what a blank tray icon or a rejected installer icon looks like).
  for (const asset of options.iconAssets) {
    const image = nativeImage.createFromPath(asset.path)
    const size = image.getSize()
    const decoded = !image.isEmpty()

    push(
      `icon decode: ${asset.label}`,
      decoded && size.width === asset.expectedSize && size.height === asset.expectedSize,
      decoded ? `${size.width}x${size.height} (expected ${asset.expectedSize})` : `could not decode ${asset.path}`
    )
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
        // These probes read the expanded card. A collapsed overlay — which is a persisted user
        // layout, not a broken build — has no header, footer or card to measure and no labelled
        // control to click, so without this the run reports failures that say nothing about the
        // code. The collapsed layout is measured by hand instead; see the Windows checklist.
        const overlayConfig = (await window.webContents.executeJavaScript(
          '(async () => (await window.translateClip.getBootstrapData()).config.overlay)()'
        )) as Record<string, unknown> | undefined

        const setCollapsed = async (collapsed: boolean) => {
          if (!overlayConfig) {
            return
          }

          await window.webContents.executeJavaScript(
            `window.translateClip.updateConfig({ overlay: ${JSON.stringify({ ...overlayConfig, collapsed })} })`
          )
          await new Promise((resolve) => setTimeout(resolve, 300))
        }

        await setCollapsed(false)

        const pipeline = await checkClipboardPipeline(window, options.log)
        push(pipeline.name, pipeline.ok, pipeline.detail)

        const watchToggle = await checkWatchToggle(window)
        push(watchToggle.name, watchToggle.ok, watchToggle.detail)

        const translation = await checkTranslationFlow(window, options.log)
        push(translation.name, translation.ok, translation.detail)

        const scaling = await checkOverlayScaling(window, options.log)
        push(scaling.name, scaling.ok, scaling.detail)

        const errorSurface = await checkErrorSurface(window)
        push(errorSurface.name, errorSurface.ok, errorSurface.detail)

        const churn = await checkConfigChurn(window)
        push(churn.name, churn.ok, churn.detail)

        // Puts the user's layout back exactly as it was found.
        if (overlayConfig?.collapsed) {
          await setCollapsed(true)
        }
      }

      if (target.view === 'settings' && bridge === 'object' && root.children > 0) {
        // Sequential rather than parallel: they all click tabs in the same window.
        const tabs = [
          await checkSettingsTab(
            window,
            'general',
            "document.querySelectorAll('[data-settings-section=\"overlay\"] input[type=number]').length === 2",
            'the overlay appearance controls rendered'
          ),
          await checkSettingsTab(
            window,
            'clipboard',
            "Boolean(document.querySelector('[data-settings-section=\"developer\"]'))",
            'the clipboard tab rendered, including the development-only clipboard simulator'
          ),
          await checkSettingsTab(window, 'providers', "document.body.innerText.includes('DeepSeek')", 'the provider catalogue rendered'),
          await checkSettingsTab(
            window,
            'prompt',
            "document.body.innerText.includes('detectedLanguage')",
            'the prompt tab rendered the live preview from the main process'
          ),
          await checkSettingsTab(
            window,
            'glossary',
            "document.body.innerText.includes('English')",
            'the glossary editor rendered its language rows'
          ),
          await checkSettingsTab(
            window,
            'shortcuts',
            "document.querySelectorAll('[data-shortcut-recorder]').length === 2",
            'both shortcut recorders rendered'
          )
        ]

        for (const tab of tabs) {
          push(tab.name, tab.ok, tab.detail)
        }
      }

      if (target.view === 'onboarding' && bridge === 'object' && root.children > 0) {
        const wizard = await checkOnboardingFlow(window, options.log)
        push(wizard.name, wizard.ok, wizard.detail)
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
