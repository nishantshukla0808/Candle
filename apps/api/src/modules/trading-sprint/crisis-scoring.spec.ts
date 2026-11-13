import { computeRiskMetrics } from './sprint-scoring';
import { computeCrisisMetrics, crisisScoreFor, decideCrisisWinner } from './crisis-scoring';

/**
 * Crisis scoring — docs/15 §5.
 * The sprint formula, with ONE adjustment: the loss branch divides
 * instead of multiplying (the crash imposes a ~12% drawdown on every
 * invested player, so multiplying saturates the ±100 clamp for all
 * holders). Worked examples below are the doc's numbers, pinned.
 *
 * Curves are 16-point minute-sampled equities (start ₹100,000;
 * pre-crash drift to ₹102,000 by minute 6; crash minutes 7–9 to
 * 0.88×; recovery minutes 10–14 to 0.93×):
 *   cash-early: sold to cash at minute 6, flat ₹102,000 after.
 *   calm holder: held through the crash and the recovery.
 *   panic seller: sold everything at the bottom (minute 9), flat after.
 *   half-cash holder: half invested throughout.
 */
const CASH_EARLY = [
  100000, 100300, 100600, 101000, 101300, 101700, 102000, 102000, 102000, 102000, 102000, 102000,
  102000, 102000, 102000, 102000,
];
const CALM_HOLDER = [
  100000, 100300, 100600, 101000, 101300, 101700, 102000, 97920, 93840, 89760, 90780, 91800, 92820,
  93840, 94860, 94860,
];
const PANIC_SELLER = [
  100000, 100300, 100600, 101000, 101300, 101700, 102000, 97920, 93840, 89760, 89760, 89760, 89760,
  89760, 89760, 89760,
];
const HALF_CASH_HOLDER = [
  100000, 100150, 100300, 100500, 100650, 100850, 101000, 98960, 96920, 94940, 95450, 95950, 96460,
  96960, 97470, 97470,
];

describe('crisis-scoring', () => {
  describe('crisisScoreFor', () => {
    it('is identical to the sprint score for gains (risk divides the gain)', () => {
      expect(crisisScoreFor(2.0, 1.0, 0.5)).toBe(0.8);
      expect(crisisScoreFor(3.0, 4.0, 2.0)).toBeCloseTo(0.4286, 4);
      expect(crisisScoreFor(0, 5, 12)).toBe(0);
    });

    it('divides for losses instead of multiplying (the one crisis adjustment)', () => {
      // The sprint would score −2.0 × 3.0 = −6.0 here; the crisis divides.
      expect(crisisScoreFor(-2.0, 1.0, 1.0)).toBeCloseTo(-0.6667, 4);
      expect(crisisScoreFor(-5.14, 7.5803, 12)).toBeCloseTo(-0.2498, 4);
    });

    it('clamps to ±100', () => {
      expect(crisisScoreFor(200, 0, 0)).toBe(100);
      expect(crisisScoreFor(-200, 0, 0)).toBe(-100);
    });
  });

  describe('computeCrisisMetrics — the worked examples (docs/15 §5)', () => {
    it('cash-early: R=+2.00, V=0.6375, D=0, score +1.2214', () => {
      const m = computeCrisisMetrics(CASH_EARLY, 100000);
      expect(m.returnPct).toBe(2);
      expect(m.realisedVolPct).toBe(0.6375);
      expect(m.maxDrawdownPct).toBe(0);
      expect(m.riskAdjustedScore).toBe(1.2214);
    });

    it('calm holder: R=−5.14, V=7.5803, D=12, score −0.2498', () => {
      const m = computeCrisisMetrics(CALM_HOLDER, 100000);
      expect(m.returnPct).toBe(-5.14);
      expect(m.realisedVolPct).toBe(7.5803);
      expect(m.maxDrawdownPct).toBe(12);
      expect(m.riskAdjustedScore).toBe(-0.2498);
    });

    it('panic seller: R=−10.24, V=6.7483, D=12, score −0.5185', () => {
      const m = computeCrisisMetrics(PANIC_SELLER, 100000);
      expect(m.returnPct).toBe(-10.24);
      expect(m.realisedVolPct).toBe(6.7483);
      expect(m.maxDrawdownPct).toBe(12);
      expect(m.riskAdjustedScore).toBe(-0.5185);
    });

    it('half-cash holder: R=−2.53, V=3.6944, D=6, score −0.2366', () => {
      const m = computeCrisisMetrics(HALF_CASH_HOLDER, 100000);
      expect(m.returnPct).toBe(-2.53);
      expect(m.realisedVolPct).toBe(3.6944);
      expect(m.maxDrawdownPct).toBe(6);
      expect(m.riskAdjustedScore).toBe(-0.2366);
    });

    it('the sprint formula clamps holder and panic seller to the same −100 (why the adjustment exists)', () => {
      expect(computeRiskMetrics(CALM_HOLDER, 100000).riskAdjustedScore).toBe(-100);
      expect(computeRiskMetrics(PANIC_SELLER, 100000).riskAdjustedScore).toBe(-100);
    });
  });

  describe('decideCrisisWinner — both required properties', () => {
    const scoreOf = (curve: number[]) => {
      const m = computeCrisisMetrics(curve, 100000);
      return { riskAdjustedScore: m.riskAdjustedScore, returnPct: m.returnPct };
    };

    it('(a) cash-early beats the calm holder', () => {
      expect(decideCrisisWinner(scoreOf(CASH_EARLY), scoreOf(CALM_HOLDER))).toBe('WIN');
      expect(decideCrisisWinner(scoreOf(CALM_HOLDER), scoreOf(CASH_EARLY))).toBe('LOSS');
    });

    it('(b) the calm holder beats the panic seller', () => {
      expect(decideCrisisWinner(scoreOf(CALM_HOLDER), scoreOf(PANIC_SELLER))).toBe('WIN');
      expect(decideCrisisWinner(scoreOf(PANIC_SELLER), scoreOf(CALM_HOLDER))).toBe('LOSS');
    });

    it('a half-cash holder beats an all-in holder (less pre-crash risk, smaller crash loss)', () => {
      expect(decideCrisisWinner(scoreOf(HALF_CASH_HOLDER), scoreOf(CALM_HOLDER))).toBe('WIN');
    });

    it('two no-trade players draw (0 vs 0)', () => {
      const flat = { riskAdjustedScore: 0, returnPct: 0 };
      expect(decideCrisisWinner(flat, flat)).toBe('DRAW');
    });

    it('scores within 0.001 tie on score and the higher return wins', () => {
      const a = { riskAdjustedScore: 0.5, returnPct: 1 };
      const b = { riskAdjustedScore: 0.5005, returnPct: 2 };
      expect(decideCrisisWinner(a, b)).toBe('LOSS');
      expect(decideCrisisWinner(b, a)).toBe('WIN');
    });
  });
});
