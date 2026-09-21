import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type {
  LlmConnectionTestResult,
  LlmProviderId,
  LlmProviderModel,
  LlmProviderProfile,
  LlmProviderState,
  SaveLlmProviderProfileInput
} from '@shared/types'

import { useAppState, useAppStore } from '../../store/appStore'
import { cn } from '../../utils/cn'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Card, CardHeader, Divider } from '../ui/Card'
import { Field } from '../ui/Field'
import { IconExternal, IconRefresh } from '../ui/Icon'
import { TextInput } from '../ui/Input'

interface FormState {
  profileId: string | null
  apiBaseUrl: string
  modelName: string
  customLabel: string
  apiKey: string
  revealStoredKey: boolean
}

function createFormState(profile: LlmProviderProfile | null, providerId: LlmProviderId, providers: LlmProviderState['providers']): FormState {
  const definition = providers.find((entry) => entry.providerId === providerId)

  return {
    profileId: profile?.profileId ?? null,
    apiBaseUrl: profile?.apiBaseUrl ?? definition?.defaultApiBaseUrl ?? '',
    modelName: profile?.modelName ?? '',
    customLabel: profile?.customLabel ?? '',
    apiKey: '',
    revealStoredKey: false
  }
}

/**
 * Provider configuration.
 *
 * Self-contained: it talks to the main process through the preload bridge only, so
 * the settings window and the first-run wizard render the exact same component and
 * there is a single place where credentials are entered.
 */
export function ProvidersPage() {
  const { t } = useTranslation()
  const store = useAppStore()
  const { llmProviderState, capabilities } = useAppState().bootstrap
  const { providers, profiles, activeProfileId } = llmProviderState

  const activeProfile = profiles.find((profile) => profile.profileId === activeProfileId) ?? null

  const [providerId, setProviderId] = useState<LlmProviderId>(activeProfile?.providerId ?? providers[0]?.providerId ?? 'openai')
  const [form, setForm] = useState<FormState>(() => createFormState(activeProfile, providerId, providers))
  const [models, setModels] = useState<LlmProviderModel[]>([])
  const [modelFilter, setModelFilter] = useState('')
  const [fetchingModels, setFetchingModels] = useState(false)
  const [testing, setTesting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [testResult, setTestResult] = useState<LlmConnectionTestResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const definition = providers.find((entry) => entry.providerId === providerId) ?? providers[0]
  const providerProfiles = useMemo(() => profiles.filter((profile) => profile.providerId === providerId), [profiles, providerId])
  const editingProfile = profiles.find((profile) => profile.profileId === form.profileId) ?? null

  // Switching provider shows that provider's active profile (or a blank form).
  useEffect(() => {
    const nextProfile = providerProfiles.find((profile) => profile.profileId === activeProfileId) ?? providerProfiles[0] ?? null
    setForm(createFormState(nextProfile, providerId, providers))
    setModels([])
    setModelFilter('')
    setTestResult(null)
    setError(null)
    // Intentionally keyed on the provider only: re-running on every profile change
    // would wipe the form while the user is typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerId])

  const filteredModels = useMemo(() => {
    const needle = modelFilter.trim().toLowerCase()
    return needle.length === 0 ? models : models.filter((model) => model.modelId.toLowerCase().includes(needle))
  }, [models, modelFilter])

  const apiKeyNeeded = definition?.requiresApiKey ?? true
  const hasStoredKey = Boolean(editingProfile?.hasApiKey)

  const describeError = (result: LlmConnectionTestResult): string => {
    const code = result.error?.code ?? 'unknown'
    const localized = t(`settings.providers.errors.${code}`, { defaultValue: '' })
    return localized.length > 0 ? localized : (result.error?.message ?? t('settings.providers.errors.unknown'))
  }

  const runTest = async () => {
    setTesting(true)
    setTestResult(null)
    setError(null)

    try {
      setTestResult(
        await window.translateClip.testLlmConnection({
          providerId,
          profileId: form.profileId ?? undefined,
          apiKey: form.apiKey.trim().length > 0 ? form.apiKey.trim() : undefined,
          apiBaseUrl: form.apiBaseUrl.trim() || undefined,
          modelName: form.modelName.trim()
        })
      )
    } catch (testError) {
      setError((testError as Error).message)
    } finally {
      setTesting(false)
    }
  }

  const fetchModels = async () => {
    setFetchingModels(true)
    setError(null)

    try {
      setModels(
        await window.translateClip.fetchLlmProviderModels({
          providerId,
          profileId: form.profileId ?? undefined,
          apiKey: form.apiKey.trim().length > 0 ? form.apiKey.trim() : undefined,
          apiBaseUrl: form.apiBaseUrl.trim() || undefined
        })
      )
    } catch (fetchError) {
      setModels([])
      setError((fetchError as Error).message)
    } finally {
      setFetchingModels(false)
    }
  }

  const revealStoredKey = async () => {
    if (!form.profileId) {
      return
    }

    const key = await window.translateClip.getLlmApiKey(form.profileId)
    setForm((current) => ({ ...current, apiKey: key ?? '', revealStoredKey: true }))
  }

  const save = async () => {
    setBusy(true)
    setError(null)

    const input: SaveLlmProviderProfileInput = {
      profileId: form.profileId ?? undefined,
      providerId,
      modelName: form.modelName.trim(),
      apiBaseUrl: form.apiBaseUrl.trim(),
      customLabel: form.customLabel.trim() || undefined,
      // An untouched field keeps the stored key; an emptied one clears it.
      apiKey: form.apiKey.trim().length > 0 ? form.apiKey.trim() : hasStoredKey && !form.revealStoredKey ? undefined : form.apiKey
    }

    try {
      store.applyBootstrap(await window.translateClip.saveLlmProviderProfile(input))
    } catch (saveError) {
      setError((saveError as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const useProfile = async (profile: LlmProviderProfile) => {
    setError(null)

    try {
      store.applyBootstrap(await window.translateClip.setActiveLlmProviderProfile(profile.profileId))
      setProviderId(profile.providerId)
      setForm(createFormState(profile, profile.providerId, providers))
    } catch (activateError) {
      setError((activateError as Error).message)
    }
  }

  const editProfile = (profile: LlmProviderProfile) => {
    setForm(createFormState(profile, providerId, providers))
    setTestResult(null)
    setError(null)
  }

  const removeProfile = async (profile: LlmProviderProfile) => {
    if (!window.confirm(t('settings.providers.deleteConfirm'))) {
      return
    }

    setError(null)

    try {
      store.applyBootstrap(await window.translateClip.deleteLlmProviderProfile(profile.profileId))

      if (form.profileId === profile.profileId) {
        setForm(createFormState(null, providerId, providers))
      }
    } catch (removeError) {
      setError((removeError as Error).message)
    }
  }

  return (
    <>
      <Card>
        <CardHeader title={t('settings.tabs.providers')} description={t('settings.providers.description')} />

        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          {providers.map((provider) => {
            const count = profiles.filter((profile) => profile.providerId === provider.providerId).length
            const isActiveProvider = activeProfile?.providerId === provider.providerId

            return (
              <button
                key={provider.providerId}
                type="button"
                onClick={() => setProviderId(provider.providerId)}
                className={cn(
                  'flex flex-col gap-0.5 rounded-lg border px-2.5 py-2 text-left transition-colors',
                  providerId === provider.providerId
                    ? 'border-accent bg-accent-soft'
                    : 'border-border bg-surface-sunken hover:bg-surface-hover'
                )}
              >
                <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-text">
                  {provider.label}
                  {isActiveProvider ? <span className="h-1.5 w-1.5 rounded-full bg-ok" /> : null}
                </span>
                <span className="text-[11px] text-muted">
                  {count > 0 ? t('settings.providers.editing') : t('settings.providers.none')}
                </span>
              </button>
            )
          })}
        </div>

        {definition?.docsUrl ? (
          <Button
            size="sm"
            variant="ghost"
            className="mt-3"
            onClick={() => void window.translateClip.openExternal(definition.docsUrl as string)}
          >
            <IconExternal />
            {t('settings.providers.docs')}
          </Button>
        ) : null}
      </Card>

      {providerProfiles.length > 0 ? (
        <Card>
          <CardHeader title={t('settings.providers.active')} />
          <ul className="flex flex-col gap-1.5">
            {providerProfiles.map((profile) => (
              <li
                key={profile.profileId}
                className={cn(
                  'flex items-center gap-2 rounded-lg border px-2.5 py-2',
                  profile.profileId === form.profileId ? 'border-accent bg-accent-soft' : 'border-border bg-surface-sunken'
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-[12.5px] font-medium text-text">
                      {profile.customLabel ?? profile.modelName}
                    </span>
                    {profile.profileId === activeProfileId ? <Badge tone="ok">{t('settings.providers.active')}</Badge> : null}
                  </span>
                  <span className="mt-0.5 block truncate font-mono text-[11px] text-muted">
                    {profile.modelName} · {profile.apiBaseUrl}
                  </span>
                </span>

                <Button size="sm" variant="ghost" onClick={() => editProfile(profile)}>
                  {t('settings.providers.editing')}
                </Button>
                {profile.profileId === activeProfileId ? null : (
                  <Button size="sm" onClick={() => void useProfile(profile)}>
                    {t('settings.providers.use')}
                  </Button>
                )}
                <Button size="sm" variant="danger" onClick={() => void removeProfile(profile)}>
                  {t('settings.providers.delete')}
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title={form.profileId ? t('settings.providers.editing') : t('settings.providers.newProfile')}
          description={providerProfiles.length === 0 ? t('settings.providers.noProfiles') : undefined}
        />

        <Field label={t('settings.providers.model')} stacked htmlFor="provider-model">
          <div className="flex items-center gap-2">
            <TextInput
              id="provider-model"
              value={form.modelName}
              placeholder={t('settings.providers.modelPlaceholder')}
              spellCheck={false}
              onChange={(event) => setForm((current) => ({ ...current, modelName: event.target.value }))}
            />
            <Button size="sm" onClick={() => void fetchModels()} disabled={fetchingModels}>
              <IconRefresh />
              {fetchingModels ? t('settings.providers.fetching') : t('settings.providers.fetchModels')}
            </Button>
          </div>

          {models.length > 0 ? (
            <div className="mt-2 rounded-lg border border-border bg-surface-sunken p-2">
              <TextInput
                className="mb-2"
                value={modelFilter}
                placeholder={t('settings.providers.filterModels')}
                spellCheck={false}
                onChange={(event) => setModelFilter(event.target.value)}
              />
              <div className="max-h-40 overflow-y-auto">
                {filteredModels.slice(0, 200).map((model) => (
                  <button
                    key={model.modelId}
                    type="button"
                    onClick={() => setForm((current) => ({ ...current, modelName: model.modelId }))}
                    className={cn(
                      'block w-full truncate rounded px-2 py-1 text-left font-mono text-[11.5px] transition-colors',
                      model.modelId === form.modelName ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-surface-hover hover:text-text'
                    )}
                  >
                    {model.modelId}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </Field>

        <Field label={t('settings.providers.baseUrl')} stacked htmlFor="provider-base-url">
          <TextInput
            id="provider-base-url"
            value={form.apiBaseUrl}
            placeholder={t('settings.providers.baseUrlPlaceholder')}
            spellCheck={false}
            onChange={(event) => setForm((current) => ({ ...current, apiBaseUrl: event.target.value }))}
          />
        </Field>

        {apiKeyNeeded ? (
          <Field label={t('settings.providers.apiKey')} stacked htmlFor="provider-api-key">
            <div className="flex items-center gap-2">
              <TextInput
                id="provider-api-key"
                type={form.revealStoredKey ? 'text' : 'password'}
                value={form.apiKey}
                placeholder={hasStoredKey && !form.revealStoredKey ? t('settings.providers.apiKeyStored') : t('settings.providers.apiKeyPlaceholder')}
                spellCheck={false}
                autoComplete="off"
                onChange={(event) => setForm((current) => ({ ...current, apiKey: event.target.value }))}
              />
              {hasStoredKey ? (
                form.revealStoredKey ? (
                  <Button
                    size="sm"
                    onClick={() => setForm((current) => ({ ...current, apiKey: '', revealStoredKey: false }))}
                  >
                    {t('settings.providers.hideKey')}
                  </Button>
                ) : (
                  <Button size="sm" onClick={() => void revealStoredKey()}>
                    {t('settings.providers.revealKey')}
                  </Button>
                )
              ) : null}
            </div>
            {!capabilities.keyring ? <p className="mt-1.5 text-[11.5px] text-warn">{t('settings.about.keyringMissingHint')}</p> : null}
          </Field>
        ) : (
          <p className="py-2 text-[12px] text-muted">{t('settings.providers.apiKeyLocal')}</p>
        )}

        <Field label={t('settings.providers.label')} stacked hint={t('settings.providers.labelHint')} htmlFor="provider-label">
          <TextInput
            id="provider-label"
            value={form.customLabel}
            placeholder={t('settings.providers.labelPlaceholder')}
            onChange={(event) => setForm((current) => ({ ...current, customLabel: event.target.value }))}
          />
        </Field>

        <Divider />

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" size="sm" disabled={busy || form.modelName.trim().length === 0} onClick={() => void save()}>
            {busy ? t('settings.providers.saving') : t('settings.providers.save')}
          </Button>
          <Button size="sm" disabled={testing} onClick={() => void runTest()}>
            {testing ? t('settings.providers.testing') : t('settings.providers.test')}
          </Button>
          <span className="flex-1" />
          {testResult ? (
            testResult.ok ? (
              <Badge tone="ok">{t('settings.providers.testOk', { ms: testResult.latencyMs ?? 0 })}</Badge>
            ) : (
              <Badge tone="danger">{`${t('settings.providers.testFailed')}: ${describeError(testResult)}`}</Badge>
            )
          ) : null}
        </div>

        <p className="mt-2 text-[11.5px] leading-relaxed text-faint">{t('settings.providers.testHint')}</p>

        {error ? <p className="mt-2 text-[12px] leading-relaxed text-danger">{error}</p> : null}
        {store.isProviderConfigured ? null : <p className="mt-2 text-[12px] text-warn">{t('settings.providers.errors.unconfigured')}</p>}
      </Card>
    </>
  )
}
