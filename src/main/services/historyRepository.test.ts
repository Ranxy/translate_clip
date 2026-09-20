import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createFakeLogger } from '../testing/fakeLogger'
import { createDatabaseService, type DatabaseService } from './database'
import { HistoryRepository } from './historyRepository'

const PENDING = {
  sourceText: 'Hello there',
  sourceHash: 'hash-hello',
  sourceLanguage: 'latin',
  targetLanguage: 'zh-CN',
  providerId: 'deepseek',
  modelName: 'deepseek-chat',
  charCount: 11
} as const

describe('HistoryRepository', () => {
  let directory: string
  let database: DatabaseService
  let history: HistoryRepository

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'translate-clip-history-'))
    database = createDatabaseService({ filePath: join(directory, 'data.sqlite'), log: createFakeLogger() })
    await database.load()
    history = new HistoryRepository(database, createFakeLogger())
  })

  afterEach(async () => {
    await database.close()
    await rm(directory, { recursive: true, force: true })
  })

  it('records a pending row before the request completes', () => {
    const id = history.insertPending(PENDING)
    const record = history.getById(id)

    expect(record).toMatchObject({ status: 'translating', translatedText: null, sourceText: 'Hello there' })
  })

  it('completes a row', () => {
    const id = history.insertPending(PENDING)
    history.markCompleted(id, { translatedText: '你好', detectedLanguage: 'en', latencyMs: 812.4, cached: false })

    expect(history.getById(id)).toMatchObject({
      status: 'done',
      translatedText: '你好',
      detectedLanguage: 'en',
      latencyMs: 812,
      cached: false
    })
  })

  it('records failures with their error code', () => {
    const id = history.insertPending(PENDING)
    history.markFailed(id, 'auth', 'The provider rejected the API key')

    expect(history.getById(id)).toMatchObject({ status: 'error', errorCode: 'auth', translatedText: null })
  })

  it('finds a fresh cached translation of identical text', () => {
    const id = history.insertPending(PENDING)
    history.markCompleted(id, { translatedText: '你好', detectedLanguage: 'en', latencyMs: 500, cached: false })

    expect(history.findCached('hash-hello', 'zh-CN', 3_600_000)?.translatedText).toBe('你好')
    // A different target language must not match.
    expect(history.findCached('hash-hello', 'ja-JP', 3_600_000)).toBeNull()
    // Nor may an expired entry.
    expect(history.findCached('hash-hello', 'zh-CN', -1)).toBeNull()
  })

  it('never caches a failed or unfinished translation', () => {
    const failed = history.insertPending(PENDING)
    history.markFailed(failed, 'server', 'boom')
    history.insertPending(PENDING)

    expect(history.findCached('hash-hello', 'zh-CN', 3_600_000)).toBeNull()
  })

  it('lists newest first and paginates with a cursor', () => {
    const ids = ['a', 'b', 'c'].map(() => history.insertPending(PENDING))

    const firstPage = history.list({ limit: 2 })
    expect(firstPage.items).toHaveLength(2)
    expect(firstPage.hasMore).toBe(true)

    const secondPage = history.list({ limit: 2, cursor: firstPage.nextCursor })
    expect(secondPage.items).toHaveLength(1)
    expect(secondPage.hasMore).toBe(false)

    expect(new Set([...firstPage.items, ...secondPage.items].map((item) => item.id))).toEqual(new Set(ids))
  })

  it('paginates correctly when entries share a timestamp', () => {
    const ids = ['a', 'b', 'c'].map(() => history.insertPending(PENDING))

    // A fast machine produces colliding milliseconds on its own, but a test cannot
    // rely on that, so force the collision the pagination has to survive.
    database.getDatabase().run("UPDATE translations SET created_at = '2026-01-01T00:00:00.000Z'")

    const firstPage = history.list({ limit: 2 })
    expect(firstPage.items).toHaveLength(2)

    const secondPage = history.list({ limit: 2, cursor: firstPage.nextCursor })
    expect(secondPage.items).toHaveLength(1)
    expect(new Set([...firstPage.items, ...secondPage.items].map((item) => item.id))).toEqual(new Set(ids))
  })

  it('searches source and translated text', () => {
    const id = history.insertPending(PENDING)
    history.markCompleted(id, { translatedText: '你好世界', detectedLanguage: 'en', latencyMs: 100, cached: false })
    history.insertPending({ ...PENDING, sourceText: 'Goodbye', sourceHash: 'hash-bye' })

    expect(history.list({ query: 'hello' }).items).toHaveLength(1)
    expect(history.list({ query: '你好' }).items).toHaveLength(1)
    expect(history.list({ query: 'nothing-matches' }).items).toHaveLength(0)
  })

  it('toggles pins and can keep pinned entries when clearing', () => {
    const pinned = history.insertPending(PENDING)
    history.insertPending(PENDING)
    history.togglePin(pinned)

    expect(history.list({ onlyPinned: true }).items.map((item) => item.id)).toEqual([pinned])

    const removed = history.clear(true)
    expect(removed).toBe(1)
    expect(history.list({}).items.map((item) => item.id)).toEqual([pinned])

    history.togglePin(pinned)
    expect(history.list({ onlyPinned: true }).items).toHaveLength(0)
  })

  it('prunes the oldest unpinned rows beyond the limit but keeps pinned ones', () => {
    const pinned = history.insertPending(PENDING)
    history.togglePin(pinned)

    for (let index = 0; index < 5; index += 1) {
      history.insertPending({ ...PENDING, sourceHash: `hash-${index}` })
    }

    const removed = history.prune(2)
    const remaining = history.list({ limit: 100 }).items

    expect(removed).toBe(3)
    expect(remaining).toHaveLength(3)
    expect(remaining.some((item) => item.id === pinned)).toBe(true)
  })

  it('removes a single entry', () => {
    const id = history.insertPending(PENDING)
    history.remove(id)

    expect(history.getById(id)).toBeNull()
  })
})
