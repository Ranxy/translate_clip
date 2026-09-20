import { APP_LIMITS, baseLanguage } from '@shared/constants'
import type { GlossaryEntry, TranslationDirection } from '@shared/types'

export interface GlossaryMatch {
  source: string
  target: string
}

export interface PromptConfig {
  translationPrompt: string
  glossaryEnabled: boolean
  glossaryMaxTerms: number
  glossary: GlossaryEntry[]
}

const TARGET_PLACEHOLDER_TEST = /\{\{\s*targetLanguage\s*\}\}/iu
const TARGET_PLACEHOLDER = /\{\{\s*targetLanguage\s*\}\}/giu
const SOURCE_PLACEHOLDER = /\{\{\s*sourceLanguage\s*\}\}/giu

/** Renders the user's template, guaranteeing the target language is stated. */
export function renderPromptTemplate(template: string, direction: TranslationDirection): string {
  const trimmed = template.trim()
  const sourceLabel = isScriptOnly(direction.sourceLanguage) ? 'auto-detected' : direction.sourceLanguage
  const hasTargetPlaceholder = TARGET_PLACEHOLDER_TEST.test(trimmed)

  const rendered = trimmed
    .replace(TARGET_PLACEHOLDER, direction.targetLanguage)
    .replace(SOURCE_PLACEHOLDER, sourceLabel)

  if (hasTargetPlaceholder) {
    return rendered
  }

  // A template without the placeholder would leave the model guessing.
  return `${rendered}\n\nTarget language: ${direction.targetLanguage}`
}

/**
 * Finds glossary entries that actually occur in the text.
 *
 * Only entries with a form in the target language are useful, and only the
 * longest matching source variant is reported per entry so the prompt stays
 * unambiguous.
 */
export function matchGlossaryEntries(
  glossary: GlossaryEntry[],
  text: string,
  targetLanguage: string,
  maxTerms: number
): GlossaryMatch[] {
  if (glossary.length === 0 || maxTerms <= 0) {
    return []
  }

  const haystack = text.toLowerCase()
  const targetBase = baseLanguage(targetLanguage)
  const matches: GlossaryMatch[] = []

  for (const entry of glossary) {
    const targetForms = pickTargetForms(entry, targetLanguage, targetBase)

    if (targetForms.length === 0) {
      continue
    }

    let best: string | null = null

    for (const [language, variants] of Object.entries(entry.terms)) {
      if (baseLanguage(language) === targetBase) {
        continue
      }

      for (const variant of variants) {
        const candidate = variant.trim()
        const needle = candidate.toLowerCase()

        if (needle.length === 0 || !haystack.includes(needle)) {
          continue
        }

        if (best === null || candidate.length > best.length) {
          best = candidate
        }
      }
    }

    if (best !== null && best.toLowerCase() !== targetForms[0].toLowerCase()) {
      matches.push({ source: best, target: targetForms[0] })
    }
  }

  matches.sort((left, right) => right.source.length - left.source.length)
  return matches.slice(0, Math.min(maxTerms, APP_LIMITS.glossaryMaxTerms.max))
}

function pickTargetForms(entry: GlossaryEntry, targetLanguage: string, targetBase: string): string[] {
  const exact = entry.terms[targetLanguage]
  if (Array.isArray(exact) && exact.length > 0) {
    return exact
  }

  const matchingKey = Object.keys(entry.terms).find((language) => baseLanguage(language) === targetBase)

  if (!matchingKey) {
    return []
  }

  return entry.terms[matchingKey] ?? []
}

export function buildGlossarySegment(matches: GlossaryMatch[]): string {
  return [
    '## Glossary',
    'The source text contains the terms below. Use exactly the listed form in the target language.',
    ...matches.map((match) => `- \`${match.source}\` → ${match.target}`)
  ].join('\n')
}

/**
 * Assembles the system prompt for one translation.
 *
 * The instruction to answer with JSON lives here rather than in the user's
 * template so the response contract stays stable even if they rewrite the prompt.
 */
export function buildSystemPrompt(config: PromptConfig, direction: TranslationDirection, sourceText: string): string {
  const segments = [renderPromptTemplate(config.translationPrompt, direction)]

  if (config.glossaryEnabled) {
    const matches = matchGlossaryEntries(config.glossary, sourceText, direction.targetLanguage, config.glossaryMaxTerms)
    if (matches.length > 0) {
      segments.push(buildGlossarySegment(matches))
    }
  }

  segments.push(
    [
      'Answer with JSON only, and nothing else, using exactly this shape:',
      '{"detectedLanguage":"<BCP-47 tag of the source text>","translatedText":"<the translation>"}',
      'Do not wrap the JSON in markdown fences and do not add commentary.'
    ].join('\n')
  )

  return segments.join('\n\n')
}

function isScriptOnly(tag: string): boolean {
  return tag === 'latin' || tag === 'unknown'
}
