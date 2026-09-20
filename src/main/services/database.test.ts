import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createFakeLogger } from '../testing/fakeLogger'
import { createDatabaseService, queryAll } from './database'

describe('createDatabaseService', () => {
  let directory: string
  let filePath: string

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'translate-clip-db-'))
    filePath = join(directory, 'data.sqlite')
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('creates the schema and survives a reload', async () => {
    const first = createDatabaseService({ filePath, log: createFakeLogger() })
    await first.load()
    first.getDatabase().run(
      `INSERT INTO translations (id, source_text, source_hash, source_language, target_language, provider_id, model_name,
        status, char_count, created_at, updated_at)
       VALUES ('1', 'hello', 'hash', 'en', 'zh-CN', 'openai', 'gpt', 'done', 5, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`
    )
    await first.flush()

    const second = createDatabaseService({ filePath, log: createFakeLogger() })
    await second.load()

    const rows = queryAll<{ id: string }>(second.getDatabase(), 'SELECT id FROM translations')
    expect(rows).toEqual([{ id: '1' }])
  })

  it('persists writes without an explicit flush', async () => {
    const service = createDatabaseService({ filePath, log: createFakeLogger() })
    await service.load()
    service.getDatabase().run("INSERT INTO translations (id, source_text, source_hash, source_language, target_language, provider_id, model_name, status, char_count, created_at, updated_at) VALUES ('a','x','h','en','zh-CN','openai','m','done',1,'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z')")
    service.schedulePersist()

    // The debounce is 1.5s; give it room without making the suite slow.
    await new Promise((resolve) => setTimeout(resolve, 1_800))

    const raw = await readFile(filePath)
    expect(raw.byteLength).toBeGreaterThan(0)

    const reloaded = createDatabaseService({ filePath, log: createFakeLogger() })
    await reloaded.load()
    expect(queryAll(reloaded.getDatabase(), 'SELECT id FROM translations')).toEqual([{ id: 'a' }])
  })

  it('keeps an unreadable database aside instead of dropping it', async () => {
    await writeFile(filePath, 'this is definitely not a sqlite file', 'utf8')
    const log = createFakeLogger()

    const service = createDatabaseService({ filePath, log })
    await service.load()

    // A fresh, usable database…
    expect(queryAll(service.getDatabase(), 'SELECT name FROM sqlite_master')).not.toHaveLength(0)
    // …and the original file preserved for inspection.
    expect(log.lines.some((line) => line.includes('unreadable'))).toBe(true)
    const files = await import('node:fs/promises').then((fs) => fs.readdir(directory))
    expect(files.some((name) => name.startsWith('data.sqlite.corrupt-'))).toBe(true)
  })

  it('refuses to hand out a database that was never loaded', () => {
    const service = createDatabaseService({ filePath, log: createFakeLogger() })
    expect(() => service.getDatabase()).toThrow(/not been loaded/u)
  })
})
