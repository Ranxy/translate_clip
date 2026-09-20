import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { APP_LIMITS, LANGUAGE_OPTIONS } from '@shared/constants'
import type { DirectionMode } from '@shared/types'

import { useAppState, useAppStore } from '../../store/appStore'
import { cn, dragRegion, noDragRegion } from '../../utils/cn'
import { ProvidersPage } from '../settings/ProvidersPage'
import { Button } from '../ui/Button'
import { Field } from '../ui/Field'
import { IconClose } from '../ui/Icon'
import { Select } from '../ui/Input'
import { NumberInput } from '../ui/NumberInput'
import { Switch } from '../ui/Switch'

const STEP_COUNT = 4

interface Draft {
  targetLanguage: string
  fallbackLanguage: string
  directionMode: DirectionMode
  watch: boolean
  skipSingleToken: boolean
  maxSourceChars: number
  launchAtLogin: boolean
  closeToTray: boolean
}

/**
 * First-run wizard.
 *
 * Step 1 owns the translation direction because nothing about this product makes
 * sense before that decision exists; everything after it is optional and can be
 * skipped. Each step is written to the config as the user moves forward, so a
 * crash or a closed window never loses completed steps.
 */
export function OnboardingShell() {
  const { t } = useTranslation()
  const store = useAppStore()
  const { config, diagnostics } = useAppState().bootstrap
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)

  const [draft, setDraft] = useState<Draft>(() => ({
    targetLanguage: config.targetLanguage,
    fallbackLanguage: config.fallbackLanguage,
    directionMode: config.directionMode,
    watch: config.clipboardWatchEnabled,
    skipSingleToken: config.skipSingleToken,
    maxSourceChars: config.maxSourceChars,
    launchAtLogin: config.launchAtLogin,
    closeToTray: config.closeToTray
  }))

  const languageOptions = LANGUAGE_OPTIONS.map((option) => ({
    value: option.value,
    label: `${option.nativeLabel} — ${option.label}`
  }))

  const label = (value: string): string => LANGUAGE_OPTIONS.find((option) => option.value === value)?.nativeLabel ?? value
  const directionIsValid = draft.targetLanguage !== draft.fallbackLanguage
  const stepTitles = [
    t('onboarding.directionTitle'),
    t('onboarding.providerTitle'),
    t('onboarding.clipboardTitle'),
    t('onboarding.integrationTitle')
  ]

  const persistStep = async (): Promise<void> => {
    if (step === 0) {
      await store.updateConfig({
        directionMode: draft.directionMode,
        targetLanguage: draft.targetLanguage,
        fallbackLanguage: draft.fallbackLanguage
      })
      return
    }

    if (step === 2) {
      await store.updateConfig({
        clipboardWatchEnabled: draft.watch,
        skipSingleToken: draft.skipSingleToken,
        maxSourceChars: draft.maxSourceChars
      })
      return
    }

    if (step === 3) {
      await store.updateConfig({ launchAtLogin: draft.launchAtLogin, closeToTray: draft.closeToTray })
    }
  }

  const next = async () => {
    setBusy(true)

    try {
      await persistStep()
      setStep((current) => Math.min(current + 1, STEP_COUNT - 1))
    } finally {
      setBusy(false)
    }
  }

  const finish = async (action: 'complete' | 'skip') => {
    setBusy(true)

    try {
      if (action === 'complete') {
        await persistStep()
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
      <header className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-2.5" style={dragRegion}>
        <span className="text-[13px] font-semibold tracking-wide">{t('app.name')}</span>
        <span className="text-[11.5px] text-faint">{t('onboarding.stepLabel', { current: step + 1, total: STEP_COUNT })}</span>
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

      <nav className="flex shrink-0 gap-1 px-4 pt-3">
        {stepTitles.map((title, index) => (
          <button
            key={title}
            type="button"
            data-step={index}
            disabled={index > step}
            onClick={() => setStep(index)}
            className={cn(
              'flex-1 rounded-lg border px-2 py-1.5 text-left text-[11.5px] transition-colors disabled:opacity-50',
              index === step ? 'border-accent bg-accent-soft text-accent' : 'border-border bg-surface-sunken text-muted'
            )}
          >
            <span className="mr-1 font-mono text-[10px] opacity-70">{index + 1}</span>
            {title}
          </button>
        ))}
      </nav>

      <main className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {step === 0 ? (
          <div className="flex flex-col gap-1">
            <h1 className="text-[15px] font-semibold">{t('onboarding.title')}</h1>
            <p className="mb-2 text-[12.5px] leading-relaxed text-muted">{t('onboarding.directionBody')}</p>

            <Field label={t('onboarding.target')}>
              <Select
                className="w-60"
                value={draft.targetLanguage}
                onValueChange={(value) => setDraft((current) => ({ ...current, targetLanguage: value }))}
                options={languageOptions}
              />
            </Field>

            <Field label={t('onboarding.fallback')}>
              <Select
                className="w-60"
                value={draft.fallbackLanguage}
                onValueChange={(value) => setDraft((current) => ({ ...current, fallbackLanguage: value }))}
                options={languageOptions}
              />
            </Field>

            {!directionIsValid ? <p className="text-[12px] text-danger">{t('onboarding.directionConflict')}</p> : null}

            <Field label={t('onboarding.mode')} hint={draft.directionMode === 'auto' ? t('onboarding.modeHintAuto') : t('onboarding.modeHintFixed')}>
              <Select
                className="w-60"
                value={draft.directionMode}
                onValueChange={(value) => setDraft((current) => ({ ...current, directionMode: value as DirectionMode }))}
                options={[
                  { value: 'auto', label: t('onboarding.modeAuto') },
                  { value: 'fixed', label: t('onboarding.modeFixed') }
                ]}
              />
            </Field>

            <section className="mt-2 rounded-xl border border-border bg-surface-sunken p-3">
              <h2 className="mb-1.5 text-[11px] uppercase tracking-wide text-faint">{t('onboarding.previewTitle')}</h2>
              <p className="font-mono text-[12px] text-text">
                {t('onboarding.previewToTarget', { target: label(draft.targetLanguage) })}
              </p>
              {draft.directionMode === 'auto' ? (
                <p className="mt-1 font-mono text-[12px] text-muted">
                  {t('onboarding.previewReversed', {
                    target: label(draft.targetLanguage),
                    fallback: label(draft.fallbackLanguage)
                  })}
                </p>
              ) : null}
            </section>
          </div>
        ) : null}

        {step === 1 ? (
          <div className="flex flex-col gap-3">
            <div>
              <h1 className="text-[15px] font-semibold">{t('onboarding.providerTitle')}</h1>
              <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{t('onboarding.providerBody')}</p>
            </div>
            <ProvidersPage />
          </div>
        ) : null}

        {step === 2 ? (
          <div className="flex flex-col gap-1">
            <h1 className="text-[15px] font-semibold">{t('onboarding.clipboardTitle')}</h1>
            <p className="mb-2 text-[12.5px] leading-relaxed text-muted">{t('onboarding.clipboardBody')}</p>

            <Field label={t('onboarding.clipboardWatch')}>
              <Switch
                label={t('onboarding.clipboardWatch')}
                checked={draft.watch}
                onChange={(checked) => setDraft((current) => ({ ...current, watch: checked }))}
              />
            </Field>

            <Field label={t('onboarding.clipboardSkipToken')}>
              <Switch
                label={t('onboarding.clipboardSkipToken')}
                checked={draft.skipSingleToken}
                onChange={(checked) => setDraft((current) => ({ ...current, skipSingleToken: checked }))}
              />
            </Field>

            <Field label={t('onboarding.clipboardMaxChars')}>
              <NumberInput
                value={draft.maxSourceChars}
                min={APP_LIMITS.maxSourceChars.min}
                max={APP_LIMITS.maxSourceChars.max}
                step={APP_LIMITS.maxSourceChars.step}
                onCommit={(value) => setDraft((current) => ({ ...current, maxSourceChars: value }))}
              />
            </Field>

            <p className="mt-2 rounded-xl border border-border bg-surface-sunken p-3 text-[12px] leading-relaxed text-warn">
              {t('onboarding.privacyNote')}
            </p>
          </div>
        ) : null}

        {step === 3 ? (
          <div className="flex flex-col gap-1">
            <h1 className="text-[15px] font-semibold">{t('onboarding.integrationTitle')}</h1>
            <p className="mb-2 text-[12.5px] leading-relaxed text-muted">{t('onboarding.integrationBody')}</p>

            <Field label={t('settings.general.launchAtLogin')} hint={t('settings.general.launchAtLoginHint')}>
              <Switch
                label={t('settings.general.launchAtLogin')}
                checked={draft.launchAtLogin}
                onChange={(checked) => setDraft((current) => ({ ...current, launchAtLogin: checked }))}
              />
            </Field>

            <Field label={t('settings.general.closeToTray')} hint={t('settings.general.closeToTrayHint')}>
              <Switch
                label={t('settings.general.closeToTray')}
                checked={draft.closeToTray}
                disabled={!diagnostics.capabilities.tray}
                onChange={(checked) => setDraft((current) => ({ ...current, closeToTray: checked }))}
              />
            </Field>

            <p className="mt-2 rounded-xl border border-border bg-surface-sunken p-3 text-[12px] leading-relaxed text-muted">
              {t('onboarding.shortcutsNote')}
            </p>
            <p className="text-[12px] leading-relaxed text-muted">{t('onboarding.readyNote')}</p>
          </div>
        ) : null}
      </main>

      <footer className="flex shrink-0 items-center gap-2 border-t border-border px-4 py-3">
        <Button
          size="sm"
          variant="ghost"
          data-action="back"
          disabled={step === 0 || busy}
          onClick={() => setStep((current) => Math.max(current - 1, 0))}
        >
          {t('onboarding.back')}
        </Button>
        {step === 1 ? <span className="text-[11.5px] text-faint">{t('onboarding.providerSkipHint')}</span> : null}
        <span className="flex-1" />
        <Button size="sm" data-action="skip" disabled={busy} onClick={() => void finish('skip')}>
          {t('onboarding.skip')}
        </Button>
        {step < STEP_COUNT - 1 ? (
          <Button
            variant="primary"
            size="sm"
            data-action="next"
            disabled={busy || !directionIsValid}
            onClick={() => void next()}
          >
            {t('onboarding.next')}
          </Button>
        ) : (
          <Button variant="primary" size="sm" data-action="finish" disabled={busy} onClick={() => void finish('complete')}>
            {t('onboarding.finish')}
          </Button>
        )}
      </footer>
    </div>
  )
}
