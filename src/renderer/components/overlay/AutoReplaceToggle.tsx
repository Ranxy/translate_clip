import { useTranslation } from 'react-i18next'

import { useAppState, useAppStore } from '../../store/appStore'
import { cn } from '../../utils/cn'
import { IconClipboardIn } from '../ui/Icon'

/**
 * Puts every finished translation on the clipboard, replacing what was copied.
 *
 * Opt-in and off by default: it takes the clipboard away from the user, which is fine as a
 * deliberate choice and rude as a surprise. Sits next to the pause control in the status bar so
 * both "watchers" of the clipboard live together, and only in the expanded layout — the collapsed
 * bar has room for the three controls it already has, and this one is a set-and-forget setting
 * rather than something to reach for while the overlay is a bar.
 */
export function AutoReplaceToggle() {
  const { t } = useTranslation()
  const store = useAppStore()
  const { bootstrap } = useAppState()

  const enabled = bootstrap.config.autoReplaceClipboard
  const label = enabled ? t('overlay.autoReplaceDisable') : t('overlay.autoReplaceEnable')

  return (
    <button
      type="button"
      data-auto-replace
      aria-pressed={enabled}
      title={label}
      aria-label={label}
      onClick={() => void store.updateConfig({ autoReplaceClipboard: !enabled })}
      className={cn(
        'flex h-5 w-5 shrink-0 items-center justify-center rounded transition-colors',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
        enabled ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-surface-hover hover:text-text'
      )}
    >
      <IconClipboardIn />
    </button>
  )
}
