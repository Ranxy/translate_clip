import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { TranslationRecord } from '@shared/types'

import { useAppState, useAppStore } from '../../store/appStore'
import { cn } from '../../utils/cn'
import { Button } from '../ui/Button'
import { IconCopy, IconPin, IconSearch } from '../ui/Icon'
import { TextInput } from '../ui/Input'

const PAGE_SIZE = 20
const SEARCH_DEBOUNCE_MS = 200

function formatTimestamp(value: string): string {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return value
  }

  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/**
 * History inside the overlay.
 *
 * The list is the second half of the product's value: a translation you cannot
 * find again is a translation you have to ask for twice. Search runs against the
 * local sql.js database, so it is instant and offline.
 */
export function HistoryPanel({ active }: { active: boolean }) {
  const { t } = useTranslation()
  const store = useAppStore()
  const { recentHistory } = useAppState()

  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [onlyPinned, setOnlyPinned] = useState(false)
  const [items, setItems] = useState<TranslationRecord[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const latestId = recentHistory[0]?.id ?? null

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query])

  const fetchPage = useCallback(
    async (mode: 'replace' | 'append') => {
      setLoading(true)

      try {
        const page = await store.listHistory({
          query: debouncedQuery.trim() || undefined,
          onlyPinned,
          limit: PAGE_SIZE,
          cursor: mode === 'append' ? cursor : null
        })

        setItems((current) => (mode === 'append' ? [...current, ...page.items] : page.items))
        setHasMore(page.hasMore)
        setCursor(page.nextCursor)
      } finally {
        setLoading(false)
      }
    },
    [cursor, debouncedQuery, onlyPinned, store]
  )

  useEffect(() => {
    if (!active) {
      return
    }

    void fetchPage('replace')
    // `latestId` refreshes the list when a new translation lands while it is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, debouncedQuery, onlyPinned, latestId])

  const copy = async (record: TranslationRecord) => {
    await window.translateClip.copyHistoryTranslation(record.id)
    setCopiedId(record.id)
    setTimeout(() => setCopiedId((current) => (current === record.id ? null : current)), 1_200)
  }

  const togglePin = async (record: TranslationRecord) => {
    await window.translateClip.toggleHistoryPin(record.id)
    await fetchPage('replace')
  }

  const remove = async (record: TranslationRecord) => {
    await window.translateClip.removeHistoryEntry(record.id)
    await fetchPage('replace')
  }

  const clear = async () => {
    if (!window.confirm(t('overlay.history.clearConfirm'))) {
      return
    }

    await window.translateClip.clearHistory(true)
    await fetchPage('replace')
  }

  if (!active) {
    return null
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border px-3 py-2">
        <span className="relative flex-1">
          <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-faint">
            <IconSearch />
          </span>
          <TextInput
            className="pl-7"
            value={query}
            placeholder={t('overlay.history.search')}
            spellCheck={false}
            onChange={(event) => setQuery(event.target.value)}
          />
        </span>
        <Button
          size="sm"
          variant={onlyPinned ? 'primary' : 'subtle'}
          title={t('overlay.history.showPinnedOnly')}
          onClick={() => setOnlyPinned((current) => !current)}
        >
          <IconPin />
        </Button>
      </div>

      {items.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center">
          <p className="text-[12.5px] text-muted">{debouncedQuery.trim().length > 0 ? t('overlay.history.emptySearch') : t('overlay.historyEmpty')}</p>
        </div>
      ) : (
        <ul className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-3 py-2">
          {items.map((record) => (
            <li key={record.id} data-history-item={record.id} className="rounded-lg border border-border bg-surface-sunken px-2.5 py-2">
              <p className="line-clamp-2 selectable whitespace-pre-wrap text-[11.5px] text-muted">{record.sourceText}</p>

              <p className="mt-1 line-clamp-3 selectable whitespace-pre-wrap text-[12.5px] text-text">
                {record.translatedText ?? <span className="text-danger">{t('overlay.history.failed')}</span>}
              </p>

              <div className="mt-1.5 flex items-center gap-1.5 text-[10.5px] text-faint">
                <span className="truncate">{formatTimestamp(record.createdAt)}</span>
                <span>·</span>
                <span className="truncate">{record.modelName}</span>
                {record.cached ? <span className="text-accent">{t('overlay.history.cached')}</span> : null}
                <span className="flex-1" />

                <button
                  type="button"
                  className={cn('rounded px-1 transition-colors hover:bg-surface-hover hover:text-text', copiedId === record.id && 'text-ok')}
                  title={t('overlay.history.copy')}
                  disabled={!record.translatedText}
                  onClick={() => void copy(record)}
                >
                  {copiedId === record.id ? t('common.copied') : <IconCopy />}
                </button>
                <button
                  type="button"
                  className={cn('rounded px-1 transition-colors hover:bg-surface-hover hover:text-text', record.pinned && 'text-accent')}
                  title={record.pinned ? t('overlay.history.unpin') : t('overlay.history.pin')}
                  onClick={() => void togglePin(record)}
                >
                  <IconPin />
                </button>
                <button
                  type="button"
                  className="rounded px-1 transition-colors hover:bg-surface-hover hover:text-danger"
                  title={t('overlay.history.delete')}
                  onClick={() => void remove(record)}
                >
                  ✕
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="flex shrink-0 items-center gap-2 border-t border-border px-3 py-1.5">
        {hasMore ? (
          <Button size="sm" variant="ghost" disabled={loading} onClick={() => void fetchPage('append')}>
            {t('overlay.history.loadMore')}
          </Button>
        ) : null}
        <span className="flex-1" />
        <Button size="sm" variant="ghost" className="text-danger" disabled={loading || items.length === 0} onClick={() => void clear()}>
          {t('overlay.history.clear')}
        </Button>
      </div>
    </div>
  )
}
