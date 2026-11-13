import { decideCrisisBotTrades, type CrisisBotDecisionInput } from './crisis-bot';

/**
 * Crisis bot — docs/15 §7.
 * Before the crash Mira trades by the normal sprint rules; once the
 * crash fires she sells ALL of every holding to cash and stays in
 * cash (no re-buy during the crash or the recovery).
 */
function input(overrides: Partial<CrisisBotDecisionInput> = {}): CrisisBotDecisionInput {
  return {
    seed: 'seed-1',
    playerTradingRating: 1000,
    cash: 50000,
    holdings: {},
    prices: [
      { instrumentId: 'nvlt', symbol: 'NVLT', priceNow: 800, price5MinAgo: 800 },
      { instrumentId: 'kvrf', symbol: 'KVRF', priceNow: 300, price5MinAgo: 300 },
    ],
    tradeCount: 0,
    minuteIndex: 3,
    crashFired: false,
    ...overrides,
  };
}

describe('crisis-bot', () => {
  it('before the crash, Mira trades by the normal sprint rules', () => {
    // Strong 5-minute momentum on NVLT → a BUY (the sprint rule).
    const orders = decideCrisisBotTrades(
      input({
        crashFired: false,
        prices: [
          { instrumentId: 'nvlt', symbol: 'NVLT', priceNow: 810, price5MinAgo: 800 },
          { instrumentId: 'kvrf', symbol: 'KVRF', priceNow: 300, price5MinAgo: 300 },
        ],
      })
    );
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({ instrumentId: 'nvlt', side: 'BUY' });
  });

  it('on the first crash tick she sells ALL of every holding to cash', () => {
    const orders = decideCrisisBotTrades(
      input({
        crashFired: true,
        cash: 10000,
        holdings: {
          nvlt: { quantity: 40, avgCost: 800 },
          kvrf: { quantity: 25, avgCost: 300 },
        },
        // Even a position still UP vs its average cost is sold: the
        // crash rule is unconditional, unlike the −1% stop-loss.
        prices: [
          { instrumentId: 'nvlt', symbol: 'NVLT', priceNow: 820, price5MinAgo: 800 },
          { instrumentId: 'kvrf', symbol: 'KVRF', priceNow: 310, price5MinAgo: 300 },
        ],
      })
    );
    expect(orders).toHaveLength(2);
    expect(orders).toContainEqual({ instrumentId: 'nvlt', side: 'SELL', quantity: 40 });
    expect(orders).toContainEqual({ instrumentId: 'kvrf', side: 'SELL', quantity: 25 });
  });

  it('after selling to cash she places no more orders (stays in cash)', () => {
    const orders = decideCrisisBotTrades(
      input({
        crashFired: true,
        cash: 90000,
        holdings: {},
        prices: [
          { instrumentId: 'nvlt', symbol: 'NVLT', priceNow: 850, price5MinAgo: 790 },
          { instrumentId: 'kvrf', symbol: 'KVRF', priceNow: 320, price5MinAgo: 290 },
        ],
      })
    );
    expect(orders).toHaveLength(0);
  });

  it('sells whole units only (a fractional holding sells its floor)', () => {
    const orders = decideCrisisBotTrades(
      input({
        crashFired: true,
        holdings: { nvlt: { quantity: 10.5, avgCost: 800 } },
      })
    );
    expect(orders).toEqual([{ instrumentId: 'nvlt', side: 'SELL', quantity: 10 }]);
  });

  it('places no orders once the 12-trade cap is hit, even in a crash', () => {
    const orders = decideCrisisBotTrades(
      input({
        crashFired: true,
        tradeCount: 12,
        holdings: { nvlt: { quantity: 10, avgCost: 800 } },
      })
    );
    expect(orders).toHaveLength(0);
  });
});
