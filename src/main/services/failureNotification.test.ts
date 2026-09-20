import { describe, expect, it } from 'vitest'

import { LOCALE_RESOURCES } from '@shared/locales'
import type { LlmError, LlmErrorCode } from '@shared/types'

import { createTranslator } from '../i18n'
import {
  buildFailureNotification,
  FAILURE_NOTIFICATION_QUIET_MS,
  type FailureNotificationInput
} from './failureNotification'

const translate = createTranslator('en')
const errors = LOCALE_RESOURCES.en.settings.providers.errors

function input(patch: Partial<FailureNotificationInput> = {}): FailureNotificationInput {
  return {
    phase: 'error',
    error: { code: 'auth', message: 'The provider rejected the API key (401)', status: 401, retryable: false },
    modelName: 'deepseek-chat',
    enabled: true,
    translate,
    lastNotifiedAt: null,
    now: 1_000_000,
    ...patch
  }
}

describe('buildFailureNotification', () => {
  it('localises the error code and appends the model', () => {
    expect(buildFailureNotification(input())).toEqual({
      title: LOCALE_RESOURCES.en.notification.translationFailed,
      body: `${errors.auth} · deepseek-chat`
    })
  })

  it('omits the model when there is none', () => {
    expect(buildFailureNotification(input({ modelName: null }))?.body).toBe(errors.auth)
  })

  it('does not repeat the same error within the quiet window', () => {
    const now = 1_000_000

    expect(buildFailureNotification(input({ lastNotifiedAt: now - 10_000, now }))).toBeNull()
    expect(buildFailureNotification(input({ lastNotifiedAt: now - FAILURE_NOTIFICATION_QUIET_MS - 1, now }))).not.toBeNull()
    expect(buildFailureNotification(input({ lastNotifiedAt: null, now }))).not.toBeNull()
  })

  it('falls back to the provider message for a code the locale does not know', () => {
    const error: LlmError = {
      code: 'brand-new-code' as LlmErrorCode,
      message: 'raw provider text',
      status: null,
      retryable: false
    }

    expect(buildFailureNotification(input({ error, modelName: null }))?.body).toBe('raw provider text')
  })

  it('stays silent unless the user enabled notifications', () => {
    expect(buildFailureNotification(input({ enabled: false }))).toBeNull()
  })

  it('only reacts to failures', () => {
    expect(buildFailureNotification(input({ phase: 'done' }))).toBeNull()
    expect(buildFailureNotification(input({ phase: 'translating' }))).toBeNull()
    expect(buildFailureNotification(input({ phase: 'canceled' }))).toBeNull()
    expect(buildFailureNotification(input({ error: null }))).toBeNull()
  })
})
