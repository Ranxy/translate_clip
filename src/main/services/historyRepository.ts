import { randomUUID } from 'node:crypto'

import type {
  HistoryPage,
  HistoryQuery,
  LlmErrorCode,
  LlmProviderId,
  TranslationRecord,
  TranslationStatus
} from '@shared/types'

import { queryAll, type DatabaseService } from './database'
import type { Logger } from './logStore'

const COLUMNS = [
  'id',
  'source_text',
  'source_hash',
  'translated_text',
  'detected_language',
  'source_language',
  'target_language',
  'provider_id',
  'model_name',
  'status',
  'error_code',
  'error_message',
  'cached',
  'pinned',
  'char_count',
  'latency_ms',
  'created_at',
  'updated_at'
].join(', ')

const DEFAULT_PAGE_SIZE = 30
const MAX_PAGE_SIZE = 200

interface TranslationRow {
  id: string
  source_text: string
  source_hash: string
  translated_text: string | null
  detected_language: string | null
  source_language: string
  target_language: string
  provider_id: string
  model_name: string
  status: string
  error_code: string | null
  error_message: string | null
  cached: number
  pinned: number
  char_count: number
  latency_ms: number | null
  created_at: string
  updated_at: string
}

export interface PendingTranslation {
  sourceText: string
  sourceHash: string
  sourceLanguage: string
  targetLanguage: string
  providerId: LlmProviderId
  modelName: string
  charCount: number
}

export interface TranslationCompletion {
  translatedText: string
  detectedLanguage: string | null
  latencyMs: number
  cached: boolean
}

function toRecord(row: TranslationRow): TranslationRecord {
  return {
    id: row.id,
    sourceText: row.source_text,
    sourceHash: row.source_hash,
    translatedText: row.translated_text,
    detectedLanguage: row.detected_language,
    sourceLanguage: row.source_language,
    targetLanguage: row.target_language,
    providerId: row.provider_id as LlmProviderId,
    modelName: row.model_name,
    status: row.status as TranslationStatus,
    errorCode: row.error_code as LlmErrorCode | null,
    errorMessage: row.error_message,
    cached: row.cached === 1,
    pinned: row.pinned === 1,
    charCount: row.char_count,
    latencyMs: row.latency_ms,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

/**
 * Translation history and the "same text again" cache.
 *
 * A row is written as `translating` before the request goes out so the overlay
 * always has something to show and a crash leaves a visible trace rather than a
 * silent gap. Superseded jobs are deleted instead of being recorded as failures.
 */
export class HistoryRepository {
  constructor(
    private readonly database: DatabaseService,
    private readonly log: Logger
  ) {}

  insertPending(input: PendingTranslation): string {
    const id = randomUUID()
    const now = new Date().toISOString()

    this.database.getDatabase().run(
      `INSERT INTO translations (${COLUMNS})
       VALUES ($id, $sourceText, $sourceHash, NULL, NULL, $sourceLanguage, $targetLanguage, $providerId, $modelName,
               'translating', NULL, NULL, 0, 0, $charCount, NULL, $createdAt, $updatedAt)`,
      {
        $id: id,
        $sourceText: input.sourceText,
        $sourceHash: input.sourceHash,
        $sourceLanguage: input.sourceLanguage,
        $targetLanguage: input.targetLanguage,
        $providerId: input.providerId,
        $modelName: input.modelName,
        $charCount: input.charCount,
        $createdAt: now,
        $updatedAt: now
      }
    )

    this.database.schedulePersist()
    return id
  }

  markCompleted(id: string, completion: TranslationCompletion): void {
    this.database.getDatabase().run(
      `UPDATE translations
       SET translated_text = $translatedText,
           detected_language = $detectedLanguage,
           status = 'done',
           cached = $cached,
           latency_ms = $latencyMs,
           error_code = NULL,
           error_message = NULL,
           updated_at = $updatedAt
       WHERE id = $id`,
      {
        $id: id,
        $translatedText: completion.translatedText,
        $detectedLanguage: completion.detectedLanguage,
        $cached: completion.cached ? 1 : 0,
        $latencyMs: Math.round(completion.latencyMs),
        $updatedAt: new Date().toISOString()
      }
    )

    this.database.schedulePersist()
  }

  markFailed(id: string, code: LlmErrorCode, message: string): void {
    this.database.getDatabase().run(
      `UPDATE translations
       SET status = 'error', error_code = $code, error_message = $message, updated_at = $updatedAt
       WHERE id = $id`,
      { $id: id, $code: code, $message: message, $updatedAt: new Date().toISOString() }
    )

    this.database.schedulePersist()
  }

  /** Most recent successful translation of identical text, if it is still fresh. */
  findCached(sourceHash: string, targetLanguage: string, maxAgeMs: number): TranslationRecord | null {
    const oldest = new Date(Date.now() - maxAgeMs).toISOString()

    const row = queryAll<TranslationRow>(
      this.database.getDatabase(),
      `SELECT ${COLUMNS} FROM translations
       WHERE source_hash = ? AND target_language = ? AND status = 'done'
         AND translated_text IS NOT NULL AND created_at >= ?
       ORDER BY created_at DESC LIMIT 1`,
      [sourceHash, targetLanguage, oldest]
    )[0]

    return row ? toRecord(row) : null
  }

  getById(id: string): TranslationRecord | null {
    const row = queryAll<TranslationRow>(
      this.database.getDatabase(),
      `SELECT ${COLUMNS} FROM translations WHERE id = ?`,
      [id]
    )[0]

    return row ? toRecord(row) : null
  }

  list(query: HistoryQuery = {}): HistoryPage {
    const limit = Math.min(Math.max(query.limit ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE)
    const conditions: string[] = []
    const params: Array<string | number> = []

    const search = query.query?.trim()
    if (search) {
      conditions.push('(source_text LIKE ? OR translated_text LIKE ?)')
      const like = `%${search}%`
      params.push(like, like)
    }

    if (query.onlyPinned) {
      conditions.push('pinned = 1')
    }

    if (query.cursor) {
      conditions.push('created_at < ?')
      params.push(query.cursor)
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    // One extra row tells us whether another page exists without a count query.
    const rows = queryAll<TranslationRow>(
      this.database.getDatabase(),
      `SELECT ${COLUMNS} FROM translations ${where} ORDER BY created_at DESC, id DESC LIMIT ?`,
      [...params, limit + 1]
    )

    const hasMore = rows.length > limit
    const items = rows.slice(0, limit).map(toRecord)

    return {
      items,
      hasMore,
      nextCursor: hasMore ? (items.at(-1)?.createdAt ?? null) : null
    }
  }

  togglePin(id: string): void {
    this.database
      .getDatabase()
      .run('UPDATE translations SET pinned = CASE pinned WHEN 1 THEN 0 ELSE 1 END, updated_at = $updatedAt WHERE id = $id', {
        $id: id,
        $updatedAt: new Date().toISOString()
      })

    this.database.schedulePersist()
  }

  remove(id: string): void {
    this.database.getDatabase().run('DELETE FROM translations WHERE id = $id', { $id: id })
    this.database.schedulePersist()
  }

  clear(keepPinned: boolean): number {
    const database = this.database.getDatabase()
    database.run(keepPinned ? 'DELETE FROM translations WHERE pinned = 0' : 'DELETE FROM translations')
    const removed = database.getRowsModified()
    this.database.schedulePersist()

    return removed
  }

  /**
   * Keeps the newest `limit` rows and every pinned row.
   *
   * Without this the sql.js export (and therefore every persist) would grow
   * without bound.
   */
  prune(limit: number): number {
    const database = this.database.getDatabase()
    database.run(
      `DELETE FROM translations
       WHERE pinned = 0 AND id NOT IN (SELECT id FROM translations ORDER BY created_at DESC LIMIT ?)`,
      [limit]
    )

    const removed = database.getRowsModified()

    if (removed > 0) {
      this.log.debug(`pruned ${removed} history entries`)
      this.database.schedulePersist()
    }

    return removed
  }
}
