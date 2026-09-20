import { useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'

import { useAppState, useAppStore } from '../../store/appStore'
import { cn, dragRegion, noDragRegion } from '../../utils/cn'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { IconChevronDown, IconClose, IconCopy, IconGear, IconMinus, IconRefresh } from '../ui/Icon'
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

function CollapsedBar() {
  const { t } = useTranslation()
  const store = useAppStore()
  const { translationState, bootstrap } = useAppState()
  const frameStyle = overlayFrameStyle(bootstrap.config.overlay.fontSize)

  const preview = translationState.translatedText ?? translationState.sourceText ?? t('overlay.emptyTitle')

  return (
    <div className="p-2" style={frameStyle}>
      <div
        className="flex h-full items-center gap-2 rounded-xl border border-border bg-surface px-3 backdrop-blur-2xl"
        style={dragRegion}
      >
        <span className="shrink-0 text-[12px] font-semibold tracking-wide text-text">{t('overlay.title')}</span>
        {/* One line only, so the rest of the text is worth having on hover rather than
            forcing an expand just to read what was copied. */}
        <span className="min-w-0 flex-1 truncate selectable text-[12px] text-muted" title={preview}>
          {preview}
        </span>
        <span style={noDragRegion}>
          <WatchToggle variant="icon" />
        </span>
        <Button
          variant="ghost"
          size="icon"
          style={noDragRegion}
          title={t('overlay.expand')}
          onClick={() => void store.updateConfig({ overlay: { ...store.config.overlay, collapsed: false } })}
        >
          <IconChevronDown />
        </Button>
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
