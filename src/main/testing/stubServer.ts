import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

export interface StubResponse {
  status?: number
  body?: unknown
  /** Send this verbatim instead of serialising `body`. */
  rawBody?: string
  delayMs?: number
}

export interface StubRequest {
  method: string
  url: string
  headers: IncomingMessage['headers']
  body: unknown
}

export interface StubServer {
  baseUrl: string
  requests: StubRequest[]
  /** Appends responses; the last one repeats once the queue is exhausted. */
  enqueue: (...responses: StubResponse[]) => void
  close: () => Promise<void>
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = ''

    request.on('data', (chunk) => {
      data += String(chunk)
    })
    request.on('end', () => resolve(data))
  })
}

/**
 * Minimal OpenAI-compatible stub endpoint.
 *
 * Lets the tests exercise the real HTTP path (headers, status codes, aborts,
 * timeouts, streaming-free JSON) without touching a real provider or needing a
 * credential.
 */
export async function startStubServer(initial: StubResponse = {}): Promise<StubServer> {
  const queue: StubResponse[] = [initial]
  const requests: StubRequest[] = []

  const server: Server = createServer((request, response) => {
    void (async () => {
      const raw = await readBody(request)
      let parsed: unknown = null

      try {
        parsed = raw.length > 0 ? JSON.parse(raw) : null
      } catch {
        parsed = raw
      }

      requests.push({ method: request.method ?? 'GET', url: request.url ?? '/', headers: request.headers, body: parsed })

      const next = queue.length > 1 ? (queue.shift() as StubResponse) : (queue[0] ?? {})
      const send = () => {
        if (response.writableEnded || response.destroyed) {
          return
        }

        const payload = typeof next.rawBody === 'string' ? next.rawBody : JSON.stringify(next.body ?? {})
        response.writeHead(next.status ?? 200, { 'Content-Type': 'application/json' })
        response.end(payload)
      }

      if (next.delayMs && next.delayMs > 0) {
        setTimeout(send, next.delayMs)
        return
      }

      send()
    })()
  })

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })

  const { port } = server.address() as AddressInfo

  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    requests,
    enqueue: (...responses: StubResponse[]) => {
      queue.push(...responses)
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.()
        server.close(() => resolve())
      })
  }
}

/** Convenience wrapper for a chat-completions style payload. */
export function chatResponse(content: string, extra: Record<string, unknown> = {}): StubResponse {
  return {
    status: 200,
    body: {
      choices: [{ message: { role: 'assistant', content } }],
      usage: { prompt_tokens: 12, completion_tokens: 8 },
      ...extra
    }
  }
}
