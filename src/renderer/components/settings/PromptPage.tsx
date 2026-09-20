import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { APP_LIMITS, DEFAULT_TRANSLATION_PROMPT } from '@shared/constants'

import { useAppState, useAppStore } from '../../store/appStore'
import { Button } from '../ui/Button'
import { Card, CardHeader, Divider } from '../ui/Card'
import { Field } from '../ui/Field'
import { CodeBlock, TextArea } from '../ui/Input'
import { NumberInput } from '../ui/NumberInput'

const SAMPLE_TEXT = 'The quick brown fox jumps over the lazy dog.'

/**
 * Prompt and request parameters.
 *
 * The preview calls the main process, which runs the same detection and prompt
 * assembly used for a real translation — including glossary injection — so what is
 * shown here is exactly what the model receives.
 */
export function PromptPage() {
  const { t } = useTranslation()
  const store = useAppStore()
  const { config } = useAppState().bootstrap

  const [template, setTemplate] = useState(config.translationPrompt)
  const [sample, setSample] = useState(SAMPLE_TEXT)
  const [preview, setPreview] = useState('')
  const [busy, setBusy] = useState(false)

  const dirty = template.trim() !== config.translationPrompt.trim()

  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const rendered = await window.translateClip.previewPrompt({ text: sample, translationPrompt: template })
        if (!cancelled) {
          setPreview(rendered)
        }
      } catch {
        if (!cancelled) {
          setPreview('')
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [
    sample,
    template,
    config.targetLanguage,
    config.fallbackLanguage,
    config.directionMode,
    config.glossary,
    config.glossaryEnabled
  ])

  const save = async () => {
    setBusy(true)

    try {
      await store.updateConfig({ translationPrompt: template.trim() || DEFAULT_TRANSLATION_PROMPT })
      setTemplate(template.trim() || DEFAULT_TRANSLATION_PROMPT)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Card>
        <CardHeader title={t('settings.tabs.prompt')} description={t('settings.prompt.description')} />

        <TextArea
          rows={10}
          value={template}
          spellCheck={false}
          onChange={(event) => setTemplate(event.target.value)}
          aria-label={t('settings.prompt.template')}
        />

        <div className="mt-2 flex items-center gap-2">
          <Button variant="primary" size="sm" disabled={busy || !dirty} onClick={() => void save()}>
            {t('common.save')}
          </Button>
          <Button size="sm" disabled={template === DEFAULT_TRANSLATION_PROMPT} onClick={() => setTemplate(DEFAULT_TRANSLATION_PROMPT)}>
            {t('settings.prompt.reset')}
          </Button>
          <span className="flex-1" />
          {dirty ? <span className="text-[11.5px] text-warn">{t('common.save')}?</span> : null}
        </div>

        <Divider />

        <h3 className="mb-1 text-[11px] uppercase tracking-wide text-faint">{t('settings.prompt.variables')}</h3>
        <ul className="flex flex-col gap-0.5 font-mono text-[11.5px] text-muted">
          <li>{t('settings.prompt.variableTarget')}</li>
          <li>{t('settings.prompt.variableSource')}</li>
        </ul>

        <p className="mt-3 text-[11.5px] leading-relaxed text-faint">{t('settings.prompt.responseContract')}</p>
      </Card>

      <Card>
        <CardHeader title={t('settings.prompt.preview')} description={t('settings.prompt.previewHint')} />

        <Field label={t('settings.prompt.sampleText')} stacked htmlFor="prompt-sample">
          <TextArea
            id="prompt-sample"
            rows={2}
            value={sample}
            spellCheck={false}
            onChange={(event) => setSample(event.target.value)}
          />
        </Field>

        <CodeBlock>{preview.length > 0 ? preview : t('common.loading')}</CodeBlock>
      </Card>

      <Card>
        <CardHeader title={t('settings.prompt.parameters')} />

        <Field label={t('settings.prompt.temperature')} hint={t('settings.prompt.temperatureHint')}>
          <NumberInput
            value={config.temperature}
            min={APP_LIMITS.temperature.min}
            max={APP_LIMITS.temperature.max}
            step={APP_LIMITS.temperature.step}
            onCommit={(value) => void store.updateConfig({ temperature: value })}
          />
        </Field>

        <Divider />

        <Field label={t('settings.prompt.timeout')}>
          <NumberInput
            value={config.requestTimeoutMs}
            min={APP_LIMITS.requestTimeoutMs.min}
            max={APP_LIMITS.requestTimeoutMs.max}
            step={APP_LIMITS.requestTimeoutMs.step}
            onCommit={(value) => void store.updateConfig({ requestTimeoutMs: value })}
          />
        </Field>

        <Divider />

        <Field label={t('settings.prompt.retries')} hint={t('settings.prompt.retriesHint')}>
          <NumberInput
            value={config.retryCount}
            min={APP_LIMITS.retryCount.min}
            max={APP_LIMITS.retryCount.max}
            onCommit={(value) => void store.updateConfig({ retryCount: value })}
          />
        </Field>
      </Card>
    </>
  )
}
