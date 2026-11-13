import {
  RATING_DECAY_GRACE_DAYS,
  RATING_DECAY_MAX_POINTS,
  RATING_DECAY_POINTS_PER_WEEK,
  RATING_FLOOR,
  RATING_INDEX_OPPONENT,
  RATING_K_1400_TO_1799,
  RATING_K_1800_PLUS,
  RATING_K_BELOW_1400,
  RATING_K_PROVISIONAL,
  RATING_PROVISIONAL_EVENTS,
  RATING_START,
  RATING_TIERS,
  RATING_WEIGHTS,
} from '@candle/shared';

/**
 * Pure rating math — docs/04-ratings-and-deployment.md §3.
 *
 * No I/O, no dates beyond the caller's inputs, no Prisma. Every formula
 * here is unit-tested, including the doc's worked example
 * (1200 vs 1400, K=32, win => +24.3 to 1224.3).
 *
 * Ratings are stored with 1 decimal place internally and displayed
 * rounded (docs/04 §2). Deltas are rounded to 1 decimal before they are
 * applied, so the two sides of a duel move by exactly opposite amounts
 * and points gained always equal points lost.
 */

export type RatingTierName = (typeof RATING_TIERS)[number]['name'];
export type DuelResult = 'WIN' | 'DRAW' | 'LOSS';

/**
 * Round to 1 decimal place (the storage precision for ratings).
 * The tiny epsilon keeps exact .5 boundaries (e.g. 1019.45, which binary
 * floats store as 1019.449999…) rounding up, as decimal arithmetic would.
 */
export function round1(n: number): number {
  return Math.round((n + 1e-9) * 10) / 10;
}

/** Expected score for A against B: Ea = 1 / (1 + 10^((Rb - Ra) / 400)). */
export function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

/**
 * K-factor — how fast a rating moves (docs/04 §3).
 * Provisional (fewer than 10 rated events in this rating): 40.
 * Established: 32 at 1400 and below, 24 for 1401–1799, 16 at 1800+.
 *
 * Boundary note (ADR 0005/2): doc 04's K table reads "32 if rating
 * <1400, 24 if 1400–1799", but its own worked example — labelled
 * "verified" — uses K=32 for the player rated exactly 1400 (win
 * +24.3, expected win +7.7). The worked example governs the boundary,
 * so 1400 takes the lower band.
 */
export function kFactor(rating: number, gamesPlayed: number): number {
  if (gamesPlayed < RATING_PROVISIONAL_EVENTS) return RATING_K_PROVISIONAL;
  if (rating <= 1400) return RATING_K_BELOW_1400;
  if (rating < 1800) return RATING_K_1400_TO_1799;
  return RATING_K_1800_PLUS;
}

/** Tier band for a rating (display only; the number is the truth). */
export function tierFor(rating: number): RatingTierName {
  let tier: RatingTierName = RATING_TIERS[0]?.name ?? 'Bronze';
  for (const t of RATING_TIERS) {
    if (rating >= t.min) tier = t.name;
  }
  return tier;
}

export interface RatingUpdate {
  k: number;
  /** Expected score, rounded to 4 decimals for the audit trail. */
  expected: number;
  /** Signed change, 1 decimal place. */
  delta: number;
  /** New rating, 1 decimal place, never below the floor. */
  newRating: number;
}

/**
 * One rating update: Ra' = Ra + K × (Sa − Ea), with the delta rounded to
 * 1 decimal first so mirrored updates are exactly opposite.
 */
export function applyUpdate(
  ratingA: number,
  ratingB: number,
  actualScore: number,
  gamesPlayed: number
): RatingUpdate {
  const k = kFactor(ratingA, gamesPlayed);
  const expected = expectedScore(ratingA, ratingB);
  const delta = round1(k * (actualScore - expected));
  const newRating = Math.max(RATING_FLOOR, round1(ratingA + delta));
  return { k, expected: Math.round(expected * 10000) / 10000, delta, newRating };
}

/** Actual score for a duel result: win 1, draw 0.5, loss 0. */
export function scoreForResult(result: DuelResult): number {
  return result === 'WIN' ? 1 : result === 'DRAW' ? 0.5 : 0;
}

/** The mirrored result for the other side of a duel. */
export function mirrorResult(result: DuelResult): DuelResult {
  return result === 'WIN' ? 'LOSS' : result === 'LOSS' ? 'WIN' : 'DRAW';
}

/**
 * Headline Candle Rating: 0.5 × Learning + 0.5 × Trading (docs/04 §1).
 * Derived, never stored; shown only alongside its two parts.
 */
export function candleRating(learning: number, trading: number): number {
  return round1(RATING_WEIGHTS.LEARNING * learning + RATING_WEIGHTS.TRADING * trading);
}

/** Display form of a stored rating: rounded to the nearest integer. */
export function displayRating(rating: number): number {
  return Math.round(rating);
}

/** Current quarter string, e.g. "2026-Q4" (UTC). */
export function currentSeason(at: Date = new Date()): string {
  const year = at.getUTCFullYear();
  const quarter = Math.floor(at.getUTCMonth() / 3) + 1;
  return `${year}-Q${quarter}`;
}

/** A season string is valid when it looks like "2026-Q4". */
export function isValidSeason(season: string): boolean {
  return /^\d{4}-Q[1-4]$/.test(season);
}

/**
 * Quarterly soft reset (docs/04 §6): R_new = 1000 + (R_old − 1000) × 0.5.
 * Order is preserved, gaps shrink, nobody jumps to 1000 in one move.
 */
export function softReset(rating: number): number {
  return round1(RATING_START + (rating - RATING_START) * 0.5);
}

/**
 * Inactivity decay (docs/04 §5): after a 30-day grace with no rated
 * event, a rating drifts 10 points per week toward 1000, capped at 50
 * points per decay run, never below the floor.
 *
 * Weeks past the grace count per started week: 31 days inactive => 1
 * week (10 points), 37 days => 2 weeks (20 points), 100 days => capped
 * at 50. The drift never overshoots 1000.
 */
export function decayFor(
  rating: number,
  daysInactive: number
): { delta: number; newRating: number } {
  if (daysInactive <= RATING_DECAY_GRACE_DAYS || rating === RATING_START) {
    return { delta: 0, newRating: rating };
  }
  const weeksBeyondGrace = Math.floor((daysInactive - RATING_DECAY_GRACE_DAYS) / 7) + 1;
  const magnitude = Math.min(
    RATING_DECAY_POINTS_PER_WEEK * weeksBeyondGrace,
    RATING_DECAY_MAX_POINTS,
    Math.abs(rating - RATING_START)
  );
  const delta = rating > RATING_START ? -magnitude : magnitude;
  const newRating = Math.max(RATING_FLOOR, round1(rating + delta));
  return { delta: round1(newRating - rating), newRating };
}

/**
 * Trading-week score (docs/04 §5): win when the portfolio beats the
 * index by more than 2 points, loss when it trails by more than 2,
 * draw within ±2.
 */
export function tradingScore(portfolioReturnPct: number, indexReturnPct: number): number {
  const diff = portfolioReturnPct - indexReturnPct;
  if (diff > 2) return 1;
  if (diff < -2) return 0;
  return 0.5;
}

/** The simulated index opponent's fixed rating (docs/04 §5). */
export const INDEX_OPPONENT_RATING = RATING_INDEX_OPPONENT;

/** Monday (00:00 UTC) of the week containing `at`. */
export function mondayOfWeek(at: Date): Date {
  const d = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  const day = d.getUTCDay(); // 0 = Sunday
  const back = (day + 6) % 7; // days since Monday
  d.setUTCDate(d.getUTCDate() - back);
  return d;
}

/** UTC start of the calendar day containing `at`. */
export function startOfUtcDay(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
}
