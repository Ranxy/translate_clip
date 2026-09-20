import { useTranslation } from 'react-i18next'

import type { TranslationState } from '@shared/types'

import { useAppState } from '../../store/appStore'
import { cn } from '../../utils/cn'
import { AutoReplaceToggle } from './AutoReplaceToggle'
import { WatchToggle } from './WatchToggle'

const PHASE_TONE: Record<TranslationState['phase'], string> = {
  idle: 'bg-faint',
  translating: 'animate-pulse bg-accent',
  done: 'bg-ok',
  error: 'bg-danger',
  skipped: 'bg-warn',
  canceled: 'bg-faint',
  unconfigured: 'bg-warn'
}

export function StatusBar() {
  const { t } = useTranslation()
  const state = useAppState()

  const { translationState, clipboardActivity } = state
  const activeProfile = state.llmProviderState.profiles.find((profile) => profile.profileId === state.llmProviderState.activeProfileId)

  const phaseLabel = t(`overlay.phase.${translationState.phase}`, { defaultValue: translationState.phase })

  /**
   * Why the last copy was *not* translated, or nothing.
   *
   * A successful capture used to report its character count here, which said nothing the phase
   * and the translation above do not already say. The skip reasons do carry information — a
   * silently skipped copy is otherwise indistinguishable from a broken one — so those stay.
   */
  const skipLabel =
    clipboardActivity && !clipboardActivity.accepted
      ? t('activity.skipped', {
          reason: clipboardActivity.reason ? t(`activity.reasons.${clipboardActivity.reason}`) : ''
        })
      : null

  return (
    <footer className="flex items-center gap-2 border-t border-border px-3 py-1.5 text-[11px] text-muted">
      {/* The status word must not wrap: with a skip reason and both toggles on screen this row is
          at its width, and a wrapped word grew the whole bar to two lines. Everything flexible
          here truncates instead. */}
      <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
        <span className={cn('h-1.5 w-1.5 rounded-full', PHASE_TONE[translationState.phase])} />
        {phaseLabel}
      </span>

      <span className="shrink-0 text-faint">·</span>

      <span className="truncate" title={activeProfile ? `${activeProfile.modelName}` : undefined}>
        {activeProfile ? `${activeProfile.providerId} / ${activeProfile.modelName}` : t('settings.providers.none')}
      </span>

      <span className="flex-1" />

      {skipLabel ? (
        <>
          <span className="truncate" title={clipboardActivity?.preview ?? undefined}>
            {skipLabel}
          </span>

          <span className="shrink-0 text-faint">·</span>
        </>
      ) : null}

      <AutoReplaceToggle />

      <WatchToggle variant="text" />
    </footer>
  )
}
