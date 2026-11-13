import {
  applyUpdate,
  candleRating,
  currentSeason,
  decayFor,
  displayRating,
  expectedScore,
  isValidSeason,
  kFactor,
  mirrorResult,
  mondayOfWeek,
  scoreForResult,
  softReset,
  tierFor,
  tradingScore,
} from './rating-math';

describe('rating-math (docs/04 §3)', () => {
  describe('expectedScore', () => {
    it('is 0.5 for equal ratings', () => {
      expect(expectedScore(1200, 1200)).toBeCloseTo(0.5, 10);
    });

    it('gives ~0.91 to the side 400 points stronger, ~0.09 to the weaker side', () => {
      expect(expectedScore(1400, 1000)).toBeCloseTo(0.9091, 4);
      expect(expectedScore(1000, 1400)).toBeCloseTo(0.0909, 4);
    });

    it('gives ~0.76 for a 200-point gap', () => {
      expect(expectedScore(1200, 1000)).toBeCloseTo(0.7597, 4);
    });
  });

  describe('kFactor', () => {
    it('is 40 while provisional (fewer than 10 rated events)', () => {
      expect(kFactor(1000, 0)).toBe(40);
      expect(kFactor(1900, 9)).toBe(40);
    });

    it('is 32 at 1400 and below once established (worked-example boundary, ADR 0005/2)', () => {
      expect(kFactor(1399, 10)).toBe(32);
      expect(kFactor(1400, 10)).toBe(32);
    });

    it('is 24 for 1401–1799 once established', () => {
      expect(kFactor(1401, 10)).toBe(24);
      expect(kFactor(1799, 10)).toBe(24);
    });

    it('is 16 at 1800+ once established', () => {
      expect(kFactor(1800, 10)).toBe(16);
      expect(kFactor(2200, 50)).toBe(16);
    });
  });

  describe('tierFor', () => {
    it.each([
      [100, 'Bronze'],
      [1099.9, 'Bronze'],
      [1100, 'Silver'],
      [1299, 'Silver'],
      [1300, 'Gold'],
      [1499, 'Gold'],
      [1500, 'Platinum'],
      [1699, 'Platinum'],
      [1700, 'Diamond'],
      [1899, 'Diamond'],
      [1900, 'Master'],
      [2400, 'Master'],
    ])('tierFor(%s) is %s', (rating, tier) => {
      expect(tierFor(rating)).toBe(tier);
    });
  });

  describe('applyUpdate — the doc worked example (1200 vs 1400, K=32)', () => {
    it('underdog win: +24.3 to 1224.3, favourite loses the same 24.3 to 1375.7', () => {
      const winner = applyUpdate(1200, 1400, 1, 10);
      expect(winner.k).toBe(32);
      expect(winner.expected).toBeCloseTo(0.2403, 4);
      expect(winner.delta).toBe(24.3);
      expect(winner.newRating).toBe(1224.3);

      const loser = applyUpdate(1400, 1200, 0, 10);
      expect(loser.k).toBe(32);
      expect(loser.delta).toBe(-24.3);
      expect(loser.newRating).toBe(1375.7);
      // Points gained exactly equal points lost.
      expect(winner.delta + loser.delta).toBe(0);
    });

    it('expected win: favourite gains only +7.7', () => {
      const favourite = applyUpdate(1400, 1200, 1, 10);
      expect(favourite.delta).toBe(7.7);
      expect(favourite.newRating).toBe(1407.7);

      const underdog = applyUpdate(1200, 1400, 0, 10);
      expect(underdog.delta).toBe(-7.7);
      expect(underdog.newRating).toBe(1192.3);
    });

    it('draw at equal ratings changes nothing', () => {
      const r = applyUpdate(1300, 1300, 0.5, 10);
      expect(r.delta).toBe(0);
      expect(r.newRating).toBe(1300);
    });

    it('a provisional win moves fast (K=40)', () => {
      const r = applyUpdate(1000, 1000, 1, 0);
      expect(r.k).toBe(40);
      expect(r.delta).toBe(20);
      expect(r.newRating).toBe(1020);
    });

    it('never drops below the floor of 100', () => {
      // Losing to a far stronger opponent costs ~0 (doc §4), so the
      // floor is exercised by losing at equal strength instead.
      const r = applyUpdate(105, 105, 0, 10);
      expect(r.delta).toBe(-16);
      expect(r.newRating).toBe(100);
    });
  });

  describe('scoreForResult / mirrorResult', () => {
    it('maps WIN/DRAW/LOSS to 1/0.5/0 and mirrors them', () => {
      expect(scoreForResult('WIN')).toBe(1);
      expect(scoreForResult('DRAW')).toBe(0.5);
      expect(scoreForResult('LOSS')).toBe(0);
      expect(mirrorResult('WIN')).toBe('LOSS');
      expect(mirrorResult('DRAW')).toBe('DRAW');
      expect(mirrorResult('LOSS')).toBe('WIN');
    });
  });

  describe('candleRating', () => {
    it('is the 0.5/0.5 mix of the two parts', () => {
      expect(candleRating(1200, 1000)).toBe(1100);
      expect(candleRating(1224.3, 1000)).toBe(1112.2);
    });
  });

  describe('displayRating', () => {
    it('rounds the stored 1-decimal rating to an integer', () => {
      expect(displayRating(1224.3)).toBe(1224);
      expect(displayRating(1224.5)).toBe(1225);
    });
  });

  describe('currentSeason / isValidSeason', () => {
    it('maps months to quarters (UTC)', () => {
      expect(currentSeason(new Date('2026-01-15T00:00:00.000Z'))).toBe('2026-Q1');
      expect(currentSeason(new Date('2026-04-01T00:00:00.000Z'))).toBe('2026-Q2');
      expect(currentSeason(new Date('2026-11-11T00:00:00.000Z'))).toBe('2026-Q4');
      expect(currentSeason(new Date('2026-12-31T23:59:59.000Z'))).toBe('2026-Q4');
    });

    it('validates season strings', () => {
      expect(isValidSeason('2026-Q4')).toBe(true);
      expect(isValidSeason('2026-Q5')).toBe(false);
      expect(isValidSeason('2026-4')).toBe(false);
      expect(isValidSeason('Q4-2026')).toBe(false);
    });
  });

  describe('softReset', () => {
    it('moves halfway toward 1000, preserving order', () => {
      expect(softReset(1600)).toBe(1300);
      expect(softReset(800)).toBe(900);
      expect(softReset(1000)).toBe(1000);
      expect(softReset(1224.3)).toBe(1112.2);
    });
  });

  describe('decayFor', () => {
    it('does nothing within the 30-day grace', () => {
      expect(decayFor(1300, 30)).toEqual({ delta: 0, newRating: 1300 });
      expect(decayFor(1300, 0)).toEqual({ delta: 0, newRating: 1300 });
    });

    it('drifts 10 points per started week past the grace', () => {
      expect(decayFor(1300, 31)).toEqual({ delta: -10, newRating: 1290 });
      expect(decayFor(1300, 37)).toEqual({ delta: -20, newRating: 1280 });
      expect(decayFor(1300, 40)).toEqual({ delta: -20, newRating: 1280 });
    });

    it('caps at 50 points per run', () => {
      expect(decayFor(1300, 100)).toEqual({ delta: -50, newRating: 1250 });
      expect(decayFor(1300, 365)).toEqual({ delta: -50, newRating: 1250 });
    });

    it('drifts upward toward 1000 from below, never overshooting it', () => {
      expect(decayFor(800, 40)).toEqual({ delta: 20, newRating: 820 });
      expect(decayFor(1010, 40)).toEqual({ delta: -10, newRating: 1000 });
      expect(decayFor(1005, 100)).toEqual({ delta: -5, newRating: 1000 });
    });

    it('can never go below the floor: decay always moves toward 1000', () => {
      // A low rating drifts UP toward 1000, never down…
      expect(decayFor(105, 100)).toEqual({ delta: 50, newRating: 155 });
      expect(decayFor(120, 100)).toEqual({ delta: 50, newRating: 170 });
      // …and a high rating stops at 1000 at the lowest (1000 > floor 100).
      expect(decayFor(1005, 100)).toEqual({ delta: -5, newRating: 1000 });
    });

    it('does nothing at exactly 1000', () => {
      expect(decayFor(1000, 200)).toEqual({ delta: 0, newRating: 1000 });
    });
  });

  describe('tradingScore', () => {
    it('wins above index + 2, loses below index − 2, draws within ±2', () => {
      expect(tradingScore(5, 1)).toBe(1); // +4
      expect(tradingScore(3.01, 1)).toBe(1); // +2.01
      expect(tradingScore(3, 1)).toBe(0.5); // exactly +2
      expect(tradingScore(1, 1)).toBe(0.5);
      expect(tradingScore(-1, 1)).toBe(0.5); // exactly −2
      expect(tradingScore(-1.01, 1)).toBe(0); // −2.01
      expect(tradingScore(-5, 1)).toBe(0);
    });
  });

  describe('mondayOfWeek', () => {
    it('returns the Monday (00:00 UTC) of the containing week', () => {
      // Wednesday 2026-11-11 -> Monday 2026-11-09.
      expect(mondayOfWeek(new Date('2026-11-11T15:30:00.000Z')).toISOString()).toBe(
        '2026-11-09T00:00:00.000Z'
      );
      // Sunday 2026-11-15 -> Monday 2026-11-09.
      expect(mondayOfWeek(new Date('2026-11-15T23:59:00.000Z')).toISOString()).toBe(
        '2026-11-09T00:00:00.000Z'
      );
      // Monday itself is unchanged.
      expect(mondayOfWeek(new Date('2026-11-09T00:00:00.000Z')).toISOString()).toBe(
        '2026-11-09T00:00:00.000Z'
      );
    });
  });
});
