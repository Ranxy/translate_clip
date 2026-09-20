import { useTranslation } from 'react-i18next'

import { useAppState, useAppStore } from '../../store/appStore'
import { cn } from '../../utils/cn'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { IconPause, IconPlay } from '../ui/Icon'

type WatchToggleVariant = 'chip' | 'text' | 'icon'

/**
 * Pauses and resumes clipboard watching.
 *
 * The overlay always showed the listening state, but none of it said it could be clicked:
 * the header carried a plain badge and the status bar's entry was unadorned 11px text, so
 * pausing read as a tray-only feature. Every placement now names the action in a tooltip and
 * reports the toggle through `aria-pressed`, and the two icon forms carry a pause/play glyph.
 *
 * Three shapes, one behaviour, because the overlay has two layouts and the state is on screen
 * in three places:
 *  - `chip` — the header badge. This is the state indicator, so it keeps the state word and
 *    gains the control's affordances;
 *  - `text` — the status bar. A button has to say what it *does*, and the header directly
 *    above already reports the state, so this one reads "暂停"/"恢复" and nothing here repeats
 *    "监听中"/"已暂停". It is also kept to roughly the width the old status word occupied: a
 *    labelled button with an icon in this row wrapped the whole footer at the default 380px;
 *  - `icon` — the collapsed bar, which had no pause entry at all, so collapsing left the tray
 *    as the only way to stop listening.
 */
export function WatchToggle({ variant = 'chip' }: { variant?: WatchToggleVariant }) {
  const { t } = useTranslation()
  const store = useAppStore()
  const { clipboardStatus } = useAppState()

  const watching = clipboardStatus.watching
  const state = watching ? t('overlay.listening') : t('overlay.paused')
  const action = watching ? t('overlay.pauseWatching') : t('overlay.resumeWatching')
  const toggle = () => void store.setClipboardWatch(!watching)
  const glyph = watching ? <IconPause /> : <IconPlay />

  if (variant === 'chip') {
    return (
      <button
        type="button"
        data-watch-toggle
        aria-pressed={!watching}
        title={action}
        aria-label={action}
        onClick={toggle}
        className="rounded-md transition-opacity hover:opacity-75 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
      >
        <Badge tone={watching ? 'ok' : 'neutral'}>
          {glyph}
          {state}
        </Badge>
      </button>
    )
  }

  if (variant === 'icon') {
    return (
      <Button
        size="icon"
        variant="ghost"
        data-watch-toggle
        aria-pressed={!watching}
        title={action}
        aria-label={action}
        onClick={toggle}
      >
        {glyph}
      </Button>
    )
  }

  return (
    <button
      type="button"
      data-watch-toggle
      aria-pressed={!watching}
      title={action}
      aria-label={action}
      onClick={toggle}
      className={cn(
        'rounded px-1 transition-colors hover:bg-surface-hover hover:text-text',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
        watching ? undefined : 'text-accent'
      )}
    >
      {watching ? t('overlay.pauseAction') : t('overlay.resumeAction')}
    </button>
  )
}
