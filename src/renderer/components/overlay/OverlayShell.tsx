import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'

import { useAppState, useAppStore } from '../../store/appStore'
import { cn, dragRegion, noDragRegion } from '../../utils/cn'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { IconChevronDown, IconClose, IconCopy, IconGear, IconMinus, IconRefresh, IconTrash } from '../ui/Icon'
import { HistoryPanel } from './HistoryPanel'
import { StatusBar } from './StatusBar'
import { WatchToggle } from './WatchToggle'

type OverlayTab = 'current' | 'history'

function DirectionLabel() {
  const { translationState } = useAppState()
  const direction = translationState.direction

  if (!direction) {
    return null
  }

  const source = direction.sourceLanguage === 'latin' || direction.sourceLanguage === 'unknown' ? 'AUTO' : direction.sourceLanguage

  return (
    <span className="font-mono text-[10px] uppercase tracking-wide text-faint">
      {source} → {direction.targetLanguage}
    </span>
  )
}

function CurrentPanel() {
  const { t } = useTranslation()
  const store = useAppStore()
  const { translationState } = useAppState()
  const configured = store.isProviderConfigured
  const hasSource = Boolean(translationState.sourceText)

  if (!hasSource && translationState.phase === 'idle') {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="text-[13px] font-medium text-text">{t('overlay.emptyTitle')}</p>
        <p className="text-[12px] leading-relaxed text-muted">{t('overlay.emptyBody')}</p>
        <Button size="sm" className="mt-1" onClick={() => void window.translateClip.translateClipboardNow()}>
          {t('overlay.actionTranslateNow')}
        </Button>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 py-3">
      {hasSource ? (
        <section>
          <header className="mb-1 flex items-center justify-between">
            <span className="text-[10.5px] uppercase tracking-wide text-faint">{t('overlay.sourceLabel')}</span>
            <DirectionLabel />
          </header>
          <p className="line-clamp-3 selectable whitespace-pre-wrap text-[12.5px] leading-relaxed text-muted">
            {translationState.sourceText}
          </p>
        </section>
      ) : null}

      <section className="flex min-h-0 flex-1 flex-col">
        <header className="mb-1 flex items-center justify-between">
          <span className="text-[10.5px] uppercase tracking-wide text-faint">{t('overlay.translationLabel')}</span>
          {translationState.cached ? <Badge tone="accent">{t('overlay.cached')}</Badge> : null}
        </header>

        {!configured ? (
          <div className="flex flex-col items-start gap-2 pt-0.5">
            <p className="text-[12.5px] text-warn">{t('overlay.providerMissing')}</p>
            <Button variant="primary" size="sm" onClick={() => void window.translateClip.openSettings()}>
              {t('overlay.providerMissingAction')}
            </Button>
          </div>
        ) : translationState.phase === 'translating' ? (
          <div className="flex flex-col gap-2 pt-1">
            <span className="h-3 w-4/5 animate-pulse rounded bg-surface-hover" />
            <span className="h-3 w-3/5 animate-pulse rounded bg-surface-hover" />
          </div>
        ) : translationState.phase === 'error' ? (
          <div className="flex flex-col items-start gap-2">
            <p className="text-[12.5px] text-danger">{translationState.error?.message ?? t('overlay.phase.error')}</p>
            <Button size="sm" onClick={() => void window.translateClip.retranslateLast()}>
              {t('common.retry')}
            </Button>
          </div>
        ) : translationState.translatedText ? (
          <p className="selectable whitespace-pre-wrap text-[14px] leading-relaxed text-text">{translationState.translatedText}</p>
        ) : (
          <p className="text-[12px] leading-relaxed text-faint">{t('overlay.emptyBody')}</p>
        )}
      </section>
    </div>
  )
}

/**
 * Turns the configured text size into a scale factor.
 *
 * The overlay's classes are in fixed pixels, so a root `zoom` is what actually makes
 * the setting do something: it scales text, padding and controls together, which is
 * what "make the overlay bigger" means in practice.
 *
 * A plain function rather than a hook: the overlay reads its config from the store it
 * already subscribes to, and a hook called after the collapsed-state early return
 * would change the hook order when the user collapses the window.
 */
const BASE_FONT_SIZE = 14

function overlayZoom(fontSize: number): number {
  return fontSize / BASE_FONT_SIZE
}

/**
 * Style for the zoomed overlay box.
 *
 * `zoom` multiplies length values, so an `h-screen`/`w-screen` box would render
 * `zoom` times taller and wider than the window and cut the status bar off the
 * bottom. Dividing the dimensions by the zoom keeps the physical size exactly the
 * viewport while everything inside still scales.
 */
function overlayFrameStyle(fontSize: number): CSSProperties {
  const zoom = overlayZoom(fontSize)

  if (zoom === 1) {
    return { zoom: 1, width: '100vw', height: '100vh' }
  }

  return {
    zoom,
    width: `calc(100vw / ${zoom})`,
    height: `calc(100vh / ${zoom})`
  }
}

/** Padding around the bar, i.e. the frame div's `p-2`. Needed to size the window to it. */
const COLLAPSED_FRAME_PADDING = 8

/**
 * Width of the control group laid out in a row: three 28 DIP icon buttons and two 2 DIP gaps.
 *
 * The stacked layout frees this much width for the text, which is the reason to stack at all —
 * and the reason the wrap decision has to be made against the *row* width (see below) rather
 * than whatever the current layout happens to give the text.
 */
const COLLAPSED_CONTROLS_ROW_WIDTH = 88

function CollapsedBar() {
  const { t } = useTranslation()
  const store = useAppStore()
  const { translationState, bootstrap } = useAppState()
  const config = bootstrap.config.overlay
  const frameStyle = overlayFrameStyle(config.fontSize)
  const zoom = overlayZoom(config.fontSize)
  const barRef = useRef<HTMLDivElement | null>(null)
  const textRef = useRef<HTMLSpanElement | null>(null)
  const measureRef = useRef<HTMLSpanElement | null>(null)

  /** The last correction asked for, so the same one is not asked for twice. */
  const lastFit = useRef<{ actual: number; wanted: number } | null>(null)

  /** True once the preview needs more than the one line the bar starts as. */
  const [wrapped, setWrapped] = useState(false)

  const preview = translationState.translatedText ?? translationState.sourceText ?? t('overlay.emptyTitle')
  const hasContent = Boolean(translationState.sourceText || translationState.translatedText)

  /**
   * Resizes the window to the bar.
   *
   * The bar is one line for a short translation and taller for a long one, and the window has
   * to follow it — otherwise the text is clipped to whatever height the window happened to be
   * collapsed to. Rects are measured inside the zoomed frame, so the frame's padding is scaled
   * by the same factor.
   *
   * A resize reaches this process on a later tick than the request, so the correction is keyed
   * on (viewport, target) and re-checked a few times: asking twice for the same correction
   * stacked it (a StrictMode double invocation in development left a 137 DIP bar in a 197 DIP
   * window), while giving up after the first ask left the bar clipped whenever the viewport had
   * not settled yet.
   */
  useEffect(() => {
    let attempts = 0
    let timer: number | undefined

    const fit = () => {
      const bar = barRef.current
      const text = textRef.current
      const measure = measureRef.current
      if (!bar) {
        return
      }

      /**
       * Whether the controls have to stack.
       *
       * Measured against the width the text would have with the controls in a *row*, never the
       * width it currently has: stacking frees ~60 DIP, so a preview that wraps in the row
       * layout can fit on one line in the stacked one, and deciding from the current layout
       * would flip between the two forever (each flip changes the width, the height and the
       * window). `measure` is an invisible single-line copy of the preview for exactly this.
       */
      if (text && measure) {
        const group = bar.lastElementChild
        const stacking = group ? Math.max(COLLAPSED_CONTROLS_ROW_WIDTH * zoom - group.getBoundingClientRect().width, 0) : 0
        const rowWidth = text.getBoundingClientRect().width - stacking
        const nextWrapped = measure.getBoundingClientRect().width > rowWidth + 1

        setWrapped((current) => (current === nextWrapped ? current : nextWrapped))
      }

      const wanted = Math.round(bar.getBoundingClientRect().height + COLLAPSED_FRAME_PADDING * 2 * zoom)
      const actual = window.innerHeight

      if (Math.abs(wanted - actual) < 2) {
        lastFit.current = null
        return
      }

      const pending = lastFit.current
      if (!pending || pending.actual !== actual || pending.wanted !== wanted) {
        lastFit.current = { actual, wanted }
        void window.translateClip.resizeOverlayBy(wanted - actual)
      }

      if (attempts < 5) {
        attempts += 1
        timer = window.setTimeout(fit, 120)
      }
    }

    fit()

    return () => {
      if (timer) {
        window.clearTimeout(timer)
      }
    }
  }, [preview, zoom, translationState.phase, wrapped])

  return (
    <div className="p-2" style={frameStyle}>
      <div
        ref={barRef}
        data-collapsed-bar
        className="relative flex items-start gap-2 rounded-xl border border-border bg-surface px-3 py-2.5 backdrop-blur-2xl"
        style={dragRegion}
      >
        {/* Invisible single-line copy of the preview, used to decide whether the controls have to
            stack. It has to be measured outside the wrapping flow, or the answer would depend on
            the layout it is meant to choose. */}
        <span
          ref={measureRef}
          aria-hidden="true"
          className="pointer-events-none invisible absolute left-3 top-2.5 whitespace-nowrap text-[12px] leading-5"
        >
          {preview}
        </span>
        {/* `line-clamp-6` is the ceiling for a content-sized bar: past a handful of lines the
            expanded view is the better tool, and without one a long copy would turn the least
            intrusive form of the overlay into a wall of text. The literal class name is what
            Tailwind scans for, so it is not built from a constant. */}
        <span
          ref={textRef}
          className="line-clamp-6 min-w-0 flex-1 selectable text-[12px] leading-5 text-muted"
          title={preview}
        >
          {preview}
        </span>
        <span
          className={cn('flex shrink-0 gap-0.5', wrapped ? 'flex-col items-center' : 'items-center')}
          style={noDragRegion}
        >
          <WatchToggle variant="icon" />
          <Button
            variant="ghost"
            size="icon"
            data-clear-current
            title={t('overlay.actionClear')}
            aria-label={t('overlay.actionClear')}
            disabled={!hasContent}
            onClick={() => void window.translateClip.clearTranslation()}
          >
            <IconTrash />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            title={t('overlay.expand')}
            onClick={() => void store.updateConfig({ overlay: { ...store.config.overlay, collapsed: false } })}
          >
            <IconChevronDown />
          </Button>
        </span>
      </div>
    </div>
  )
}

export function OverlayShell() {
  const { t } = useTranslation()
  const store = useAppStore()
  const state = useAppState()
  const [tab, setTab] = useState<OverlayTab>('current')

  const { config, capabilities } = state.bootstrap
  const { translationState } = state
  const opaque = config.overlay.opaque
  const frameStyle = overlayFrameStyle(config.overlay.fontSize)

  if (config.overlay.collapsed) {
    return <CollapsedBar />
  }

  const warnings: string[] = []
  if (!capabilities.tray) {
    warnings.push(t('settings.about.trayMissingHint'))
  }
  if (config.overlay.clickThrough) {
    warnings.push(t('overlay.clickThroughHint'))
  }

  const canCopy = Boolean(translationState.translatedText)
  const canClear = Boolean(translationState.sourceText || translationState.translatedText)

  return (
    <div className="p-2" style={frameStyle}>
      <div
        data-overlay-card
        className={cn(
          'flex h-full flex-col overflow-hidden rounded-xl border border-border',
          opaque ? 'bg-surface-opaque' : 'bg-surface backdrop-blur-2xl'
        )}
        style={{ boxShadow: 'var(--shadow-float)' }}
      >
        <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2" style={dragRegion}>
          <span className="text-[12.5px] font-semibold tracking-wide text-text">{t('overlay.title')}</span>
          <WatchToggle />
          <span className="flex-1" />
          <div className="flex items-center gap-0.5" style={noDragRegion}>
            <Button
              variant="ghost"
              size="icon"
              title={t('overlay.collapse')}
              onClick={() => void store.updateConfig({ overlay: { ...config.overlay, collapsed: true } })}
            >
              <IconMinus />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              title={t('overlay.settings')}
              onClick={() => void window.translateClip.openSettings()}
            >
              <IconGear />
            </Button>
            <Button variant="ghost" size="icon" title={t('overlay.hide')} onClick={() => void window.translateClip.hideOverlay()}>
              <IconClose />
            </Button>
          </div>
        </header>

        {tab === 'current' ? <CurrentPanel /> : <HistoryPanel active />}

        <div className="flex shrink-0 items-center gap-1.5 border-t border-border px-3 py-2">
          <Button size="sm" onClick={() => void window.translateClip.translateClipboardNow()}>
            <IconRefresh />
            {t('overlay.actionTranslateNow')}
          </Button>
          <Button
            size="sm"
            disabled={!canCopy}
            onClick={() => translationState.translatedText && void window.translateClip.copyText(translationState.translatedText)}
          >
            <IconCopy />
            {t('overlay.actionCopy')}
          </Button>
          <Button
            size="icon"
            variant="ghost"
            data-clear-current
            disabled={!canClear}
            title={t('overlay.actionClear')}
            aria-label={t('overlay.actionClear')}
            onClick={() => void window.translateClip.clearTranslation()}
          >
            <IconTrash />
          </Button>
          <span className="flex-1" />
          <div className="flex items-center rounded-lg bg-surface-sunken p-0.5">
            {(['current', 'history'] as OverlayTab[]).map((value) => (
              <button
                key={value}
                type="button"
                data-tab={value}
                onClick={() => setTab(value)}
                className={cn(
                  'rounded-md px-2 py-1 text-[11.5px] transition-colors',
                  tab === value ? 'bg-surface-strong text-text shadow-sm' : 'text-muted hover:text-text'
                )}
              >
                {value === 'current' ? t('overlay.tabCurrent') : t('overlay.tabHistory')}
              </button>
            ))}
          </div>
        </div>

        {warnings.length > 0 ? (
          <p className="shrink-0 border-t border-border px-3 py-1.5 text-[11px] leading-relaxed text-warn">{warnings.join(' · ')}</p>
        ) : null}

        <StatusBar />
      </div>
    </div>
  )
}
