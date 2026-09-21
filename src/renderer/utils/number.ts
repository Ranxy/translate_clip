/**
 * Rounds a value to the precision a control's step is expressed in.
 *
 * Rounding to a whole number is only correct while the step is 1. The overlay opacity steps by
 * 0.02, so every value in its 0.6–1 range used to collapse onto 1 (or onto 0.6 once clamped):
 * the field looked editable and silently did nothing. The grid itself is deliberately left alone
 * — a step is what the spinner arrows move by, and rewriting a typed 437 into 450 because the
 * step is 50 would be a surprise of its own — so only the decimals are honoured, and 437 stays
 * 437 while 0.87 stays 0.87 instead of becoming 1.
 */
export function roundToStepPrecision(value: number, step: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(step) || step <= 0) {
    return value
  }

  const factor = 10 ** stepDecimals(step)
  return Math.round(value * factor) / factor
}

/**
 * Decimal places a step is expressed in: 1 → 0, 0.1 → 1, 0.02 → 2.
 *
 * Found by round-tripping rather than by string inspection, so a step written in exponential
 * notation (`1e-7`) or carrying float dust still lands on the shortest faithful precision.
 */
function stepDecimals(step: number): number {
  for (let decimals = 0; decimals <= 12; decimals += 1) {
    if (Number(step.toFixed(decimals)) === step) {
      return decimals
    }
  }

  return 12
}
