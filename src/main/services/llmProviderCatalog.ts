import { LLM_PROVIDER_DEFINITIONS } from '@shared/constants'
import type { LlmProviderDefinition, LlmProviderId, LlmProviderState } from '@shared/types'

export function listProviderDefinitions(): LlmProviderDefinition[] {
  return LLM_PROVIDER_DEFINITIONS.map((definition) => ({ ...definition }))
}

export function getProviderDefinition(providerId: LlmProviderId): LlmProviderDefinition {
  const definition = LLM_PROVIDER_DEFINITIONS.find((entry) => entry.providerId === providerId)

  if (!definition) {
    throw new Error(`Unsupported provider: ${providerId}`)
  }

  return { ...definition }
}

/** Resolves the effective base URL for a provider, without a trailing slash. */
export function resolveApiBaseUrl(providerId: LlmProviderId, apiBaseUrl: string | null | undefined): string {
  const definition = getProviderDefinition(providerId)
  const base = (apiBaseUrl?.trim() || definition.defaultApiBaseUrl).trim()
  return base.replace(/\/+$/u, '')
}

/**
 * Provider state before the profile store is wired up (phase 1 fills in the
 * profiles and the active profile from the sql.js store).
 */
export function createEmptyProviderState(): LlmProviderState {
  return {
    providers: listProviderDefinitions(),
    profiles: [],
    activeProfileId: null
  }
}
