import { baseLanguage } from '@shared/constants'
import type { TranslationDirection } from '@shared/types'

export type ScriptFamily =
  | 'han'
  | 'kana'
  | 'hangul'
  | 'cyrillic'
  | 'arabic'
  | 'hebrew'
  | 'devanagari'
  | 'thai'
  | 'latin'
  | 'unknown'

export interface DetectionResult {
  /**
   * BCP-47 tag when a specific language is certain, otherwise the script family
   * (`latin`, `unknown`). Callers display and forward this as "auto".
   */
  language: string
  script: ScriptFamily
  /** Share of the dominant script among counted characters, 0–1. */
  confidence: number
}

export interface DirectionConfig {
  directionMode: 'auto' | 'fixed'
  targetLanguage: string
  fallbackLanguage: string
}

const SCRIPT_RANGES: Array<{ script: ScriptFamily; pattern: RegExp }> = [
  { script: 'kana', pattern: /[\u3040-\u30ff]/u },
  { script: 'hangul', pattern: /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/u },
  { script: 'han', pattern: /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u },
  { script: 'cyrillic', pattern: /[\u0400-\u04ff\u0500-\u052f]/u },
  { script: 'arabic', pattern: /[\u0600-\u06ff\u0750-\u077f]/u },
  { script: 'hebrew', pattern: /[\u0590-\u05ff]/u },
  { script: 'devanagari', pattern: /[\u0900-\u097f]/u },
  { script: 'thai', pattern: /[\u0e00-\u0e7f]/u },
  { script: 'latin', pattern: /[a-z\u00c0-\u024f]/iu }
]

/** Characters that only exist in one of the two Chinese orthographies. */
const ORTHOGRAPHY_PAIRS: Array<[traditional: string, simplified: string]> = [
  ['這', '这'],
  ['學', '学'],
  ['國', '国'],
  ['說', '说'],
  ['時', '时'],
  ['會', '会'],
  ['體', '体'],
  ['發', '发'],
  ['覺', '觉'],
  ['語', '语'],
  ['話', '话'],
  ['與', '与'],
  ['樣', '样'],
  ['來', '来'],
  ['對', '对'],
  ['開', '开'],
  ['關', '关'],
  ['門', '门'],
  ['問', '问'],
  ['題', '题'],
  ['實', '实'],
  ['際', '际'],
  ['當', '当'],
  ['點', '点'],
  ['產', '产'],
  ['們', '们'],
  ['個', '个'],
  ['為', '为'],
  ['條', '条'],
  ['經', '经'],
  ['東', '东'],
  ['車', '车'],
  ['馬', '马'],
  ['鳥', '鸟'],
  ['魚', '鱼'],
  ['龜', '龟'],
  ['麼', '么'],
  ['幾', '几'],
  ['廣', '广'],
  ['應', '应'],
  ['讓', '让'],
  ['認', '认'],
  ['識', '识'],
  ['譯', '译']
]

const TRADITIONAL_MARKERS = new Set(ORTHOGRAPHY_PAIRS.map(([traditional]) => traditional))
const SIMPLIFIED_MARKERS = new Set(ORTHOGRAPHY_PAIRS.map(([, simplified]) => simplified))

function countScript(text: string, pattern: RegExp): number {
  let count = 0

  for (const character of text) {
    if (pattern.test(character)) {
      count += 1
    }
  }

  return count
}

function detectChineseOrthography(text: string): 'zh-TW' | 'zh-CN' {
  let traditional = 0
  let simplified = 0

  for (const character of text) {
    if (TRADITIONAL_MARKERS.has(character)) {
      traditional += 1
    } else if (SIMPLIFIED_MARKERS.has(character)) {
      simplified += 1
    }
  }

  // No marker at all means the text is orthography-neutral (数字、专有名词……),
  // and Simplified is the far more likely intent for this product's audience.
  return traditional > simplified ? 'zh-TW' : 'zh-CN'
}

/**
 * Script-based language detection.
 *
 * Deliberately local, instant and free: it only decides which prompt to send and
 * whether to flip the direction. The model reports the real language back in its
 * response, which is what ends up in the history record, so an approximation here
 * never becomes a wrong "detected language" claim in the UI.
 */
export function detectLanguage(text: string): DetectionResult {
  const trimmed = text.trim()

  if (trimmed.length === 0) {
    return { language: 'unknown', script: 'unknown', confidence: 0 }
  }

  const counts = new Map<ScriptFamily, number>()
  let total = 0

  for (const { script, pattern } of SCRIPT_RANGES) {
    const count = countScript(trimmed, pattern)
    if (count > 0) {
      counts.set(script, count)
      total += count
    }
  }

  if (total === 0) {
    return { language: 'unknown', script: 'unknown', confidence: 0 }
  }

  const dominant = [...counts.entries()].reduce((best, entry) => (entry[1] > best[1] ? entry : best))
  const [script, count] = dominant
  const confidence = count / total

  switch (script) {
    case 'kana':
      return { language: 'ja', script, confidence }
    case 'hangul':
      return { language: 'ko', script, confidence }
    case 'han':
      return { language: detectChineseOrthography(trimmed), script, confidence }
    case 'cyrillic':
      return { language: 'ru', script, confidence }
    case 'arabic':
      return { language: 'ar', script, confidence }
    case 'hebrew':
      return { language: 'he', script, confidence }
    case 'devanagari':
      return { language: 'hi', script, confidence }
    case 'thai':
      return { language: 'th', script, confidence }
    default:
      // Latin script spans dozens of languages; guessing one would be worse than
      // admitting we only know the script.
      return { language: 'latin', script: 'latin', confidence }
  }
}

/**
 * Decides what to translate into.
 *
 * `auto` implements the "just works" behaviour for a clipboard translator: text
 * that is already in the target language is translated into the fallback language
 * instead of being sent back unchanged. `fixed` never flips.
 */
export function resolveDirection(detection: DetectionResult, config: DirectionConfig): TranslationDirection {
  const sourceLanguage = detection.language

  if (config.directionMode === 'fixed') {
    return { sourceLanguage, targetLanguage: config.targetLanguage, reversed: false }
  }

  const targetBase = baseLanguage(config.targetLanguage)
  const detectedBase = baseLanguage(sourceLanguage)
  const alreadyTarget =
    (sourceLanguage !== 'latin' && sourceLanguage !== 'unknown' && detectedBase === targetBase) ||
    // Latin script with an English target is the common "this is already English"
    // case; the model confirms or corrects it in its response.
    (sourceLanguage === 'latin' && targetBase === 'en')

  if (alreadyTarget) {
    return { sourceLanguage, targetLanguage: config.fallbackLanguage, reversed: true }
  }

  return { sourceLanguage, targetLanguage: config.targetLanguage, reversed: false }
}

/** True when the tag is a script family rather than a specific language. */
export function isScriptOnlyTag(tag: string): boolean {
  return tag === 'latin' || tag === 'unknown'
}
