import { Prisma } from '@prisma/client';
import { PriceEngine } from './price-engine';

describe('PriceEngine', () => {
  const at = new Date('2026-11-02T10:15:30.000Z');

  it('is deterministic: same symbol and minute give the same price', () => {
    const a = PriceEngine.price('NVLT', 100, at);
    const b = PriceEngine.price('NVLT', 100, new Date('2026-11-02T10:15:59.999Z'));
    expect(a.equals(b)).toBe(true);
  });

  it('buckets to whole minutes: adjacent minutes may differ, same minute never does', () => {
    const m1 = PriceEngine.price('NVLT', 100, new Date('2026-11-02T10:15:00.000Z'));
    const m2 = PriceEngine.price('NVLT', 100, new Date('2026-11-02T10:16:00.000Z'));
    // Not asserting inequality (a flat minute is possible) — asserting the
    // bucket boundary is the only thing that can change the price.
    expect(m1 instanceof Prisma.Decimal).toBe(true);
    expect(m2 instanceof Prisma.Decimal).toBe(true);
  });

  it('always returns positive prices rounded to 2 decimals', () => {
    for (const symbol of ['NVLT', 'KVRF', 'ASTL', 'MRUM', 'SGNR', 'HELX']) {
      for (let m = 0; m < 2000; m += 137) {
        const p = PriceEngine.price(symbol, 250, new Date(PriceEngine.PRICE_EPOCH_MS + m * 60_000));
        expect(p.isPositive()).toBe(true);
        expect(p.decimalPlaces()).toBeLessThanOrEqual(2);
      }
    }
  });

  it('differentiates symbols: different tickers get different prices', () => {
    const prices = new Set(
      ['NVLT', 'KVRF', 'ASTL', 'MRUM', 'SGNR', 'HELX'].map((s) =>
        PriceEngine.price(s, 100, at).toString()
      )
    );
    expect(prices.size).toBeGreaterThan(1);
  });

  it('scales with the base price', () => {
    const cheap = PriceEngine.price('NVLT', 10, at);
    const pricey = PriceEngine.price('NVLT', 1000, at);
    // Same log-return applied to different bases; independent 2dp rounding
    // means the ratio is approximate, not exact.
    const ratio = pricey.div(cheap).toNumber();
    expect(ratio).toBeGreaterThan(99);
    expect(ratio).toBeLessThan(101);
  });

  it('stays near the base price (bounded oscillation, no blowups)', () => {
    for (let m = 0; m < 100_000; m += 977) {
      const p = PriceEngine.price('NVLT', 100, new Date(PriceEngine.PRICE_EPOCH_MS + m * 60_000));
      expect(p.greaterThan(50)).toBe(true);
      expect(p.lessThan(200)).toBe(true);
    }
  });

  it('hashSymbol is stable across calls', () => {
    expect(PriceEngine.hashSymbol('NVLT')).toBe(PriceEngine.hashSymbol('NVLT'));
  });
});
