import { LLM_PROVIDER_DEFINITIONS } from '@shared/constants'
import type { LlmProviderDefinition, LlmProviderId, LlmProviderModel, LlmProviderState } from '@shared/types'

import { classifyHttpError, LlmRequestError } from './llmClient'

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

/** Ranks the models a user is most likely to want first. */
function getModelRank(modelId: string): number {
  if (/^gpt-4\.1/u.test(modelId)) return 0
  if (/^gpt-4o/u.test(modelId)) return 1
  if (/^gpt-4/u.test(modelId)) return 2
  if (/^deepseek-chat/u.test(modelId)) return 0
  if (/^deepseek-reasoner/u.test(modelId)) return 1
  if (/^deepseek/u.test(modelId)) return 2
  if (/^qwen/u.test(modelId)) return 3
  if (/^llama/u.test(modelId)) return 4
  return 10
}

/**
 * Lists the models an OpenAI-compatible endpoint exposes.
 *
 * Doubles as the connectivity check used by the settings page: it validates the
 * base URL and the credential without spending tokens, and works for every
 * provider we ship including a local Ollama.
 */
export async function fetchProviderModels(input: {
  apiBaseUrl: string
  apiKey: string | null
  timeoutMs?: number
}): Promise<LlmProviderModel[]> {
  const url = `${input.apiBaseUrl.replace(/\/+$/u, '')}/models`
  const headers: Record<string, string> = {}

  if (input.apiKey && input.apiKey.trim().length > 0) {
    headers.Authorization = `Bearer ${input.apiKey.trim()}`
  }

  const timeoutSignal = AbortSignal.timeout(input.timeoutMs ?? 15_000)

  try {
    const response = await fetch(url, { method: 'GET', headers, signal: timeoutSignal })

    if (!response.ok) {
      throw classifyHttpError(response.status, await response.text())
    }

    const payload = (await response.json()) as { data?: Array<{ id?: string; owned_by?: string }> }
    const models = (payload.data ?? [])
      .map((entry) => {
        const modelId = entry.id?.trim() ?? ''
        return modelId.length > 0 ? { modelId, label: modelId, ownedBy: entry.owned_by?.trim() || null } : null
      })
      .filter((entry): entry is LlmProviderModel => entry !== null)

    if (models.length === 0) {
      throw new LlmRequestError('bad-response', 'The provider did not return any models')
    }

    return models.sort((left, right) => getModelRank(left.modelId) - getModelRank(right.modelId) || left.modelId.localeCompare(right.modelId))
  } catch (error) {
    if (error instanceof LlmRequestError) {
      throw error
    }

    if (timeoutSignal.aborted) {
      throw new LlmRequestError('timeout', `No response from ${url} within the timeout`)
    }

    throw new LlmRequestError('network', `Could not reach ${url}: ${(error as Error).message}`)
  }
}
