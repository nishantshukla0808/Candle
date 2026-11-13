import { DUELS } from '@candle/shared';
import { decideBotTrades, type BotDecisionInput, type BotOrder } from './sprint-bot';

/**
 * Crisis bot — docs/15 §7 (pure, no I/O).
 *
 * Mira's crash behaviour, in full: the moment the crash fires she
 * sells ALL of every holding to cash, and she stays in cash for the
 * rest of the duel — no re-buy during the crash or the recovery.
 * She is the teaching opponent for "what calm looks like": her
 * normal rules already include a −1% stop-loss (sprint-bot.ts), so
 * she would usually sell on the first crash tick anyway — but the
 * stop-loss only fires when a position is down vs its average cost,
 * and a position bought cheap months ago (in duel-minutes) could
 * still be up after a −4% minute. The crash rule closes that gap:
 * it is unconditional on the crash, not conditional on her cost.
 *
 * Implementation: a thin wrapper over the sprint bot. While the
 * crash has not fired, Mira trades by the normal rules
 * (`decideBotTrades`). Once `crashFired` is true:
 *   - holdings non-empty → one SELL-all order per held instrument
 *     (the first crash tick empties her; later ticks find nothing
 *     to sell and return no orders);
 *   - holdings empty → no orders at all (she never re-buys).
 * Her orders execute through the same `executeOrder` path as humans
 * (the engine calls this from the crisis bot step), and her trades
 * are not persisted as rows — same as the sprint bot (docs/14 §5).
 */

export interface CrisisBotDecisionInput extends BotDecisionInput {
  /** True once the crash has fired in this duel (engine state). */
  crashFired: boolean;
}

/**
 * Mira's orders for one minute tick in a Crisis Duel. At most one
 * order per instrument; at most SPRINT_BOT_MAX_TRADES total (the
 * normal cap still applies — the crash sell-all counts toward it,
 * like any other trade).
 */
export function decideCrisisBotTrades(input: CrisisBotDecisionInput): BotOrder[] {
  if (!input.crashFired) return decideBotTrades(input);
  const orders: BotOrder[] = [];
  if (input.tradeCount >= DUELS.SPRINT_BOT_MAX_TRADES) return orders;
  for (const [instrumentId, holding] of Object.entries(input.holdings)) {
    if (input.tradeCount + orders.length >= DUELS.SPRINT_BOT_MAX_TRADES) break;
    const qty = Math.floor(holding.quantity);
    if (qty >= 1) {
      orders.push({ instrumentId, side: 'SELL', quantity: qty });
    }
  }
  return orders;
}
