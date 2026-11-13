import { DUELS } from '@candle/shared';
import {
  computeRiskMetrics,
  decideSprintWinner,
  type SprintOutcome,
  type SprintRiskMetrics,
} from './sprint-scoring';

/**
 * Crisis scoring — docs/15 §5 (pure, no I/O).
 *
 * The Crisis Duel reuses the sprint risk-adjusted score as its base
 * (same R, V, D from the same minute-sampled equity curve), with ONE
 * explicit adjustment — the loss branch divides instead of
 * multiplying:
 *
 *   score = R / (1 + V + D)   when R ≥ 0   (identical to the sprint)
 *   score = R / (1 + V + D)   when R < 0   (the sprint multiplies here)
 *
 * ## Why the adjustment is needed (proved, not assumed)
 * In a sprint a large drawdown signals reckless trading, so the
 * multiplicative loss branch is the right punishment. In a crisis
 * duel the crash imposes a ~12% drawdown on EVERY invested player —
 * even a calm holder who does everything right. With the sprint
 * formula a typical calm holder scores R × (1 + V + D) ≈ −5.14 ×
 * (1 + 7.58 + 12) ≈ −105.8, and a panic seller scores ≈ −10.24 ×
 * (1 + 6.75 + 12) ≈ −202.3: BOTH clamp to −100 (SPRINT_SCORE_CLAMP)
 * and tie on score, so the duel's whole point — calm beats panic —
 * survives only on the return tie-break. Dividing for losses too
 * keeps every crisis score in sprint range and orders players by
 * (return, risk) instead of saturating the clamp. Gains are
 * untouched: a positive crisis score is exactly a sprint score.
 *
 * ## The two required properties (worked examples, pinned in tests)
 * Curves are 16-point minute-sampled equities (start ₹100,000;
 * pre-crash drift to ₹102,000 by minute 6; crash minutes 7–9 to
 * 0.88×; recovery minutes 10–14 to 0.93× — see crisis-crash.ts):
 *
 *   Cash-early: sold to cash at minute 6, R=+2.00, V=0.64, D=0.00
 *     → 2.00 / 1.64 = +1.2195 — BEATS the holder (−0.2498). (a) ✓
 *   Calm holder: held through, R=−5.14, V=7.58, D=12.00
 *     → −5.14 / 20.58 = −0.2498
 *   Panic seller: sold everything at the bottom (minute 9),
 *     R=−10.24, V=6.75, D=12.00 → −10.24 / 19.75 = −0.5185 —
 *     LOSES to the calm holder (−0.2498). (b) ✓ The panic seller
 *     locks the full −12% and misses the +5% recovery; the return
 *     gap, not a penalty term, decides it.
 *   Half-cash holder: half invested, R=−2.53, V=3.69, D=6.00
 *     → −2.53 / 10.69 = −0.2366 — beats the all-in holder
 *     (−0.2498): less pre-crash risk, smaller crash loss. ✓
 *
 * The panic-sell flag (crisis-crash.ts `computePanicSold`) is stored
 * on the result and shown on the result screen, but it is NOT a score
 * term — adding one would double-count the missed recovery. Winner:
 * higher crisis score; scores within SPRINT_SCORE_TIE_EPSILON tie on
 * score and the higher return wins; equal on both is a draw (same
 * tie-break as the sprint, so a no-trade crisis (0 vs 0) is a draw).
 */

/** The crisis score for one (return, volatility, drawdown) triple. */
export function crisisScoreFor(
  returnPct: number,
  realisedVolPct: number,
  maxDrawdownPct: number
): number {
  const v = Math.max(0, realisedVolPct);
  const d = Math.max(0, maxDrawdownPct);
  const factor = 1 + v + d;
  const raw = returnPct / factor;
  const clamp = DUELS.SPRINT_SCORE_CLAMP;
  return Math.round(Math.max(-clamp, Math.min(clamp, raw)) * 10000) / 10000;
}

/**
 * Full crisis risk metrics from an equity curve (start cash + minute
 * samples + the final sample, in order). R, V and D are the sprint's
 * `computeRiskMetrics` values; only the deciding score differs
 * (symmetric division — see above).
 */
export function computeCrisisMetrics(equityCurve: number[], startCash: number): SprintRiskMetrics {
  const base = computeRiskMetrics(equityCurve, startCash);
  return {
    ...base,
    riskAdjustedScore: crisisScoreFor(base.returnPct, base.realisedVolPct, base.maxDrawdownPct),
  };
}

/** Winner from the first side's perspective — the sprint tie-break, unchanged. */
export function decideCrisisWinner(
  a: { riskAdjustedScore: number; returnPct: number },
  b: { riskAdjustedScore: number; returnPct: number }
): SprintOutcome {
  return decideSprintWinner(a, b);
}
