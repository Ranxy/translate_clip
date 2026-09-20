import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { useAppState, type AppStore } from '../../store/appStore'
import { Button } from './Button'

/**
 * Surfaces failures that would otherwise be invisible.
 *
 * Most renderer calls into the main process are fire-and-forget (`void someCall()`),
 * so a rejected IPC — a database that cannot be written, a profile that no longer
 * exists, a bug in a handler — produced an unhandled rejection and nothing else. That
 * is exactly the silent-failure shape this project keeps tripping over, so the whole
 * class is now reported in one place.
 */
export function ErrorToastHost({ store }: { store: AppStore }) {
  const { error } = useAppState()

  useEffect(() => {
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      // Keep the console entry out of the way; the message is shown instead.
      event.preventDefault()
      const reason: unknown = event.reason
      store.reportError(reason instanceof Error ? reason.message : String(reason))
    }

    window.addEventListener('unhandledrejection', onUnhandledRejection)

    return () => {
      window.removeEventListener('unhandledrejection', onUnhandledRejection)
    }
  }, [store])

  useEffect(() => {
    if (!error) {
      return
    }

    const timer = setTimeout(() => store.dismissError(), 8_000)
    return () => clearTimeout(timer)
  }, [error, store])

  if (!error) {
    return null
  }

  return <ErrorToast message={error} onDismiss={() => store.dismissError()} />
}

function ErrorToast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  const { t } = useTranslation()

  return (
    <div
      role="alert"
      data-error-toast
      className="fixed bottom-3 left-1/2 z-50 flex w-[min(92%,520px)] -translate-x-1/2 items-start gap-3 rounded-xl border border-border bg-surface-strong px-3 py-2.5"
      style={{ boxShadow: 'var(--shadow-float)' }}
    >
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-medium text-danger">{t('common.errorTitle')}</p>
        <p className="mt-0.5 selectable break-words text-[12px] leading-relaxed text-text">{message}</p>
      </div>
      <Button size="sm" variant="ghost" onClick={onDismiss}>
        {t('common.dismiss')}
      </Button>
    </div>
  )
}
