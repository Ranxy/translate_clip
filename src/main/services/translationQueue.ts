import type { AppConfig, TranslationDirection, TranslationState } from '@shared/types'

import type { HistoryRepository } from './historyRepository'
import { requestTranslation, toLlmError, type TranslationResult } from './llmClient'
import type { ResolvedLlmConfig } from './llmConfigStore'
import type { Logger } from './logStore'

export interface TranslationJob {
  text: string
  hash: string
  direction: TranslationDirection
}

export interface TranslationQueueOptions {
  log: Logger
  getConfig: () => AppConfig
  getActiveConfig: () => ResolvedLlmConfig | null
  history: HistoryRepository
  buildSystemPrompt: (direction: TranslationDirection, text: string) => string
  onState: (state: TranslationState) => void
}

/**
 * Runs translations with "latest wins" semantics.
 *
 * A clipboard translator has no queue: nobody wants the translation of what they
 * copied three copies ago. A new job aborts the request in flight and replaces it,
 * so there is at most one request running and nothing waiting behind it.
 */
export class TranslationQueue {
  private controller: AbortController | null = null
  private lastJob: TranslationJob | null = null

  constructor(private readonly options: TranslationQueueOptions) {}

  isBusy(): boolean {
    return this.controller !== null
  }

  getLastJob(): TranslationJob | null {
    return this.lastJob ? { ...this.lastJob } : null
  }

  submit(job: TranslationJob): void {
    this.abortInFlight()
    this.lastJob = job

    const config = this.options.getActiveConfig()

    if (!config) {
      this.options.onState(this.buildState({ phase: 'unconfigured', job }))
      return
    }

    const controller = new AbortController()
    this.controller = controller
    void this.run(job, config, controller, false)
  }

  /** Re-runs the last job, bypassing the cache. */
  retranslate(): void {
    const job = this.lastJob

    if (!job) {
      return
    }

    this.abortInFlight()
    const config = this.options.getActiveConfig()

    if (!config) {
      this.options.onState(this.buildState({ phase: 'unconfigured', job }))
      return
    }

    const controller = new AbortController()
    this.controller = controller
    void this.run(job, config, controller, true)
  }

  /** User-initiated stop; unlike superseding, this is reported to the UI. */
  cancel(): void {
    if (!this.controller) {
      return
    }

    const job = this.lastJob
    this.abortInFlight()

    if (job) {
      this.options.onState(this.buildState({ phase: 'canceled', job }))
    }
  }

  dispose(): void {
    this.abortInFlight()
  }

  private abortInFlight(): void {
    this.controller?.abort()
    this.controller = null
  }

  private async run(job: TranslationJob, config: ResolvedLlmConfig, controller: AbortController, skipCache: boolean): Promise<void> {
    const appConfig = this.options.getConfig()

    if (!skipCache && appConfig.translationCacheEnabled) {
      const cached = this.options.history.findCached(job.hash, job.direction.targetLanguage, appConfig.cacheTtlHours * 3_600_000)

      if (cached?.translatedText) {
        this.controller = null
        this.options.onState(
          this.buildState({
            phase: 'done',
            job,
            config,
            translatedText: cached.translatedText,
            direction: { ...job.direction, sourceLanguage: cached.detectedLanguage ?? job.direction.sourceLanguage },
            latencyMs: 0,
            cached: true
          })
        )
        return
      }
    }

    const historyId = this.options.history.insertPending({
      sourceText: job.text,
      sourceHash: job.hash,
      sourceLanguage: job.direction.sourceLanguage,
      targetLanguage: job.direction.targetLanguage,
      providerId: config.providerId,
      modelName: config.modelName,
      charCount: job.text.length
    })

    this.options.onState(this.buildState({ phase: 'translating', job, config, historyId }))

    let result: TranslationResult

    try {
      result = await requestTranslation({
        apiBaseUrl: config.apiBaseUrl,
        modelName: config.modelName,
        apiKey: config.apiKey,
        systemPrompt: this.options.buildSystemPrompt(job.direction, job.text),
        text: job.text,
        temperature: appConfig.temperature,
        timeoutMs: appConfig.requestTimeoutMs,
        retryCount: appConfig.retryCount,
        signal: controller.signal
      })
    } catch (error) {
      if (controller.signal.aborted) {
        // Superseded by a newer copy: drop the row instead of recording noise.
        this.options.history.remove(historyId)
        return
      }

      const llmError = toLlmError(error)
      this.options.history.markFailed(historyId, llmError.code, llmError.message)
      this.controller = null
      this.options.log.warn('translation failed', { code: llmError.code, message: llmError.message })
      this.options.onState(this.buildState({ phase: 'error', job, config, historyId, error: llmError }))
      return
    }

    const direction: TranslationDirection = result.detectedLanguage
      ? { ...job.direction, sourceLanguage: result.detectedLanguage }
      : job.direction

    this.options.history.markCompleted(historyId, {
      translatedText: result.translatedText,
      detectedLanguage: result.detectedLanguage,
      latencyMs: result.latencyMs,
      cached: false
    })

    this.options.history.prune(appConfig.historyLimit)
    this.controller = null
    this.options.log.info('translation completed', {
      chars: job.text.length,
      latencyMs: result.latencyMs,
      attempts: result.attempts,
      target: direction.targetLanguage
    })
    this.options.onState(
      this.buildState({
        phase: 'done',
        job,
        config,
        direction,
        historyId,
        translatedText: result.translatedText,
        latencyMs: result.latencyMs,
        cached: false
      })
    )
  }

  private buildState(input: {
    phase: TranslationState['phase']
    job: TranslationJob
    config?: ResolvedLlmConfig
    direction?: TranslationDirection
    translatedText?: string
    historyId?: string
    error?: TranslationState['error']
    latencyMs?: number
    cached?: boolean
  }): TranslationState {
    return {
      phase: input.phase,
      sourceText: input.job.text,
      translatedText: input.translatedText ?? null,
      direction: input.direction ?? input.job.direction,
      providerId: input.config?.providerId ?? null,
      modelName: input.config?.modelName ?? null,
      historyId: input.historyId ?? null,
      error: input.error ?? null,
      skipReason: null,
      latencyMs: input.latencyMs ?? null,
      cached: input.cached ?? false
    }
  }
}
