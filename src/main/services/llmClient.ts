import type { LlmError, LlmErrorCode } from '@shared/types'

const RETRYABLE_CODES: ReadonlySet<LlmErrorCode> = new Set(['rate-limit', 'timeout', 'server', 'network'])
const RETRY_BACKOFF_MS = [600, 1_800]

export class LlmRequestError extends Error {
  constructor(
    readonly code: LlmErrorCode,
    message: string,
    readonly status: number | null = null
  ) {
    super(message)
    this.name = 'LlmRequestError'
  }

  get retryable(): boolean {
    return RETRYABLE_CODES.has(this.code)
  }

  toLlmError(): LlmError {
    return { code: this.code, message: this.message, status: this.status, retryable: this.retryable }
  }
}

export interface TranslationRequestOptions {
  apiBaseUrl: string
  modelName: string
  apiKey: string | null
  systemPrompt: string
  text: string
  temperature: number
  timeoutMs: number
  retryCount: number
  signal?: AbortSignal
}

export interface TranslationResult {
  translatedText: string
  detectedLanguage: string | null
  usage: { promptTokens: number | null; completionTokens: number | null } | null
  latencyMs: number
  attempts: number
}

interface ChatCompletionPayload {
  choices?: Array<{ message?: { content?: unknown } }>
  usage?: { prompt_tokens?: number; completion_tokens?: number }
  error?: { message?: string }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function parseJsonSafely(value: string): unknown {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return null
  }
}

/** Providers disagree on this: most return a string, some gateways return parts. */
export function normalizeMessageContent(content: unknown): string {
  if (typeof content === 'string') {
    return content.trim()
  }

  if (!Array.isArray(content)) {
    return ''
  }

  return content
    .filter((part): part is { type?: string; text?: string } => typeof part === 'object' && part !== null)
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => (part.text ?? '').trim())
    .join('\n')
    .trim()
}

function readTranslatedText(payload: Record<string, unknown>): { translatedText: string; detectedLanguage: string | null } | null {
  const candidate = payload.translatedText ?? payload.translation ?? payload.text

  if (typeof candidate !== 'string' || candidate.trim().length === 0) {
    return null
  }

  return {
    translatedText: candidate.trim(),
    detectedLanguage: typeof payload.detectedLanguage === 'string' ? payload.detectedLanguage.trim() || null : null
  }
}

/**
 * Extracts the translation from a model response.
 *
 * Three fallbacks, because models ignore instructions regularly: a clean JSON
 * object, JSON buried in prose or fences, and finally the raw text treated as the
 * translation itself. Producing a usable answer matters more than being strict.
 */
export function parseTranslationContent(content: string): { translatedText: string; detectedLanguage: string | null } {
  const normalized = content
    .trim()
    .replace(/^```(?:json)?\s*/iu, '')
    .replace(/```$/u, '')
    .trim()

  if (normalized.length === 0) {
    throw new LlmRequestError('bad-response', 'The provider returned an empty response')
  }

  const direct = parseJsonSafely(normalized)
  if (direct && typeof direct === 'object') {
    const read = readTranslatedText(direct as Record<string, unknown>)
    if (read) {
      return read
    }
  }

  const start = normalized.indexOf('{')
  const end = normalized.lastIndexOf('}')

  if (start !== -1 && end > start) {
    const embedded = parseJsonSafely(normalized.slice(start, end + 1))
    if (embedded && typeof embedded === 'object') {
      const read = readTranslatedText(embedded as Record<string, unknown>)
      if (read) {
        return read
      }
    }
  }

  return { translatedText: normalized, detectedLanguage: null }
}

export function classifyHttpError(status: number, bodyText: string): LlmRequestError {
  const payload = parseJsonSafely(bodyText) as ChatCompletionPayload | null
  const detail = payload?.error?.message?.trim()
  const suffix = detail ? `: ${detail}` : ''

  if (status === 401 || status === 403) {
    return new LlmRequestError('auth', `The provider rejected the API key (${status})${suffix}`, status)
  }

  if (status === 429) {
    return new LlmRequestError('rate-limit', `The provider is rate limiting requests (429)${suffix}`, status)
  }

  if (status >= 500) {
    return new LlmRequestError('server', `The provider failed with ${status}${suffix}`, status)
  }

  if (status === 404) {
    return new LlmRequestError(
      'bad-response',
      `Endpoint not found (404). Check the API base URL and the model name${suffix}`,
      status
    )
  }

  return new LlmRequestError('bad-response', `The provider returned ${status}${suffix}`, status)
}

function toRequestError(error: unknown, options: TranslationRequestOptions, timeoutSignal: AbortSignal, url: string): LlmRequestError {
  if (error instanceof LlmRequestError) {
    return error
  }

  if (options.signal?.aborted) {
    return new LlmRequestError('canceled', 'The translation was cancelled')
  }

  if (timeoutSignal.aborted) {
    return new LlmRequestError('timeout', `No response within ${options.timeoutMs} ms`)
  }

  return new LlmRequestError('network', `Could not reach ${url}: ${(error as Error).message}`)
}

async function attemptTranslation(options: TranslationRequestOptions, attempt: number): Promise<TranslationResult> {
  const url = `${options.apiBaseUrl.replace(/\/+$/u, '')}/chat/completions`
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }

  // Ollama and other local servers accept a bearer token but do not need one.
  if (options.apiKey && options.apiKey.trim().length > 0) {
    headers.Authorization = `Bearer ${options.apiKey.trim()}`
  }

  const timeoutSignal = AbortSignal.timeout(options.timeoutMs)
  const signal = options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal
  const startedAt = Date.now()

  let response: Response

  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: options.modelName,
        temperature: options.temperature,
        stream: false,
        messages: [
          { role: 'system', content: options.systemPrompt },
          { role: 'user', content: options.text }
        ]
      }),
      signal
    })
  } catch (error) {
    throw toRequestError(error, options, timeoutSignal, url)
  }

  const latencyMs = Date.now() - startedAt
  const bodyText = await response.text()

  if (!response.ok) {
    throw classifyHttpError(response.status, bodyText)
  }

  const payload = parseJsonSafely(bodyText) as ChatCompletionPayload | null
  const content = normalizeMessageContent(payload?.choices?.[0]?.message?.content)

  if (content.length === 0) {
    throw new LlmRequestError('bad-response', 'The provider response did not contain any text', response.status)
  }

  const parsed = parseTranslationContent(content)

  return {
    translatedText: parsed.translatedText,
    detectedLanguage: parsed.detectedLanguage,
    usage: payload?.usage
      ? {
          promptTokens: payload.usage.prompt_tokens ?? null,
          completionTokens: payload.usage.completion_tokens ?? null
        }
      : null,
    latencyMs,
    attempts: attempt
  }
}

/**
 * One translation request, including retries.
 *
 * Retries are limited to codes where retrying can actually help (rate limits,
 * timeouts, 5xx, network) and are skipped entirely once the caller has aborted —
 * for a clipboard translator the newest copy always wins, so burning time on a
 * request nobody is waiting for would be pure waste.
 */
export async function requestTranslation(options: TranslationRequestOptions): Promise<TranslationResult> {
  const maxAttempts = Math.max(1, options.retryCount + 1)
  let lastError: LlmRequestError | null = null

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await attemptTranslation(options, attempt)
    } catch (error) {
      const requestError = error instanceof LlmRequestError ? error : new LlmRequestError('unknown', (error as Error).message)
      lastError = requestError

      if (!requestError.retryable || attempt === maxAttempts || options.signal?.aborted) {
        throw requestError
      }

      await delay(RETRY_BACKOFF_MS[attempt - 1] ?? RETRY_BACKOFF_MS.at(-1) ?? 1_800)
    }
  }

  throw lastError ?? new LlmRequestError('unknown', 'The translation failed')
}

export function toLlmError(error: unknown): LlmError {
  if (error instanceof LlmRequestError) {
    return error.toLlmError()
  }

  return { code: 'unknown', message: (error as Error)?.message ?? 'The translation failed', status: null, retryable: false }
}

/** Cheap connectivity + credential check: lists models without spending tokens. */
export async function checkProviderConnection(options: {
  apiBaseUrl: string
  apiKey: string | null
  timeoutMs: number
}): Promise<void> {
  const url = `${options.apiBaseUrl.replace(/\/+$/u, '')}/models`
  const headers: Record<string, string> = {}

  if (options.apiKey && options.apiKey.trim().length > 0) {
    headers.Authorization = `Bearer ${options.apiKey.trim()}`
  }

  const timeoutSignal = AbortSignal.timeout(options.timeoutMs)

  try {
    const response = await fetch(url, { method: 'GET', headers, signal: timeoutSignal })

    if (!response.ok) {
      throw classifyHttpError(response.status, await response.text())
    }
  } catch (error) {
    if (error instanceof LlmRequestError) {
      throw error
    }

    if (timeoutSignal.aborted) {
      throw new LlmRequestError('timeout', `No response within ${options.timeoutMs} ms`)
    }

    throw new LlmRequestError('network', `Could not reach ${url}: ${(error as Error).message}`)
  }
}
