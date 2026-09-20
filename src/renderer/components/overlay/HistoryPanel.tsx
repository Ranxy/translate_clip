import { useTranslation } from 'react-i18next'

import { useAppState } from '../../store/appStore'
import { cn } from '../../utils/cn'

export function HistoryPanel({ active }: { active: boolean }) {
  const { t } = useTranslation()
  const { recentHistory } = useAppState()

  if (!active) {
    return null
  }

  if (recentHistory.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="text-[13px] text-muted">{t('overlay.historyEmpty')}</p>
        <p className="text-[12px] text-faint">{t('common.planned')}</p>
      </div>
    )
  }

  return (
    <ul className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-3 py-2">
      {recentHistory.map((entry) => (
        <li
          key={entry.id}
          className={cn('rounded-lg border border-border bg-surface-sunken px-2.5 py-2 text-[12px] transition-colors hover:bg-surface-hover')}
        >
          <p className="line-clamp-2 selectable text-muted">{entry.sourceText}</p>
          <p className="mt-1 line-clamp-2 selectable text-text">{entry.translatedText}</p>
        </li>
      ))}
    </ul>
  )
}
