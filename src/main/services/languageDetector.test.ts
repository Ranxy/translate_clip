import { describe, expect, it } from 'vitest'

import { detectLanguage, isScriptOnlyTag, resolveDirection, type DirectionConfig } from './languageDetector'

const config: DirectionConfig = {
  directionMode: 'auto',
  targetLanguage: 'zh-CN',
  fallbackLanguage: 'en-US'
}

describe('detectLanguage', () => {
  it('detects simplified Chinese', () => {
    const result = detectLanguage('这是一段简体中文文本')

    expect(result.language).toBe('zh-CN')
    expect(result.script).toBe('han')
  })

  it('detects traditional Chinese', () => {
    expect(detectLanguage('這是繁體中文').language).toBe('zh-TW')
  })

  it('prefers Japanese when kana is present, even alongside kanji', () => {
    expect(detectLanguage('これは日本語のテストです').language).toBe('ja')
  })

  it('detects Korean', () => {
    expect(detectLanguage('안녕하세요 반갑습니다').language).toBe('ko')
  })

  it('detects Russian', () => {
    expect(detectLanguage('Привет мир').language).toBe('ru')
  })

  it('only claims the script for latin text', () => {
    const result = detectLanguage('Hello there, friend')

    expect(result.script).toBe('latin')
    expect(result.language).toBe('latin')
    expect(isScriptOnlyTag(result.language)).toBe(true)
  })

  it('returns unknown for empty and symbol-only input', () => {
    expect(detectLanguage('   ').language).toBe('unknown')
    expect(detectLanguage('123 !!! ...').language).toBe('unknown')
  })

  it('picks the dominant script in mixed text', () => {
    expect(detectLanguage('Hello world, this is mostly English 你好').script).toBe('latin')
    expect(detectLanguage('这是一段很长的中文内容 with one word').script).toBe('han')
  })

  it('reports confidence as the share of the dominant script', () => {
    const result = detectLanguage('這是繁體中文')

    expect(result.confidence).toBeGreaterThan(0.9)
    expect(result.confidence).toBeLessThanOrEqual(1)
  })
})

describe('resolveDirection', () => {
  it('translates non-target text into the configured target', () => {
    expect(resolveDirection(detectLanguage('Hello there'), config)).toEqual({
      sourceLanguage: 'latin',
      targetLanguage: 'zh-CN',
      reversed: false
    })
  })

  it('flips to the fallback language when the text is already in the target', () => {
    const direction = resolveDirection(detectLanguage('这是一段中文'), config)

    expect(direction.targetLanguage).toBe('en-US')
    expect(direction.reversed).toBe(true)
  })

  it('flips latin text when the target language is English', () => {
    const direction = resolveDirection(detectLanguage('Hello there'), { ...config, targetLanguage: 'en-US', fallbackLanguage: 'zh-CN' })

    expect(direction.targetLanguage).toBe('zh-CN')
    expect(direction.reversed).toBe(true)
  })

  it('keeps the target for Japanese text with a Chinese target', () => {
    const direction = resolveDirection(detectLanguage('これはテストです'), config)

    expect(direction.targetLanguage).toBe('zh-CN')
    expect(direction.reversed).toBe(false)
  })

  it('never flips in fixed mode', () => {
    const direction = resolveDirection(detectLanguage('这是一段中文'), { ...config, directionMode: 'fixed' })

    expect(direction.targetLanguage).toBe('zh-CN')
    expect(direction.reversed).toBe(false)
  })

  it('treats a script-only detection as "not the target" for non-English targets', () => {
    expect(resolveDirection(detectLanguage('Hello there'), { ...config, targetLanguage: 'ja-JP' }).reversed).toBe(false)
  })
})
