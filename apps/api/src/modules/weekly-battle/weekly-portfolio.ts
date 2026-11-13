import { DUELS, SIMULATOR_STARTING_CASH } from '@candle/shared';

/**
 * Weekly portfolio replay — docs/16 §5 (pure, no I/O).
 *
 * A weekly battle keeps no live portfolio state: there is no socket,
 * no Redis state, no tick. The portfolio is REPLAYED from the stored
 * WeeklyTrade rows whenever it is needed (standings, settlement, the
 * "my portfolio" view). The replay is deterministic — same trades,
 * same portfolio — because every trade carries its server execution
 * price, and the PriceEngine is deterministic per minute.
 *
 * Money is rounded to 2dp at each step, the same convention as the
 * sprint engine (`money()` there). Quantities are whole units.
 */

export type WeeklyTradeSide = 'BUY' | 'SELL';

export interface WeeklyTradeLike {
  instrumentId: string;
  symbol: string;
  side: WeeklyTradeSide;
  /** Whole units. */
  quantity: number;
  /** Server execution price per unit. */
  price: number;
  /** Server execution time (ms epoch). */
  executedAtMs: number;
}

export interface WeeklyHolding {
  instrumentId: string;
  symbol: string;
  quantity: number;
  /** Weighted-average cost per unit. */
  avgCost: number;
}

export interface WeeklyPortfolio {
  cash: number;
  holdings: WeeklyHolding[];
}

export interface WeeklyInstrumentLike {
  id: string;
  symbol: string;
  name: string;
  /** Anchor price for the deterministic price engine. */
  basePrice: number;
}

/** A price function: (symbol, basePrice, at) -> price per unit. */
export type WeeklyPriceFn = (symbol: string, basePrice: number, at: Date) => number;

export interface WeeklyEquityPoint {
  /** ms epoch. */
  t: number;
  /** Portfolio value at that time, 2dp. */
  equity: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Replay a player's trades into a portfolio, in execution order.
 * BUY spends cash and grows the holding (weighted-average cost);
 * SELL returns cash and shrinks the holding (average cost unchanged).
 * Starts from SIMULATOR_STARTING_CASH (₹100,000) with no holdings.
 */
export function replayWeeklyPortfolio(trades: WeeklyTradeLike[]): WeeklyPortfolio {
  let cash = SIMULATOR_STARTING_CASH;
  const byId = new Map<string, WeeklyHolding>();
  const ordered = [...trades].sort((a, b) => a.executedAtMs - b.executedAtMs);
  for (const t of ordered) {
    const total = round2(t.price * t.quantity);
    if (t.side === 'BUY') {
      cash = round2(cash - total);
      const h = byId.get(t.instrumentId) ?? {
        instrumentId: t.instrumentId,
        symbol: t.symbol,
        quantity: 0,
        avgCost: 0,
      };
      const prevCost = h.avgCost * h.quantity;
      h.quantity += t.quantity;
      h.avgCost = h.quantity > 0 ? round2((prevCost + total) / h.quantity) : 0;
      byId.set(t.instrumentId, h);
    } else {
      cash = round2(cash + total);
      const h = byId.get(t.instrumentId);
      if (!h) continue;
      h.quantity -= t.quantity;
      if (h.quantity <= 0) byId.delete(t.instrumentId);
    }
  }
  return { cash, holdings: [...byId.values()] };
}

/** Portfolio value at a set of prices (by instrument id), 2dp. */
export function weeklyEquityAt(portfolio: WeeklyPortfolio, prices: Map<string, number>): number {
  let equity = portfolio.cash;
  for (const h of portfolio.holdings) {
    equity += h.quantity * (prices.get(h.instrumentId) ?? 0);
  }
  return round2(equity);
}

/**
 * The equity curve for scoring (docs/16 §5): the starting cash at the
 * season start, one sample after EACH trade (the portfolio replayed
 * up to that trade, valued at that trade's minute prices), and the
 * final sample at `endAtMs`.
 *
 * There is no scheduler or tick for a week-long duel in v1, so V/D
 * come from trade-time + settlement samples, not a fixed daily grid —
 * recorded as a limitation in ADR 0013 §9. A player who trades once
 * has a 3-point curve; a player who never trades has a flat 2-point
 * curve (start + settlement) and scores 0 on the risk metrics when
 * the market is flat (docs/14 §3: R=0 → score 0, whatever V and D).
 */
export function buildWeeklyEquityCurve(
  trades: WeeklyTradeLike[],
  instruments: WeeklyInstrumentLike[],
  priceAt: WeeklyPriceFn,
  startedAtMs: number,
  endAtMs: number
): WeeklyEquityPoint[] {
  const pricesAt = (atMs: number): Map<string, number> => {
    const out = new Map<string, number>();
    for (const inst of instruments) {
      out.set(inst.id, priceAt(inst.symbol, inst.basePrice, new Date(atMs)));
    }
    return out;
  };
  const ordered = [...trades].sort((a, b) => a.executedAtMs - b.executedAtMs);
  const points: WeeklyEquityPoint[] = [{ t: startedAtMs, equity: SIMULATOR_STARTING_CASH }];
  for (const t of ordered) {
    const upto = ordered.filter((x) => x.executedAtMs <= t.executedAtMs);
    const portfolio = replayWeeklyPortfolio(upto);
    points.push({ t: t.executedAtMs, equity: weeklyEquityAt(portfolio, pricesAt(t.executedAtMs)) });
  }
  const finalPortfolio = replayWeeklyPortfolio(ordered);
  points.push({ t: endAtMs, equity: weeklyEquityAt(finalPortfolio, pricesAt(endAtMs)) });
  return points;
}

/**
 * The simulated index return for a week (docs/04 §5): the
 * equal-weighted mean return of the 6 fictional instruments from
 * `fromMs` to `toMs`, in %. The Trading Rating is scored against this
 * number — every player in every league of the season shares it.
 */
export function weeklyIndexReturnPct(
  instruments: WeeklyInstrumentLike[],
  priceAt: WeeklyPriceFn,
  fromMs: number,
  toMs: number
): number {
  if (instruments.length === 0) return 0;
  let sum = 0;
  for (const inst of instruments) {
    const from = priceAt(inst.symbol, inst.basePrice, new Date(fromMs));
    const to = priceAt(inst.symbol, inst.basePrice, new Date(toMs));
    if (from > 0) sum += ((to - from) / from) * 100;
  }
  return Math.round((sum / instruments.length) * 10000) / 10000;
}

/** League size guard: a league never exceeds this (30 + a merged singleton). */
export const WEEKLY_MAX_LEAGUE_SIZE = DUELS.WEEKLY_MAX_LEAGUE_SIZE;
