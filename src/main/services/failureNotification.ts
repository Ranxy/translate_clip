import type { TranslationState } from '@shared/types'

import type { Translator } from '../i18n'

export interface FailureNotificationPayload {
  title: string
  body: string
}

export interface FailureNotificationInput {
  phase: TranslationState['phase']
  error: TranslationState['error']
  modelName: string | null
  enabled: boolean
  translate: Translator
  /** When the same error code was last notified, if ever. */
  lastNotifiedAt: number | null
  now: number
}

/**
 * One notification per error code per window.
 *
 * With a rejected API key every copy fails, and a toast per copy would be worse
 * than useless — the user already knows after the first one.
 */
export const FAILURE_NOTIFICATION_QUIET_MS = 60_000

/**
 * Decides whether a failure is worth a system notification, and what it says.
 *
 * Deliberately free of Electron imports: the decision (only real failures, only when
 * the user asked for notifications) is the part that can be wrong, and keeping it
 * pure means it can be tested without an OS notification service.
 */
export function buildFailureNotification(input: FailureNotificationInput): FailureNotificationPayload | null {
  if (!input.enabled || input.phase !== 'error' || !input.error) {
    return null
  }

  if (input.lastNotifiedAt !== null && input.now - input.lastNotifiedAt < FAILURE_NOTIFICATION_QUIET_MS) {
    return null
  }

  const key = `settings.providers.errors.${input.error.code}`
  const localized = input.translate(key)

  // The translator returns the key itself when it has no entry, in which case the
  // provider's own message is more useful than a made-up key string.
  const reason = localized === key ? input.error.message : localized

  return {
    title: input.translate('notification.translationFailed'),
    body: input.modelName ? `${reason} · ${input.modelName}` : reason
  }
}
