import { DUELS } from '@candle/shared';

/**
 * Sprint scoring — docs/14 §3 (pure, no I/O).
 *
 * A Paper Trading Sprint is won on RISK-ADJUSTED return, not on the
 * highest return. The score is computed from the player's equity curve
 * (minute-sampled portfolio values, start cash + one sample per minute
 * + the final sample at settlement):
 *
 *   R = returnPct = (finalEquity − startCash) / startCash × 100
 *   V = realisedVolPct = stdev(per-minute simple returns, %) × √(n)
 *       (population stdev — the whole sprint is observed; the √n factor
 *       scales 1-minute volatility to the sprint horizon, so V is in
 *       the same "% over the sprint" units as R and D)
 *   D = maxDrawdownPct = largest peak-to-trough fall of the curve, %
 *
 *   score = R / (1 + V + D)   when R ≥ 0   (risk divides the gain)
 *   score = R × (1 + V + D)   when R < 0   (risk multiplies the loss)
 *
 * The asymmetry is deliberate: a player who gains 3% by swinging wildly
 * scores less than a player who gains 2% steadily — and a player who
 * LOSES 2% by swinging wildly scores worse than one who loses 2%
 * calmly. Risk can never turn a loss into a smaller loss, and it can
 * never turn a wild gain into a bigger score. The score is clamped to
 * ±100 (DUELS.SPRINT_SCORE_CLAMP).
 *
 * Why not Sharpe-style (R / V)? Two reasons. First, a Sharpe ratio
 * explodes when V → 0 (a player who never trades would score infinity
 * if they gained a rupee on a price drift) — the "+1" in the divisor
 * keeps a no-trade sprint at exactly 0. Second, max drawdown is what
 * a beginner actually feels ("how far did I fall?"), so it belongs in
 * the number, not just in the risk panel.
 *
 * No leverage, no shorting in v1 (ADR 0011 §3): both would let a
 * player multiply R and V together and game the divisor, and shorting
 * needs borrow mechanics the sprint does not have.
 */

export type SprintOutcome = 'WIN' | 'DRAW' | 'LOSS';

export interface SprintRiskMetrics {
  /** (finalEquity − startCash) / startCash × 100. */
  returnPct: number;
  /** Sprint-horizon realised volatility, in %. */
  realisedVolPct: number;
  /** Largest peak-to-trough fall of the equity curve, in %. */
  maxDrawdownPct: number;
  /** The deciding number, clamped to ±100. */
  riskAdjustedScore: number;
}

/** Round to 4 decimal places (stored metrics stay stable and readable). */
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/**
 * The risk-adjusted score for one (return, volatility, drawdown) triple.
 * Gains are divided by (1 + V + D); losses are multiplied by (1 + V + D).
 * Worked examples (pinned in unit tests):
 * - R=+2.0, V=1.0, D=0.5 → 2.0 / 2.5 = 0.8
 * - R=+3.0, V=4.0, D=2.0 → 3.0 / 7.0 ≈ 0.4286 (wild winner loses to the steady one)
 * - R=−2.0, V=1.0, D=1.0 → −2.0 × 3.0 = −6.0 (risky loser scores worse)
 * - R=−2.0, V=0, D=0 → −2.0 (a calm loss stays a calm loss)
 * - R=0 → 0, whatever V and D are (no gain, no score)
 * - R=+200 → 100 (clamped); R=−200 → −100 (clamped)
 */
export function riskAdjustedScoreFor(
  returnPct: number,
  realisedVolPct: number,
  maxDrawdownPct: number
): number {
  const v = Math.max(0, realisedVolPct);
  const d = Math.max(0, maxDrawdownPct);
  const factor = 1 + v + d;
  const raw = returnPct >= 0 ? returnPct / factor : returnPct * factor;
  const clamp = DUELS.SPRINT_SCORE_CLAMP;
  return round4(Math.max(-clamp, Math.min(clamp, raw)));
}

/**
 * Full risk metrics from an equity curve (start cash + minute samples +
 * final sample, in order). The curve must contain at least the starting
 * equity; a one-point curve means "never moved" (R from that point, V=0,
 * D=0). A no-trade sprint has a flat curve: R=0, V=0, D=0, score 0.
 */
export function computeRiskMetrics(equityCurve: number[], startCash: number): SprintRiskMetrics {
  if (equityCurve.length === 0 || startCash <= 0) {
    return { returnPct: 0, realisedVolPct: 0, maxDrawdownPct: 0, riskAdjustedScore: 0 };
  }
  const first = equityCurve[0] as number;
  const last = equityCurve[equityCurve.length - 1] as number;
  const returnPct = ((last - startCash) / startCash) * 100;

  // Per-sample simple returns, in %.
  const returns: number[] = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const prev = equityCurve[i - 1] as number;
    const cur = equityCurve[i] as number;
    if (prev > 0) returns.push(((cur - prev) / prev) * 100);
  }
  let realisedVolPct = 0;
  if (returns.length > 0) {
    const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
    const variance = returns.reduce((s, r) => s + (r - mean) * (r - mean), 0) / returns.length;
    realisedVolPct = Math.sqrt(variance) * Math.sqrt(returns.length);
  }

  // Max peak-to-trough drawdown, in %.
  let maxDrawdownPct = 0;
  let peak = first;
  for (const equity of equityCurve) {
    if (equity > peak) peak = equity;
    if (peak > 0) maxDrawdownPct = Math.max(maxDrawdownPct, ((peak - equity) / peak) * 100);
  }

  return {
    returnPct: round4(returnPct),
    realisedVolPct: round4(realisedVolPct),
    maxDrawdownPct: round4(maxDrawdownPct),
    riskAdjustedScore: riskAdjustedScoreFor(returnPct, realisedVolPct, maxDrawdownPct),
  };
}

/** Mirror a sprint result to the other side. */
export function mirrorSprintOutcome(result: SprintOutcome): SprintOutcome {
  return result === 'WIN' ? 'LOSS' : result === 'LOSS' ? 'WIN' : 'DRAW';
}

export interface SprintSideScore {
  riskAdjustedScore: number;
  returnPct: number;
}

/**
 * Winner from the first side's perspective: higher risk-adjusted score
 * wins. Two scores within SPRINT_SCORE_TIE_EPSILON are a tie on score,
 * and the higher return wins; equal on both ⇒ draw. A no-trade sprint
 * (0 vs 0) is a draw, not a win for either side.
 */
export function decideSprintWinner(a: SprintSideScore, b: SprintSideScore): SprintOutcome {
  const eps = DUELS.SPRINT_SCORE_TIE_EPSILON;
  if (Math.abs(a.riskAdjustedScore - b.riskAdjustedScore) > eps) {
    return a.riskAdjustedScore > b.riskAdjustedScore ? 'WIN' : 'LOSS';
  }
  if (a.returnPct !== b.returnPct) return a.returnPct > b.returnPct ? 'WIN' : 'LOSS';
  return 'DRAW';
}

// --- per-instrument summary ------------------------------------------------------

export interface SprintTradeInput {
  instrumentId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  /** Execution price per unit. */
  price: number;
}

export interface PerInstrumentSummary {
  instrumentId: string;
  symbol: string;
  trades: number;
  /** Units bought over the sprint. */
  buyQty: number;
  /** Units sold over the sprint. */
  sellQty: number;
  /** Profit/loss realised by sells vs the running average cost, 2dp. */
  realisedPnl: number;
  /** Units still held at settlement. */
  finalQty: number;
  /** Final holding value at the settlement price, 2dp. */
  finalValue: number;
}

/**
 * Per-instrument trade summary, replayed from the trade log in order.
 * Realised P&L uses a running weighted-average cost: a sell realises
 * (sell price − average cost) × quantity. Buys update the average;
 * sells never change it. Money is rounded to 2dp at the end.
 */
export function summariseTrades(
  trades: SprintTradeInput[],
  finalPrices: Map<string, number>
): PerInstrumentSummary[] {
  const byId = new Map<
    string,
    {
      symbol: string;
      trades: number;
      buyQty: number;
      sellQty: number;
      realisedPnl: number;
      qty: number;
      avgCost: number;
    }
  >();
  for (const t of trades) {
    const agg = byId.get(t.instrumentId) ?? {
      symbol: t.symbol,
      trades: 0,
      buyQty: 0,
      sellQty: 0,
      realisedPnl: 0,
      qty: 0,
      avgCost: 0,
    };
    agg.trades += 1;
    if (t.side === 'BUY') {
      const prevCost = agg.avgCost * agg.qty;
      agg.qty += t.quantity;
      agg.avgCost = agg.qty > 0 ? (prevCost + t.price * t.quantity) / agg.qty : 0;
      agg.buyQty += t.quantity;
    } else {
      agg.realisedPnl += (t.price - agg.avgCost) * t.quantity;
      agg.qty -= t.quantity;
      agg.sellQty += t.quantity;
      if (agg.qty === 0) agg.avgCost = 0;
    }
    byId.set(t.instrumentId, agg);
  }
  const out: PerInstrumentSummary[] = [];
  for (const [instrumentId, agg] of byId) {
    const finalPrice = finalPrices.get(instrumentId) ?? 0;
    out.push({
      instrumentId,
      symbol: agg.symbol,
      trades: agg.trades,
      buyQty: agg.buyQty,
      sellQty: agg.sellQty,
      realisedPnl: Math.round(agg.realisedPnl * 100) / 100,
      finalQty: agg.qty,
      finalValue: Math.round(agg.qty * finalPrice * 100) / 100,
    });
  }
  return out;
}
