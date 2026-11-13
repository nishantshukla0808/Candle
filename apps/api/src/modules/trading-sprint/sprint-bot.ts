import { DUELS, SPRINT_BOT_BANDS } from '@candle/shared';

/**
 * Sprint bot — docs/14 §5 (pure, no I/O).
 *
 * Mira trades a sprint by RULES, not by randomness — the same rules
 * every sprint, so her trades are reproducible from the duel seed +
 * the public price path. She is a teaching opponent: disciplined,
 * transparent, beatable. Her strategy, in full:
 *
 *   1. MOMENTUM: every minute, for each instrument, compare the current
 *      simulated price with the price 5 minutes ago
 *      (momentum = (P_now − P_5min) / P_5min, from the deterministic
 *      price engine — public prices only, no hidden information).
 *      Momentum above +threshold with no position → BUY.
 *      Momentum below −threshold while holding → SELL half (trim the loser).
 *   2. TAKE PROFIT: a position up ≥ 1% vs its average cost → SELL half.
 *   3. STOP LOSS: a position down ≥ 1% vs its average cost → SELL all.
 *      (A stop-loss always beats the momentum trim: the rules are
 *      checked in this order, one order per instrument per minute.)
 *   4. SIZE + CAPS: one buy spends `sizeShare` of her current cash,
 *      never more than 30% of her portfolio value in one instrument,
 *      never more than 12 trades in a sprint, at most one order per
 *      instrument per minute. She never buys what she cannot afford,
 *      never sells what she does not hold, never uses leverage, never
 *      shorts — the same constraints as a human player (ADR 0011 §3).
 *
 * Skill bands (SPRINT_BOT_BANDS, by the player's Trading Rating):
 * a stronger player faces a sharper Mira — a lower momentum threshold
 * (she reacts to smaller moves) and a larger size per trade. The bands
 * are the trading mirror of BOT_ACCURACY_BY_RATING (docs/07 §5).
 *
 * Determinism: the instrument evaluation order each minute is shuffled
 * with mulberry32 seeded by (seed + minute), so the same (seed, prices,
 * rating, cash, holdings) always yields the same orders. The shuffle
 * only breaks ties between instruments — the decisions are the rules.
 * (mulberry32 + FNV-1a here are the same pattern as
 * duels/bot-simulation.ts, duplicated — not imported — so the trading
 * module does not depend on the duels module's internals.)
 */

export interface BotPricePoint {
  instrumentId: string;
  symbol: string;
  /** Current simulated price per unit. */
  priceNow: number;
  /** Simulated price per unit 5 minutes ago (same deterministic engine). */
  price5MinAgo: number;
}

export interface BotHolding {
  quantity: number;
  avgCost: number;
}

export interface BotDecisionInput {
  /** Duel seed (the market seed on the Duel row). */
  seed: string;
  /** The human player's Trading Rating at match time. */
  playerTradingRating: number;
  /** Mira's current virtual cash. */
  cash: number;
  /** Mira's current holdings by instrument id. */
  holdings: Record<string, BotHolding>;
  /** One point per instrument in the sprint (all 6 fictional tickers). */
  prices: BotPricePoint[];
  /** Trades Mira has already made in this sprint. */
  tradeCount: number;
  /** Whole-minute index of the sprint (0 = first minute). */
  minuteIndex: number;
}

export interface BotOrder {
  instrumentId: string;
  side: 'BUY' | 'SELL';
  /** Whole units. */
  quantity: number;
}

/** The skill band for a Trading Rating (first band whose maxRating covers it). */
export function botBandFor(playerTradingRating: number): {
  momentumThreshold: number;
  sizeShare: number;
} {
  for (const band of SPRINT_BOT_BANDS) {
    if (playerTradingRating <= band.maxRating) {
      return { momentumThreshold: band.momentumThreshold, sizeShare: band.sizeShare };
    }
  }
  const last = SPRINT_BOT_BANDS[SPRINT_BOT_BANDS.length - 1] as {
    momentumThreshold: number;
    sizeShare: number;
  };
  return { momentumThreshold: last.momentumThreshold, sizeShare: last.sizeShare };
}

function hashSeed(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Mira's orders for one minute tick. At most one order per instrument,
 * at most SPRINT_BOT_MAX_TRADES total in the sprint (further calls
 * return no orders once the cap is hit). Never an order she cannot
 * afford or a sell she cannot cover — the engine re-validates every
 * order through the same path as a human order, so a bot bug can never
 * invent cash or holdings.
 */
export function decideBotTrades(input: BotDecisionInput): BotOrder[] {
  const band = botBandFor(input.playerTradingRating);
  const orders: BotOrder[] = [];
  if (input.tradeCount >= DUELS.SPRINT_BOT_MAX_TRADES) return orders;

  // Portfolio value (cash + holdings at current prices) for the
  // 30%-per-instrument cap.
  let portfolioValue = input.cash;
  const valueById = new Map<string, number>();
  for (const p of input.prices) {
    const h = input.holdings[p.instrumentId];
    const value = h ? h.quantity * p.priceNow : 0;
    valueById.set(p.instrumentId, value);
    portfolioValue += value;
  }

  // Seeded instrument order (tie-breaks only — decisions are the rules).
  const rng = mulberry32(hashSeed(`${input.seed}:${input.minuteIndex}`));
  const shuffled = [...input.prices];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = shuffled[i] as BotPricePoint;
    shuffled[i] = shuffled[j] as BotPricePoint;
    shuffled[j] = tmp;
  }

  for (const p of shuffled) {
    if (input.tradeCount + orders.length >= DUELS.SPRINT_BOT_MAX_TRADES) break;
    if (p.priceNow <= 0 || p.price5MinAgo <= 0) continue;
    const momentum = (p.priceNow - p.price5MinAgo) / p.price5MinAgo;
    const holding = input.holdings[p.instrumentId];
    const qty = holding?.quantity ?? 0;

    if (qty > 0 && holding) {
      const pnlPct = (p.priceNow - holding.avgCost) / holding.avgCost;
      // Stop loss first: a losing position is closed in full.
      if (pnlPct <= -DUELS.SPRINT_BOT_STOP_LOSS_PCT) {
        orders.push({ instrumentId: p.instrumentId, side: 'SELL', quantity: qty });
        continue;
      }
      // Take profit, then momentum trim: both sell half (at least 1 unit).
      if (pnlPct >= DUELS.SPRINT_BOT_TAKE_PROFIT_PCT || momentum < -band.momentumThreshold) {
        const sellQty = Math.max(1, Math.floor(qty / 2));
        orders.push({ instrumentId: p.instrumentId, side: 'SELL', quantity: sellQty });
        continue;
      }
    } else if (momentum > band.momentumThreshold) {
      // Momentum buy: sizeShare of cash, capped at 30% of portfolio value.
      const maxSpend = DUELS.SPRINT_BOT_MAX_POSITION_SHARE * portfolioValue;
      const spend = Math.min(input.cash * band.sizeShare, maxSpend);
      const buyQty = Math.floor(spend / p.priceNow);
      if (buyQty >= 1) {
        orders.push({ instrumentId: p.instrumentId, side: 'BUY', quantity: buyQty });
      }
    }
  }
  return orders;
}
