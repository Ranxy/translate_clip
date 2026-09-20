import { describe, expect, it } from 'vitest'

import { DEFAULT_TRANSLATION_PROMPT } from '@shared/constants'
import type { GlossaryEntry, TranslationDirection } from '@shared/types'

import { buildSystemPrompt, matchGlossaryEntries, renderPromptTemplate, type PromptConfig } from './promptBuilder'

const directionTo: TranslationDirection = { sourceLanguage: 'latin', targetLanguage: 'zh-CN', reversed: false }

const glossary: GlossaryEntry[] = [
  { id: 'isk', terms: { en: ['ISK', 'InterStellar Kredits'], 'zh-CN': ['星币'] } },
  { id: 'jita', terms: { en: ['Jita'], 'zh-CN': ['吉他'] } },
  { id: 'no-target-form', terms: { en: ['Vexor'] } },
  { id: 'same-both-ways', terms: { en: ['星币'], 'zh-CN': ['星币'] } }
]

function promptConfig(patch: Partial<PromptConfig> = {}): PromptConfig {
  return {
    translationPrompt: DEFAULT_TRANSLATION_PROMPT,
    glossaryEnabled: true,
    glossaryMaxTerms: 30,
    glossary,
    ...patch
  }
}

describe('renderPromptTemplate', () => {
  it('substitutes the target and source placeholders', () => {
    const rendered = renderPromptTemplate('Translate {{sourceLanguage}} into {{targetLanguage}}.', {
      ...directionTo,
      sourceLanguage: 'en-US'
    })

    expect(rendered).toBe('Translate en-US into zh-CN.')
  })

  it('appends the target language when the template has no placeholder', () => {
    expect(renderPromptTemplate('Translate everything.', directionTo)).toBe('Translate everything.\n\nTarget language: zh-CN')
  })

  it('describes script-only sources as auto-detected', () => {
    const rendered = renderPromptTemplate('From {{sourceLanguage}} into {{targetLanguage}}', { ...directionTo, sourceLanguage: 'latin' })

    expect(rendered).toBe('From auto-detected into zh-CN')
  })
})

describe('matchGlossaryEntries', () => {
  it('matches source variants and returns the target form', () => {
    const matches = matchGlossaryEntries(glossary, 'Bought in Jita for 100 ISK.', 'zh-CN', 10)

    expect(matches).toEqual([
      { source: 'Jita', target: '吉他' },
      { source: 'ISK', target: '星币' }
    ])
  })

  it('ignores entries without a form in the target language', () => {
    const matches = matchGlossaryEntries(glossary, 'Flying a Vexor today', 'zh-CN', 10)

    expect(matches).toEqual([])
  })

  it('does not report a term that is identical in both languages', () => {
    expect(matchGlossaryEntries(glossary, '我买了星币', 'zh-CN', 10)).toEqual([])
  })

  it('prefers the longest matching variant of an entry', () => {
    const entries: GlossaryEntry[] = [{ id: 'eve', terms: { en: ['EVE', 'EVE Online'], 'zh-CN': ['EVE 在线'] } }]
    const matches = matchGlossaryEntries(entries, 'EVE Online is a sandbox', 'zh-CN', 10)

    expect(matches).toEqual([{ source: 'EVE Online', target: 'EVE 在线' }])
  })

  it('caps the number of injected terms', () => {
    const matches = matchGlossaryEntries(glossary, 'Jita and ISK', 'zh-CN', 1)

    expect(matches).toHaveLength(1)
    expect(matches[0].source).toBe('Jita')
  })

  it('matches case-insensitively', () => {
    const matches = matchGlossaryEntries(glossary, 'i trade in jita', 'zh-CN', 10)

    expect(matches).toEqual([{ source: 'Jita', target: '吉他' }])
  })
})

describe('buildSystemPrompt', () => {
  it('states the JSON response contract', () => {
    const prompt = buildSystemPrompt(promptConfig(), directionTo, 'Hello')

    expect(prompt).toContain('"detectedLanguage"')
    expect(prompt).toContain('"translatedText"')
    expect(prompt).toContain('zh-CN')
  })

  it('injects matched glossary terms', () => {
    const prompt = buildSystemPrompt(promptConfig(), directionTo, 'Bought in Jita for ISK')

    expect(prompt).toContain('## Glossary')
    expect(prompt).toContain('`Jita` → 吉他')
  })

  it('omits the glossary when the feature is disabled', () => {
    const prompt = buildSystemPrompt(promptConfig({ glossaryEnabled: false }), directionTo, 'Bought in Jita for ISK')

    expect(prompt).not.toContain('## Glossary')
  })

  it('omits the glossary when nothing matches', () => {
    const prompt = buildSystemPrompt(promptConfig(), directionTo, 'Nothing relevant here')

    expect(prompt).not.toContain('## Glossary')
  })
})
