import { describe, expect, it } from 'vitest'

import { roundToStepPrecision } from './number'

describe('roundToStepPrecision', () => {
  it('rounds whole-number steps the way Math.round does', () => {
    expect(roundToStepPrecision(37.4, 1)).toBe(37)
    expect(roundToStepPrecision(37.6, 1)).toBe(38)
  })

  it('keeps the step\'s decimals instead of collapsing every value onto an integer', () => {
    // The bug this exists for: 0.87 rounded to a whole number is 1, so the overlay
    // opacity could only ever be its maximum.
    expect(roundToStepPrecision(0.87, 0.02)).toBe(0.87)
    expect(roundToStepPrecision(0.8, 0.02)).toBe(0.8)
    expect(roundToStepPrecision(0.224, 0.05)).toBe(0.22)
    expect(roundToStepPrecision(0.226, 0.05)).toBe(0.23)
  })

  it('does not drag a typed value onto the step grid', () => {
    // A 50ms step is what the spinner arrows move by; a poll interval the user typed
    // as 437 is still a valid interval and must survive the round trip.
    expect(roundToStepPrecision(437, 50)).toBe(437)
    expect(roundToStepPrecision(4373, 10)).toBe(4373)
  })

  it('clears float dust rather than storing it', () => {
    expect(roundToStepPrecision(0.1 + 0.2, 0.1)).toBe(0.3)
  })

  it('leaves the value alone when it has no usable step', () => {
    expect(roundToStepPrecision(0.8, 0)).toBe(0.8)
    expect(roundToStepPrecision(0.8, -1)).toBe(0.8)
    expect(roundToStepPrecision(Number.NaN, 0.02)).toBeNaN()
  })
})
