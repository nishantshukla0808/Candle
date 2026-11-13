import {
  buildWeeklyEquityCurve,
  replayWeeklyPortfolio,
  weeklyEquityAt,
  weeklyIndexReturnPct,
  type WeeklyInstrumentLike,
  type WeeklyTradeLike,
} from './weekly-portfolio';

/**
 * Weekly portfolio replay + equity curve — docs/16 §5 (ADR 0013 §5).
 * No live state: the portfolio is replayed from stored trades, and
 * the curve is start + one sample per trade + settlement.
 */

const NVLT: WeeklyInstrumentLike = {
  id: 'inst-nvlt',
  symbol: 'NVLT',
  name: 'NovaVolt',
  basePrice: 100,
};
const KVRF: WeeklyInstrumentLike = {
  id: 'inst-kvrf',
  symbol: 'KVRF',
  name: 'Kaveri',
  basePrice: 50,
};

/** Flat prices: the market never moves (isolates the replay math). */
const flatPrice = (symbol: string, base: number): number => base;

function trade(over: Partial<WeeklyTradeLike> & { instrumentId: string }): WeeklyTradeLike {
  return {
    symbol: 'NVLT',
    side: 'BUY',
    quantity: 10,
    price: 100,
    executedAtMs: 1000,
    ...over,
  };
}

describe('replayWeeklyPortfolio', () => {
  it('starts from ₹100,000 with no holdings', () => {
    expect(replayWeeklyPortfolio([])).toEqual({ cash: 100000, holdings: [] });
  });

  it('buys spend cash and grow the holding at weighted-average cost', () => {
    const p = replayWeeklyPortfolio([
      trade({ instrumentId: 'inst-nvlt', quantity: 10, price: 100, executedAtMs: 1000 }),
      trade({ instrumentId: 'inst-nvlt', quantity: 10, price: 120, executedAtMs: 2000 }),
    ]);
    expect(p.cash).toBe(97800);
    expect(p.holdings).toHaveLength(1);
    expect(p.holdings[0]?.quantity).toBe(20);
    expect(p.holdings[0]?.avgCost).toBe(110);
  });

  it('sells return cash and shrink the holding without changing avg cost', () => {
    const p = replayWeeklyPortfolio([
      trade({ instrumentId: 'inst-nvlt', quantity: 10, price: 100, executedAtMs: 1000 }),
      trade({
        instrumentId: 'inst-nvlt',
        side: 'SELL',
        quantity: 4,
        price: 110,
        executedAtMs: 2000,
      }),
    ]);
    expect(p.cash).toBe(99440);
    expect(p.holdings[0]?.quantity).toBe(6);
    expect(p.holdings[0]?.avgCost).toBe(100);
  });

  it('removes the holding when fully sold', () => {
    const p = replayWeeklyPortfolio([
      trade({ instrumentId: 'inst-nvlt', quantity: 10, price: 100, executedAtMs: 1000 }),
      trade({
        instrumentId: 'inst-nvlt',
        side: 'SELL',
        quantity: 10,
        price: 90,
        executedAtMs: 2000,
      }),
    ]);
    expect(p.cash).toBe(99900);
    expect(p.holdings).toEqual([]);
  });

  it('replays in execution order, not input order', () => {
    const p = replayWeeklyPortfolio([
      trade({
        instrumentId: 'inst-nvlt',
        side: 'SELL',
        quantity: 5,
        price: 110,
        executedAtMs: 2000,
      }),
      trade({ instrumentId: 'inst-nvlt', quantity: 10, price: 100, executedAtMs: 1000 }),
    ]);
    // Sell after buy (execution order): cash 99000 + 550 = 99550, holding 5.
    expect(p.cash).toBe(99550);
    expect(p.holdings[0]?.quantity).toBe(5);
  });
});

describe('weeklyEquityAt', () => {
  it('values cash + holdings at current prices', () => {
    const p = replayWeeklyPortfolio([
      trade({ instrumentId: 'inst-nvlt', quantity: 10, price: 100 }),
    ]);
    expect(weeklyEquityAt(p, new Map([['inst-nvlt', 110]]))).toBe(100100);
  });
});

describe('buildWeeklyEquityCurve', () => {
  it('is start + one sample per trade + settlement (flat prices)', () => {
    const curve = buildWeeklyEquityCurve(
      [trade({ instrumentId: 'inst-nvlt', executedAtMs: 1000 })],
      [NVLT, KVRF],
      (symbol, base) => flatPrice(symbol, base),
      0,
      2000
    );
    expect(curve).toEqual([
      { t: 0, equity: 100000 },
      { t: 1000, equity: 100000 },
      { t: 2000, equity: 100000 },
    ]);
  });

  it('values the final sample at the settlement prices', () => {
    // Price rises from 100 to 110 after the trade: 10 units bought at
    // 100 are worth 1100 at settlement; cash 99000 + 1100 = 100100.
    const priceAt = (_symbol: string, base: number, at: Date): number =>
      at.getTime() >= 2000 ? 110 : base;
    const curve = buildWeeklyEquityCurve(
      [trade({ instrumentId: 'inst-nvlt', executedAtMs: 1000 })],
      [NVLT, KVRF],
      priceAt,
      0,
      2000
    );
    expect(curve.map((p) => p.equity)).toEqual([100000, 100000, 100100]);
  });

  it('a never-traded player has a flat 2-point curve', () => {
    const curve = buildWeeklyEquityCurve([], [NVLT], flatPrice, 0, 2000);
    expect(curve).toEqual([
      { t: 0, equity: 100000 },
      { t: 2000, equity: 100000 },
    ]);
  });
});

describe('weeklyIndexReturnPct', () => {
  it('is the equal-weighted mean instrument return', () => {
    // NVLT +2%, KVRF −1% → mean +0.5%.
    const priceAt = (symbol: string, base: number, at: Date): number => {
      if (at.getTime() === 0) return base;
      return symbol === 'NVLT' ? base * 1.02 : base * 0.99;
    };
    expect(weeklyIndexReturnPct([NVLT, KVRF], priceAt, 0, 1000)).toBe(0.5);
  });

  it('is 0 with no instruments', () => {
    expect(weeklyIndexReturnPct([], flatPrice, 0, 1000)).toBe(0);
  });
});
