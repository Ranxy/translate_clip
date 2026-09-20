import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { DEFAULT_CONFIG } from '@shared/constants'
import type { AppConfig, TranslationDirection, TranslationState } from '@shared/types'

import { createFakeLogger } from '../testing/fakeLogger'
import { chatResponse, startStubServer, type StubServer } from '../testing/stubServer'
import { hashText } from '../utils/hash'
import { createDatabaseService, type DatabaseService } from './database'
import { HistoryRepository } from './historyRepository'
import type { ResolvedLlmConfig } from './llmConfigStore'
import { TranslationQueue, type TranslationJob } from './translationQueue'

const DIRECTION: TranslationDirection = { sourceLanguage: 'latin', targetLanguage: 'zh-CN', reversed: false }

function job(text: string): TranslationJob {
  return { text, hash: hashText(text), direction: DIRECTION }
}

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs

  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error('timed out waiting for the queue to settle')
    }

    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

describe('TranslationQueue', () => {
  let directory: string
  let database: DatabaseService
  let history: HistoryRepository
  let server: StubServer
  let states: TranslationState[]
  let config: AppConfig
  let activeConfig: ResolvedLlmConfig | null

  const createQueue = () =>
    new TranslationQueue({
      log: createFakeLogger(),
      getConfig: () => config,
      getActiveConfig: () => activeConfig,
      history,
      buildSystemPrompt: () => 'translate this',
      onState: (state) => states.push(state)
    })

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'translate-clip-queue-'))
    database = createDatabaseService({ filePath: join(directory, 'data.sqlite'), log: createFakeLogger() })
    await database.load()
    history = new HistoryRepository(database, createFakeLogger())
    states = []
    config = { ...DEFAULT_CONFIG }
  })

  afterEach(async () => {
    await server?.close()
    await database.close()
    await rm(directory, { recursive: true, force: true })
  })

  async function useServer(response = chatResponse('{"detectedLanguage":"en","translatedText":"你好"}')): Promise<void> {
    server = await startStubServer(response)
    activeConfig = {
      profileId: 'profile-1',
      providerId: 'custom',
      apiBaseUrl: server.baseUrl,
      modelName: 'test-model',
      apiKey: 'sk-test'
    }
  }

  it('translates, reports the phases in order and records history', async () => {
    await useServer()
    const queue = createQueue()

    queue.submit(job('Hello world'))
    await waitFor(() => states.at(-1)?.phase === 'done')

    expect(states.map((state) => state.phase)).toEqual(['translating', 'done'])
    expect(states.at(-1)).toMatchObject({
      translatedText: '你好',
      cached: false,
      providerId: 'custom',
      modelName: 'test-model'
    })
    // The model's own detection replaces our script guess.
    expect(states.at(-1)?.direction?.sourceLanguage).toBe('en')

    const page = history.list({})
    expect(page.items).toHaveLength(1)
    expect(page.items[0]).toMatchObject({
      status: 'done',
      translatedText: '你好',
      detectedLanguage: 'en',
      sourceText: 'Hello world'
    })
  })

  it('replaces the request in flight when a newer copy arrives', async () => {
    server = await startStubServer({ ...chatResponse('{"translatedText":"第一个"}'), delayMs: 500 })
    server.enqueue(chatResponse('{"translatedText":"第二个"}'))
    activeConfig = {
      profileId: 'profile-1',
      providerId: 'custom',
      apiBaseUrl: server.baseUrl,
      modelName: 'test-model',
      apiKey: null
    }

    const queue = createQueue()
    queue.submit(job('first copy'))
    await waitFor(() => states.some((state) => state.phase === 'translating'))
    await new Promise((resolve) => setTimeout(resolve, 60))

    queue.submit(job('second copy'))
    await waitFor(() => states.at(-1)?.phase === 'done')

    expect(states.at(-1)?.translatedText).toBe('第二个')
    expect(states.at(-1)?.sourceText).toBe('second copy')

    // The superseded row is removed rather than recorded as a failure.
    const page = history.list({})
    expect(page.items).toHaveLength(1)
    expect(page.items[0].sourceText).toBe('second copy')
  })

  it('reuses a cached translation instead of calling the provider again', async () => {
    await useServer()
    const queue = createQueue()

    queue.submit(job('Hello world'))
    await waitFor(() => states.at(-1)?.phase === 'done')
    expect(server.requests).toHaveLength(1)

    queue.submit(job('Hello world'))
    await waitFor(() => states.at(-1)?.phase === 'done' && states.at(-1)?.cached === true)

    expect(server.requests).toHaveLength(1)
    expect(states.at(-1)).toMatchObject({ translatedText: '你好', cached: true, latencyMs: 0 })
  })

  it('ignores the cache when the cache is disabled', async () => {
    await useServer()
    config = { ...DEFAULT_CONFIG, translationCacheEnabled: false }
    const queue = createQueue()

    queue.submit(job('Hello world'))
    await waitFor(() => states.at(-1)?.phase === 'done')
    queue.submit(job('Hello world'))
    await waitFor(() => states.filter((state) => state.phase === 'done').length === 2)

    expect(server.requests).toHaveLength(2)
    expect(states.at(-1)?.cached).toBe(false)
  })

  it('re-runs the last job when asked to retranslate, bypassing the cache', async () => {
    await useServer()
    const queue = createQueue()

    queue.submit(job('Hello world'))
    await waitFor(() => states.at(-1)?.phase === 'done')

    queue.retranslate()
    await waitFor(() => states.filter((state) => state.phase === 'done').length === 2)

    expect(server.requests).toHaveLength(2)
    expect(states.at(-1)?.cached).toBe(false)
  })

  it('reports unconfigured without touching the network', async () => {
    await useServer()
    activeConfig = null
    const queue = createQueue()

    queue.submit(job('Hello world'))

    expect(states.at(-1)?.phase).toBe('unconfigured')
    expect(server.requests).toHaveLength(0)
    expect(history.list({}).items).toHaveLength(0)
  })

  it('reports a failure and keeps the row for the history view', async () => {
    await useServer({ status: 401, body: { error: { message: 'bad key' } } })
    config = { ...DEFAULT_CONFIG, retryCount: 0 }
    const queue = createQueue()

    queue.submit(job('Hello world'))
    await waitFor(() => states.at(-1)?.phase === 'error')

    expect(states.at(-1)?.error).toMatchObject({ code: 'auth', retryable: false })

    const page = history.list({})
    expect(page.items).toHaveLength(1)
    expect(page.items[0]).toMatchObject({ status: 'error', errorCode: 'auth', translatedText: null })
  })

  it('drops the row when the user cancels', async () => {
    server = await startStubServer({ ...chatResponse('{"translatedText":"late"}'), delayMs: 500 })
    activeConfig = {
      profileId: 'profile-1',
      providerId: 'custom',
      apiBaseUrl: server.baseUrl,
      modelName: 'test-model',
      apiKey: null
    }

    const queue = createQueue()
    queue.submit(job('Hello world'))
    await waitFor(() => states.some((state) => state.phase === 'translating'))

    queue.cancel()

    expect(states.at(-1)?.phase).toBe('canceled')
    await new Promise((resolve) => setTimeout(resolve, 120))
    expect(history.list({}).items).toHaveLength(0)
  })

  it('prunes history beyond the configured limit', async () => {
    await useServer()
    config = { ...DEFAULT_CONFIG, historyLimit: 50, translationCacheEnabled: false }
    const queue = createQueue()

    for (let index = 0; index < 3; index += 1) {
      const text = `message ${index}`
      queue.submit(job(text))
      await waitFor(() => states.at(-1)?.phase === 'done' || states.at(-1)?.phase === 'error')
    }

    expect(history.list({}).items).toHaveLength(3)
  })
})
