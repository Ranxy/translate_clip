import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { LANGUAGE_OPTIONS } from '@shared/constants'
import type { GlossaryEntry } from '@shared/types'

import { useAppState, useAppStore } from '../../store/appStore'
import { Button } from '../ui/Button'
import { Card, CardHeader, Divider } from '../ui/Card'
import { Field } from '../ui/Field'
import { IconClose, IconSearch } from '../ui/Icon'
import { Select, TextArea, TextInput } from '../ui/Input'

interface TermRow {
  language: string
  variants: string
}

interface Draft {
  id: string | null
  notes: string
  rows: TermRow[]
}

const DEFAULT_LANGUAGE = 'en-US'
const DEFAULT_TARGET_LANGUAGE = 'zh-CN'

function createDraft(entry: GlossaryEntry | null, targetLanguage: string): Draft {
  if (!entry) {
    // A new entry starts with the two languages that matter for the common case,
    // deduplicated in case the target already is one of them.
    const rows: TermRow[] = [
      { language: DEFAULT_LANGUAGE, variants: '' },
      { language: targetLanguage, variants: '' },
      { language: DEFAULT_TARGET_LANGUAGE, variants: '' }
    ].filter((row, index, all) => all.findIndex((other) => other.language === row.language) === index)

    return { id: null, notes: '', rows }
  }

  return {
    id: entry.id,
    notes: entry.notes ?? '',
    rows: Object.entries(entry.terms).map(([language, variants]) => ({ language, variants: variants.join(', ') }))
  }
}

/**
 * Glossary editor.
 *
 * A glossary entry is a set of wordings of the same term across languages; the
 * prompt builder picks the target-language wording and injects it when the source
 * wording appears in the copied text.
 */
export function GlossaryPage() {
  const { t } = useTranslation()
  const store = useAppStore()
  const { config } = useAppState().bootstrap

  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState<Draft>(() => createDraft(null, config.targetLanguage))
  const [importText, setImportText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const entries = useMemo(() => {
    const needle = query.trim().toLowerCase()

    if (needle.length === 0) {
      return config.glossary
    }

    return config.glossary.filter((entry) => {
      const haystack = [entry.id, entry.notes ?? '', ...Object.values(entry.terms).flat()].join(' ').toLowerCase()
      return haystack.includes(needle)
    })
  }, [config.glossary, query])

  const save = async () => {
    const id = draft.id ?? draft.rows.find((row) => row.variants.trim().length > 0)?.variants.split(',')[0]?.trim() ?? ''

    if (id.length === 0) {
      setError(t('settings.glossary.variantsPlaceholder'))
      return
    }

    const terms: Record<string, string[]> = {}

    for (const row of draft.rows) {
      const variants = row.variants
        .split(',')
        .map((variant) => variant.trim())
        .filter((variant) => variant.length > 0)

      if (variants.length > 0) {
        terms[row.language] = variants
      }
    }

    if (Object.keys(terms).length === 0) {
      setError(t('settings.glossary.variantsHint'))
      return
    }

    setBusy(true)
    setError(null)

    try {
      store.applyBootstrap(
        await window.translateClip.saveGlossaryEntry({ id, notes: draft.notes.trim() || undefined, terms })
      )
      setDraft(createDraft(null, config.targetLanguage))
    } catch (saveError) {
      setError((saveError as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const remove = async (entry: GlossaryEntry) => {
    if (!window.confirm(t('settings.glossary.deleteConfirm'))) {
      return
    }

    store.applyBootstrap(await window.translateClip.deleteGlossaryEntry(entry.id))

    if (draft.id === entry.id) {
      setDraft(createDraft(null, config.targetLanguage))
    }
  }

  const exportToClipboard = async () => {
    const json = await window.translateClip.exportGlossary()
    await window.translateClip.copyText(json)
    setCopied(true)
    setTimeout(() => setCopied(false), 1_500)
  }

  const importFromText = async () => {
    setBusy(true)
    setError(null)

    try {
      store.applyBootstrap(await window.translateClip.importGlossary(importText))
      setImportText('')
    } catch {
      setError(t('settings.glossary.importInvalid'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Card>
        <CardHeader title={t('settings.tabs.glossary')} description={t('settings.glossary.description')} />

        <div className="mb-3 flex items-center gap-2">
          <span className="relative flex-1">
            <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-faint">
              <IconSearch />
            </span>
            <TextInput
              className="pl-7"
              value={query}
              placeholder={t('settings.glossary.search')}
              spellCheck={false}
              onChange={(event) => setQuery(event.target.value)}
            />
          </span>
          <Button size="sm" onClick={() => setDraft(createDraft(null, config.targetLanguage))}>
            {t('settings.glossary.add')}
          </Button>
        </div>

        {entries.length === 0 ? (
          <p className="text-[12px] text-muted">{query.trim().length > 0 ? t('settings.glossary.emptySearch') : t('settings.glossary.empty')}</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {entries.map((entry) => (
              <li key={entry.id} className="flex items-center gap-2 rounded-lg border border-border bg-surface-sunken px-2.5 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-medium text-text">{entry.id}</span>
                  <span className="mt-0.5 block truncate text-[11px] text-muted">
                    {entry.notes ? `${entry.notes} · ` : ''}
                    {Object.entries(entry.terms)
                      .map(([language, variants]) => `${language}: ${variants.join('/')}`)
                      .join('  ·  ')}
                  </span>
                </span>
                <Button size="sm" variant="ghost" onClick={() => setDraft(createDraft(entry, config.targetLanguage))}>
                  {t('settings.glossary.edit')}
                </Button>
                <Button size="sm" variant="danger" onClick={() => void remove(entry)}>
                  {t('settings.glossary.delete')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader title={draft.id ? `${t('settings.glossary.edit')}: ${draft.id}` : t('settings.glossary.newEntry')} />

        <Field label={t('settings.glossary.notes')} stacked htmlFor="glossary-notes">
          <TextInput
            id="glossary-notes"
            value={draft.notes}
            placeholder={t('settings.glossary.notesPlaceholder')}
            onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))}
          />
        </Field>

        <h3 className="mt-1 text-[11px] uppercase tracking-wide text-faint">{t('settings.glossary.terms')}</h3>

        <div className="mt-1.5 flex flex-col gap-1.5">
          {draft.rows.map((row, index) => (
            <div key={`${row.language}-${index}`} className="flex items-center gap-2">
              <Select
                className="w-40"
                value={row.language}
                onValueChange={(value) =>
                  setDraft((current) => ({
                    ...current,
                    rows: current.rows.map((entry, rowIndex) => (rowIndex === index ? { ...entry, language: value } : entry))
                  }))
                }
                options={LANGUAGE_OPTIONS.map((option) => ({ value: option.value, label: `${option.nativeLabel} — ${option.label}` }))}
              />
              <TextInput
                value={row.variants}
                placeholder={t('settings.glossary.variantsPlaceholder')}
                spellCheck={false}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    rows: current.rows.map((entry, rowIndex) => (rowIndex === index ? { ...entry, variants: event.target.value } : entry))
                  }))
                }
              />
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('settings.glossary.delete')}
                disabled={draft.rows.length <= 1}
                onClick={() => setDraft((current) => ({ ...current, rows: current.rows.filter((_, rowIndex) => rowIndex !== index) }))}
              >
                <IconClose />
              </Button>
            </div>
          ))}
        </div>

        <Button
          size="sm"
          className="mt-2"
          onClick={() => setDraft((current) => ({ ...current, rows: [...current.rows, { language: config.targetLanguage, variants: '' }] }))}
        >
          {t('settings.glossary.addLanguage')}
        </Button>

        <p className="mt-2 text-[11.5px] leading-relaxed text-faint">{t('settings.glossary.variantsHint')}</p>

        <Divider />

        <Button variant="primary" size="sm" disabled={busy} onClick={() => void save()}>
          {t('settings.glossary.save')}
        </Button>

        {error ? <p className="mt-2 text-[12px] text-danger">{error}</p> : null}
      </Card>

      <Card>
        <CardHeader title={t('settings.glossary.transfer')} description={t('settings.glossary.transferHint')} />

        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => void exportToClipboard()}>
            {copied ? t('common.copied') : t('settings.glossary.exportCopy')}
          </Button>
        </div>

        <TextArea
          className="mt-2"
          rows={4}
          value={importText}
          placeholder={t('settings.glossary.importPlaceholder')}
          spellCheck={false}
          onChange={(event) => setImportText(event.target.value)}
        />

        <Button size="sm" className="mt-2" disabled={busy || importText.trim().length === 0} onClick={() => void importFromText()}>
          {t('settings.glossary.importApply')}
        </Button>
      </Card>
    </>
  )
}
