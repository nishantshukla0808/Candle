import { Prisma } from '@prisma/client';

/**
 * PriceEngine — deterministic simulated prices for fictional tickers
 * (blueprint §16, ADR 0003/3).
 *
 * Model: price(symbol, base, t) = base * exp(drift*t + Σ amp_i·sin(freq_i·t + phase_i))
 *
 * - `t` is whole minutes since PRICE_EPOCH — prices are bucketed to the
 *   minute, so every read inside the same minute agrees (no jitter
 *   between a quote and the execution that follows it).
 * - Oscillator (freq, phase, amp) triples and the drift are derived from
 *   a FNV-1a hash of the symbol — no randomness, no I/O, no stored ticks.
 * - Same (symbol, minute) ALWAYS yields the same price; exp() keeps
 *   prices positive by construction.
 *
 * This is a teaching toy, not a market model: it has no volatility
 * clustering, no volume, no bid/ask spread, and no relation to any real
 * security. Real market data is explicitly out of scope (blueprint §17).
 */
export class PriceEngine {
  /** Anchor for the minute counter — fixed so prices are stable forever. */
  static readonly PRICE_EPOCH_MS = Date.UTC(2026, 0, 1, 0, 0, 0);

  private static readonly MS_PER_MINUTE = 60_000;
  /** (amplitude, minFreq, maxFreq) per oscillator, freq in rad/minute. */
  private static readonly OSCILLATORS: Array<[number, number, number]> = [
    [0.012, 0.0008, 0.004],
    [0.007, 0.004, 0.012],
    [0.004, 0.012, 0.03],
  ];
  /** Drift per minute, seeded per symbol. Tiny on purpose. */
  private static readonly MAX_DRIFT_PER_MIN = 0.00001;

  /** FNV-1a 32-bit hash — deterministic seed from the symbol. */
  static hashSymbol(symbol: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < symbol.length; i++) {
      h ^= symbol.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  /** Whole minutes since PRICE_EPOCH (negative before the epoch — fine). */
  static minuteIndex(at: Date): number {
    return Math.floor((at.getTime() - PriceEngine.PRICE_EPOCH_MS) / PriceEngine.MS_PER_MINUTE);
  }

  /**
   * Simulated price for a symbol at a timestamp, rounded to 2 decimals.
   * Pure and deterministic: identical inputs → identical output.
   */
  static price(
    symbol: string,
    basePrice: Prisma.Decimal | number | string,
    at: Date
  ): Prisma.Decimal {
    const t = PriceEngine.minuteIndex(at);
    const seed = PriceEngine.hashSymbol(symbol);
    const rand = PriceEngine.mulberry32(seed);

    const drift = (rand() * 2 - 1) * PriceEngine.MAX_DRIFT_PER_MIN;
    let logReturn = drift * t;
    for (const [amp, minFreq, maxFreq] of PriceEngine.OSCILLATORS) {
      const freq = minFreq + rand() * (maxFreq - minFreq);
      const phase = rand() * Math.PI * 2;
      logReturn += amp * Math.sin(freq * t + phase);
    }

    const base = new Prisma.Decimal(basePrice);
    const price = base.mul(new Prisma.Decimal(Math.exp(logReturn)));
    return price.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  }

  /** Deterministic PRNG (mulberry32) seeded from the symbol hash. */
  private static mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
}
