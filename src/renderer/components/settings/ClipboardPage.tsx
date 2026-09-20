import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { APP_LIMITS, SUGGESTED_IGNORE_PATTERNS } from '@shared/constants'

import { useAppState, useAppStore } from '../../store/appStore'
import { Button } from '../ui/Button'
import { Card, CardHeader, Divider } from '../ui/Card'
import { Field } from '../ui/Field'
import { IconClose } from '../ui/Icon'
import { TextInput } from '../ui/Input'
import { NumberInput } from '../ui/NumberInput'
import { Switch } from '../ui/Switch'

function isValidPattern(pattern: string): boolean {
  try {
    new RegExp(pattern)
    return true
  } catch {
    return false
  }
}

export function ClipboardPage() {
  const { t } = useTranslation()
  const store = useAppStore()
  const { config } = useAppState().bootstrap
  const [draftPattern, setDraftPattern] = useState('')
  const [simulatedText, setSimulatedText] = useState('')
  const [developerMode, setDeveloperMode] = useState(false)

  useEffect(() => {
    let cancelled = false

    void window.translateClip.debugIsEnabled().then((enabled) => {
      if (!cancelled) {
        setDeveloperMode(enabled)
      }
    })

    return () => {
      cancelled = true
    }
  }, [])

  const draftValid = draftPattern.trim().length === 0 || isValidPattern(draftPattern.trim())

  const addPattern = (pattern: string) => {
    const trimmed = pattern.trim()
    if (trimmed.length === 0 || !isValidPattern(trimmed) || config.ignorePatterns.includes(trimmed)) {
      return
    }

    void store.updateConfig({ ignorePatterns: [...config.ignorePatterns, trimmed] })
    setDraftPattern('')
  }

  const removePattern = (pattern: string) => {
    void store.updateConfig({ ignorePatterns: config.ignorePatterns.filter((entry) => entry !== pattern) })
  }

  return (
    <>
      <Card>
        <CardHeader title={t('settings.clipboard.watch')} description={t('settings.clipboard.watchHint')} />
        <Switch
          label={t('settings.clipboard.watch')}
          checked={config.clipboardWatchEnabled}
          onChange={(checked) => void store.setClipboardWatch(checked)}
        />
      </Card>

      <Card>
        <Field label={t('settings.clipboard.pollInterval')} hint={t('settings.clipboard.pollIntervalHint')}>
          <NumberInput
            value={config.pollIntervalMs}
            min={APP_LIMITS.pollIntervalMs.min}
            max={APP_LIMITS.pollIntervalMs.max}
            step={APP_LIMITS.pollIntervalMs.step}
            onCommit={(value) => void store.updateConfig({ pollIntervalMs: value })}
          />
        </Field>

        <Divider />

        <Field label={t('settings.clipboard.minChars')} hint={t('settings.clipboard.minCharsHint')}>
          <NumberInput
            value={config.minSourceChars}
            min={APP_LIMITS.minSourceChars.min}
            max={APP_LIMITS.minSourceChars.max}
            onCommit={(value) => void store.updateConfig({ minSourceChars: value })}
          />
        </Field>

        <Field label={t('settings.clipboard.maxChars')} hint={t('settings.clipboard.maxCharsHint')}>
          <NumberInput
            value={config.maxSourceChars}
            min={APP_LIMITS.maxSourceChars.min}
            max={APP_LIMITS.maxSourceChars.max}
            step={APP_LIMITS.maxSourceChars.step}
            onCommit={(value) => void store.updateConfig({ maxSourceChars: value })}
          />
        </Field>

        <Divider />

        <Field label={t('settings.clipboard.skipSingleToken')} hint={t('settings.clipboard.skipSingleTokenHint')}>
          <Switch
            label={t('settings.clipboard.skipSingleToken')}
            checked={config.skipSingleToken}
            onChange={(checked) => void store.updateConfig({ skipSingleToken: checked })}
          />
        </Field>
      </Card>

      <Card>
        <CardHeader title={t('settings.clipboard.ignorePatterns')} description={t('settings.clipboard.ignorePatternsHint')} />

        {config.ignorePatterns.length > 0 ? (
          <ul className="mb-3 flex flex-col gap-1.5">
            {config.ignorePatterns.map((pattern) => (
              <li
                key={pattern}
                className="flex items-center gap-2 rounded-lg border border-border bg-surface-sunken px-2.5 py-1.5"
              >
                <code className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-text">{pattern}</code>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t('common.close')}
                  onClick={() => removePattern(pattern)}
                >
                  <IconClose />
                </Button>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="flex items-center gap-2">
          <TextInput
            className={draftValid ? undefined : 'border-danger'}
            placeholder={t('settings.clipboard.addPattern')}
            value={draftPattern}
            spellCheck={false}
            onChange={(event) => setDraftPattern(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                addPattern(draftPattern)
              }
            }}
          />
          <Button size="sm" disabled={!draftValid || draftPattern.trim().length === 0} onClick={() => addPattern(draftPattern)}>
            {t('settings.clipboard.addPattern')}
          </Button>
        </div>

        {!draftValid ? <p className="mt-1.5 text-[11.5px] text-danger">{t('settings.clipboard.patternInvalid')}</p> : null}

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-[11.5px] text-faint">{t('settings.clipboard.suggested')}</span>
          {SUGGESTED_IGNORE_PATTERNS.filter((suggestion) => !config.ignorePatterns.includes(suggestion.pattern)).map(
            (suggestion) => (
              <button
                key={suggestion.pattern}
                type="button"
                className="rounded-md bg-surface-sunken px-2 py-0.5 text-[11.5px] text-muted transition-colors hover:bg-surface-hover hover:text-text"
                onClick={() => addPattern(suggestion.pattern)}
              >
                {suggestion.label}
              </button>
            )
          )}
        </div>
      </Card>

      <Card>
        <Field label={t('settings.clipboard.cache')} hint={t('settings.clipboard.cacheHint')}>
          <Switch
            label={t('settings.clipboard.cache')}
            checked={config.translationCacheEnabled}
            onChange={(checked) => void store.updateConfig({ translationCacheEnabled: checked })}
          />
        </Field>

        <Divider />

        <Field label={t('settings.clipboard.autoReplace')} hint={t('settings.clipboard.autoReplaceHint')}>
          <Switch
            label={t('settings.clipboard.autoReplace')}
            checked={config.autoReplaceClipboard}
            onChange={(checked) => void store.updateConfig({ autoReplaceClipboard: checked })}
          />
        </Field>

        <Divider />

        <Field label={t('settings.clipboard.debugLog')} hint={t('settings.clipboard.debugLogHint')}>
          <Switch
            label={t('settings.clipboard.debugLog')}
            checked={config.llmDebugEnabled}
            onChange={(checked) => void store.updateConfig({ llmDebugEnabled: checked })}
          />
        </Field>
      </Card>

      {developerMode ? (
        <Card data-settings-section="developer">
          <CardHeader title={t('settings.clipboard.developer')} description={t('settings.clipboard.simulateHint')} />
          <Field label={t('settings.clipboard.simulateLabel')} stacked htmlFor="simulate-clipboard">
            <div className="flex items-center gap-2">
              <TextInput
                id="simulate-clipboard"
                value={simulatedText}
                placeholder={t('settings.clipboard.simulatePlaceholder')}
                spellCheck={false}
                onChange={(event) => setSimulatedText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && simulatedText.trim().length > 0) {
                    void window.translateClip.debugInjectClipboard(simulatedText)
                  }
                }}
              />
              <Button size="sm" disabled={simulatedText.trim().length === 0} onClick={() => void window.translateClip.debugInjectClipboard(simulatedText)}>
                {t('settings.clipboard.simulateAction')}
              </Button>
            </div>
          </Field>
        </Card>
      ) : null}
    </>
  )
}
