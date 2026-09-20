import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { APP_LIMITS, DEFAULT_CONFIG } from '@shared/constants'

import { ConfigStore, sanitizeConfig } from './configStore'

describe('sanitizeConfig', () => {
  it('returns the shipped defaults for an empty object', () => {
    expect(sanitizeConfig({})).toEqual(DEFAULT_CONFIG)
  })

  it('returns the defaults for values that are not objects at all', () => {
    expect(sanitizeConfig(null)).toEqual(DEFAULT_CONFIG)
    expect(sanitizeConfig('nonsense')).toEqual(DEFAULT_CONFIG)
  })

  it('clamps numeric settings into their supported range', () => {
    const config = sanitizeConfig({
      pollIntervalMs: 5,
      maxSourceChars: 10_000_000,
      historyLimit: -3,
      temperature: 9
    })

    expect(config.pollIntervalMs).toBe(APP_LIMITS.pollIntervalMs.min)
    expect(config.maxSourceChars).toBe(APP_LIMITS.maxSourceChars.max)
    expect(config.historyLimit).toBe(APP_LIMITS.historyLimit.min)
    expect(config.temperature).toBe(APP_LIMITS.temperature.max)
  })

  it('replaces unsupported enum values with defaults', () => {
    const config = sanitizeConfig({ theme: 'neon', directionMode: 'sideways', uiLanguage: 'fr', logLevel: 'verbose' })

    expect(config.theme).toBe(DEFAULT_CONFIG.theme)
    expect(config.directionMode).toBe(DEFAULT_CONFIG.directionMode)
    expect(config.uiLanguage).toBe(DEFAULT_CONFIG.uiLanguage)
    expect(config.logLevel).toBe(DEFAULT_CONFIG.logLevel)
  })

  it('keeps unknown but well-formed language tags', () => {
    const config = sanitizeConfig({ targetLanguage: 'pl-PL', fallbackLanguage: '  ' })

    expect(config.targetLanguage).toBe('pl-PL')
    expect(config.fallbackLanguage).toBe(DEFAULT_CONFIG.fallbackLanguage)
  })

  it('drops unusable ignore patterns while keeping valid ones', () => {
    const warnings: string[] = []
    const config = sanitizeConfig(
      { ignorePatterns: ['[', '^https?://\\S+$', 42, '^https?://\\S+$', ''] },
      (message) => warnings.push(message)
    )

    expect(config.ignorePatterns).toEqual(['^https?://\\S+$'])
    expect(warnings.some((message) => message.includes('invalid ignore pattern'))).toBe(true)
  })

  it('never lets the maximum length fall below the minimum', () => {
    const config = sanitizeConfig({ minSourceChars: 100, maxSourceChars: 50 })

    expect(config.minSourceChars).toBe(APP_LIMITS.minSourceChars.max)
    expect(config.maxSourceChars).toBeGreaterThan(config.minSourceChars)
  })

  it('leaves both global shortcuts unregistered by default', () => {
    expect(sanitizeConfig({}).shortcuts).toEqual({ toggleOverlay: null, translateClipboard: null })
    expect(sanitizeConfig({ shortcuts: { toggleOverlay: null, translateClipboard: 'Control+Alt+C' } }).shortcuts).toEqual({
      toggleOverlay: null,
      translateClipboard: 'Control+Alt+C'
    })
  })

  it('sanitises glossary entries', () => {
    const config = sanitizeConfig({
      glossary: [
        { id: '  eve  ', notes: ' game ', terms: { 'zh-CN': [' 星战前夜 ', ''], en: 'EVE Online' } },
        { id: '', terms: { en: ['dropped'] } },
        { id: 'empty', terms: {} }
      ]
    })

    expect(config.glossary).toEqual([
      {
        id: 'eve',
        notes: 'game',
        terms: { 'zh-CN': ['星战前夜'], en: ['EVE Online'] }
      }
    ])
  })

  it('fills in missing overlay fields from a partial patch', () => {
    const config = sanitizeConfig({ overlay: { opacity: 0.8 } })

    expect(config.overlay.opacity).toBe(0.8)
    expect(config.overlay.width).toBe(DEFAULT_CONFIG.overlay.width)
    expect(config.overlay.clickThrough).toBe(false)
  })
})

describe('ConfigStore', () => {
  let directory: string
  let filePath: string

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'translate-clip-config-'))
    filePath = join(directory, 'config.json')
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('starts from defaults when the file does not exist', async () => {
    const store = new ConfigStore(filePath)

    expect(await store.load()).toEqual(DEFAULT_CONFIG)
  })

  it('persists an update and reads it back', async () => {
    const store = new ConfigStore(filePath)
    await store.load()

    await store.update({ targetLanguage: 'ja-JP', overlay: { ...DEFAULT_CONFIG.overlay, opacity: 0.75 } })

    const reloaded = new ConfigStore(filePath)
    const config = await reloaded.load()

    expect(config.targetLanguage).toBe('ja-JP')
    expect(config.overlay.opacity).toBe(0.75)
  })

  it('falls back to defaults when the file is corrupt', async () => {
    await writeFile(filePath, '{ this is not json', 'utf8')

    const store = new ConfigStore(filePath)

    expect(await store.load()).toEqual(DEFAULT_CONFIG)
  })

  it('deep-merges nested patches instead of replacing the whole object', async () => {
    const store = new ConfigStore(filePath)
    await store.load()

    const config = await store.update({ overlay: { ...DEFAULT_CONFIG.overlay, fontSize: 18 } })

    expect(config.overlay.fontSize).toBe(18)
    expect(config.overlay.width).toBe(DEFAULT_CONFIG.overlay.width)
    expect(config.overlay.opaque).toBe(DEFAULT_CONFIG.overlay.opaque)
  })

  it('does not leak internal state through getConfig', async () => {
    const store = new ConfigStore(filePath)
    await store.load()

    const first = store.getConfig()
    first.targetLanguage = 'mutated'
    first.overlay.width = 999

    expect(store.getConfig().targetLanguage).toBe(DEFAULT_CONFIG.targetLanguage)
    expect(store.getConfig().overlay.width).toBe(DEFAULT_CONFIG.overlay.width)
  })
})
