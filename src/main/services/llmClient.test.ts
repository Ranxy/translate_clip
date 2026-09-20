import { afterEach, describe, expect, it } from 'vitest'

import { chatResponse, startStubServer, type StubServer } from '../testing/stubServer'
import {
  checkProviderConnection,
  classifyHttpError,
  LlmRequestError,
  normalizeMessageContent,
  parseTranslationContent,
  requestTranslation
} from './llmClient'

const servers: StubServer[] = []

async function createServer(initial = chatResponse('{"detectedLanguage":"en","translatedText":"你好"}')): Promise<StubServer> {
  const server = await startStubServer(initial)
  servers.push(server)
  return server
}

function baseRequest(server: StubServer, patch: Partial<Parameters<typeof requestTranslation>[0]> = {}) {
  return {
    apiBaseUrl: server.baseUrl,
    modelName: 'test-model',
    apiKey: 'sk-test',
    systemPrompt: 'translate this',
    text: 'Hello world',
    temperature: 0.2,
    timeoutMs: 2_000,
    retryCount: 0,
    ...patch
  }
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()))
})

describe('parseTranslationContent', () => {
  it('reads a clean JSON answer', () => {
    expect(parseTranslationContent('{"detectedLanguage":"en","translatedText":"你好世界"}')).toEqual({
      translatedText: '你好世界',
      detectedLanguage: 'en'
    })
  })

  it('reads a fenced JSON answer', () => {
    expect(parseTranslationContent('```json\n{"translatedText":"你好"}\n```')).toEqual({
      translatedText: '你好',
      detectedLanguage: null
    })
  })

  it('reads JSON surrounded by prose', () => {
    expect(parseTranslationContent('Sure! Here you go:\n{"translatedText":"你好"}\nHope that helps.')).toEqual({
      translatedText: '你好',
      detectedLanguage: null
    })
  })

  it('accepts alternative field names', () => {
    expect(parseTranslationContent('{"translation":"你好"}').translatedText).toBe('你好')
    expect(parseTranslationContent('{"text":"你好"}').translatedText).toBe('你好')
  })

  it('falls back to the raw text when the model ignores the JSON contract', () => {
    expect(parseTranslationContent('你好世界')).toEqual({ translatedText: '你好世界', detectedLanguage: null })
  })

  it('falls back to the raw text when the JSON has nothing usable', () => {
    expect(parseTranslationContent('{"unexpected":true}').translatedText).toBe('{"unexpected":true}')
  })

  it('rejects an empty response', () => {
    expect(() => parseTranslationContent('   ')).toThrow(LlmRequestError)
  })
})

describe('normalizeMessageContent', () => {
  it('handles a plain string', () => {
    expect(normalizeMessageContent(' hi ')).toBe('hi')
  })

  it('handles the multi-part shape some gateways return', () => {
    expect(normalizeMessageContent([{ type: 'text', text: ' a ' }, { type: 'text', text: 'b' }, { type: 'image' }])).toBe('a\nb')
  })

  it('returns an empty string for anything else', () => {
    expect(normalizeMessageContent(undefined)).toBe('')
    expect(normalizeMessageContent({})).toBe('')
  })
})

describe('classifyHttpError', () => {
  it('maps statuses to actionable codes', () => {
    expect(classifyHttpError(401, '').code).toBe('auth')
    expect(classifyHttpError(403, '').code).toBe('auth')
    expect(classifyHttpError(429, '').code).toBe('rate-limit')
    expect(classifyHttpError(500, '').code).toBe('server')
    expect(classifyHttpError(404, '').code).toBe('bad-response')
  })

  it('marks only the recoverable codes as retryable', () => {
    expect(classifyHttpError(429, '').retryable).toBe(true)
    expect(classifyHttpError(503, '').retryable).toBe(true)
    expect(classifyHttpError(401, '').retryable).toBe(false)
    expect(classifyHttpError(404, '').retryable).toBe(false)
  })

  it('keeps the provider detail in the message', () => {
    expect(classifyHttpError(401, JSON.stringify({ error: { message: 'Invalid API key' } })).message).toContain('Invalid API key')
  })
})

describe('requestTranslation', () => {
  it('posts an OpenAI-compatible request and parses the answer', async () => {
    const server = await createServer()
    const result = await requestTranslation(baseRequest(server))

    expect(result.translatedText).toBe('你好')
    expect(result.detectedLanguage).toBe('en')
    expect(result.attempts).toBe(1)
    expect(result.usage).toEqual({ promptTokens: 12, completionTokens: 8 })

    const [request] = server.requests
    expect(request.url).toBe('/v1/chat/completions')
    expect(request.method).toBe('POST')
    expect(request.headers.authorization).toBe('Bearer sk-test')
    expect(request.body).toMatchObject({
      model: 'test-model',
      stream: false,
      messages: [{ role: 'system' }, { role: 'user', content: 'Hello world' }]
    })
  })

  it('omits the Authorization header for a keyless local provider', async () => {
    const server = await createServer()
    await requestTranslation(baseRequest(server, { apiKey: null }))

    expect(server.requests[0].headers.authorization).toBeUndefined()
  })

  it('retries a rate limit and then succeeds', async () => {
    const server = await createServer({ status: 429, body: { error: { message: 'slow down' } } })
    server.enqueue(chatResponse('{"translatedText":"你好"}'))

    const result = await requestTranslation(baseRequest(server, { retryCount: 1 }))

    expect(result.translatedText).toBe('你好')
    expect(result.attempts).toBe(2)
    expect(server.requests).toHaveLength(2)
  })

  it('does not retry an authentication failure', async () => {
    const server = await createServer({ status: 401, body: { error: { message: 'bad key' } } })

    await expect(requestTranslation(baseRequest(server, { retryCount: 3 }))).rejects.toMatchObject({ code: 'auth' })
    expect(server.requests).toHaveLength(1)
  })

  it('gives up after exhausting retries on a server error', async () => {
    const server = await createServer({ status: 503, body: { error: { message: 'unavailable' } } })

    await expect(requestTranslation(baseRequest(server, { retryCount: 1 }))).rejects.toMatchObject({ code: 'server' })
    expect(server.requests).toHaveLength(2)
  })

  it('reports a timeout', async () => {
    const server = await createServer({ ...chatResponse('{"translatedText":"too late"}'), delayMs: 600 })

    await expect(requestTranslation(baseRequest(server, { timeoutMs: 60 }))).rejects.toMatchObject({ code: 'timeout' })
  })

  it('reports cancellation distinctly from a timeout', async () => {
    const server = await createServer({ ...chatResponse('{"translatedText":"never"}'), delayMs: 600 })
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 30)

    await expect(requestTranslation(baseRequest(server, { signal: controller.signal }))).rejects.toMatchObject({
      code: 'canceled'
    })
  })

  it('reads a multi-part content response', async () => {
    const server = await createServer({
      status: 200,
      body: { choices: [{ message: { content: [{ type: 'text', text: '{"translatedText":"分段"}' }] } }] }
    })

    await expect(requestTranslation(baseRequest(server))).resolves.toMatchObject({ translatedText: '分段' })
  })

  it('fails when the response carries no text', async () => {
    const server = await createServer({ status: 200, body: { choices: [{ message: { content: '' } }] } })

    await expect(requestTranslation(baseRequest(server))).rejects.toMatchObject({ code: 'bad-response' })
  })
})

describe('checkProviderConnection', () => {
  it('accepts a reachable endpoint', async () => {
    const server = await createServer({ status: 200, body: { data: [{ id: 'test-model' }] } })

    await expect(
      checkProviderConnection({ apiBaseUrl: server.baseUrl, apiKey: 'sk-test', timeoutMs: 1_000 })
    ).resolves.toBeUndefined()
    expect(server.requests[0].url).toBe('/v1/models')
  })

  it('reports a rejected key', async () => {
    const server = await createServer({ status: 401, body: { error: { message: 'bad key' } } })

    await expect(checkProviderConnection({ apiBaseUrl: server.baseUrl, apiKey: 'nope', timeoutMs: 1_000 })).rejects.toMatchObject({
      code: 'auth'
    })
  })

  it('reports an unreachable endpoint', async () => {
    await expect(
      checkProviderConnection({ apiBaseUrl: 'http://127.0.0.1:1/v1', apiKey: null, timeoutMs: 1_000 })
    ).rejects.toMatchObject({ code: 'network' })
  })
})
