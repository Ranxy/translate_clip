import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { ShortcutAction } from '@shared/types'

import { useAppState } from '../../store/appStore'
import { cn } from '../../utils/cn'
import { Button } from '../ui/Button'
import { Card, CardHeader } from '../ui/Card'
import { IconClose } from '../ui/Icon'

const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'CapsLock'])

const NAMED_KEYS: Record<string, string> = {
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Enter: 'Return',
  Escape: 'Escape',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Tab: 'Tab',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  Insert: 'Insert'
}

function normalizeKey(key: string): string | null {
  if (key === ' ') {
    return 'Space'
  }

  if (NAMED_KEYS[key]) {
    return NAMED_KEYS[key]
  }

  if (/^F\d{1,2}$/u.test(key)) {
    return key
  }

  return key.length === 1 ? key.toUpperCase() : null
}

/**
 * Converts a keydown event into an Electron accelerator.
 *
 * Returns null for modifier-only presses and for keys we cannot express, so the
 * recorder simply keeps waiting instead of storing something that will never
 * register.
 */
export function toAccelerator(event: {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
}): string | null {
  if (MODIFIER_KEYS.has(event.key)) {
    return null
  }

  const modifiers: string[] = []

  if (event.ctrlKey) modifiers.push('Control')
  if (event.metaKey) modifiers.push('Command')
  if (event.altKey) modifiers.push('Alt')
  if (event.shiftKey) modifiers.push('Shift')

  // A bare key would swallow normal typing system-wide.
  if (modifiers.length === 0) {
    return null
  }

  const key = normalizeKey(event.key)

  return key ? [...modifiers, key].join('+') : null
}

function ShortcutRow({ action, label }: { action: ShortcutAction; label: string }) {
  const { t } = useTranslation()
  const appState = useAppState()
  const { config } = appState.bootstrap
  const [recording, setRecording] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const accelerator = config.shortcuts[action]

  /**
   * The live registration state, not `bootstrap.shortcutState`.
   *
   * That one is the snapshot from whenever this window loaded its payload, while the state itself
   * is maintained by the `shortcut:state` broadcast. Reading the snapshot meant the first recording
   * of a session displayed the *previous* outcome — "registration failed" for a shortcut that had
   * just registered, corrected only by reopening the window, which fetched a fresh payload.
   */
  const state = appState.shortcutState[action]

  const apply = async (next: string | null) => {
    const result = await window.translateClip.setShortcut(action, next)
    setError(result.ok ? null : result.error)
    setRecording(false)
  }

  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-text">{label}</p>
        <p className="mt-0.5 text-[11.5px] text-muted">
          {error || state.error ? (
            <span className="text-danger">{t('settings.shortcuts.failed')}</span>
          ) : accelerator ? (
            state.registered ? (
              <span className="text-ok">{t('settings.shortcuts.registered')}</span>
            ) : (
              <span className="text-warn">{t('settings.shortcuts.failed')}</span>
            )
          ) : (
            t('settings.shortcuts.notSet')
          )}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          data-shortcut-recorder={action}
          onKeyDown={(event) => {
            if (!recording) {
              return
            }

            event.preventDefault()

            if (event.key === 'Escape') {
              setRecording(false)
              return
            }

            const next = toAccelerator(event)

            if (next) {
              void apply(next)
            }
          }}
          onClick={() => {
            setRecording(true)
            setError(null)
          }}
          onBlur={() => setRecording(false)}
          className={cn(
            'min-w-44 rounded-lg border px-2.5 py-1.5 text-center font-mono text-[12px] transition-colors',
            recording ? 'border-accent bg-accent-soft text-accent' : 'border-border bg-surface-sunken text-text hover:bg-surface-hover'
          )}
        >
          {recording ? t('settings.shortcuts.recording') : (accelerator ?? t('settings.shortcuts.record'))}
        </button>

        <Button variant="ghost" size="icon" disabled={!accelerator} title={t('settings.shortcuts.clear')} onClick={() => void apply(null)}>
          <IconClose />
        </Button>
      </div>
    </div>
  )
}

export function ShortcutsPage() {
  const { t } = useTranslation()
  const { capabilities } = useAppState().bootstrap

  return (
    <Card>
      <CardHeader title={t('settings.tabs.shortcuts')} description={t('settings.shortcuts.description')} />

      <ShortcutRow action="toggleOverlay" label={t('settings.shortcuts.toggleOverlayLabel')} />
      <div className="border-t border-border" />
      <ShortcutRow action="translateClipboard" label={t('settings.shortcuts.translateClipboardLabel')} />

      <p className="mt-3 text-[11.5px] leading-relaxed text-faint">{t('settings.shortcuts.hint')}</p>
      {capabilities.globalShortcut === 'limited' ? (
        <p className="mt-2 text-[11.5px] leading-relaxed text-warn">{t('settings.about.shortcutLimitedHint')}</p>
      ) : null}
    </Card>
  )
}
