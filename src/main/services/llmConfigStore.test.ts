import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createFakeLogger } from '../testing/fakeLogger'
import type { CredentialStore } from './credentialStore'
import { createDatabaseService, type DatabaseService } from './database'
import { LlmConfigStore } from './llmConfigStore'

/** Deterministic stand-in for safeStorage: base64 with the plaintext marker. */
const credentials: CredentialStore = {
  isEncryptionAvailable: () => false,
  encrypt: (value) => `v0:${Buffer.from(value, 'utf8').toString('base64')}`,
  decrypt: (stored) => (stored ? Buffer.from(stored.replace(/^v0:/u, ''), 'base64').toString('utf8') : null)
}

describe('LlmConfigStore', () => {
  let directory: string
  let database: DatabaseService
  let store: LlmConfigStore

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'translate-clip-llm-'))
    database = createDatabaseService({ filePath: join(directory, 'data.sqlite'), log: createFakeLogger() })
    await database.load()
    store = new LlmConfigStore(database, credentials, createFakeLogger())
  })

  afterEach(async () => {
    await database.close()
    await rm(directory, { recursive: true, force: true })
  })

  it('starts with the provider catalogue and no profiles', () => {
    const state = store.getState()

    expect(state.profiles).toEqual([])
    expect(state.activeProfileId).toBeNull()
    expect(state.providers.map((provider) => provider.providerId)).toEqual([
      'openai',
      'deepseek',
      'openrouter',
      'ollama',
      'custom'
    ])
  })

  it('rejects a profile without a model name', async () => {
    await expect(store.saveProfile({ providerId: 'deepseek', modelName: '   ' })).rejects.toThrow(/model name/u)
  })

  it('auto-selects the first profile and resolves its defaults', async () => {
    const state = await store.saveProfile({ providerId: 'deepseek', modelName: 'deepseek-chat', apiKey: 'sk-test' })
    const profile = state.profiles[0]

    expect(state.activeProfileId).toBe(profile.profileId)
    expect(profile.apiBaseUrl).toBe('https://api.deepseek.com')
    expect(profile.hasApiKey).toBe(true)
    expect(JSON.stringify(profile)).not.toContain('sk-test')

    expect(store.getResolvedConfig()).toEqual({
      profileId: profile.profileId,
      providerId: 'deepseek',
      apiBaseUrl: 'https://api.deepseek.com',
      modelName: 'deepseek-chat',
      apiKey: 'sk-test'
    })
  })

  it('keeps the stored key when an update does not mention one', async () => {
    const first = await store.saveProfile({ providerId: 'openai', modelName: 'gpt-4o-mini', apiKey: 'sk-keep' })
    const profileId = first.profiles[0].profileId

    await store.saveProfile({ profileId, providerId: 'openai', modelName: 'gpt-4o' })

    expect(store.getApiKey(profileId)).toBe('sk-keep')
    expect(store.getState().profiles[0].modelName).toBe('gpt-4o')
  })

  it('clears the key when an empty one is supplied explicitly', async () => {
    const first = await store.saveProfile({ providerId: 'openai', modelName: 'gpt-4o-mini', apiKey: 'sk-clear' })
    const profileId = first.profiles[0].profileId

    await store.saveProfile({ profileId, providerId: 'openai', modelName: 'gpt-4o-mini', apiKey: '' })

    expect(store.getApiKey(profileId)).toBeNull()
    expect(store.getState().profiles[0].hasApiKey).toBe(false)
  })

  it('lets a local provider be configured without a key', async () => {
    const state = await store.saveProfile({ providerId: 'ollama', modelName: 'qwen2.5:7b' })

    expect(state.profiles[0].apiBaseUrl).toBe('http://127.0.0.1:11434/v1')
    expect(state.profiles[0].hasApiKey).toBe(false)
    expect(store.getResolvedConfig()?.apiKey).toBeNull()
  })

  it('switches the active profile', async () => {
    await store.saveProfile({ providerId: 'openai', modelName: 'gpt-4o-mini' })
    const second = await store.saveProfile({ providerId: 'deepseek', modelName: 'deepseek-chat' })
    const secondId = second.profiles.find((profile) => profile.providerId === 'deepseek')?.profileId as string

    const state = await store.setActiveProfile(secondId)

    expect(state.activeProfileId).toBe(secondId)
    expect(state.profiles.filter((profile) => profile.isActive)).toHaveLength(1)
  })

  it('promotes another profile when the active one is deleted', async () => {
    const first = await store.saveProfile({ providerId: 'openai', modelName: 'gpt-4o-mini' })
    const firstId = first.profiles[0].profileId
    await store.saveProfile({ providerId: 'deepseek', modelName: 'deepseek-chat' })

    const state = await store.deleteProfile(firstId)

    expect(state.profiles).toHaveLength(1)
    expect(state.profiles[0].providerId).toBe('deepseek')
    expect(state.activeProfileId).toBe(state.profiles[0].profileId)
  })

  it('rejects activating a profile that does not exist', async () => {
    await expect(store.setActiveProfile('missing')).rejects.toThrow(/no longer exists/u)
  })

  it('survives a reload from disk', async () => {
    await store.saveProfile({ providerId: 'openrouter', modelName: 'openai/gpt-4o-mini', apiKey: 'sk-openrouter' })

    const reopened = createDatabaseService({ filePath: join(directory, 'data.sqlite'), log: createFakeLogger() })
    await reopened.load()
    const reloaded = new LlmConfigStore(reopened, credentials, createFakeLogger())

    expect(reloaded.getResolvedConfig()).toMatchObject({ providerId: 'openrouter', modelName: 'openai/gpt-4o-mini' })
    expect(reloaded.getResolvedConfig()?.apiKey).toBe('sk-openrouter')
    await reopened.close()
  })
})
