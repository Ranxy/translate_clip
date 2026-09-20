import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'

import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js'

import type { Logger } from './logStore'

const require = createRequire(import.meta.url)

const PERSIST_DEBOUNCE_MS = 1_500
const PERSIST_MAX_WAIT_MS = 5_000

const SCHEMA = `
CREATE TABLE IF NOT EXISTS llm_provider_profiles (
  profile_id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  api_base_url TEXT NOT NULL,
  model_name TEXT NOT NULL,
  custom_label TEXT,
  encrypted_api_key TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  is_selected INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS translations (
  id TEXT PRIMARY KEY,
  source_text TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  translated_text TEXT,
  detected_language TEXT,
  source_language TEXT NOT NULL,
  target_language TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  model_name TEXT NOT NULL,
  status TEXT NOT NULL,
  error_code TEXT,
  error_message TEXT,
  cached INTEGER NOT NULL DEFAULT 0,
  pinned INTEGER NOT NULL DEFAULT 0,
  char_count INTEGER NOT NULL,
  latency_ms INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_translations_created_at ON translations (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_translations_hash ON translations (source_hash, target_language);
`

export type SqlValue = string | number | null | Uint8Array

export interface DatabaseService {
  load: () => Promise<void>
  getDatabase: () => Database
  /** Marks the database dirty; the write is merged with any others in flight. */
  schedulePersist: () => void
  /** Writes immediately and waits for it to hit the disk. */
  flush: () => Promise<void>
  close: () => Promise<void>
  getFilePath: () => string
}

export function queryAll<T>(database: Database, sql: string, params: SqlValue[] = []): T[] {
  const statement = database.prepare(sql)
  const rows: T[] = []

  try {
    if (params.length > 0) {
      statement.bind(params)
    }

    while (statement.step()) {
      rows.push(statement.getAsObject() as T)
    }
  } finally {
    statement.free()
  }

  return rows
}

export function queryOne<T>(database: Database, sql: string, params: SqlValue[] = []): T | null {
  return queryAll<T>(database, sql, params)[0] ?? null
}

/**
 * Owns the single sql.js database.
 *
 * sql.js keeps everything in memory and persists by exporting the whole file, so
 * exactly one component may own the handle and the file: two writers would
 * silently clobber each other. The repositories below take this service rather
 * than opening the file themselves.
 *
 * Writes are coalesced (a translation writes twice: pending, then completed) with
 * a debounce plus a hard maximum wait, and flushed to disk through a temporary
 * file so a crash cannot leave a truncated database behind.
 */
export function createDatabaseService(options: { filePath: string; log: Logger }): DatabaseService {
  let sqlite: SqlJsStatic | null = null
  let database: Database | null = null
  let debounceTimer: NodeJS.Timeout | null = null
  let maxWaitTimer: NodeJS.Timeout | null = null
  let writing: Promise<void> = Promise.resolve()

  const persist = async (): Promise<void> => {
    if (!database) {
      return
    }

    const bytes = database.export()
    const temporaryPath = `${options.filePath}.tmp`

    try {
      await mkdir(dirname(options.filePath), { recursive: true })
      await writeFile(temporaryPath, bytes)
      await rename(temporaryPath, options.filePath)
    } catch (error) {
      options.log.error('failed to persist the database', error)
      throw error
    }
  }

  const clearTimers = () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }

    if (maxWaitTimer) {
      clearTimeout(maxWaitTimer)
      maxWaitTimer = null
    }
  }

  const flush = (): Promise<void> => {
    clearTimers()
    // Serialise writes so two flushes can never interleave on the same file.
    writing = writing.then(persist, persist)
    return writing
  }

  return {
    load: async () => {
      if (database) {
        return
      }

      sqlite ??= await initSqlJs({ locateFile: (fileName) => require.resolve(`sql.js/dist/${fileName}`) })

      let existing: Uint8Array | null = null

      try {
        existing = new Uint8Array(await readFile(options.filePath))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          options.log.warn('could not read the database file, starting fresh', error)
        }
      }

      const openFreshDatabase = () => {
        database = new sqlite!.Database()
        database.exec(SCHEMA)
      }

      if (existing) {
        try {
          database = new sqlite.Database(existing)
          // A corrupt file is not detected by the constructor — it surfaces on the
          // first statement, so the schema has to be part of the probe.
          database.exec(SCHEMA)
        } catch (error) {
          // Never silently drop data: keep the unreadable file for inspection.
          const backupPath = `${options.filePath}.corrupt-${Date.now()}`
          options.log.error(`database is unreadable, moving it to ${backupPath}`, error)
          database?.close()
          database = null
          await rename(options.filePath, backupPath).catch(() => undefined)
          openFreshDatabase()
        }
      } else {
        openFreshDatabase()
      }
    },

    getDatabase: () => {
      if (!database) {
        throw new Error('The database has not been loaded yet')
      }

      return database
    },

    schedulePersist: () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer)
      }

      debounceTimer = setTimeout(() => {
        void flush().catch(() => undefined)
      }, PERSIST_DEBOUNCE_MS)

      // Guarantees a bound on how much work a crash can cost, no matter how
      // frequently writes arrive.
      maxWaitTimer ??= setTimeout(() => {
        void flush().catch(() => undefined)
      }, PERSIST_MAX_WAIT_MS)
    },

    flush,

    close: async () => {
      await flush()
      database?.close()
      database = null
    },

    getFilePath: () => options.filePath
  }
}
