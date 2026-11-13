import {
  computeCrashDrawdownPct,
  computePanicSold,
  crashFactorAt,
  crashPanicWindowMs,
  crashSeedHash,
  crashWindowMs,
  crisisMinuteAt,
  crisisMinuteMs,
  deriveCrashMinute,
  tradesDuringCrash,
  type CrisisTradeInput,
} from './crisis-crash';

/**
 * Crisis crash — docs/15 §4.
 * Seeded crash minute, deterministic drop-then-partial-recovery price
 * path, crash-window drawdown, trades during the crash, panic-sell flag.
 */
describe('crisis-crash', () => {
  describe('deriveCrashMinute', () => {
    it('is minute 7–10 for any seed (never outside the band)', () => {
      for (const seed of ['seed-1', 'seed-2', 'abc', '00000000-0000-4000-8000-000000000000']) {
        const m = deriveCrashMinute(seed);
        expect(m).toBeGreaterThanOrEqual(7);
        expect(m).toBeLessThanOrEqual(10);
      }
    });

    it('is deterministic per seed and varies across seeds', () => {
      expect(deriveCrashMinute('seed-1')).toBe(deriveCrashMinute('seed-1'));
      const minutes = new Set(Array.from({ length: 20 }, (_, i) => deriveCrashMinute(`seed-${i}`)));
      expect(minutes.size).toBeGreaterThan(1);
    });

    it('is 7 + (FNV-1a hash % 4)', () => {
      expect(deriveCrashMinute('seed-1')).toBe(7 + (crashSeedHash('seed-1') % 4));
    });
  });

  describe('crashFactorAt', () => {
    it('is 1.00 before the crash minute', () => {
      expect(crashFactorAt(0, 8)).toBe(1);
      expect(crashFactorAt(7, 8)).toBe(1);
    });

    it('falls −12% over 3 minutes, −4% per minute (identical for every instrument)', () => {
      expect(crashFactorAt(8, 8)).toBe(0.96);
      expect(crashFactorAt(9, 8)).toBe(0.92);
      expect(crashFactorAt(10, 8)).toBe(0.88);
    });

    it('then recovers +5% over 5 minutes and stops at 0.93', () => {
      expect(crashFactorAt(11, 8)).toBe(0.89);
      expect(crashFactorAt(12, 8)).toBe(0.9);
      expect(crashFactorAt(13, 8)).toBe(0.91);
      expect(crashFactorAt(14, 8)).toBe(0.92);
      expect(crashFactorAt(15, 8)).toBe(0.93);
      expect(crashFactorAt(16, 8)).toBe(0.93);
      expect(crashFactorAt(30, 8)).toBe(0.93);
    });

    it('shifts with the crash minute (the shape, not the minute, is fixed)', () => {
      expect(crashFactorAt(7, 7)).toBe(0.96);
      expect(crashFactorAt(9, 7)).toBe(0.88);
      expect(crashFactorAt(10, 7)).toBe(0.89);
      expect(crashFactorAt(10, 10)).toBe(0.96);
      expect(crashFactorAt(12, 10)).toBe(0.88);
    });
  });

  describe('crisisMinuteAt (test-time rule)', () => {
    it('a crisis minute is duration/15 in production (a real minute)', () => {
      expect(crisisMinuteMs(900_000)).toBe(60_000);
    });

    it('shrinks proportionally when the duration shrinks (20 s test duel)', () => {
      expect(crisisMinuteMs(20_000)).toBeCloseTo(1333.33, 2);
      const startedAtMs = 1_000_000;
      // Crash minute 8 of 15 ≈ 53% of the duel: ~10.7 s into a 20 s duel.
      expect(crisisMinuteAt(startedAtMs + 10_667, startedAtMs, 20_000)).toBe(8);
      expect(crisisMinuteAt(startedAtMs + 20_000, startedAtMs, 20_000)).toBe(15);
    });

    it('is 0 before the start', () => {
      expect(crisisMinuteAt(999, 1000, 900_000)).toBe(0);
    });
  });

  describe('crashWindowMs', () => {
    it('covers the 3 fall minutes from the crash minute', () => {
      const w = crashWindowMs(0, 8, 900_000);
      expect(w.crashStartMs).toBe(8 * 60_000);
      expect(w.crashEndMs).toBe(11 * 60_000);
    });
  });

  describe('crashPanicWindowMs (execution grace, docs/15 §6)', () => {
    it('extends the fall window by exactly one crisis minute', () => {
      const w = crashPanicWindowMs(0, 8, 900_000);
      expect(w.crashStartMs).toBe(8 * 60_000);
      expect(w.panicEndMs).toBe(12 * 60_000);
    });

    it('scales with the duel: one crisis minute is ~1.33 s in a 20 s test duel', () => {
      const w = crashPanicWindowMs(0, 8, 20_000);
      expect(w.crashStartMs).toBeCloseTo(8 * (20_000 / 15), 2);
      expect(w.panicEndMs).toBeCloseTo(12 * (20_000 / 15), 2);
    });
  });

  describe('computeCrashDrawdownPct', () => {
    const curve = (equities: number[], startMs = 0, stepMs = 60_000) =>
      equities.map((equity, i) => ({ t: startMs + i * stepMs, equity: String(equity) }));

    it('is ~12% for a fully invested holder (peak 102k → trough 89.76k)', () => {
      const c = curve([
        100000, 100300, 100600, 101000, 101300, 101700, 102000, 97920, 93840, 89760, 90780, 91800,
        92820, 93840, 94860, 94860,
      ]);
      expect(computeCrashDrawdownPct(c, 7 * 60_000)).toBeCloseTo(12, 2);
    });

    it('is 0 for an all-cash player (flat curve)', () => {
      const c = curve([100000, 102000, 102000, 102000, 102000]);
      expect(computeCrashDrawdownPct(c, 2 * 60_000)).toBe(0);
    });

    it('is 0 on an empty curve', () => {
      expect(computeCrashDrawdownPct([], 0)).toBe(0);
    });

    it('ignores falls before the crash (a pre-crash dip is not crash drawdown)', () => {
      const c = curve([100000, 99000, 101000, 101000, 101000]);
      expect(computeCrashDrawdownPct(c, 3 * 60_000)).toBe(0);
    });
  });

  describe('tradesDuringCrash / computePanicSold', () => {
    const START = 0;
    const CRASH_START = 8 * 60_000;
    const CRASH_END = 11 * 60_000;
    const buy = (executedAtMs: number, quantity = 100): CrisisTradeInput => ({
      userId: 'a',
      instrumentId: 'nvlt',
      side: 'BUY',
      quantity,
      price: 800,
      totalValue: 800 * quantity,
      executedAtMs,
    });
    const sell = (executedAtMs: number, quantity = 100): CrisisTradeInput => ({
      userId: 'a',
      instrumentId: 'nvlt',
      side: 'SELL',
      quantity,
      price: 800,
      totalValue: 800 * quantity,
      executedAtMs,
    });

    it('counts only trades inside the crash window', () => {
      const trades = [
        buy(START + 60_000),
        sell(CRASH_START - 1000),
        sell(CRASH_START + 1000),
        sell(CRASH_END - 1000),
        sell(CRASH_END + 1000),
      ];
      expect(tradesDuringCrash(trades, 'a', CRASH_START, CRASH_END)).toBe(2);
      expect(tradesDuringCrash(trades, 'b', CRASH_START, CRASH_END)).toBe(0);
    });

    it('flags selling everything at the bottom as panic', () => {
      const trades = [buy(60_000, 100), sell(CRASH_START + 60_000, 100)];
      expect(computePanicSold(trades, 'a', CRASH_START, CRASH_END)).toBe(true);
    });

    it('flags selling half in the window as panic (the 50% threshold)', () => {
      const trades = [buy(60_000, 100), sell(CRASH_START + 60_000, 50)];
      expect(computePanicSold(trades, 'a', CRASH_START, CRASH_END)).toBe(true);
    });

    it('does not flag selling less than half, or selling before the crash', () => {
      expect(
        computePanicSold(
          [buy(60_000, 100), sell(CRASH_START + 60_000, 49)],
          'a',
          CRASH_START,
          CRASH_END
        )
      ).toBe(false);
      expect(
        computePanicSold(
          [buy(60_000, 100), sell(CRASH_START - 60_000, 100)],
          'a',
          CRASH_START,
          CRASH_END
        )
      ).toBe(false);
    });

    it('does not flag a player who held nothing at the crash start', () => {
      expect(computePanicSold([sell(CRASH_START + 60_000, 10)], 'a', CRASH_START, CRASH_END)).toBe(
        false
      );
    });

    it('does not flag selling after the window (during the recovery)', () => {
      expect(
        computePanicSold(
          [buy(60_000, 100), sell(CRASH_END + 60_000, 100)],
          'a',
          CRASH_START,
          CRASH_END
        )
      ).toBe(false);
    });

    it('counts and flags a sale executing in the first recovery minute (panic window)', () => {
      // The panic window is the fall plus one crisis minute of
      // execution grace: a sale 30 s past the fall (factor 0.89, one
      // step off the bottom) still counts and still flags.
      const w = crashPanicWindowMs(START, 8, 900_000);
      const trades = [buy(60_000, 100), sell(CRASH_END + 30_000, 100)];
      expect(tradesDuringCrash(trades, 'a', w.crashStartMs, w.panicEndMs)).toBe(1);
      expect(computePanicSold(trades, 'a', w.crashStartMs, w.panicEndMs)).toBe(true);
    });

    it('does not flag a sale executing from the second recovery minute on', () => {
      // Exactly at the grace boundary (factor 0.90, recovery
      // genuinely underway) and past it: outside the panic window.
      const w = crashPanicWindowMs(START, 8, 900_000);
      expect(
        computePanicSold(
          [buy(60_000, 100), sell(CRASH_END + 60_000, 100)],
          'a',
          w.crashStartMs,
          w.panicEndMs
        )
      ).toBe(false);
      expect(
        computePanicSold(
          [buy(60_000, 100), sell(CRASH_END + 90_000, 100)],
          'a',
          w.crashStartMs,
          w.panicEndMs
        )
      ).toBe(false);
      expect(
        tradesDuringCrash(
          [buy(60_000, 100), sell(CRASH_END + 90_000, 100)],
          'a',
          w.crashStartMs,
          w.panicEndMs
        )
      ).toBe(0);
    });
  });
});
