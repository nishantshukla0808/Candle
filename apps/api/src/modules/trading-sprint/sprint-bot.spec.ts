import { botBandFor, decideBotTrades, type BotDecisionInput } from './sprint-bot';

/**
 * Sprint bot — docs/14 §5 (ADR 0011 §5).
 * Mira trades by rules, not by randomness: momentum buys, take-profit
 * and stop-loss sells, size + trade caps. Deterministic per seed.
 */
function baseInput(overrides: Partial<BotDecisionInput> = {}): BotDecisionInput {
  return {
    seed: 'sprint-seed-1',
    playerTradingRating: 1000,
    cash: 100000,
    holdings: {},
    prices: [
      { instrumentId: 'i1', symbol: 'NVLT', priceNow: 100, price5MinAgo: 100 },
      { instrumentId: 'i2', symbol: 'KVRF', priceNow: 300, price5MinAgo: 300 },
    ],
    tradeCount: 0,
    minuteIndex: 1,
    ...overrides,
  };
}

describe('sprint-bot', () => {
  describe('botBandFor', () => {
    it('a stronger player faces a sharper bot (lower threshold, bigger size)', () => {
      expect(botBandFor(1000)).toEqual({ momentumThreshold: 0.004, sizeShare: 0.15 });
      expect(botBandFor(1200)).toEqual({ momentumThreshold: 0.0035, sizeShare: 0.18 });
      expect(botBandFor(1400)).toEqual({ momentumThreshold: 0.003, sizeShare: 0.2 });
      expect(botBandFor(1600)).toEqual({ momentumThreshold: 0.0025, sizeShare: 0.22 });
      expect(botBandFor(1800)).toEqual({ momentumThreshold: 0.002, sizeShare: 0.25 });
    });
  });

  describe('decideBotTrades', () => {
    it('is deterministic: same input, same orders', () => {
      const input = baseInput({
        prices: [
          { instrumentId: 'i1', symbol: 'NVLT', priceNow: 105, price5MinAgo: 100 },
          { instrumentId: 'i2', symbol: 'KVRF', priceNow: 290, price5MinAgo: 300 },
        ],
      });
      expect(decideBotTrades(input)).toEqual(decideBotTrades(input));
    });

    it('buys on strong momentum: 15% of cash at rating 1000', () => {
      const orders = decideBotTrades(
        baseInput({
          prices: [{ instrumentId: 'i1', symbol: 'NVLT', priceNow: 105, price5MinAgo: 100 }],
        })
      );
      // Momentum +5% > 0.4% threshold; spend min(15% × 100000, 30% × 100000) = 15000.
      expect(orders).toEqual([{ instrumentId: 'i1', side: 'BUY', quantity: 142 }]);
    });

    it('does not buy on weak momentum', () => {
      const orders = decideBotTrades(
        baseInput({
          prices: [{ instrumentId: 'i1', symbol: 'NVLT', priceNow: 100.1, price5MinAgo: 100 }],
        })
      );
      expect(orders).toEqual([]);
    });

    it('stop-loss sells the whole position (a losing position is closed in full)', () => {
      const orders = decideBotTrades(
        baseInput({
          holdings: { i1: { quantity: 10, avgCost: 100 } },
          prices: [{ instrumentId: 'i1', symbol: 'NVLT', priceNow: 98.5, price5MinAgo: 100 }],
        })
      );
      expect(orders).toEqual([{ instrumentId: 'i1', side: 'SELL', quantity: 10 }]);
    });

    it('take-profit sells half the position', () => {
      const orders = decideBotTrades(
        baseInput({
          holdings: { i1: { quantity: 10, avgCost: 100 } },
          prices: [{ instrumentId: 'i1', symbol: 'NVLT', priceNow: 101.5, price5MinAgo: 100 }],
        })
      );
      expect(orders).toEqual([{ instrumentId: 'i1', side: 'SELL', quantity: 5 }]);
    });

    it('trims half on negative momentum while holding', () => {
      const orders = decideBotTrades(
        baseInput({
          holdings: { i1: { quantity: 10, avgCost: 100 } },
          prices: [{ instrumentId: 'i1', symbol: 'NVLT', priceNow: 100, price5MinAgo: 101 }],
        })
      );
      expect(orders).toEqual([{ instrumentId: 'i1', side: 'SELL', quantity: 5 }]);
    });

    it('holds when momentum is flat and the position is flat', () => {
      const orders = decideBotTrades(
        baseInput({
          holdings: { i1: { quantity: 10, avgCost: 100 } },
          prices: [{ instrumentId: 'i1', symbol: 'NVLT', priceNow: 100, price5MinAgo: 100.05 }],
        })
      );
      expect(orders).toEqual([]);
    });

    it('never trades past the 12-trade cap', () => {
      const orders = decideBotTrades(
        baseInput({
          tradeCount: 12,
          prices: [{ instrumentId: 'i1', symbol: 'NVLT', priceNow: 105, price5MinAgo: 100 }],
        })
      );
      expect(orders).toEqual([]);
    });

    it('never buys what it cannot afford (cash below one unit)', () => {
      const orders = decideBotTrades(
        baseInput({
          cash: 50,
          prices: [{ instrumentId: 'i1', symbol: 'NVLT', priceNow: 105, price5MinAgo: 100 }],
        })
      );
      expect(orders).toEqual([]);
    });

    it('one order per instrument per minute, even when two rules fire', () => {
      const orders = decideBotTrades(
        baseInput({
          holdings: { i1: { quantity: 10, avgCost: 100 } },
          // Up 2% (take-profit) AND momentum −2% (trim): exactly one SELL of half.
          prices: [{ instrumentId: 'i1', symbol: 'NVLT', priceNow: 102, price5MinAgo: 104.08 }],
        })
      );
      expect(orders).toEqual([{ instrumentId: 'i1', side: 'SELL', quantity: 5 }]);
    });
  });
});
