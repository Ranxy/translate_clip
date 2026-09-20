import { randomUUID } from 'node:crypto'

import type { LlmProviderId, LlmProviderProfile, LlmProviderState, SaveLlmProviderProfileInput } from '@shared/types'
import { isLlmProviderId } from '@shared/types'

import type { CredentialStore } from './credentialStore'
import { queryAll, type DatabaseService } from './database'
import { getProviderDefinition, listProviderDefinitions, resolveApiBaseUrl } from './llmProviderCatalog'
import type { Logger } from './logStore'

export interface ResolvedLlmConfig {
  profileId: string
  providerId: LlmProviderId
  apiBaseUrl: string
  modelName: string
  apiKey: string | null
}

interface ProfileRow {
  profile_id: string
  provider_id: string
  api_base_url: string
  model_name: string
  custom_label: string | null
  encrypted_api_key: string | null
  is_selected: number
  created_at: string
  updated_at: string
}

const PROFILE_COLUMNS =
  'profile_id, provider_id, api_base_url, model_name, custom_label, encrypted_api_key, is_selected, created_at, updated_at'

/**
 * Provider profiles: what to call, with which model, and the credential to use.
 *
 * API keys are encrypted through {@link CredentialStore} and never leave the main
 * process — the renderer can only ask to reveal a stored key explicitly, and it
 * never receives one as part of the bootstrap payload.
 */
export class LlmConfigStore {
  constructor(
    private readonly database: DatabaseService,
    private readonly credentials: CredentialStore,
    private readonly log: Logger
  ) {}

  getState(): LlmProviderState {
    const rows = this.getProfileRows()

    return {
      providers: listProviderDefinitions(),
      profiles: rows.map((row) => this.toProfile(row)),
      activeProfileId: rows.find((row) => row.is_selected === 1)?.profile_id ?? null
    }
  }

  /** Everything needed to issue a request, including the decrypted key. */
  getResolvedConfig(): ResolvedLlmConfig | null {
    const row = this.getSelectedRow()

    if (!row) {
      return null
    }

    return {
      profileId: row.profile_id,
      providerId: row.provider_id as LlmProviderId,
      apiBaseUrl: row.api_base_url,
      modelName: row.model_name,
      apiKey: this.credentials.decrypt(row.encrypted_api_key)
    }
  }

  getApiKey(profileId: string): string | null {
    const row = this.getProfileRow(profileId)
    return this.credentials.decrypt(row?.encrypted_api_key ?? null)
  }

  async saveProfile(input: SaveLlmProviderProfileInput): Promise<LlmProviderState> {
    const modelName = input.modelName.trim()

    if (modelName.length === 0) {
      throw new Error('A model name is required.')
    }

    if (!isLlmProviderId(input.providerId)) {
      throw new Error(`Unsupported provider: ${input.providerId}`)
    }

    const definition = getProviderDefinition(input.providerId)
    const current = input.profileId ? this.getProfileRow(input.profileId) : null

    if (input.profileId && !current) {
      throw new Error('The profile being edited no longer exists.')
    }

    const selected = this.getSelectedRow()
    const shouldAutoSelect = selected === null
    const now = new Date().toISOString()
    const encryptedApiKey = this.resolveApiKey(input, current)

    const profileId = current?.profile_id ?? randomUUID()
    const database = this.database.getDatabase()
    const isSelected = shouldAutoSelect ? 1 : (current?.is_selected ?? 0)

    if (shouldAutoSelect) {
      database.run('UPDATE llm_provider_profiles SET is_selected = 0')
    }

    database.run(
      `INSERT INTO llm_provider_profiles (${PROFILE_COLUMNS})
       VALUES ($profileId, $providerId, $apiBaseUrl, $modelName, $customLabel, $encryptedApiKey, $isSelected, $createdAt, $updatedAt)
       ON CONFLICT(profile_id) DO UPDATE SET
         provider_id = excluded.provider_id,
         api_base_url = excluded.api_base_url,
         model_name = excluded.model_name,
         custom_label = excluded.custom_label,
         encrypted_api_key = excluded.encrypted_api_key,
         is_selected = excluded.is_selected,
         updated_at = excluded.updated_at`,
      {
        $profileId: profileId,
        $providerId: input.providerId,
        $apiBaseUrl: resolveApiBaseUrl(input.providerId, input.apiBaseUrl ?? current?.api_base_url ?? definition.defaultApiBaseUrl),
        $modelName: modelName,
        $customLabel:
          typeof input.customLabel === 'string' ? input.customLabel.trim() || null : (current?.custom_label ?? null),
        $encryptedApiKey: encryptedApiKey,
        $isSelected: isSelected,
        $createdAt: current?.created_at ?? now,
        $updatedAt: now
      }
    )

    await this.database.flush()
    this.log.info('provider profile saved', { profileId, providerId: input.providerId, modelName })

    return this.getState()
  }

  async deleteProfile(profileId: string): Promise<LlmProviderState> {
    const current = this.getProfileRow(profileId)

    if (!current) {
      return this.getState()
    }

    const database = this.database.getDatabase()
    database.run('DELETE FROM llm_provider_profiles WHERE profile_id = $profileId', { $profileId: profileId })

    if (current.is_selected === 1) {
      // Never leave the app without an active profile if one is still available.
      database.run(
        `UPDATE llm_provider_profiles SET is_selected = 1
         WHERE profile_id = (
           SELECT profile_id FROM llm_provider_profiles ORDER BY updated_at DESC LIMIT 1
         )`
      )
    }

    await this.database.flush()
    this.log.info('provider profile deleted', { profileId })

    return this.getState()
  }

  async setActiveProfile(profileId: string): Promise<LlmProviderState> {
    if (!this.getProfileRow(profileId)) {
      throw new Error('The profile to activate no longer exists.')
    }

    const database = this.database.getDatabase()
    database.run('UPDATE llm_provider_profiles SET is_selected = 0')
    database.run('UPDATE llm_provider_profiles SET is_selected = 1, updated_at = $updatedAt WHERE profile_id = $profileId', {
      $profileId: profileId,
      $updatedAt: new Date().toISOString()
    })

    await this.database.flush()
    return this.getState()
  }

  private resolveApiKey(input: SaveLlmProviderProfileInput, current: ProfileRow | null): string | null {
    const trimmed = typeof input.apiKey === 'string' ? input.apiKey.trim() : undefined

    if (typeof trimmed !== 'undefined') {
      return trimmed.length > 0 ? this.credentials.encrypt(trimmed) : null
    }

    if (current) {
      return current.encrypted_api_key
    }

    if (input.copyApiKeyFromProfileId) {
      return this.getProfileRow(input.copyApiKeyFromProfileId)?.encrypted_api_key ?? null
    }

    return null
  }

  private toProfile(row: ProfileRow): LlmProviderProfile {
    return {
      profileId: row.profile_id,
      providerId: row.provider_id as LlmProviderId,
      apiBaseUrl: row.api_base_url,
      modelName: row.model_name,
      customLabel: row.custom_label,
      hasApiKey: Boolean(row.encrypted_api_key),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      isActive: row.is_selected === 1
    }
  }

  private getProfileRows(): ProfileRow[] {
    return queryAll<ProfileRow>(
      this.database.getDatabase(),
      `SELECT ${PROFILE_COLUMNS} FROM llm_provider_profiles ORDER BY is_selected DESC, updated_at DESC, created_at DESC`
    )
  }

  private getProfileRow(profileId: string): ProfileRow | null {
    return (
      queryAll<ProfileRow>(this.database.getDatabase(), `SELECT ${PROFILE_COLUMNS} FROM llm_provider_profiles WHERE profile_id = ?`, [
        profileId
      ])[0] ?? null
    )
  }

  private getSelectedRow(): ProfileRow | null {
    return (
      queryAll<ProfileRow>(
        this.database.getDatabase(),
        `SELECT ${PROFILE_COLUMNS} FROM llm_provider_profiles WHERE is_selected = 1 ORDER BY updated_at DESC LIMIT 1`
      )[0] ?? null
    )
  }
}
