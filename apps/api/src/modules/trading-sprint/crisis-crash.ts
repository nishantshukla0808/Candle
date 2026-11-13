import { DUELS } from '@candle/shared';

/**
 * Crisis crash — docs/15 §4 (pure, no I/O).
 *
 * A Crisis Duel is a Paper Trading Sprint with one seeded crash in the
 * middle. The crash is a MULTIPLIER on the Phase 2 deterministic price
 * engine, applied identically to all 6 instruments and to both players:
 * the base price still comes from `PriceEngine` (same market, same
 * minute), the crash factor only bends it. Because the factor depends
 * only on (seed, elapsed time), both players always see the same
 * crash, and the crash is replayable from the duel seed alone.
 *
 * ## Crash minute (seeded, never disclosed)
 * crashMinute = 7 + (FNV-1a(seed) % 4) — minute 7, 8, 9 or 10 of 15.
 * A fixed minute would be gameable (sell everything at minute 6,
 * buy back at minute 11); a seeded minute in a 4-minute band is not.
 * The minute is stored in the Redis state and the stored result, and
 * is NEVER sent to a client before settlement.
 *
 * ## Crash shape (deterministic, identical for both players)
 * Factor on the pre-crash price, by "crisis minute" m (whole minutes
 * since the duel started):
 *
 *   m < crashMinute:                    1.00
 *   crashMinute .. crashMinute + 2:     0.96, 0.92, 0.88   (−4%/min, −12% total)
 *   crashMinute + 3 .. + 7:             0.89, 0.90, 0.91, 0.92, 0.93
 *   m ≥ crashMinute + 8:                0.93 (flat — the recovery stops)
 *
 * The fall is −12% over 3 minutes; the partial recovery is +5% over
 * the next 5 minutes; the market ends −7% below where the crash
 * started. The recovery is load-bearing for the scoring (docs/15 §5):
 * a player who panic-sells at the bottom locks the full −12% and
 * misses the +5% that a calm holder recovers.
 *
 * ## Test time (docs/15 §4, mandatory rule)
 * A "crisis minute" is duration/15 milliseconds, not a wall-clock
 * minute: in production the duration is 15 real minutes, so a crisis
 * minute IS a wall-clock minute; in tests the duration shrinks
 * (SPRINT_DURATION_MS=20 s in e2e) and a crisis minute is ~1.33 s, so
 * the crash still fires at ~50% of the shortened duel, falls over the
 * next ~20%, and recovers after — a full crisis duel runs in test
 * time. The crash minute is therefore a FRACTION of the duel
 * (crashMinute/15 ≈ 47–67%), never a hard-coded wall-clock minute.
 * The base price engine still uses wall-clock minutes — only the
 * crash factor runs on crisis minutes, so in a 20-second test the
 * base prices barely move and the whole visible move IS the crash.
 */

/** FNV-1a 32-bit hash — the same pattern as PriceEngine.hashSymbol. */
export function crashSeedHash(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * The crash minute for a duel seed: 7 + (hash(seed) % 4) → 7, 8, 9 or 10.
 * Deterministic per seed; the same seed always crashes in the same minute.
 */
export function deriveCrashMinute(seed: string): number {
  return DUELS.CRISIS_CRASH_MIN_MINUTE + (crashSeedHash(seed) % DUELS.CRISIS_CRASH_MINUTE_SPAN);
}

/** Milliseconds per crisis minute for a duel of `durationMs` (duration/15). */
export function crisisMinuteMs(durationMs: number): number {
  return durationMs / 15;
}

/** Whole crisis minutes elapsed since `startedAtMs` (0-based, 0 before the start). */
export function crisisMinuteAt(nowMs: number, startedAtMs: number, durationMs: number): number {
  if (nowMs < startedAtMs) return 0;
  return Math.floor((nowMs - startedAtMs) / crisisMinuteMs(durationMs));
}

/**
 * The crash multiplier at crisis minute `m` for a crash starting at
 * `crashMinute`. 1.00 before the crash, 0.96/0.92/0.88 across the
 * 3-minute fall, then +0.01/minute for 5 minutes to 0.93, then flat.
 * Pure — pinned in unit tests (drop, then partial recovery, then flat).
 */
export function crashFactorAt(m: number, crashMinute: number): number {
  const drop = DUELS.CRISIS_CRASH_DROP_PCT / 100 / DUELS.CRISIS_CRASH_DROP_MINUTES;
  const recoveryStep = DUELS.CRISIS_CRASH_RECOVERY_PCT / 100 / DUELS.CRISIS_CRASH_RECOVERY_MINUTES;
  if (m < crashMinute) return 1;
  const intoCrash = m - crashMinute;
  if (intoCrash < DUELS.CRISIS_CRASH_DROP_MINUTES) {
    return round4(1 - drop * (intoCrash + 1));
  }
  const intoRecovery = intoCrash - DUELS.CRISIS_CRASH_DROP_MINUTES;
  if (intoRecovery < DUELS.CRISIS_CRASH_RECOVERY_MINUTES) {
    const bottom = 1 - DUELS.CRISIS_CRASH_DROP_PCT / 100;
    return round4(bottom + recoveryStep * (intoRecovery + 1));
  }
  return round4(1 - DUELS.CRISIS_CRASH_DROP_PCT / 100 + DUELS.CRISIS_CRASH_RECOVERY_PCT / 100);
}

/** Round to 4 decimal places (the factor is applied to 2dp prices). */
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** Wall-clock window of the crash fall, in ms since the epoch. */
export function crashWindowMs(
  startedAtMs: number,
  crashMinute: number,
  durationMs: number
): { crashStartMs: number; crashEndMs: number } {
  const minute = crisisMinuteMs(durationMs);
  return {
    crashStartMs: startedAtMs + crashMinute * minute,
    crashEndMs: startedAtMs + (crashMinute + DUELS.CRISIS_CRASH_DROP_MINUTES) * minute,
  };
}

/**
 * Wall-clock window used for the PANIC stats at settlement
 * (`tradesDuringCrash`, `computePanicSold`): the 3-minute fall
 * [crashStartMs, crashEndMs) PLUS one crisis minute of execution
 * grace, so panicEndMs = crashEndMs + duration/15.
 *
 * Why the grace exists (docs/15 §6): `executedAtMs` is stamped at
 * server execution, not at the player's click. A player who acts at
 * the bottom (factor 0.88) can have the order execute just past the
 * fall window — the client sleep, the socket round-trip, and the
 * server's Redis load/save all sit between click and execution, and
 * under full-suite load that drift exceeds the ~0.7 s left in the
 * bottom minute of a 20-second test duel. A strict fall window then
 * misses a genuine panic sale (proven, not a flake: full e2e 127/128
 * twice, same test, Rating deltas still correct — only `panicSold`
 * false, because the sale executed past `crashEndMs`).
 *
 * One crisis minute is the right size for the grace, not an arbitrary
 * millisecond fudge: it is the smallest unit the crash shape itself
 * uses (the factor changes once per crisis minute), and it is
 * proportional (duration/15), so it is 1 minute in production and
 * ~1.33 s in a 20-second test duel. Extending by one minute covers
 * exactly the executions priced at factor 0.89 — one recovery step
 * (1pp) off the 0.88 bottom, with 4 of the 5 recovery points still
 * missed — and nothing later: a sale in the second recovery minute
 * (factor ≥ 0.90, recovery genuinely underway) is still not panic,
 * and neither is a sale before the crash or a calm hold (0 trades).
 * The crash DRAWDOWN still uses the strict fall window
 * (`crashWindowMs`); only the two panic stats use this window, and
 * they use the SAME window, so `panicSold: true` always implies
 * `tradesDuringCrash ≥ 1` — fixing only one of them would leave the
 * two stats contradicting each other.
 */
export function crashPanicWindowMs(
  startedAtMs: number,
  crashMinute: number,
  durationMs: number
): { crashStartMs: number; panicEndMs: number } {
  const { crashStartMs, crashEndMs } = crashWindowMs(startedAtMs, crashMinute, durationMs);
  return { crashStartMs, panicEndMs: crashEndMs + crisisMinuteMs(durationMs) };
}

/** One minute-sampled equity point (the shape SprintState stores). */
export interface CrisisEquityPoint {
  t: number;
  equity: string;
}

/**
 * The crash-window drawdown for one player: the peak equity at or
 * before the crash start, vs the lowest equity after the crash start.
 * A player holding only cash has a flat curve and a 0% crash
 * drawdown; a fully invested player falls ~12%. Computed from the
 * stored equity curve — no new sampling is needed.
 */
export function computeCrashDrawdownPct(curve: CrisisEquityPoint[], crashStartMs: number): number {
  if (curve.length === 0) return 0;
  let peak = 0;
  for (const p of curve) {
    if (p.t <= crashStartMs) peak = Math.max(peak, Number(p.equity));
  }
  if (peak <= 0) {
    peak = Number(curve[0]?.equity ?? 0);
    if (peak <= 0) return 0;
  }
  let trough = peak;
  for (const p of curve) {
    if (p.t > crashStartMs) trough = Math.min(trough, Number(p.equity));
  }
  if (trough >= peak) return 0;
  return Math.round(((peak - trough) / peak) * 100 * 10000) / 10000;
}

export interface CrisisTradeInput {
  userId: string;
  instrumentId: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  /** Execution price per unit (for the sell-share value check). */
  price: number;
  totalValue: number;
  executedAtMs: number;
}

/**
 * Trades one player made during the crash window (fall minutes only,
 * [crashStartMs, crashEndMs)). A calm holder has none; a panic seller
 * has sells here. Counted per player for the stored result. The
 * window this is given at settlement is the PANIC window
 * (`crashPanicWindowMs` — fall plus one crisis minute of execution
 * grace), not the strict fall window, so a sale that executes just
 * past the fall still counts here; the function itself stays a pure
 * [start, end) count.
 */
export function tradesDuringCrash(
  trades: CrisisTradeInput[],
  userId: string,
  crashStartMs: number,
  crashEndMs: number
): number {
  return trades.filter(
    (t) => t.userId === userId && t.executedAtMs >= crashStartMs && t.executedAtMs < crashEndMs
  ).length;
}

/**
 * Panic-sell flag (docs/15 §6): true when the player sold at least
 * half (CRISIS_PANIC_SELL_SHARE) of the units they held at the crash
 * start, during the crash window. Holdings at the crash start are
 * replayed from the trade log (buys before the window minus sells
 * before the window); sells inside the window are summed per
 * instrument and compared per instrument — selling half of ANY one
 * holding in the window counts. A player who held nothing, sold
 * nothing, or sold before the crash is never flagged; a player who
 * sold everything at the bottom always is.
 *
 * The window this is given at settlement is the PANIC window
 * (`crashPanicWindowMs` — fall plus one crisis minute of execution
 * grace), so a sale that executes in the first recovery minute
 * (priced at factor 0.89, one step off the bottom) still flags, and
 * a sale from the second recovery minute on (factor ≥ 0.90) does
 * not. The flag is REPORTED on the stored result, not scored: the missed
 * recovery already prices the panic into the return (docs/15 §6).
 */
export function computePanicSold(
  trades: CrisisTradeInput[],
  userId: string,
  crashStartMs: number,
  crashEndMs: number
): boolean {
  const held = new Map<string, number>();
  const soldInWindow = new Map<string, number>();
  for (const t of trades) {
    if (t.userId !== userId) continue;
    if (t.executedAtMs < crashStartMs) {
      const q = held.get(t.instrumentId) ?? 0;
      held.set(t.instrumentId, t.side === 'BUY' ? q + t.quantity : q - t.quantity);
    } else if (t.executedAtMs < crashEndMs && t.side === 'SELL') {
      soldInWindow.set(t.instrumentId, (soldInWindow.get(t.instrumentId) ?? 0) + t.quantity);
    }
  }
  for (const [instrumentId, sold] of soldInWindow) {
    const heldAtStart = held.get(instrumentId) ?? 0;
    if (heldAtStart > 0 && sold >= DUELS.CRISIS_PANIC_SELL_SHARE * heldAtStart) return true;
  }
  return false;
}
