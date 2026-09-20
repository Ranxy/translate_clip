import { useTranslation } from 'react-i18next'

import type { TranslationState } from '@shared/types'

import { useAppState } from '../../store/appStore'
import { cn } from '../../utils/cn'
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

  const activityLabel = !clipboardActivity
    ? t('activity.idle')
    : clipboardActivity.accepted
      ? t('activity.accepted', { count: clipboardActivity.charCount })
      : t('activity.skipped', {
          reason: clipboardActivity.reason ? t(`activity.reasons.${clipboardActivity.reason}`) : ''
        })

  return (
    <footer className="flex items-center gap-2 border-t border-border px-3 py-1.5 text-[11px] text-muted">
      <span className="flex items-center gap-1.5">
        <span className={cn('h-1.5 w-1.5 rounded-full', PHASE_TONE[translationState.phase])} />
        {phaseLabel}
      </span>

      <span className="text-faint">·</span>

      <span className="truncate" title={activeProfile ? `${activeProfile.modelName}` : undefined}>
        {activeProfile ? `${activeProfile.providerId} / ${activeProfile.modelName}` : t('settings.providers.none')}
      </span>

      <span className="flex-1" />

      <span className="truncate" title={clipboardActivity?.preview ?? undefined}>
        {activityLabel}
      </span>

      <span className="text-faint">·</span>

      <WatchToggle variant="text" />
    </footer>
  )
}
