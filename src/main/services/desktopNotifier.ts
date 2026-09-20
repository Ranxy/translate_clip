import { Notification } from 'electron'

import type { AppConfig, TranslationState } from '@shared/types'

import type { Translator } from '../i18n'
import { buildFailureNotification } from './failureNotification'

/**
 * Shows the failure notification.
 *
 * A failed translation is normally visible in the overlay — but not when the overlay
 * is hidden, or when it sits behind an exclusive-fullscreen window. That is exactly
 * the situation where the user needs to be told that nothing is going to appear.
 */
export function notifyTranslationFailure(
  state: TranslationState,
  config: AppConfig,
  translate: Translator,
  lastNotifiedAt: number | null,
  onActivate: () => void
): boolean {
  const payload = buildFailureNotification({
    phase: state.phase,
    error: state.error,
    modelName: state.modelName,
    enabled: config.notificationsEnabled,
    translate,
    lastNotifiedAt,
    now: Date.now()
  })

  if (!payload || !Notification.isSupported()) {
    return false
  }

  try {
    const notification = new Notification({ title: payload.title, body: payload.body })
    notification.on('click', onActivate)
    notification.show()
    return true
  } catch {
    // A notification that cannot be shown must never affect the translation itself.
    return false
  }
}
