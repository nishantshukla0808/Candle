import { DUELS, RATING_TRADING_MIN_TRADES, XP } from '@candle/shared';
import { computeRiskMetrics } from '../trading-sprint/sprint-scoring';
import { leagueZoneFor } from './weekly-leagues';

/**
 * Weekly scoring + ranking — docs/16 §6/§7 (pure, no I/O).
 *
 * LEAGUE RANKING and TRADING RATING are two separate things, and
 * confusing them is the one surprise this module must prevent
 * (ADR 0013 §7):
 *
 * (a) LEAGUE RANKING — by risk-adjusted return, the sprint scoring
 *     family (docs/14 §3): score = R/(1+V+D) for R ≥ 0, R×(1+V+D)
 *     for R < 0, clamped ±100, computed from the player's equity
 *     curve (start + one sample per trade + settlement). Winner =
 *     highest score in the league. The curve is built by
 *     buildWeeklyEquityCurve (weekly-portfolio.ts) and the metrics by
 *     computeRiskMetrics — REUSED from the sprint, not duplicated.
 * (b) TRADING RATING — per doc 04 §5 via the existing recordTradingWeek
 *     path (vs the index at 1200, win > index+2% / draw ±2% / loss <
 *     index−2%, min 3 trades, one update per user per week). A league
 *     winner can therefore GAIN Rating or not depending on the index:
 *     beating 29 league rivals while trailing the index is a league
 *     win and a Rating loss. Both numbers are shown on the result.
 *
 * Worked examples (pinned in weekly-scoring.spec.ts — the same table
 * as the sprint, docs/14 §6, because it is the same formula):
 * - Steady: R=+2.0, V=1.0, D=0.5 → 2.0/2.5 = 0.80 — WINS
 * - Wild: R=+3.0, V=4.0, D=2.0 → 3.0/7.0 ≈ 0.43 — loses, the higher
 *   return does not win
 * - Risky loser: R=−2.0, V=1.0, D=1.0 → −2.0×3.0 = −6.00
 * - Calm loser: R=−2.0, V=0, D=0 → −2.00
 * - No trades: R=0, V=0, D=0 → 0
 */

export type WeeklyLeagueOutcome = 'WIN' | 'DRAW' | 'LOSS';

export interface LeagueEntryInput {
  userId: string;
  displayName: string | null;
  riskAdjustedScore: number;
  returnPct: number;
  tradeCount: number;
  /** ms epoch of the join (final tie-break, before userId). */
  joinedAtMs: number;
}

export interface RankedLeagueEntry extends LeagueEntryInput {
  rank: number;
  promotionZone: boolean;
  relegationZone: boolean;
  xpOutcome: WeeklyLeagueOutcome;
  xpAwarded: number;
}

/**
 * Rank one league. Order: higher risk-adjusted score first; scores
 * within WEEKLY_SCORE_TIE_EPSILON tie on score and the higher return
 * wins; then more trades; then earlier join; then userId (so the
 * order is total — no two players ever share a rank). Players who
 * never traded score 0 and rank last: a 0 from trading at least ties
 * with a 0 from never trading on score, so the trade-count tie-break
 * puts every traded player above every never-traded one.
 */
export function rankLeagueEntries(entries: LeagueEntryInput[]): RankedLeagueEntry[] {
  const eps = DUELS.WEEKLY_SCORE_TIE_EPSILON;
  const size = entries.length;
  const sorted = [...entries].sort((a, b) => {
    if (Math.abs(a.riskAdjustedScore - b.riskAdjustedScore) > eps) {
      return b.riskAdjustedScore - a.riskAdjustedScore;
    }
    if (a.returnPct !== b.returnPct) return b.returnPct - a.returnPct;
    if (a.tradeCount !== b.tradeCount) return b.tradeCount - a.tradeCount;
    if (a.joinedAtMs !== b.joinedAtMs) return a.joinedAtMs - b.joinedAtMs;
    return a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0;
  });
  return sorted.map((e, i) => {
    const rank = i + 1;
    const zone = leagueZoneFor(rank, size);
    const xpOutcome = weeklyXpOutcome(rank, size, e.tradeCount);
    return {
      ...e,
      rank,
      promotionZone: zone === 'TOP',
      relegationZone: zone === 'BOTTOM',
      xpOutcome,
      xpAwarded: xpOutcome === 'WIN' ? XP.QUIZ_PASS : xpOutcome === 'DRAW' ? XP.TRADE_EXECUTED : 0,
    };
  });
}

/**
 * XP by league outcome (docs/16 §7): top 3 = win XP (20), middle =
 * draw XP (5), bottom 3 = loss XP (0), never-traded = 0. In leagues
 * smaller than 6 the zones are rank 1 / last rank only (leagueZoneFor)
 * — a 2-player league still has a winner and a loser. A never-traded
 * player is a loss for XP whatever their rank — they did not play.
 */
export function weeklyXpOutcome(
  rank: number,
  leagueSize: number,
  tradeCount: number
): WeeklyLeagueOutcome {
  if (tradeCount === 0) return 'LOSS';
  const zone = leagueZoneFor(rank, leagueSize);
  if (zone === 'TOP') return 'WIN';
  if (zone === 'BOTTOM') return 'LOSS';
  return 'DRAW';
}

/** Re-exported for the service: the sprint risk math, unchanged. */
export function weeklyRiskMetrics(equityCurve: number[], startCash: number) {
  return computeRiskMetrics(equityCurve, startCash);
}

/** Min trades for a rated week (doc 04 §5) — re-exported for the service. */
export const WEEKLY_MIN_TRADES = RATING_TRADING_MIN_TRADES;

/** Plain-words Trading Rating reason for a weekly result. */
export function weeklyRatingReasonFor(input: {
  rank: number;
  leagueSize: number;
  tier: number;
  leagueNumber: number;
  tradeCount: number;
  returnPct: number;
  indexReturnPct: number;
  ratingResult: WeeklyLeagueOutcome | null;
  ratingDelta: number | null;
}): string {
  const { rank, leagueSize, tier, leagueNumber, tradeCount, returnPct, indexReturnPct } = input;
  const place = `You finished #${rank} of ${leagueSize} in League ${leagueNumber} (tier ${tier}) with a ${returnPct}% return.`;
  if (tradeCount < WEEKLY_MIN_TRADES) {
    return (
      `${place} You made ${tradeCount} trade${tradeCount === 1 ? '' : 's'} — fewer than ` +
      `${WEEKLY_MIN_TRADES} — so this week was unrated and your Trading Rating did not change.`
    );
  }
  const vsIndex =
    input.ratingResult === 'WIN'
      ? `You beat the simulated index (${indexReturnPct}%) by more than 2%.`
      : input.ratingResult === 'LOSS'
        ? `You trailed the simulated index (${indexReturnPct}%) by more than 2%.`
        : `You stayed within 2% of the simulated index (${indexReturnPct}%).`;
  const deltaText =
    input.ratingDelta === null
      ? ' Your Trading Rating could not be updated this week.'
      : input.ratingDelta > 0
        ? ` Your Trading Rating went up by ${input.ratingDelta}.`
        : input.ratingDelta < 0
          ? ` Your Trading Rating went down by ${Math.abs(input.ratingDelta)}.`
          : ' Your Trading Rating did not change.';
  return `${place} ${vsIndex}${deltaText}`;
}
