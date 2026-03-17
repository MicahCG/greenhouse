// Two-proportion z-test for A/B significance
// Uses the complementary error function approximation (no external math lib)

export interface SignificanceResult {
  pValue: number;
  confidence: number;
  relativeLift: number;
  isSignificant: boolean;
  winner: 'control' | 'variant' | 'none';
}

/**
 * Approximation of the complementary error function erfc(x).
 * Accurate to ~7 decimal places.
 */
function erfc(x: number): number {
  // Abramowitz & Stegun formula 7.1.26
  const t = 1.0 / (1.0 + 0.3275911 * Math.abs(x));
  const poly =
    t * (0.254829592 +
      t * (-0.284496736 +
        t * (1.421413741 +
          t * (-1.453152027 +
            t * 1.061405429))));
  const approx = poly * Math.exp(-x * x);
  return x >= 0 ? approx : 2.0 - approx;
}

/**
 * Cumulative standard normal distribution P(Z ≤ z).
 */
function normalCDF(z: number): number {
  return 0.5 * erfc(-z / Math.SQRT2);
}

/**
 * Two-proportion z-test.
 * Returns significance metrics comparing variant to control.
 */
export function calculateSignificance(
  controlVisitors: number,
  controlConversions: number,
  variantVisitors: number,
  variantConversions: number
): SignificanceResult {
  const safe: SignificanceResult = {
    pValue: 1,
    confidence: 0,
    relativeLift: 0,
    isSignificant: false,
    winner: 'none',
  };

  // Guard against degenerate inputs
  if (
    controlVisitors <= 0 ||
    variantVisitors <= 0 ||
    controlConversions < 0 ||
    variantConversions < 0
  ) {
    return safe;
  }

  const pControl = controlConversions / controlVisitors;
  const pVariant = variantConversions / variantVisitors;

  // If both rates are identical (including both zero) there is nothing to test
  if (pControl === pVariant) {
    return { ...safe, relativeLift: 0 };
  }

  // Pooled proportion
  const pPooled =
    (controlConversions + variantConversions) / (controlVisitors + variantVisitors);

  // Guard against pooled rate of 0 or 1 (no variance)
  if (pPooled <= 0 || pPooled >= 1) {
    return safe;
  }

  const se = Math.sqrt(
    pPooled * (1 - pPooled) * (1 / controlVisitors + 1 / variantVisitors)
  );

  if (se === 0) return safe;

  const z = (pVariant - pControl) / se;

  // Two-tailed p-value
  const pValue = 2 * (1 - normalCDF(Math.abs(z)));
  const confidence = 1 - pValue;

  const relativeLift =
    pControl === 0 ? 0 : (pVariant - pControl) / pControl;

  const isSignificant = pValue < 0.05;

  let winner: 'control' | 'variant' | 'none' = 'none';
  if (isSignificant) {
    winner = pVariant > pControl ? 'variant' : 'control';
  }

  return { pValue, confidence, relativeLift, isSignificant, winner };
}

/**
 * Minimum sample size per variant for a given baseline conversion rate.
 * Uses normal approximation: n = (z_α/2 + z_β)² * (p1(1-p1) + p2(1-p2)) / (p1-p2)²
 *
 * @param baselineConversionRate  e.g. 0.05 for 5%
 * @param minimumDetectableEffect absolute difference, e.g. 0.05 = detect a 5pp lift
 * @param alpha                   type-I error rate, default 0.05 (95% confidence)
 * @param power                   statistical power, default 0.8 (80%)
 */
export function calculateMinSampleSize(
  baselineConversionRate: number,
  minimumDetectableEffect = 0.05,
  alpha = 0.05,
  power = 0.8
): number {
  if (
    baselineConversionRate <= 0 ||
    baselineConversionRate >= 1 ||
    minimumDetectableEffect <= 0
  ) {
    return 500; // sensible fallback
  }

  // z-scores for common alpha/power values (two-tailed alpha)
  // Approximated via inverse normal: z = √2 * erfinv(1 - x)
  // For speed, use well-known table values for typical inputs
  const zAlpha = alpha === 0.05 ? 1.96 : alpha === 0.01 ? 2.576 : 1.645;
  const zBeta = power === 0.8 ? 0.8416 : power === 0.9 ? 1.2816 : 0.5244;

  const p1 = baselineConversionRate;
  const p2 = baselineConversionRate + minimumDetectableEffect;
  const clampedP2 = Math.min(p2, 0.9999);

  const numerator =
    Math.pow(zAlpha + zBeta, 2) *
    (p1 * (1 - p1) + clampedP2 * (1 - clampedP2));
  const denominator = Math.pow(clampedP2 - p1, 2);

  return Math.ceil(numerator / denominator);
}

/**
 * Whether the current sample is large enough to draw conclusions.
 */
export function isEnoughData(
  visitors: number,
  minSampleSize: number
): { enough: boolean; percentComplete: number } {
  const percentComplete = minSampleSize > 0
    ? Math.min(100, Math.round((visitors / minSampleSize) * 100))
    : 100;
  return { enough: visitors >= minSampleSize, percentComplete };
}
