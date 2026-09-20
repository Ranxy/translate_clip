import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAppState } from '../../store/appStore'
import { dragRegion, noDragRegion } from '../../utils/cn'
import { Button } from '../ui/Button'
import { IconClose } from '../ui/Icon'

/**
 * First-run wizard shell.
 *
 * Phase 1 replaces the body with the four steps (direction → provider →
 * clipboard/privacy → system integration). The window chrome, the drag region and
 * the completion semantics are already the final ones, so only the content grows.
 */
export function OnboardingShell() {
  const { t } = useTranslation()
  const { diagnostics } = useAppState().bootstrap
  const [busy, setBusy] = useState(false)

  const finish = async (action: 'complete' | 'skip') => {
    setBusy(true)
    try {
      if (action === 'complete') {
        await window.translateClip.completeOnboarding()
      } else {
        await window.translateClip.skipOnboarding()
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-screen w-screen flex-col border border-border bg-surface-opaque text-text">
      <header className="flex items-center gap-2 border-b border-border px-4 py-2.5" style={dragRegion}>
        <span className="text-[13px] font-semibold tracking-wide">{t('app.name')}</span>
        <span className="flex-1" />
        <Button
          variant="ghost"
          size="icon"
          style={noDragRegion}
          title={t('onboarding.skip')}
          disabled={busy}
          onClick={() => void finish('skip')}
        >
          <IconClose />
        </Button>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center gap-3 px-10 text-center">
        <h1 className="text-[18px] font-semibold">{t('onboarding.title')}</h1>
        <p className="max-w-md text-[13px] leading-relaxed text-muted">{t('onboarding.planned')}</p>
        <p className="selectable text-[11px] text-faint">{`${diagnostics.platform} · Electron ${diagnostics.electronVersion}`}</p>
      </main>

      <footer className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
        <Button size="sm" disabled={busy} onClick={() => void finish('skip')}>
          {t('onboarding.skip')}
        </Button>
        <Button variant="primary" size="sm" disabled={busy} onClick={() => void finish('complete')}>
          {t('onboarding.finish')}
        </Button>
      </footer>
    </div>
  )
}
