import {
  computeRiskMetrics,
  decideSprintWinner,
  riskAdjustedScoreFor,
  summariseTrades,
} from './sprint-scoring';

/**
 * Sprint scoring — docs/14 §3 (ADR 0011 §3).
 * The risk-adjusted score, worked examples pinned: a steady 2% beats a
 * wild 3%, a risky loss scores worse than a calm loss, no-trade is 0.
 */
describe('sprint-scoring', () => {
  describe('riskAdjustedScoreFor', () => {
    it('divides a gain by (1 + volatility + drawdown)', () => {
      expect(riskAdjustedScoreFor(2, 1, 0.5)).toBe(0.8);
    });

    it('a steady 2% beats a wild 3% (the headline example)', () => {
      const steady = riskAdjustedScoreFor(2, 1, 0.5);
      const wild = riskAdjustedScoreFor(3, 4, 2);
      expect(steady).toBe(0.8);
      expect(wild).toBeCloseTo(3 / 7, 4);
      expect(steady).toBeGreaterThan(wild);
    });

    it('multiplies a loss by (1 + volatility + drawdown) — risk never shrinks a loss', () => {
      expect(riskAdjustedScoreFor(-2, 1, 1)).toBe(-6);
      expect(riskAdjustedScoreFor(-2, 0, 0)).toBe(-2);
    });

    it('no return means no score, whatever the risk', () => {
      expect(riskAdjustedScoreFor(0, 5, 5)).toBe(0);
    });

    it('clamps the score to ±100', () => {
      expect(riskAdjustedScoreFor(200, 0, 0)).toBe(100);
      expect(riskAdjustedScoreFor(-200, 0, 0)).toBe(-100);
    });

    it('never goes negative on volatility/drawdown inputs', () => {
      expect(riskAdjustedScoreFor(2, -1, -1)).toBe(2);
    });
  });

  describe('computeRiskMetrics', () => {
    it('a flat curve (no trades) scores exactly 0', () => {
      const m = computeRiskMetrics([100000, 100000, 100000], 100000);
      expect(m.returnPct).toBe(0);
      expect(m.realisedVolPct).toBe(0);
      expect(m.maxDrawdownPct).toBe(0);
      expect(m.riskAdjustedScore).toBe(0);
    });

    it('a steady climb: +2% return, no drawdown, tiny volatility', () => {
      const m = computeRiskMetrics([100000, 101000, 102000], 100000);
      expect(m.returnPct).toBe(2);
      expect(m.maxDrawdownPct).toBe(0);
      expect(m.realisedVolPct).toBeCloseTo(0.007, 3);
      expect(m.riskAdjustedScore).toBeCloseTo(2 / (1 + m.realisedVolPct), 3);
    });

    it('a dip and recovery: 0% return, 2% max drawdown, 0 score', () => {
      const m = computeRiskMetrics([100000, 99000, 98000, 100000], 100000);
      expect(m.returnPct).toBe(0);
      expect(m.maxDrawdownPct).toBe(2);
      expect(m.realisedVolPct).toBeGreaterThan(0);
      expect(m.riskAdjustedScore).toBe(0);
    });

    it('a straight fall: negative return, no drawdown beyond the fall itself', () => {
      const m = computeRiskMetrics([100000, 99000, 98000], 100000);
      expect(m.returnPct).toBe(-2);
      expect(m.maxDrawdownPct).toBe(2);
      // Loss × (1 + V + D): strictly worse than −2.
      expect(m.riskAdjustedScore).toBeLessThan(-2);
    });

    it('an empty curve is all zeros (never NaN)', () => {
      const m = computeRiskMetrics([], 100000);
      expect(m).toEqual({
        returnPct: 0,
        realisedVolPct: 0,
        maxDrawdownPct: 0,
        riskAdjustedScore: 0,
      });
    });
  });

  describe('decideSprintWinner', () => {
    it('higher risk-adjusted score wins, even with the lower return', () => {
      expect(
        decideSprintWinner(
          { riskAdjustedScore: 0.8, returnPct: 2 },
          { riskAdjustedScore: 0.4286, returnPct: 3 }
        )
      ).toBe('WIN');
    });

    it('scores within epsilon tie on score — the higher return wins', () => {
      expect(
        decideSprintWinner(
          { riskAdjustedScore: 0.5, returnPct: 1 },
          { riskAdjustedScore: 0.5005, returnPct: 2 }
        )
      ).toBe('LOSS');
    });

    it('equal on score and return is a draw (no-trade vs no-trade)', () => {
      expect(
        decideSprintWinner(
          { riskAdjustedScore: 0, returnPct: 0 },
          { riskAdjustedScore: 0, returnPct: 0 }
        )
      ).toBe('DRAW');
    });
  });

  describe('summariseTrades', () => {
    it('realises sells against the running average cost', () => {
      const out = summariseTrades(
        [
          { instrumentId: 'i1', symbol: 'NVLT', side: 'BUY', quantity: 10, price: 100 },
          { instrumentId: 'i1', symbol: 'NVLT', side: 'SELL', quantity: 4, price: 110 },
        ],
        new Map([['i1', 115]])
      );
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({
        instrumentId: 'i1',
        symbol: 'NVLT',
        trades: 2,
        buyQty: 10,
        sellQty: 4,
        realisedPnl: 40,
        finalQty: 6,
        finalValue: 690,
      });
    });

    it('a losing round trip realises a negative P&L and leaves nothing held', () => {
      const out = summariseTrades(
        [
          { instrumentId: 'i1', symbol: 'NVLT', side: 'BUY', quantity: 10, price: 100 },
          { instrumentId: 'i1', symbol: 'NVLT', side: 'SELL', quantity: 10, price: 90 },
        ],
        new Map([['i1', 90]])
      );
      expect(out[0]).toMatchObject({ realisedPnl: -100, finalQty: 0, finalValue: 0 });
    });

    it('keeps instruments separate, in first-trade order', () => {
      const out = summariseTrades(
        [
          { instrumentId: 'i1', symbol: 'NVLT', side: 'BUY', quantity: 5, price: 100 },
          { instrumentId: 'i2', symbol: 'KVRF', side: 'BUY', quantity: 2, price: 300 },
        ],
        new Map([
          ['i1', 100],
          ['i2', 300],
        ])
      );
      expect(out.map((o) => o.symbol)).toEqual(['NVLT', 'KVRF']);
    });
  });
});
