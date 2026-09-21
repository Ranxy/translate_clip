import { BrowserWindow, nativeImage } from 'electron'
import { access, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { SUPPORTED_LOCALES } from '@shared/locales'

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

/** Every shipped interface language, plus the "follow system" entry above them. */
const UI_LANGUAGE_OPTION_COUNT = SUPPORTED_LOCALES.length + 1

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

/**
 * Picks an interface language from the wizard's first step and back again.
 *
 * The first step is the one screen a user cannot skip, and it is also the only
 * place where the interface language has to be changeable *before* anything else
 * makes sense. Four things have to hold at once, and only a real render shows
 * them: the picker offers every shipped locale and defaults to "follow system",
 * choosing one re-renders the window in it (that is the whole point of the i18n
 * wiring), the choice reaches the config rather than only local state, and the
 * wizard does not write a stale copy back when a step is committed — the language
 * is applied immediately, so the step's own "next" must leave it alone.
 *
 * The original setting is put back, so a diagnostic run leaves no trace.
 */
async function checkOnboardingLanguage(window: BrowserWindow, log: Logger): Promise<SelfCheckEntry> {
  const name = 'onboarding language picker'

  try {
    const result = (await window.webContents.executeJavaScript(`(async () => {
      const select = document.querySelector('[data-ui-language]')
      if (!select) return { found: false }

      const original = (await window.translateClip.getBootstrapData()).config.uiLanguage
      const options = [...select.options].map((option) => option.value)
      const initial = select.value

      select.value = 'ja'
      select.dispatchEvent(new Event('change', { bubbles: true }))

      const deadline = Date.now() + 5000
      let translated = false

      while (Date.now() < deadline) {
        if (document.documentElement.lang === 'ja' && document.body.innerText.includes('ようこそ')) {
          translated = true
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 50))
      }

      const stored = (await window.translateClip.getBootstrapData()).config.uiLanguage
      await window.translateClip.updateConfig({ uiLanguage: original })

      // The picker must follow the store from here on, not a copy it kept.
      const followed = document.querySelector('[data-ui-language]').value

      // Committing step 1 is what used to write the old language back.
      document.querySelector('[data-action="next"]').click()
      await new Promise((resolve) => setTimeout(resolve, 600))
      const afterNext = (await window.translateClip.getBootstrapData()).config.uiLanguage
      document.querySelector('[data-action="back"]').click()
      await new Promise((resolve) => setTimeout(resolve, 300))

      return { found: true, options, initial, stored, translated, followed, afterNext }
    })()`)) as {
      found: boolean
      options?: string[]
      initial?: string
      stored?: string
      translated?: boolean
      followed?: string
      afterNext?: string
    }

    if (!result.found) {
      return { name, ok: false, detail: 'the first wizard step has no [data-ui-language] picker' }
    }

    if (result.options?.length !== UI_LANGUAGE_OPTION_COUNT) {
      return {
        name,
        ok: false,
        detail: `the picker listed ${result.options?.length ?? 0} languages, expected ${UI_LANGUAGE_OPTION_COUNT} (${result.options?.join(', ')})`
      }
    }

    if (result.initial !== 'system') {
      return { name, ok: false, detail: `the picker defaulted to "${String(result.initial)}" instead of following the system` }
    }

    if (!result.translated) {
      return { name, ok: false, detail: 'choosing Japanese did not re-render the wizard in Japanese' }
    }

    if (result.stored !== 'ja') {
      return { name, ok: false, detail: `choosing a language stored "${String(result.stored)}" instead of "ja"` }
    }

    if (result.followed !== result.initial) {
      return {
        name,
        ok: false,
        detail: `the picker kept showing "${String(result.followed)}" after the config was set back to "${String(result.initial)}"`
      }
    }

    if (result.afterNext !== result.initial) {
      return {
        name,
        ok: false,
        detail: `committing the first step rewrote the interface language as "${String(result.afterNext)}"`
      }
    }

    return {
      name,
      ok: true,
      detail: `all ${SUPPORTED_LOCALES.length} locales offered, "system" by default, switching re-renders and persists immediately, and committing the step leaves it alone`
    }
  } catch (error) {
    log.warn('self-check language picker probe failed', error)
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
 * Drags the overlay opacity slider and asserts the value actually reaches the config.
 *
 * This control is two-phase by design — applied to the overlay while the thumb moves, saved when
 * it is released — so "the slider moved" would prove nothing on its own. What has to hold is that
 * the *stored* value is the one the user let go on (the number field this replaced rounded every
 * value in the 0.6–1 range up to 1, which is how the setting became impossible to change), and
 * that the drag itself writes no config. Both are read back from the main process.
 *
 * The user's own opacity is put back at the end. On a platform whose windows cannot take an
 * opacity at all the control is rendered disabled, which is reported as such rather than failed.
 */
async function checkOverlayOpacitySlider(window: BrowserWindow): Promise<SelfCheckEntry> {
  const name = 'overlay opacity slider'

  try {
    const original = (await window.webContents.executeJavaScript(
      '(async () => (await window.translateClip.getBootstrapData()).config.overlay.opacity)()'
    )) as number

    const target = original === 0.7 ? 0.9 : 0.7

    const result = (await window.webContents.executeJavaScript(`(async () => {
      const tab = document.querySelector('[data-settings-tab="general"]')
      if (tab) tab.click()
      await new Promise((resolve) => setTimeout(resolve, 250))

      const slider = document.querySelector('[data-overlay-opacity]')
      if (!slider) return { found: false }

      // On a platform whose window manager cannot take an opacity (Linux), the control is
      // rendered disabled and the settings page explains why. There is nothing to drag there.
      if (slider.disabled) return { found: true, disabled: true }

      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      const before = (await window.translateClip.getBootstrapData()).config.overlay.opacity

      // The drag: applied to the window, deliberately not written to the config.
      await window.translateClip.previewOverlayOpacity(${target})
      const afterPreview = (await window.translateClip.getBootstrapData()).config.overlay.opacity

      // The release: this is the one that persists.
      setter.call(slider, '${target}')
      slider.dispatchEvent(new Event('input', { bubbles: true }))
      slider.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
      await new Promise((resolve) => setTimeout(resolve, 400))

      const stored = (await window.translateClip.getBootstrapData()).config.overlay.opacity

      return { found: true, disabled: false, before, afterPreview, stored, shown: Number(slider.value) }
    })()`)) as {
      found: boolean
      disabled?: boolean
      before?: number
      afterPreview?: number
      stored?: number
      shown?: number
    }

    await window.webContents.executeJavaScript(
      `(async () => { const overlay = (await window.translateClip.getBootstrapData()).config.overlay; return window.translateClip.updateConfig({ overlay: Object.assign({}, overlay, { opacity: ${original} }) }) })()`
    )

    if (!result.found) {
      return { name, ok: false, detail: 'the settings window has no overlay opacity slider' }
    }

    if (result.disabled) {
      return { name, ok: true, detail: 'this platform cannot set window opacity, so the slider is rendered disabled' }
    }

    if (result.afterPreview !== result.before) {
      return {
        name,
        ok: false,
        detail: `dragging the slider wrote the config (${String(result.before)} → ${String(result.afterPreview)})`
      }
    }

    if (result.stored !== target) {
      return { name, ok: false, detail: `releasing the slider stored ${String(result.stored)} instead of ${target}` }
    }

    return {
      name,
      ok: true,
      detail: `the drag previewed ${target} without writing it, the release stored it, and the control shows ${String(result.shown)}`
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

/**
 * Clicks the overlay's clear control.
 *
 * Runs after the translation probe, which leaves both a source and a translation on screen — so
 * there is something to clear, and clearing has to remove both rather than just the translation.
 * The control is then expected to disable itself, since there is nothing left to clear.
 */
async function checkClearCurrent(window: BrowserWindow): Promise<SelfCheckEntry> {
  const name = 'clear current'

  try {
    const result = (await window.webContents.executeJavaScript(`(async () => {
      const read = async () => (await window.translateClip.getBootstrapData()).translationState
      const button = document.querySelector('[data-clear-current]')

      if (!button) return { found: false }

      const before = await read()
      const wasDisabled = button.disabled
      button.click()
      await new Promise((resolve) => setTimeout(resolve, 400))
      const after = await read()

      return {
        found: true,
        wasDisabled,
        before: { source: before.sourceText, translated: before.translatedText },
        after: { source: after.sourceText, translated: after.translatedText, phase: after.phase },
        disabledAfter: document.querySelector('[data-clear-current]')?.disabled ?? null
      }
    })()`)) as {
      found: boolean
      wasDisabled?: boolean
      before?: { source: string | null; translated: string | null }
      after?: { source: string | null; translated: string | null; phase: string }
      disabledAfter?: boolean | null
    }

    if (!result.found) {
      return { name, ok: false, detail: 'the overlay has no [data-clear-current] control' }
    }

    if (!result.before?.source && !result.before?.translated) {
      return { name, ok: false, detail: 'there was nothing on screen for the control to clear' }
    }

    if (result.wasDisabled) {
      return { name, ok: false, detail: 'the control was disabled while a translation was on screen' }
    }

    if (result.after?.source || result.after?.translated || result.after?.phase !== 'idle') {
      return {
        name,
        ok: false,
        detail: `clearing left phase=${String(result.after?.phase)} with source=${result.after?.source ? 'set' : 'null'} translation=${result.after?.translated ? 'set' : 'null'}`
      }
    }

    if (result.disabledAfter !== true) {
      return { name, ok: false, detail: 'the control stayed enabled with nothing left to clear' }
    }

    return { name, ok: true, detail: 'clearing emptied the source and the translation and disabled the control' }
  } catch (error) {
    return { name, ok: false, detail: (error as Error).message }
  }
}

/**
 * Records a shortcut through the settings recorder and checks the row agrees with the main process.
 *
 * Asserted on the rendered row rather than on the returned state, because that is where the bug was:
 * the row rendered `bootstrap.shortcutState`, a snapshot taken when the window loaded its payload,
 * so the first recording of a session displayed the *previous* outcome — "registration failed" for a
 * shortcut that had just registered — until the window was reopened and fetched a fresh payload.
 *
 * The probe starts by clearing the shortcut and reloading the window, so the snapshot says "not
 * registered" while the live state is about to say otherwise; without that the two can agree by luck
 * and the check would prove nothing. Whether the combination actually registers is allowed either
 * way — the assertion is agreement, so a machine that refuses it still passes while a stale row does
 * not — and the user's own shortcut is put back at the end.
 */
async function checkShortcutRecording(window: BrowserWindow): Promise<SelfCheckEntry> {
  const name = 'shortcut recording'

  try {
    await window.webContents.executeJavaScript(`window.translateClip.setShortcut('toggleOverlay', null)`)
    window.webContents.reload()
    await waitForMountedRoot(window)

    const result = (await window.webContents.executeJavaScript(`(async () => {
      const tab = document.querySelector('[data-settings-tab="shortcuts"]')
      if (tab) tab.click()
      await new Promise((resolve) => setTimeout(resolve, 400))

      const recorder = document.querySelector('[data-shortcut-recorder="toggleOverlay"]')
      if (!recorder) return { found: false }

      recorder.click()
      await new Promise((resolve) => setTimeout(resolve, 100))
      recorder.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'F9',
          code: 'F9',
          ctrlKey: true,
          altKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true
        })
      )
      await new Promise((resolve) => setTimeout(resolve, 700))

      const row = recorder.parentElement?.parentElement ?? null
      const registered = (await window.translateClip.getBootstrapData()).shortcutState.toggleOverlay.registered
      const showsRegistered = Boolean(row && row.querySelector('.text-ok'))
      const showsFailed = Boolean(row && row.querySelector('.text-warn, .text-danger'))
      const accelerator = (await window.translateClip.getBootstrapData()).config.shortcuts.toggleOverlay

      await window.translateClip.setShortcut('toggleOverlay', null)

      return { found: true, registered, showsRegistered, showsFailed, accelerator }
    })()`)) as {
      found: boolean
      registered?: boolean
      showsRegistered?: boolean
      showsFailed?: boolean
      accelerator?: string | null
    }

    if (!result.found) {
      return { name, ok: false, detail: 'the settings window has no shortcut recorder' }
    }

    if (result.accelerator !== 'Control+Alt+Shift+F9') {
      return { name, ok: false, detail: `the recorder stored ${String(result.accelerator)}` }
    }

    const agrees = result.registered === true
      ? result.showsRegistered === true && result.showsFailed !== true
      : result.showsFailed === true && result.showsRegistered !== true

    const shown = result.showsRegistered ? 'registered' : result.showsFailed ? 'failed' : 'neither'

    return {
      name,
      ok: agrees,
      detail: agrees
        ? `the row matched the registration (registered=${String(result.registered)}), and the shortcut was released again`
        : `the row disagreed with the registration: registered=${String(result.registered)} but the row showed ${shown}`
    }
  } catch (error) {
    return { name, ok: false, detail: (error as Error).message }
  }
}

/** Rows of the overlay that carry translated text. */
const OVERLAY_ROWS: ReadonlyArray<{ selector: string; label: string; singleLine: boolean }> = [
  { selector: '[data-overlay-header]', label: 'header', singleLine: true },
  { selector: '[data-overlay-actions]', label: 'action row', singleLine: true },
  { selector: '[data-status-bar]', label: 'status bar', singleLine: true },
  { selector: '[data-overlay-card]', label: 'card', singleLine: false },
  { selector: '[data-history-search]', label: 'history search', singleLine: true },
  { selector: '[data-history-actions]', label: 'history actions', singleLine: true }
]

/**
 * The two widths that matter: the default one, and the narrowest the user may drag
 * the overlay to (`MIN_OVERLAY_WIDTH` in windowManager).
 */
const OVERLAY_MEASUREMENTS = [
  { label: 'default', width: 380, height: 520, requireSingleLine: true },
  { label: 'minimum', width: 300, height: 420, requireSingleLine: false }
] as const

/**
 * Measures the overlay in every shipped language, at its default and narrowest width.
 *
 * Translations are not the same length: "Copy translation" fits a 380 DIP overlay and
 * "Копировать перевод" did not, so a layout tuned on Chinese clipped Russian and
 * English buttons and tabs — silently, because the card is `overflow-hidden`. Two
 * separate promises are checked here, in every language and on both tabs:
 *
 *   - nothing is ever clipped, down to the narrowest width the window allows, and
 *   - at the default width every row still lays out on one line, so the overlay looks
 *     the same in all four languages rather than merely staying readable in each.
 *
 * The status bar is put into its longest state first (a copy the filter rejected, so
 * the reason and the phase and the provider and both toggles are all on screen), and
 * the text size is pinned so this measures the language rather than the zoom setting.
 */
async function checkOverlayLocalization(window: BrowserWindow, log: Logger): Promise<SelfCheckEntry> {
  const name = 'overlay localization'
  const originalSize = window.getContentSize()
  const overflow: string[] = []
  const wrapped: string[] = []
  const missing: string[] = []

  // Captured before anything is touched: the probe sets the interface language, the
  // text size and the clipboard filter, and reading the config back afterwards would
  // read the probe's own values and restore nothing.
  const original = (await window.webContents.executeJavaScript(
    `(async () => {
      const config = (await window.translateClip.getBootstrapData()).config
      return { uiLanguage: config.uiLanguage, overlay: config.overlay, minSourceChars: config.minSourceChars }
    })()`
  )) as { uiLanguage: string; overlay: Record<string, unknown>; minSourceChars: number }

  /** Set when the config could not be put back; a probe that edits user data must say so. */
  let restoreFailure: string | null = null

  /** Loops the languages (and both tabs) at whatever size the window currently has. */
  const measure = (requireSingleLine: boolean): string => `(async () => {
    const ROWS = ${JSON.stringify(OVERLAY_ROWS)}
    const LOCALES = ${JSON.stringify(SUPPORTED_LOCALES)}
    const REQUIRE_SINGLE_LINE = ${String(requireSingleLine)}
    const settle = () => new Promise((resolve) => setTimeout(resolve, 80))
    const overflow = []
    const wrapped = []
    const missing = []

    /**
     * True when the row took more than one line.
     *
     * With centered items and no wrap, a row is exactly as tall as its tallest child
     * plus its own padding, whatever the children's individual heights are; wrapping
     * adds a whole second line, so the comparison is exact rather than a guess about
     * where the children's tops land.
     */
    const wrappedRow = (element) => {
      const style = getComputedStyle(element)
      const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom)
      const heights = [...element.children]
        .filter((child) => child.getBoundingClientRect().width > 0)
        .map((child) => child.getBoundingClientRect().height)
      const tallest = heights.length > 0 ? Math.max(...heights) : 0

      if (tallest === 0) {
        return false
      }

      return element.getBoundingClientRect().height > tallest + padding + 2
    }

    const showTab = async (tab) => {
      const button = document.querySelector('[data-tab="' + tab + '"]')
      if (button) button.click()
      await settle()
    }

    /**
     * Waits for the layout the config asks for, instead of assuming it landed.
     *
     * Both layouts are the same React tree with an early return, so the swap is one
     * render — but measuring on a fixed delay is how a probe reports "rows missing"
     * for a reason that has nothing to do with the thing it is testing.
     */
    const applyLayout = async (collapsed) => {
      const wanted = collapsed ? '[data-collapsed-bar]' : '[data-overlay-card]'
      const unwanted = collapsed ? '[data-overlay-card]' : '[data-collapsed-bar]'
      const config = (await window.translateClip.getBootstrapData()).config

      await window.translateClip.updateConfig({ overlay: { ...config.overlay, collapsed } })

      const deadline = Date.now() + 3000
      while (Date.now() < deadline) {
        if (document.querySelector(wanted) && !document.querySelector(unwanted)) {
          await settle()
          return true
        }
        await new Promise((resolve) => setTimeout(resolve, 30))
      }

      missing.push('the ' + (collapsed ? 'collapsed bar' : 'expanded card') + ' never rendered')
      return false
    }

    const setCollapsed = (collapsed) => applyLayout(collapsed)

    /** How many lines a clamped text span actually rendered. */
    const textLines = (element) => {
      const lineHeight = parseFloat(getComputedStyle(element).lineHeight) || 20
      return Math.max(Math.round(element.scrollHeight / lineHeight), 1)
    }

    // Pins the text size so this measures the language rather than the zoom setting,
    // then waits for the expanded layout the loop below starts from.
    await window.translateClip.updateConfig({ overlay: { ...(await window.translateClip.getBootstrapData()).config.overlay, collapsed: false, fontSize: 14 } })
    await applyLayout(false)

    // Restored by the same script that changes it, so the language can never outlive
    // this call even if the caller's own restore is lost.
    const restoreLanguage = (await window.translateClip.getBootstrapData()).config.uiLanguage

    // The longest the status bar ever gets: a copy the filter rejected, which adds
    // "Skipped: <reason>" next to the phase, the provider and both toggles. The
    // minimum length is pinned alongside the text size so a one-character probe can
    // never reach a provider and spend the user's quota. It also leaves the overlay
    // with no source and no translation, which is the state the collapsed bar's idle
    // hint is measured in.
    await window.translateClip.updateConfig({ minSourceChars: 2 })
    await window.translateClip.debugInjectClipboard('x')
    await settle()

    for (const locale of LOCALES) {
      await window.translateClip.updateConfig({ uiLanguage: locale })

      const deadline = Date.now() + 3000
      while (document.documentElement.lang !== locale && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 30))
      }

      await setCollapsed(false)

      for (const tab of ['current', 'history']) {
        await showTab(tab)
        const where = locale + ' ' + tab + ' tab'

        // Checked once per tab rather than per row: when the card is gone, six "row
        // missing" lines say less than one line saying what is on screen instead.
        if (!document.querySelector('[data-overlay-card]')) {
          missing.push(
            where +
              ' has no overlay card — ' +
              (document.querySelector('[data-collapsed-bar]')
                ? 'the collapsed bar is showing instead'
                : 'body: ' + document.body.innerText.replace(/\s+/g, ' ').slice(0, 80))
          )
          continue
        }

        for (const row of ROWS) {
          const element = document.querySelector(row.selector)

          if (!element) {
            // The history rows only exist while the history tab is showing.
            if (tab === 'history' || !row.selector.includes('history')) {
              missing.push(where + ' ' + row.label)
            }
            continue
          }

          const excess = element.scrollWidth - element.clientWidth
          if (excess > 1) {
            overflow.push(where + ' ' + row.label + ' clipped by ' + excess + 'px')
          }

          if (REQUIRE_SINGLE_LINE && row.singleLine && wrappedRow(element)) {
            wrapped.push(where + ' ' + row.label)
          }
        }
      }

      // The collapsed bar is the overlay's least intrusive form: one line of preview
      // and three icon buttons. Its idle hint has to stay on that one line.
      await setCollapsed(true)

      const bar = document.querySelector('[data-collapsed-bar]')
      const text = document.querySelector('[data-collapsed-text]')

      if (!bar || !text) {
        missing.push(locale + ' collapsed bar')
      } else {
        const excess = bar.scrollWidth - bar.clientWidth
        if (excess > 1) {
          overflow.push(locale + ' collapsed bar clipped by ' + excess + 'px')
        }

        const lines = textLines(text)
        if (REQUIRE_SINGLE_LINE && lines > 1) {
          wrapped.push(locale + ' collapsed bar idle hint (' + lines + ' lines)')
        }
      }
    }

    await window.translateClip.updateConfig({ uiLanguage: restoreLanguage })

    return { overflow, wrapped, missing }
  })()`

  try {
    // Pinned before the first measurement so the reflow is already done.
    await window.webContents.executeJavaScript(
      `(async () => {
        const config = (await window.translateClip.getBootstrapData()).config
        await window.translateClip.updateConfig({ overlay: { ...config.overlay, collapsed: false, fontSize: 14 } })
      })()`
    )

    for (const scenario of OVERLAY_MEASUREMENTS) {
      window.setContentSize(scenario.width, scenario.height)
      await new Promise((resolve) => setTimeout(resolve, 200))

      const result = (await window.webContents.executeJavaScript(measure(scenario.requireSingleLine))) as {
        overflow: string[]
        wrapped: string[]
        missing: string[]
      }

      const at = `at ${scenario.width} DIP (${scenario.label})`
      overflow.push(...result.overflow.map((entry) => `${at}: ${entry}`))
      wrapped.push(...result.wrapped.map((entry) => `${at}: ${entry}`))
      missing.push(...result.missing.map((entry) => `${at}: ${entry}`))
    }
  } catch (error) {
    return { name, ok: false, detail: (error as Error).message }
  } finally {
    window.setContentSize(originalSize[0], originalSize[1])

    // Puts back exactly what was captured above, not whatever the probe left behind,
    // and checks that it stuck: a silent restore failure would leave the user's
    // interface in a language they never chose, and would then look like the *next*
    // run's failure rather than this one's.
    try {
      await window.webContents.executeJavaScript(
        `window.translateClip.updateConfig(${JSON.stringify(original)})`
      )

      const after = (await window.webContents.executeJavaScript(
        `(async () => {
          const config = (await window.translateClip.getBootstrapData()).config
          return {
            uiLanguage: config.uiLanguage,
            minSourceChars: config.minSourceChars,
            collapsed: config.overlay.collapsed,
            fontSize: config.overlay.fontSize
          }
        })()`
      )) as { uiLanguage: string; minSourceChars: number; collapsed: boolean; fontSize: number }

      const expected = {
        uiLanguage: original.uiLanguage,
        minSourceChars: original.minSourceChars,
        collapsed: original.overlay.collapsed,
        fontSize: original.overlay.fontSize
      }

      if (JSON.stringify(after) !== JSON.stringify(expected)) {
        restoreFailure = `the config was not restored: ${JSON.stringify(after)} should be ${JSON.stringify(expected)}`
      }
    } catch (error) {
      restoreFailure = `the config could not be restored: ${(error as Error).message}`
    }
  }

  if (restoreFailure) {
    log.warn(`self-check overlay localization: ${restoreFailure}`)
    return { name, ok: false, detail: restoreFailure }
  }

  if (missing.length > 0) {
    return { name, ok: false, detail: `rows missing from the overlay: ${missing.join(', ')}` }
  }

  if (overflow.length > 0) {
    log.warn(`self-check overlay localization clipped: ${overflow.join('; ')}`)
    return { name, ok: false, detail: overflow.join('; ') }
  }

  if (wrapped.length > 0) {
    log.warn(`self-check overlay localization wrapped: ${wrapped.join('; ')}`)
    return { name, ok: false, detail: `not on one line at the default width: ${wrapped.join('; ')}` }
  }

  return {
    name,
    ok: true,
    detail: `${SUPPORTED_LOCALES.length} languages, both tabs: one line at the default width, nothing clipped at the ${OVERLAY_MEASUREMENTS[1].width} DIP minimum`
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

        const clear = await checkClearCurrent(window)
        push(clear.name, clear.ok, clear.detail)

        const scaling = await checkOverlayScaling(window, options.log)
        push(scaling.name, scaling.ok, scaling.detail)

        const errorSurface = await checkErrorSurface(window)
        push(errorSurface.name, errorSurface.ok, errorSurface.detail)

        const churn = await checkConfigChurn(window)
        push(churn.name, churn.ok, churn.detail)

        // Runs last among the overlay probes: it changes the window size, the text
        // size, the interface language and the clipboard activity.
        const localization = await checkOverlayLocalization(window, options.log)
        push(localization.name, localization.ok, localization.detail)

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
            "document.querySelectorAll('[data-settings-section=\"overlay\"] input[type=number]').length === 1" +
              " && document.querySelector('[data-settings-section=\"overlay\"] input[type=range]') !== null" +
              ` && document.querySelectorAll('[data-ui-language] option').length === ${UI_LANGUAGE_OPTION_COUNT}`,
            'the overlay appearance controls (opacity slider, text size) and the interface-language picker rendered'
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

        const recording = await checkShortcutRecording(window)
        push(recording.name, recording.ok, recording.detail)

        const opacity = await checkOverlayOpacitySlider(window)
        push(opacity.name, opacity.ok, opacity.detail)
      }

      if (target.view === 'onboarding' && bridge === 'object' && root.children > 0) {
        // The wizard probe walks forward and back and leaves step 1 showing; the
        // language probe then drives the picker on that same step.
        const wizard = await checkOnboardingFlow(window, options.log)
        push(wizard.name, wizard.ok, wizard.detail)

        const language = await checkOnboardingLanguage(window, options.log)
        push(language.name, language.ok, language.detail)
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
