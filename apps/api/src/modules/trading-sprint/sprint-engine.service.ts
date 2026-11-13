import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DuelStatus, DuelType, Prisma, RatingKind, SimOrderSide } from '@prisma/client';
import { DUELS, ErrorCode, SIMULATOR_STARTING_CASH } from '@candle/shared';
import { CONFIG } from '../../config/config.module';
import type { AppConfig } from '../../config/configuration';
import { AppError } from '../../common/errors/app-error';
import { AppLogger } from '../../common/services/logger.service';
import { RedisService } from '../../common/services/redis.service';
import { TransactionService } from '../../database/transaction.service';
import type { RewardSummary } from '../gamification/gamification.service';
import { GamificationService } from '../gamification/gamification.service';
import { RatingsService } from '../ratings/ratings.service';
import { DuelResult as DtoDuelResult } from '../ratings/dto/ratings.dto';
import { PriceEngine } from '../simulator/price-engine';
import { SimulatorRepository } from '../simulator/simulator.repository';
import { decideBotTrades } from './sprint-bot';
import { decideCrisisBotTrades } from './crisis-bot';
import {
  computeCrashDrawdownPct,
  computePanicSold,
  crashFactorAt,
  crashPanicWindowMs,
  crashWindowMs,
  crisisMinuteAt,
  deriveCrashMinute,
  tradesDuringCrash,
} from './crisis-crash';
import { computeCrisisMetrics, decideCrisisWinner } from './crisis-scoring';
import {
  computeRiskMetrics,
  decideSprintWinner,
  mirrorSprintOutcome,
  summariseTrades,
  type SprintOutcome,
} from './sprint-scoring';
import {
  parseSprintState,
  sprintDuelStateKey,
  sprintUserDuelKey,
  tradingDuelStateKey,
  tradingEventPrefix,
  tradingRematchKey,
  tradingUserDuelKey,
  type SprintPlayerState,
  type SprintState,
  type SprintTradeEntry,
  type TradingDuelVariant,
} from './sprint-state';
import { SprintRepository, type SprintDuelRow } from './sprint.repository';
import { SprintService, sprintRatingReasonFor, type SprintResultView } from './sprint.service';

/**
 * Transport out of the engine. The engine never imports Socket.IO:
 * the gateway implements this interface, so the engine is unit-testable
 * with a recording emitter and the transport can change without
 * touching sprint logic (blueprint §4).
 */
export interface SprintEmitter {
  toUser(userId: string, event: string, payload: unknown): void;
  toRoom(duelId: string, event: string, payload: unknown): void;
}

export interface SprintPlayerRef {
  userId: string;
  displayName: string;
  /** Trading Rating at match time. */
  rating: number;
}

export interface SprintMatchedPayload {
  duelId: string;
  opponent: { userId: string; displayName: string; rating: number; kind: 'HUMAN' | 'BOT' };
  host: { name: string; line: string };
  /** Starting cash for BOTH players (2dp string) — always ₹1,00,000. */
  startingCash: string;
  instruments: Array<{ id: string; symbol: string; name: string }>;
  countdownEndsAtMs: number;
  serverNowMs: number;
}

/** My active trading duel (sprint or crisis), for reconnect / resume on page load. */
export interface TradingDuelSummary {
  duelId: string;
  type: 'SPRINT' | 'CRISIS';
  phase: string;
  startedAtMs: number | null;
  endsAtMs: number | null;
  serverNowMs: number;
  myEquity: string;
  opponentEquity: string | null;
  opponent: { userId: string; displayName: string; kind: 'HUMAN' | 'BOT' } | null;
  /** Crisis only: whether the crash has fired. */
  crashFired?: boolean;
}

const HOST_INTRO =
  '15 minutes, same market, same ₹1,00,000. Best risk-adjusted return wins — not the biggest gain. Good luck.';
const HOST_RESULT_WIN =
  'Well played — you won on risk-adjusted return, not just on return. That is the skill that lasts.';
const HOST_RESULT_LOSS =
  'Good fight. Your risk panel below shows where the return came from — steady beats wild over time.';
const HOST_RESULT_DRAW = 'A dead heat on risk-adjusted return. Rematch, and the next one is yours.';
const CRISIS_HOST_INTRO =
  '15 minutes, same market, same ₹1,00,000 — and somewhere in the middle, the market crashes. ' +
  'Nobody knows when. Smallest loss + calmest decisions wins. Good luck.';
const CRISIS_HOST_RESULT_WIN =
  'Well played — you won the crash, not just the market. Staying calm when prices fall is the skill that lasts.';
const CRISIS_HOST_RESULT_LOSS =
  'Good fight. The crash panel below shows how far you fell and whether you sold into it — holding through recovers part of the fall.';
const CRISIS_HOST_RESULT_DRAW =
  'A dead heat through the crash. Rematch, and the next crash is yours to survive.';

const START_CASH = new Prisma.Decimal(SIMULATOR_STARTING_CASH);
const ZERO = new Prisma.Decimal(0);

function money(d: Prisma.Decimal): Prisma.Decimal {
  return d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

function fmt(d: Prisma.Decimal): string {
  return money(d).toFixed(2);
}

/**
 * SprintEngine — docs/05 §1 T1, docs/14 (Phase 9), docs/15 (Phase 10).
 *
 * Owns the Paper Trading Sprint AND the Crisis Duel (T2): the crisis
 * is a variant of this engine, not a second engine (docs/15 §3). The
 * variant lives on the Redis state (`variant: 'SPRINT' | 'CRISIS'`)
 * and picks the Redis keyspace, the socket event prefix, the price
 * path (the crash factor, crisis only), the scoring (crisis only)
 * and the bot step (crisis only). The timer, order execution,
 * disconnect grace, settlement ordering and rematch rules are shared
 * and identical for both variants — a change to them changes both
 * duels, which is the point of the parameterisation.
 *
 * This is a DIFFERENT engine from the live question engine
 * (LiveDuelEngine): a sprint has no questions, no per-question reveal,
 * and no answer grading — it has orders, portfolios, and an equity
 * curve. The patterns are shared (Redis state, server-owned timers,
 * Ratings-first settlement, idempotent re-settle, 15 s disconnect
 * grace, 5-minute rematch cooldown, 30 s bot offer), the mechanics are
 * not. Nothing here imports the live engine's question flow.
 *
 * State lives in Redis; Postgres is the source of truth after the
 * sprint ends. Timers live on this process (v1, single server): a
 * reconnect to another server re-arms them from the Redis state (see
 * handleReconnect / rearmTimers), but a process crash mid-sprint voids
 * the sprint rather than inventing a result — see docs/14 §7.
 */
@Injectable()
export class SprintEngine implements OnModuleDestroy {
  /** One emitter per variant: the sprint gateway binds 'SPRINT', the crisis gateway 'CRISIS'. */
  private readonly emitters = new Map<TradingDuelVariant, SprintEmitter>();
  private readonly timers = new Map<string, { handle: NodeJS.Timeout; interval: boolean }>();

  constructor(
    private readonly redis: RedisService,
    private readonly repo: SprintRepository,
    private readonly simRepo: SimulatorRepository,
    private readonly ratings: RatingsService,
    private readonly gamification: GamificationService,
    private readonly transactions: TransactionService,
    private readonly sprints: SprintService,
    private readonly logger: AppLogger,
    @Inject(CONFIG) private readonly config: AppConfig
  ) {}

  onModuleDestroy(): void {
    for (const t of this.timers.values()) {
      if (t.interval) clearInterval(t.handle);
      else clearTimeout(t.handle);
    }
    this.timers.clear();
  }

  /** The gateway binds itself here after init (engine never imports Socket.IO). */
  bindEmitter(emitter: SprintEmitter, variant: TradingDuelVariant = 'SPRINT'): void {
    this.emitters.set(variant, emitter);
  }

  /** Current Redis state for a sprint (the gateway re-reads it for rematch emits). */
  async getState(duelId: string): Promise<SprintState | null> {
    return this.loadState(duelId);
  }

  /** Test/ops cleanup: clear every armed timer for a sprint (or all). */
  clearTimers(duelId?: string): void {
    for (const [key, t] of [...this.timers.entries()]) {
      if (!duelId || key.startsWith(`${duelId}:`)) {
        if (t.interval) clearInterval(t.handle);
        else clearTimeout(t.handle);
        this.timers.delete(key);
      }
    }
  }

  private arm(key: string, ms: number, fn: () => void): void {
    this.clearTimer(key);
    const handle = setTimeout(fn, Math.max(0, ms));
    if (typeof handle.unref === 'function') handle.unref();
    this.timers.set(key, { handle, interval: false });
  }

  private armInterval(key: string, ms: number, fn: () => void): void {
    this.clearTimer(key);
    const handle = setInterval(fn, Math.max(1, ms));
    if (typeof handle.unref === 'function') handle.unref();
    this.timers.set(key, { handle, interval: true });
  }

  private clearTimer(key: string): void {
    const t = this.timers.get(key);
    if (!t) return;
    if (t.interval) clearInterval(t.handle);
    else clearTimeout(t.handle);
    this.timers.delete(key);
  }

  private emitToUser(
    userId: string,
    event: string,
    payload: unknown,
    variant: TradingDuelVariant
  ): void {
    this.emitters.get(variant)?.toUser(userId, event, payload);
  }

  private emitRoom(
    duelId: string,
    event: string,
    payload: unknown,
    variant: TradingDuelVariant
  ): void {
    this.emitters.get(variant)?.toRoom(duelId, event, payload);
  }

  /**
   * Loads a duel's Redis state. The variant is stored ON the state,
   * so a load by duel id alone must try both keyspaces (sprint first,
   * then crisis) — the callers that know the variant already (the
   * gateways) never call this; they go through the user-duel keys.
   */
  private async loadState(duelId: string): Promise<SprintState | null> {
    const sprint = parseSprintState(await this.redis.get(sprintDuelStateKey(duelId)));
    if (sprint) return sprint;
    return parseSprintState(await this.redis.get(tradingDuelStateKey(duelId, 'CRISIS')));
  }

  private async saveState(state: SprintState): Promise<void> {
    await this.redis.set(
      tradingDuelStateKey(state.duelId, state.variant),
      JSON.stringify(state),
      DUELS.SPRINT_STATE_TTL_SEC
    );
    await this.redis.set(
      tradingUserDuelKey(state.playerA.userId, state.variant),
      state.duelId,
      DUELS.SPRINT_STATE_TTL_SEC
    );
    if (state.playerB) {
      await this.redis.set(
        tradingUserDuelKey(state.playerB.userId, state.variant),
        state.duelId,
        DUELS.SPRINT_STATE_TTL_SEC
      );
    }
  }

  /** Deletes a duel's state + user-duel keys (settlement cleanup, either variant). */
  private async deleteStateKeys(state: SprintState): Promise<void> {
    await this.redis.del(tradingDuelStateKey(state.duelId, state.variant));
    await this.redis.del(tradingUserDuelKey(state.playerA.userId, state.variant));
    if (state.playerB) {
      await this.redis.del(tradingUserDuelKey(state.playerB.userId, state.variant));
    }
  }

  /** The active-duel id for a user in either variant (sprint first, then crisis). */
  private async userDuelId(
    userId: string
  ): Promise<{ duelId: string; variant: TradingDuelVariant } | null> {
    const sprintId = await this.redis.get(sprintUserDuelKey(userId));
    if (sprintId) return { duelId: sprintId, variant: 'SPRINT' };
    const crisisId = await this.redis.get(tradingUserDuelKey(userId, 'CRISIS'));
    if (crisisId) return { duelId: crisisId, variant: 'CRISIS' };
    return null;
  }

  // --- match creation ---------------------------------------------------------

  /**
   * Creates a human-vs-human sprint: one market for both players (the
   * same instruments, the same starting cash, the same minute-bucketed
   * prices — market fairness is structural, docs/14 §2), one Duel row
   * (type SPRINT, questionIds = []), Redis state in COUNTDOWN.
   */
  async createSprint(
    a: SprintPlayerRef,
    b: SprintPlayerRef,
    now: Date = new Date()
  ): Promise<SprintState> {
    return this.createTradingDuel(a, b, 'SPRINT', now);
  }

  /**
   * Creates a human-vs-human Crisis Duel (docs/15 §3): exactly the
   * sprint creation path, with variant CRISIS — one Duel row (type
   * CRISIS), Redis state in COUNTDOWN with the seeded crash minute.
   * The crash minute is derived from the market seed and stored on
   * the state; it is never sent to a client before settlement.
   */
  async createCrisis(
    a: SprintPlayerRef,
    b: SprintPlayerRef,
    now: Date = new Date()
  ): Promise<SprintState> {
    return this.createTradingDuel(a, b, 'CRISIS', now);
  }

  private async createTradingDuel(
    a: SprintPlayerRef,
    b: SprintPlayerRef,
    variant: TradingDuelVariant,
    now: Date = new Date()
  ): Promise<SprintState> {
    const instruments = await this.listSprintInstruments();
    const seed = randomUUID();
    const duel = await this.repo.createDuel({
      playerAId: a.userId,
      playerBId: b.userId,
      seed,
      type: variant === 'CRISIS' ? DuelType.CRISIS : DuelType.SPRINT,
    });
    const state = this.newState(duel, a, b, instruments, seed, now, variant);
    await this.saveState(state);
    this.arm(
      `${duel.id}:countdown`,
      this.config.LIVE_COUNTDOWN_MS,
      () => void this.startTrading(duel.id)
    );
    this.logger.info('Trading duel created', {
      duelId: duel.id,
      variant,
      a: a.userId,
      b: b.userId,
    });
    return state;
  }

  /**
   * Creates a rated sprint vs the Mira bot (the 30-second bot offer,
   * docs/05 §3.3). The bot trades by the documented rules
   * (sprint-bot.ts) on the same market and the same timer as a human
   * — rated via recordTradingDuelVsBot at the player's own Trading
   * Rating, because the player queued for a rated sprint; silently
   * switching them to unrated practice would change the stakes after
   * a 30-second wait.
   */
  async createBotSprint(player: SprintPlayerRef, now: Date = new Date()): Promise<SprintState> {
    return this.createBotTradingDuel(player, 'SPRINT', now);
  }

  /**
   * Creates a rated Crisis Duel vs the Mira bot (docs/15 §7): the
   * same bot-offer path as a sprint, with variant CRISIS — Mira sells
   * to cash on the first crash tick and stays in cash (crisis-bot.ts).
   */
  async createBotCrisis(player: SprintPlayerRef, now: Date = new Date()): Promise<SprintState> {
    return this.createBotTradingDuel(player, 'CRISIS', now);
  }

  private async createBotTradingDuel(
    player: SprintPlayerRef,
    variant: TradingDuelVariant,
    now: Date = new Date()
  ): Promise<SprintState> {
    const instruments = await this.listSprintInstruments();
    const seed = randomUUID();
    const duel = await this.repo.createDuel({
      playerAId: player.userId,
      playerBId: null,
      seed,
      type: variant === 'CRISIS' ? DuelType.CRISIS : DuelType.SPRINT,
    });
    const bot: SprintPlayerRef = {
      userId: 'bot:mira',
      displayName: DUELS.BOT_NAME,
      rating: player.rating,
    };
    const state = this.newState(duel, player, bot, instruments, seed, now, variant);
    state.isBot = true;
    await this.saveState(state);
    this.arm(
      `${duel.id}:countdown`,
      this.config.LIVE_COUNTDOWN_MS,
      () => void this.startTrading(duel.id)
    );
    this.logger.info('Trading bot duel created', {
      duelId: duel.id,
      variant,
      userId: player.userId,
    });
    return state;
  }

  /** Payload the gateway sends each player on `sprint:matched` / `crisis:matched`. */
  matchedPayload(state: SprintState, userId: string): SprintMatchedPayload {
    const meIsA = state.playerA.userId === userId;
    const opponent = state.isBot
      ? {
          userId: 'bot:mira',
          displayName: DUELS.BOT_NAME,
          rating: state.playerA.rating,
          kind: 'BOT' as const,
        }
      : meIsA
        ? {
            userId: state.playerB?.userId ?? '',
            displayName: state.playerB?.displayName ?? 'Player',
            rating: state.playerB?.rating ?? 1000,
            kind: 'HUMAN' as const,
          }
        : {
            userId: state.playerA.userId,
            displayName: state.playerA.displayName,
            rating: state.playerA.rating,
            kind: 'HUMAN' as const,
          };
    return {
      duelId: state.duelId,
      opponent,
      host: {
        name: DUELS.SPRINT_HOST_NAME,
        line: state.variant === 'CRISIS' ? CRISIS_HOST_INTRO : HOST_INTRO,
      },
      startingCash: state.startCash,
      instruments: state.instruments.map((i) => ({ id: i.id, symbol: i.symbol, name: i.name })),
      countdownEndsAtMs: state.countdownEndsAtMs,
      serverNowMs: Date.now(),
    };
  }

  /** The sprint's instruments: every active fictional instrument, snapshotted at match time. */
  private async listSprintInstruments(): Promise<SprintState['instruments']> {
    const rows = await this.simRepo.listActiveInstruments();
    if (rows.length === 0) {
      throw AppError.serviceUnavailable('No fictional instruments are available right now.');
    }
    return rows.map((r) => ({
      id: r.id,
      symbol: r.symbol,
      name: r.name,
      basePrice: new Prisma.Decimal(r.basePrice).toFixed(2),
    }));
  }

  // --- trading flow (server owns the clock) ------------------------------------

  /**
   * Starts the 15-minute trading window: phase TRADING, the end timer,
   * the 30-second tick interval, and the first equity sample. The
   * `sprint:started` payload carries the instruments WITH current
   * prices and the player's own cash — never the opponent's holdings
   * or orders.
   */
  async startTrading(duelId: string, now: Date = new Date()): Promise<void> {
    const state = await this.loadState(duelId);
    if (!state || state.phase !== 'COUNTDOWN') return;
    state.phase = 'TRADING';
    state.startedAtMs = now.getTime();
    state.endsAtMs = now.getTime() + this.config.SPRINT_DURATION_MS;
    this.sampleEquity(state, now);
    await this.saveState(state);
    // Per-player start (each player gets their OWN cash + portfolio —
    // a room broadcast would leak player A's cash to player B).
    for (const player of [state.playerA, state.playerB]) {
      if (!player) continue;
      this.emitToUser(
        player.userId,
        `${tradingEventPrefix(state.variant)}:started`,
        this.startedPayload(state, player, now),
        state.variant
      );
    }
    this.armInterval(`${duelId}:tick`, this.config.SPRINT_TICK_MS, () => void this.tick(duelId));
    this.arm(
      `${duelId}:end`,
      this.config.SPRINT_DURATION_MS,
      () => void this.settleDuel(duelId, new Date())
    );
  }

  /**
   * One tick: broadcast prices + both players' TOTAL equity (never
   * holdings or orders), sample the equity curve when a new minute
   * starts, and — in a bot sprint — let Mira trade on the new minute
   * (docs/14 §5). Ticks are 30 s; equity is sampled per minute, so a
   * tick inside a minute broadcasts without sampling.
   *
   * Crisis only (docs/15 §4): the tick also fires the crash. When the
   * crisis minute reaches the seeded crash minute, the state flips
   * `crashFired`, the room gets one `crisis:crash` event (the banner),
   * and every price from then on carries the crash factor. The check
   * runs on EVERY tick, not only on a new minute — in a shortened
   * test duel the wall-clock minute never advances, but the crisis
   * minute does, so the crash must not depend on minute sampling.
   */
  async tick(duelId: string, now: Date = new Date()): Promise<void> {
    const state = await this.loadState(duelId);
    if (!state || state.phase !== 'TRADING') return;
    const minuteAdvanced = this.sampleEquity(state, now);
    if (minuteAdvanced && state.isBot) {
      await this.botStep(state, now);
    }
    if (state.variant === 'CRISIS' && !state.crashFired && state.crashMinute !== null) {
      const crashMinuteNow = state.startedAtMs
        ? crisisMinuteAt(now.getTime(), state.startedAtMs, this.config.SPRINT_DURATION_MS)
        : 0;
      if (crashMinuteNow >= state.crashMinute) {
        state.crashFired = true;
        state.crashFiredAtMs = now.getTime();
        // The bot sells to cash on the first crash tick: run her crash
        // step now, not on the next minute boundary (docs/15 §7).
        if (state.isBot) await this.botStep(state, now, true);
        await this.saveState(state);
        this.emitRoom(
          duelId,
          `${tradingEventPrefix(state.variant)}:crash`,
          {
            duelId,
            crashMinute: state.crashMinute,
            crashFiredAtMs: state.crashFiredAtMs,
            dropPct: DUELS.CRISIS_CRASH_DROP_PCT,
            dropMinutes: DUELS.CRISIS_CRASH_DROP_MINUTES,
            recoveryPct: DUELS.CRISIS_CRASH_RECOVERY_PCT,
            serverNowMs: now.getTime(),
          },
          state.variant
        );
        this.logger.info('Crisis crash fired', { duelId, crashMinute: state.crashMinute });
      }
    }
    await this.saveState(state);
    this.emitRoom(
      duelId,
      `${tradingEventPrefix(state.variant)}:tick`,
      this.tickPayload(state, now),
      state.variant
    );
  }

  /**
   * Records one order. The server prices it from the deterministic
   * price engine at the current minute (the same price for both
   * players), validates funds/holdings, and applies it to the player's
   * Redis portfolio. A retried clientOrderId replays the stored order
   * (never a second trade). The opponent learns nothing except the new
   * total equity on the next tick.
   */
  async placeOrder(
    userId: string,
    duelId: string,
    input: { instrumentId: string; side: SimOrderSide; quantity: number; clientOrderId: string },
    now: Date = new Date()
  ): Promise<{
    order: SprintTradeEntry;
    portfolio: ReturnType<SprintEngine['portfolioOf']>;
  }> {
    const state = await this.loadState(duelId);
    if (!state || state.phase !== 'TRADING') {
      if (state?.variant === 'CRISIS') {
        throw AppError.crisisNotActive('This Crisis Duel is not active any more.');
      }
      throw AppError.sprintNotActive('This Paper Trading Sprint is not active any more.');
    }
    const side = this.sideOf(state, userId);
    if (!side) throw AppError.forbidden();
    // Idempotency FIRST: a retried clientOrderId replays the stored
    // order, even after the cap or the timer would now reject it.
    const replayed = state.trades.find(
      (t) => t.userId === userId && t.clientOrderId === input.clientOrderId
    );
    if (replayed) {
      return { order: replayed, portfolio: this.portfolioOf(state, side, now) };
    }
    if (side.executedOrderIds.includes(input.clientOrderId)) {
      throw AppError.conflict('This order was already placed.');
    }
    if (
      !Number.isInteger(input.quantity) ||
      input.quantity < DUELS.SPRINT_MIN_ORDER_QTY ||
      input.quantity > DUELS.SPRINT_MAX_ORDER_QTY
    ) {
      throw AppError.validationFailed([
        {
          field: 'quantity',
          issue: `Quantity must be a whole number of units, ${DUELS.SPRINT_MIN_ORDER_QTY}–${DUELS.SPRINT_MAX_ORDER_QTY}.`,
        },
      ]);
    }
    if (side.tradeCount >= DUELS.SPRINT_MAX_ORDERS_PER_PLAYER) {
      throw AppError.validationFailed([
        {
          field: 'quantity',
          issue: `You have placed the maximum ${DUELS.SPRINT_MAX_ORDERS_PER_PLAYER} orders for this sprint.`,
        },
      ]);
    }
    const order = this.executeOrder(state, side, input, now, true);
    await this.saveState(state);
    this.emitToUser(
      userId,
      `${tradingEventPrefix(state.variant)}:order-accepted`,
      {
        duelId,
        order,
        portfolio: this.portfolioOf(state, side, now),
      },
      state.variant
    );
    this.emitRoom(
      duelId,
      `${tradingEventPrefix(state.variant)}:tick`,
      this.tickPayload(state, now),
      state.variant
    );
    return { order, portfolio: this.portfolioOf(state, side, now) };
  }

  /**
   * Executes one order against a player's Redis portfolio (shared by
   * human orders and bot orders — one code path, no special casing).
   * Prices come from the deterministic engine at the current minute;
   * BUY needs the cash, SELL needs the holding. Throws domain errors
   * (INSUFFICIENT_FUNDS / INSUFFICIENT_HOLDINGS) — never a row.
   */
  private executeOrder(
    state: SprintState,
    player: SprintPlayerState,
    input: { instrumentId: string; side: SimOrderSide; quantity: number; clientOrderId: string },
    now: Date,
    recordLog: boolean
  ): SprintTradeEntry {
    const instrument = state.instruments.find((i) => i.id === input.instrumentId);
    if (!instrument) {
      throw AppError.validationFailed([
        { field: 'instrumentId', issue: 'This instrument is not part of this sprint.' },
      ]);
    }
    // Crisis-aware price: the crash factor is already in here (docs/15 §4) —
    // a human order during the crash executes at the crashed price, exactly
    // like the tick prices show. The client never sends a price.
    const price = this.priceOf(state, instrument, now);
    const qty = new Prisma.Decimal(input.quantity);
    const totalValue = money(price.mul(qty));
    const cash = new Prisma.Decimal(player.cash);
    if (input.side === SimOrderSide.BUY) {
      if (totalValue.greaterThan(cash)) {
        throw AppError.insufficientFunds(
          `This order costs ${fmt(totalValue)} virtual cash but the portfolio holds ${fmt(cash)}.`
        );
      }
      player.cash = fmt(cash.sub(totalValue));
      const holding = player.holdings[instrument.id];
      const prevQty = holding ? new Prisma.Decimal(holding.quantity) : ZERO;
      const prevCost = holding ? new Prisma.Decimal(holding.avgCost).mul(prevQty) : ZERO;
      const newQty = prevQty.add(qty);
      const newAvg = money(prevCost.add(totalValue).div(newQty));
      player.holdings[instrument.id] = {
        quantity: newQty.toFixed(6),
        avgCost: newAvg.toFixed(2),
      };
    } else {
      const holding = player.holdings[instrument.id];
      const heldQty = holding ? new Prisma.Decimal(holding.quantity) : ZERO;
      if (heldQty.lessThan(qty)) {
        throw AppError.insufficientHoldings(
          `Cannot sell ${qty.toString()} units — the portfolio holds ${heldQty.toString()}.`
        );
      }
      player.cash = fmt(cash.add(totalValue));
      const newQty = heldQty.sub(qty);
      if (newQty.isZero()) {
        delete player.holdings[instrument.id];
      } else if (holding) {
        player.holdings[instrument.id] = {
          quantity: newQty.toFixed(6),
          avgCost: holding.avgCost,
        };
      }
    }
    player.tradeCount += 1;
    player.executedOrderIds.push(input.clientOrderId);
    const order: SprintTradeEntry = {
      userId: player.userId,
      instrumentId: instrument.id,
      symbol: instrument.symbol,
      side: input.side,
      quantity: qty.toFixed(6),
      price: fmt(price),
      totalValue: fmt(totalValue),
      clientOrderId: input.clientOrderId,
      executedAtMs: now.getTime(),
    };
    if (recordLog) state.trades.push(order);
    return order;
  }

  /**
   * Mira's minute step (bot sprints only): she decides from the public
   * prices (now vs 5 minutes ago) and her own cash/holdings, then each
   * decision executes through the same executeOrder path as a human
   * order. Her trades are NOT appended to the human trade log — they
   * are reproducible from the seed + the documented strategy
   * (docs/14 §5), and her summary is computed from her player state
   * at settlement.
   *
   * Crisis only (docs/15 §7): when `forceCrash` is true (the tick
   * that fired the crash) — or whenever the crash has already fired —
   * she decides by the crisis rule instead: sell ALL of every holding
   * to cash, and never re-buy. The crash step runs on the crash tick
   * itself, not on the next minute boundary.
   */
  private async botStep(state: SprintState, now: Date, forceCrash = false): Promise<void> {
    if (!state.playerB) return;
    const bot = state.playerB;
    const startMinute = state.startedAtMs
      ? Math.floor(state.startedAtMs / 60000)
      : Math.floor(now.getTime() / 60000);
    const minuteIndex = Math.floor(now.getTime() / 60000) - startMinute;
    const fiveMinAgo = new Date(now.getTime() - 5 * 60000);
    const prices = state.instruments.map((i) => ({
      instrumentId: i.id,
      symbol: i.symbol,
      priceNow: Number(this.priceOf(state, i, now)),
      price5MinAgo: Number(this.priceOf(state, i, fiveMinAgo)),
    }));
    const holdings: Record<string, { quantity: number; avgCost: number }> = {};
    for (const [id, h] of Object.entries(bot.holdings)) {
      holdings[id] = { quantity: Number(h.quantity), avgCost: Number(h.avgCost) };
    }
    const isCrisis = state.variant === 'CRISIS';
    const decisions = isCrisis
      ? decideCrisisBotTrades({
          seed: state.seed,
          playerTradingRating: state.playerA.rating,
          cash: Number(bot.cash),
          holdings,
          prices,
          tradeCount: bot.tradeCount,
          minuteIndex,
          crashFired: forceCrash || state.crashFired,
        })
      : decideBotTrades({
          seed: state.seed,
          playerTradingRating: state.playerA.rating,
          cash: Number(bot.cash),
          holdings,
          prices,
          tradeCount: bot.tradeCount,
          minuteIndex,
        });
    for (const d of decisions) {
      try {
        this.executeOrder(
          state,
          bot,
          {
            instrumentId: d.instrumentId,
            side: d.side === 'BUY' ? SimOrderSide.BUY : SimOrderSide.SELL,
            quantity: d.quantity,
            clientOrderId: `bot:${state.duelId}:${minuteIndex}:${d.instrumentId}`,
          },
          now,
          false
        );
      } catch {
        // A bot order that fails validation (e.g. cash moved since the
        // decision) is skipped, never retried — the bot trades again
        // next minute. A bot bug must never break the human's sprint.
        continue;
      }
    }
  }

  // --- pricing / portfolios (server-side, from the deterministic engine) ------

  /**
   * One instrument's price at a timestamp (Decimal, 2dp). The base is
   * the Phase 2 deterministic engine at the current wall-clock minute
   * (the same price for both players). Crisis only (docs/15 §4): the
   * crash factor multiplies the base price — 1.00 before the crash,
   * 0.96/0.92/0.88 across the 3-minute fall, then +0.01/minute for 5
   * minutes to 0.93. The factor runs on CRISIS minutes (duration/15),
   * so it fires proportionally in a shortened test duel.
   */
  private priceOf(
    state: SprintState,
    instrument: SprintState['instruments'][number],
    at: Date
  ): Prisma.Decimal {
    const base = PriceEngine.price(instrument.symbol, instrument.basePrice, at);
    if (state.variant !== 'CRISIS' || !state.startedAtMs || state.crashMinute === null) {
      return base;
    }
    const m = crisisMinuteAt(at.getTime(), state.startedAtMs, this.config.SPRINT_DURATION_MS);
    const factor = crashFactorAt(m, state.crashMinute);
    if (factor === 1) return base;
    return money(base.mul(new Prisma.Decimal(factor)));
  }

  /** Current simulated prices for the sprint's instruments (Decimal, 2dp). */
  private pricesAt(
    state: SprintState,
    at: Date
  ): Array<{ instrumentId: string; symbol: string; price: Prisma.Decimal }> {
    return state.instruments.map((i) => ({
      instrumentId: i.id,
      symbol: i.symbol,
      price: this.priceOf(state, i, at),
    }));
  }

  /** One player's portfolio value at a timestamp (cash + holdings at current prices). */
  private equityOf(state: SprintState, player: SprintPlayerState, at: Date): Prisma.Decimal {
    const prices = new Map(this.pricesAt(state, at).map((p) => [p.instrumentId, p.price]));
    let equity = new Prisma.Decimal(player.cash);
    for (const [instrumentId, h] of Object.entries(player.holdings)) {
      const price = prices.get(instrumentId);
      if (!price) continue;
      equity = equity.add(price.mul(new Prisma.Decimal(h.quantity)));
    }
    return money(equity);
  }

  /** One player's full portfolio view (own holdings only — never the opponent's). */
  portfolioOf(state: SprintState, player: SprintPlayerState, at: Date) {
    const prices = new Map(this.pricesAt(state, at).map((p) => [p.instrumentId, p.price]));
    let equity = new Prisma.Decimal(player.cash);
    const holdings = [];
    for (const [instrumentId, h] of Object.entries(player.holdings)) {
      const instrument = state.instruments.find((i) => i.id === instrumentId);
      const price = prices.get(instrumentId);
      if (!instrument || !price) continue;
      const qty = new Prisma.Decimal(h.quantity);
      const avgCost = new Prisma.Decimal(h.avgCost);
      const marketValue = money(price.mul(qty));
      const costBasis = money(avgCost.mul(qty));
      equity = equity.add(marketValue);
      holdings.push({
        instrumentId,
        symbol: instrument.symbol,
        name: instrument.name,
        quantity: qty.toString(),
        avgCost: fmt(avgCost),
        currentPrice: fmt(price),
        marketValue: fmt(marketValue),
        unrealizedPnl: fmt(marketValue.sub(costBasis)),
      });
    }
    return { cash: fmt(new Prisma.Decimal(player.cash)), totalEquity: fmt(equity), holdings };
  }

  /**
   * Samples the equity curve when a new whole minute starts. Returns
   * true when a sample was taken (a new minute began). Prices are
   * minute-bucketed, so sampling per minute captures every price move
   * — a 30-second tick inside a minute adds no new information.
   * The curve is the input to the risk metrics (docs/14 §3).
   */
  private sampleEquity(state: SprintState, now: Date): boolean {
    const minute = Math.floor(now.getTime() / 60000);
    if (state.lastSampleMinute !== null && minute <= state.lastSampleMinute) return false;
    state.lastSampleMinute = minute;
    for (const player of [state.playerA, state.playerB]) {
      if (!player) continue;
      const curve = (state.equityCurve[player.userId] ??= []);
      curve.push({ t: now.getTime(), equity: fmt(this.equityOf(state, player, now)) });
    }
    return true;
  }

  private startedPayload(state: SprintState, player: SprintPlayerState, now: Date) {
    const prices = this.pricesAt(state, now);
    return {
      duelId: state.duelId,
      instruments: state.instruments.map((i) => ({
        id: i.id,
        symbol: i.symbol,
        name: i.name,
        price: fmt(prices.find((p) => p.instrumentId === i.id)?.price ?? ZERO),
      })),
      cash: player.cash,
      portfolio: this.portfolioOf(state, player, now),
      startedAtMs: state.startedAtMs,
      endsAtMs: state.endsAtMs,
      serverNowMs: now.getTime(),
    };
  }

  private tickPayload(state: SprintState, now: Date) {
    const prices = this.pricesAt(state, now);
    const equities: Record<string, { userId: string; equity: string }> = {};
    for (const player of [state.playerA, state.playerB]) {
      if (!player) continue;
      equities[player.userId] = {
        userId: player.userId,
        equity: fmt(this.equityOf(state, player, now)),
      };
    }
    return {
      duelId: state.duelId,
      serverNowMs: now.getTime(),
      endsAtMs: state.endsAtMs,
      prices: prices.map((p) => ({
        instrumentId: p.instrumentId,
        symbol: p.symbol,
        price: fmt(p.price),
      })),
      // Total equity only — never holdings or orders (docs/14 §4).
      equities,
      // Crisis only: whether the crash has fired (the banner trigger).
      // The crash MINUTE is never sent — only that it has happened.
      ...(state.variant === 'CRISIS'
        ? { crashFired: state.crashFired, crashFiredAtMs: state.crashFiredAtMs }
        : {}),
    };
  }

  // --- disconnect / reconnect / forfeit --------------------------------------------

  /**
   * A socket dropped mid-sprint: mark the player disconnected and start
   * the 15-second grace (docs/05 §3.1). The opponent sees a
   * "reconnecting…" notice, not a forfeit — yet. Trading continues for
   * the other player: the market does not pause.
   */
  async handleDisconnect(userId: string, now: Date = new Date()): Promise<void> {
    const found = await this.userDuelId(userId);
    if (!found) return;
    const state = await this.loadState(found.duelId);
    if (!state || state.phase === 'FINISHED') return;
    const duelId = found.duelId;
    const side = this.sideOf(state, userId);
    if (!side || side.disconnectedAtMs !== null) return;
    side.disconnectedAtMs = now.getTime();
    await this.saveState(state);
    this.emitRoom(
      duelId,
      `${tradingEventPrefix(state.variant)}:opponent-disconnected`,
      {
        duelId,
        userId,
        graceSeconds: Math.round(this.config.LIVE_DISCONNECT_GRACE_MS / 1000),
      },
      state.variant
    );
    this.arm(
      `${duelId}:grace:${userId}`,
      this.config.LIVE_DISCONNECT_GRACE_MS,
      () => void this.forfeitIfStillDisconnected(duelId, userId)
    );
  }

  /**
   * A socket reconnected: clear the grace, tell the opponent, and
   * resend the current sprint state so trading resumes where it was.
   * Late-join is impossible — only the two players on the duel row
   * ever receive its events (the gateway joins no other socket to
   * the room).
   */
  async handleReconnect(userId: string, now: Date = new Date()): Promise<void> {
    const found = await this.userDuelId(userId);
    if (!found) return;
    const duelId = found.duelId;
    const state = await this.loadState(found.duelId);
    if (!state || state.phase === 'FINISHED') return;
    const side = this.sideOf(state, userId);
    if (!side) return;
    const wasDisconnected = side.disconnectedAtMs !== null;
    side.disconnectedAtMs = null;
    await this.saveState(state);
    this.clearTimer(`${duelId}:grace:${userId}`);
    if (wasDisconnected) {
      this.emitRoom(
        duelId,
        `${tradingEventPrefix(state.variant)}:opponent-reconnected`,
        { duelId, userId },
        state.variant
      );
    }
    // Re-arm the timers this process owns from the Redis state, so a
    // reconnect to a different server resumes the sprint (docs/05 §3.4).
    this.rearmTimers(state, now);
    await this.resendCurrent(userId, state, now);
  }

  /** Grace expired with no reconnect: the disconnected player forfeits. */
  async forfeitIfStillDisconnected(duelId: string, userId: string): Promise<void> {
    const state = await this.loadState(duelId);
    if (!state || state.phase === 'FINISHED') return;
    const side = this.sideOf(state, userId);
    if (!side || side.disconnectedAtMs === null) return;
    this.logger.info('Sprint forfeit on disconnect', { duelId, userId });
    await this.settleDuel(duelId, new Date(), userId);
  }

  /** A player leaves voluntarily mid-sprint: that is a forfeit too. */
  async leaveSprint(userId: string, duelId: string): Promise<void> {
    const state = await this.loadState(duelId);
    if (!state || state.phase === 'FINISHED') return;
    if (!this.sideOf(state, userId)) throw AppError.forbidden();
    await this.settleDuel(duelId, new Date(), userId);
  }

  // --- settlement (Trading Rating once, then trades + results + XP in one tx) ------

  /**
   * Settles a sprint. Ordering follows ADR 0006/7: the Trading Rating
   * call runs FIRST (a cap failure fails cleanly there — see the
   * fallback below), then the Duel row + SprintTrade rows + both
   * SprintDuelResult rows + both XP grants commit in one sprint
   * transaction. The idempotency key is `duel:{duelId}`; a crash
   * between the two steps is recovered by a re-settle reading the
   * deltas back from history (getDuelOutcome, kind TRADING).
   *
   * Rating-cap fallback (deviation, ADR 0007 §8.2 carries over): if
   * the Ratings call fails on a cap/cooldown at settle time, the
   * sprint still settles — result + XP are stored, the Rating is left
   * unchanged, and the reason says so in plain words. Losing a played
   * sprint's result would be worse than a missed Rating update, and
   * the caps are checked again at the next sprint.
   */
  async settleDuel(
    duelId: string,
    now: Date = new Date(),
    forfeitedByUserId?: string
  ): Promise<SprintResultView | null> {
    const state = await this.loadState(duelId);
    const duel = await this.repo.findDuelById(duelId);
    if (!duel) throw AppError.notFound('Sprint not found.');
    if (duel.status === DuelStatus.SETTLED) {
      // Already settled (double timer / retry): replay, never re-apply.
      return this.sprints.getResult(duel.playerAId, duelId);
    }
    if (!state) {
      // Redis state lost mid-sprint (docs/05 §3.2): void, no Rating change.
      this.logger.error('Sprint state lost in Redis — voiding without Rating change', {
        duelId,
      });
      throw AppError.serviceUnavailable(
        'This sprint could not be finished — the live state was lost. No Rating changed.'
      );
    }
    state.phase = 'FINISHED';
    if (forfeitedByUserId) state.forfeitedByUserId = forfeitedByUserId;
    // Final equity sample, so the curve ends at the settlement value.
    this.sampleEquity(state, now);
    const lastA = state.equityCurve[state.playerA.userId]?.at(-1);
    if (!lastA || lastA.t !== now.getTime()) {
      state.equityCurve[state.playerA.userId]?.push({
        t: now.getTime(),
        equity: fmt(this.equityOf(state, state.playerA, now)),
      });
    }
    if (state.playerB) {
      const lastB = state.equityCurve[state.playerB.userId]?.at(-1);
      if (!lastB || lastB.t !== now.getTime()) {
        state.equityCurve[state.playerB.userId]?.push({
          t: now.getTime(),
          equity: fmt(this.equityOf(state, state.playerB, now)),
        });
      }
    }
    await this.saveState(state);

    const startCash = Number(state.startCash);
    const finalPrices = new Map(
      this.pricesAt(state, now).map((p) => [p.instrumentId, Number(p.price)])
    );
    // Crisis only (docs/15 §5/§8): the crash window for the per-player
    // crash stats. Null when the duel never started (forfeit during
    // the countdown) — then every crash stat is 0 / false.
    const isCrisis = state.variant === 'CRISIS';
    const crashWindow =
      isCrisis && state.startedAtMs !== null && state.crashMinute !== null
        ? crashWindowMs(state.startedAtMs, state.crashMinute, this.config.SPRINT_DURATION_MS)
        : null;
    // Panic stats use the panic window, not the strict fall window:
    // the fall plus one crisis minute of execution grace, so a sale
    // that executes just past the fall (priced at factor 0.89, one
    // step off the bottom) still counts as panic — see
    // `crashPanicWindowMs` (docs/15 §6). The drawdown above keeps
    // the strict fall window.
    const panicWindow =
      isCrisis && state.startedAtMs !== null && state.crashMinute !== null
        ? crashPanicWindowMs(state.startedAtMs, state.crashMinute, this.config.SPRINT_DURATION_MS)
        : null;
    const metricsOf = (player: SprintPlayerState) => {
      const curve = (state.equityCurve[player.userId] ?? []).map((p) => Number(p.equity));
      if (curve.length === 0) curve.push(startCash);
      // Crisis scoring: the sprint R/V/D, with the loss branch dividing
      // instead of multiplying (docs/15 §5). Sprints are unchanged.
      const metrics = isCrisis
        ? computeCrisisMetrics(curve, startCash)
        : computeRiskMetrics(curve, startCash);
      const finalEquity = curve[curve.length - 1] as number;
      const myTrades = state.trades.filter((t) => t.userId === player.userId);
      const perInstrument = summariseTrades(
        myTrades.map((t) => ({
          instrumentId: t.instrumentId,
          symbol: t.symbol,
          side: t.side,
          quantity: Number(t.quantity),
          price: Number(t.price),
        })),
        finalPrices
      );
      const crashCurve = state.equityCurve[player.userId] ?? [];
      const crashDrawdownPct = crashWindow
        ? computeCrashDrawdownPct(crashCurve, crashWindow.crashStartMs)
        : 0;
      const crashTrades = panicWindow
        ? tradesDuringCrash(
            state.trades.map((t) => ({
              userId: t.userId,
              instrumentId: t.instrumentId,
              side: t.side,
              quantity: Number(t.quantity),
              price: Number(t.price),
              totalValue: Number(t.totalValue),
              executedAtMs: t.executedAtMs,
            })),
            player.userId,
            panicWindow.crashStartMs,
            panicWindow.panicEndMs
          )
        : 0;
      const panicSold = panicWindow
        ? computePanicSold(
            state.trades.map((t) => ({
              userId: t.userId,
              instrumentId: t.instrumentId,
              side: t.side,
              quantity: Number(t.quantity),
              price: Number(t.price),
              totalValue: Number(t.totalValue),
              executedAtMs: t.executedAtMs,
            })),
            player.userId,
            panicWindow.crashStartMs,
            panicWindow.panicEndMs
          )
        : false;
      return {
        metrics,
        finalEquity,
        perInstrument,
        curve,
        crashDrawdownPct,
        crashTrades,
        panicSold,
      };
    };
    const a = metricsOf(state.playerA);
    const b = state.playerB ? metricsOf(state.playerB) : null;

    let outcomeA: SprintOutcome;
    if (forfeitedByUserId) {
      outcomeA = forfeitedByUserId === state.playerA.userId ? 'LOSS' : 'WIN';
    } else if (b) {
      outcomeA = isCrisis
        ? decideCrisisWinner(a.metrics, b.metrics)
        : decideSprintWinner(a.metrics, b.metrics);
    } else {
      outcomeA = 'DRAW';
    }

    // --- Trading Rating first (ADR 0006/7 ordering) --------------------------------
    let ratingA: { ratingBefore: number; ratingAfter: number; delta: number } | null = null;
    let ratingB: { ratingBefore: number; ratingAfter: number; delta: number } | null = null;
    let ratingFailedReason: string | null = null;
    const key = `duel:${duel.id}`;
    try {
      if (state.isBot) {
        const res = await this.ratings.recordTradingDuelVsBot(
          state.playerA.userId,
          outcomeA,
          key,
          now
        );
        ratingA = res.me;
      } else if (state.playerB) {
        const res = await this.ratings.recordTradingDuel(state.playerA.userId, {
          opponentId: state.playerB.userId,
          result: outcomeA as DtoDuelResult,
          idempotencyKey: key,
        });
        ratingA = res.me;
        ratingB = res.opponent;
      }
    } catch (err) {
      if (err instanceof AppError && err.code === ErrorCode.RATING_EVENT_DUPLICATE) {
        const recovered = await this.ratings.getDuelOutcome(
          state.playerA.userId,
          key,
          RatingKind.TRADING
        );
        if (recovered) {
          ratingA = recovered.me;
          ratingB = recovered.opponent;
        }
      }
      if (!ratingA) {
        ratingFailedReason =
          err instanceof Error ? err.message : 'The Rating could not be updated.';
        this.logger.error('Sprint Rating failed at settlement — settling without Rating', {
          duelId,
          reason: ratingFailedReason,
        });
      }
    }

    const nameA = state.playerA.displayName;
    const nameB = state.isBot ? DUELS.BOT_NAME : (state.playerB?.displayName ?? 'Player');
    const ratingFailedText = `Your Trading Rating could not be updated for this ${isCrisis ? 'crisis duel' : 'sprint'} (${ratingFailedReason ?? 'limit reached'}). Your result and XP are saved.`;
    const ratingReasonA =
      ratingA === null
        ? ratingFailedText
        : sprintRatingReasonFor(
            outcomeA,
            nameB,
            state.isBot
              ? (ratingA?.ratingBefore ?? state.playerA.rating)
              : (ratingB?.ratingBefore ?? state.playerB?.rating ?? 1000),
            ratingA.delta,
            isCrisis
          );
    const ratingReasonB =
      ratingB === null
        ? ratingFailedText
        : sprintRatingReasonFor(
            mirrorSprintOutcome(outcomeA),
            nameA,
            ratingA?.ratingBefore ?? state.playerB?.rating ?? 1000,
            ratingB.delta,
            isCrisis
          );

    const winnerId =
      outcomeA === 'WIN'
        ? state.playerA.userId
        : outcomeA === 'LOSS'
          ? (state.playerB?.userId ?? null)
          : null;

    await this.transactions.run(async (tx) => {
      const rewardsA = await this.gamification.grantDuelRewards(tx, {
        userId: state.playerA.userId,
        result: outcomeA,
        reason: isCrisis ? 'duel.crisis_completed' : 'duel.sprint_completed',
        xpIdempotencyKey: `duel:${duel.id}:${state.playerA.userId}`,
        atIso: now.toISOString(),
      });
      let rewardsB: RewardSummary | null = null;
      if (state.playerB && !state.isBot) {
        rewardsB = await this.gamification.grantDuelRewards(tx, {
          userId: state.playerB.userId,
          result: mirrorSprintOutcome(outcomeA),
          reason: isCrisis ? 'duel.crisis_completed' : 'duel.sprint_completed',
          xpIdempotencyKey: `duel:${duel.id}:${state.playerB.userId}`,
          atIso: now.toISOString(),
        });
      }
      await this.repo.updateDuel(
        duel.id,
        {
          status: DuelStatus.SETTLED,
          finishedAt: now,
          winnerId,
          botScore: state.isBot && b ? Math.round(b.metrics.riskAdjustedScore * 1000) : null,
          botCorrect: state.isBot && state.playerB ? state.playerB.tradeCount : null,
          botTotalTimeMs: null,
        },
        tx
      );
      for (const t of state.trades) {
        await this.repo.createTrade(
          {
            duelId: duel.id,
            userId: t.userId,
            instrumentId: t.instrumentId,
            side: t.side,
            quantity: new Prisma.Decimal(t.quantity),
            price: new Prisma.Decimal(t.price),
            totalValue: new Prisma.Decimal(t.totalValue),
            clientOrderId: t.clientOrderId,
            executedAt: new Date(t.executedAtMs),
          },
          tx
        );
      }
      await this.repo.createResult(
        {
          duelId: duel.id,
          userId: state.playerA.userId,
          result: outcomeA,
          finalEquity: new Prisma.Decimal(a.finalEquity.toFixed(2)),
          returnPct: a.metrics.returnPct,
          realisedVolPct: a.metrics.realisedVolPct,
          maxDrawdownPct: a.metrics.maxDrawdownPct,
          riskAdjustedScore: a.metrics.riskAdjustedScore,
          tradeCount: state.playerA.tradeCount,
          perInstrument: a.perInstrument as unknown as Prisma.InputJsonValue,
          equityCurve: (state.equityCurve[state.playerA.userId] ??
            []) as unknown as Prisma.InputJsonValue,
          opponentRiskScore: b ? b.metrics.riskAdjustedScore : 0,
          opponentEquity: b ? new Prisma.Decimal(b.finalEquity.toFixed(2)) : null,
          opponentTradeCount: state.playerB ? state.playerB.tradeCount : 0,
          ratingBefore: ratingA?.ratingBefore ?? null,
          ratingAfter: ratingA?.ratingAfter ?? null,
          ratingDelta: ratingA?.delta ?? null,
          ratingReason: ratingReasonA,
          crashMinute: isCrisis ? state.crashMinute : null,
          crashDrawdownPct: isCrisis ? a.crashDrawdownPct : null,
          tradesDuringCrash: isCrisis ? a.crashTrades : null,
          panicSold: isCrisis ? a.panicSold : null,
          xpAwarded: rewardsA.xpAwarded,
          xpBreakdown: {
            result: outcomeA,
            xp: rewardsA.xpAwarded,
            reason: isCrisis ? 'duel.crisis_completed' : 'duel.sprint_completed',
            totalXp: rewardsA.totalXp,
            level: rewardsA.level,
            levelUp: rewardsA.levelUp,
            currentStreak: rewardsA.currentStreak,
            newBadges: rewardsA.newBadges.map((b) => ({ slug: b.slug, name: b.name })),
          },
        },
        tx
      );
      if (state.playerB && b && rewardsB) {
        await this.repo.createResult(
          {
            duelId: duel.id,
            userId: state.playerB.userId,
            result: mirrorSprintOutcome(outcomeA),
            finalEquity: new Prisma.Decimal(b.finalEquity.toFixed(2)),
            returnPct: b.metrics.returnPct,
            realisedVolPct: b.metrics.realisedVolPct,
            maxDrawdownPct: b.metrics.maxDrawdownPct,
            riskAdjustedScore: b.metrics.riskAdjustedScore,
            tradeCount: state.playerB.tradeCount,
            perInstrument: b.perInstrument as unknown as Prisma.InputJsonValue,
            equityCurve: (state.equityCurve[state.playerB.userId] ??
              []) as unknown as Prisma.InputJsonValue,
            opponentRiskScore: a.metrics.riskAdjustedScore,
            opponentEquity: new Prisma.Decimal(a.finalEquity.toFixed(2)),
            opponentTradeCount: state.playerA.tradeCount,
            ratingBefore: ratingB?.ratingBefore ?? null,
            ratingAfter: ratingB?.ratingAfter ?? null,
            ratingDelta: ratingB?.delta ?? null,
            ratingReason: ratingReasonB,
            crashMinute: isCrisis ? state.crashMinute : null,
            crashDrawdownPct: isCrisis ? b.crashDrawdownPct : null,
            tradesDuringCrash: isCrisis ? b.crashTrades : null,
            panicSold: isCrisis ? b.panicSold : null,
            xpAwarded: rewardsB.xpAwarded,
            xpBreakdown: {
              result: mirrorSprintOutcome(outcomeA),
              xp: rewardsB.xpAwarded,
              reason: isCrisis ? 'duel.crisis_completed' : 'duel.sprint_completed',
              totalXp: rewardsB.totalXp,
              level: rewardsB.level,
              levelUp: rewardsB.levelUp,
              currentStreak: rewardsB.currentStreak,
              newBadges: rewardsB.newBadges.map((b) => ({ slug: b.slug, name: b.name })),
            },
          },
          tx
        );
      }
    });

    this.clearTimers(duelId);
    await this.deleteStateKeys(state);

    // --- finished payloads (stored results, never recomputed) ----------------------
    const playerIds = state.playerB
      ? [state.playerA.userId, state.playerB.userId]
      : [state.playerA.userId];
    for (const userId of playerIds) {
      if (state.isBot && userId === 'bot:mira') continue;
      const view = await this.sprints.getResult(userId, duelId);
      const hostLine =
        view.result === 'WIN'
          ? isCrisis
            ? CRISIS_HOST_RESULT_WIN
            : HOST_RESULT_WIN
          : view.result === 'LOSS'
            ? isCrisis
              ? CRISIS_HOST_RESULT_LOSS
              : HOST_RESULT_LOSS
            : isCrisis
              ? CRISIS_HOST_RESULT_DRAW
              : HOST_RESULT_DRAW;
      this.emitToUser(
        userId,
        `${tradingEventPrefix(state.variant)}:finished`,
        {
          ...view,
          host: { name: DUELS.SPRINT_HOST_NAME, line: hostLine },
          forfeitedBy: state.forfeitedByUserId,
        },
        state.variant
      );
    }
    this.logger.info('Sprint settled', { duelId, result: outcomeA, forfeitedByUserId });
    return this.sprints.getResult(state.playerA.userId, duelId);
  }

  // --- rematch ------------------------------------------------------------------------

  /**
   * One-tap rematch after a finished sprint. Both players must ask; the
   * second ask creates the new sprint directly (no re-queue). The
   * 5-minute rematch cooldown (docs/04 §5) is enforced HERE, at the
   * offer — not at settlement, where it would waste a played sprint.
   * Returns `{ matched, newDuelId?, reason?, retryAfterMs? }`.
   */
  async rematch(
    userId: string,
    duelId: string,
    now: Date = new Date()
  ): Promise<{ matched: boolean; newDuelId?: string; reason?: string; retryAfterMs?: number }> {
    const duel = await this.repo.findDuelById(duelId);
    if (!duel || (duel.type !== DuelType.SPRINT && duel.type !== DuelType.CRISIS)) {
      throw AppError.notFound('Sprint not found.');
    }
    if (duel.status !== DuelStatus.SETTLED) {
      if (duel.type === DuelType.CRISIS) {
        throw AppError.crisisNotActive('This crisis duel has not finished yet.');
      }
      throw AppError.sprintNotActive('This sprint has not finished yet.');
    }
    if (duel.playerAId !== userId && duel.playerBId !== userId) throw AppError.forbidden();
    if (!duel.playerBId) {
      return { matched: false, reason: 'BOT_NO_REMATCH' };
    }
    const otherId = duel.playerAId === userId ? duel.playerBId : duel.playerAId;
    const last = await this.repo.findLastTradingDuelBetween(
      duel.playerAId,
      duel.playerBId,
      duel.type
    );
    const cooldownMs = 5 * 60 * 1000;
    if (last?.finishedAt && now.getTime() - last.finishedAt.getTime() < cooldownMs) {
      return {
        matched: false,
        reason: 'REMATCH_COOLDOWN',
        retryAfterMs: cooldownMs - (now.getTime() - last.finishedAt.getTime()),
      };
    }
    const variant: TradingDuelVariant = duel.type === DuelType.CRISIS ? 'CRISIS' : 'SPRINT';
    const key = tradingRematchKey(duelId, variant);
    const raw = await this.redis.get(key);
    const requested: string[] = raw ? (JSON.parse(raw) as string[]) : [];
    if (!requested.includes(userId)) requested.push(userId);
    await this.redis.set(key, JSON.stringify(requested), 300);
    if (!requested.includes(otherId)) {
      this.emitToUser(
        otherId,
        `${tradingEventPrefix(variant)}:rematch-requested`,
        { duelId, fromUserId: userId },
        variant
      );
      return { matched: false, reason: 'WAITING_OPPONENT' };
    }
    await this.redis.del(key);
    const [aRatings, bRatings] = await Promise.all([
      this.ratings.getUserRatings(duel.playerAId),
      this.ratings.getUserRatings(otherId),
    ]);
    const aUser = await this.repo.findUserById(duel.playerAId);
    const bUser = await this.repo.findUserById(otherId);
    const create =
      variant === 'CRISIS' ? this.createCrisis.bind(this) : this.createSprint.bind(this);
    const state = await create(
      {
        userId: duel.playerAId,
        displayName: aUser?.displayName ?? 'Player',
        rating: aRatings.trading.rating,
      },
      {
        userId: otherId,
        displayName: bUser?.displayName ?? 'Player',
        rating: bRatings.trading.rating,
      },
      now
    );
    return { matched: true, newDuelId: state.duelId };
  }

  // --- reads (REST) ----------------------------------------------------------------------

  /** My active sprint, if any — for reconnect / resume on page load. */
  async activeSprintSummary(userId: string): Promise<TradingDuelSummary | null> {
    return this.activeTradingDuelSummary(userId, DuelType.SPRINT);
  }

  /** My active trading duel of this type, if any — for reconnect / resume on page load. */
  async activeTradingDuelSummary(
    userId: string,
    type: DuelType
  ): Promise<TradingDuelSummary | null> {
    const duel = await this.repo.findActiveTradingDuelForUser(userId, type);
    if (!duel) return null;
    const state = await this.loadState(duel.id);
    if (!state) return null;
    const now = new Date();
    const me = this.sideOf(state, userId);
    if (!me) return null;
    const other = state.playerA.userId === userId ? state.playerB : state.playerA;
    return {
      duelId: duel.id,
      type: type === DuelType.CRISIS ? 'CRISIS' : 'SPRINT',
      phase: state.phase,
      startedAtMs: state.startedAtMs,
      endsAtMs: state.endsAtMs,
      serverNowMs: now.getTime(),
      myEquity: fmt(this.equityOf(state, me, now)),
      opponentEquity: other ? fmt(this.equityOf(state, other, now)) : null,
      opponent: other
        ? {
            userId: other.userId,
            displayName: other.displayName,
            kind: state.isBot ? 'BOT' : 'HUMAN',
          }
        : null,
      ...(type === DuelType.CRISIS ? { crashFired: state.crashFired } : {}),
    };
  }

  /** One sprint's state summary (mine only — a sprint that is not mine is 404). */
  async stateSummary(
    userId: string,
    duelId: string
  ): Promise<{
    duelId: string;
    type: 'SPRINT' | 'CRISIS';
    phase: string;
    startedAtMs: number | null;
    endsAtMs: number | null;
    serverNowMs: number;
    instruments: Array<{ id: string; symbol: string; name: string; price: string }>;
    myPortfolio: ReturnType<SprintEngine['portfolioOf']>;
    myEquity: string;
    opponentEquity: string | null;
    tradeCount: number;
    /** Crisis only: whether the crash has fired. */
    crashFired?: boolean;
  } | null> {
    const duel = await this.repo.findDuelById(duelId);
    if (!duel || (duel.playerAId !== userId && duel.playerBId !== userId)) return null;
    const state = await this.loadState(duelId);
    if (!state) return null;
    const now = new Date();
    const me = this.sideOf(state, userId);
    if (!me) return null;
    const other = state.playerA.userId === userId ? state.playerB : state.playerA;
    const prices = this.pricesAt(state, now);
    return {
      duelId: state.duelId,
      type: state.variant,
      phase: state.phase,
      startedAtMs: state.startedAtMs,
      endsAtMs: state.endsAtMs,
      serverNowMs: now.getTime(),
      instruments: state.instruments.map((i) => ({
        id: i.id,
        symbol: i.symbol,
        name: i.name,
        price: fmt(prices.find((p) => p.instrumentId === i.id)?.price ?? ZERO),
      })),
      myPortfolio: this.portfolioOf(state, me, now),
      myEquity: fmt(this.equityOf(state, me, now)),
      opponentEquity: other ? fmt(this.equityOf(state, other, now)) : null,
      tradeCount: me.tradeCount,
      ...(state.variant === 'CRISIS' ? { crashFired: state.crashFired } : {}),
    };
  }

  // --- internals -------------------------------------------------------------------------

  private newState(
    duel: SprintDuelRow,
    a: SprintPlayerRef,
    b: SprintPlayerRef | null,
    instruments: SprintState['instruments'],
    seed: string,
    now: Date,
    variant: TradingDuelVariant = 'SPRINT'
  ): SprintState {
    const player = (ref: SprintPlayerRef): SprintPlayerState => ({
      userId: ref.userId,
      displayName: ref.displayName,
      rating: ref.rating,
      cash: fmt(START_CASH),
      holdings: {},
      tradeCount: 0,
      executedOrderIds: [],
      disconnectedAtMs: null,
    });
    return {
      duelId: duel.id,
      variant,
      seed,
      // Crisis only: the seeded crash minute, derived from the market
      // seed at creation (docs/15 §4). Sprints carry null.
      crashMinute: variant === 'CRISIS' ? deriveCrashMinute(seed) : null,
      crashFired: false,
      crashFiredAtMs: null,
      startCash: fmt(START_CASH),
      instruments,
      playerA: player(a),
      playerB: b ? player(b) : null,
      isBot: false,
      phase: 'COUNTDOWN',
      countdownEndsAtMs: now.getTime() + this.config.LIVE_COUNTDOWN_MS,
      startedAtMs: null,
      endsAtMs: null,
      lastSampleMinute: null,
      equityCurve: {},
      trades: [],
      forfeitedByUserId: null,
      createdAtMs: now.getTime(),
    };
  }

  private sideOf(state: SprintState, userId: string): SprintPlayerState | null {
    if (state.playerA.userId === userId) return state.playerA;
    if (state.playerB?.userId === userId) return state.playerB;
    return null;
  }

  /** Re-arm this process's timers from the Redis state (reconnect to another server). */
  private rearmTimers(state: SprintState, now: Date): void {
    if (state.phase !== 'TRADING' || !state.endsAtMs) return;
    this.clearTimer(`${state.duelId}:tick`);
    this.clearTimer(`${state.duelId}:end`);
    this.armInterval(
      `${state.duelId}:tick`,
      this.config.SPRINT_TICK_MS,
      () => void this.tick(state.duelId)
    );
    this.arm(
      `${state.duelId}:end`,
      state.endsAtMs - now.getTime(),
      () => void this.settleDuel(state.duelId, new Date())
    );
  }

  /** Resend the current sprint state to a reconnected player. */
  private async resendCurrent(userId: string, state: SprintState, now: Date): Promise<void> {
    if (state.phase === 'COUNTDOWN') {
      this.emitToUser(
        userId,
        `${tradingEventPrefix(state.variant)}:countdown`,
        {
          duelId: state.duelId,
          countdownEndsAtMs: state.countdownEndsAtMs,
          serverNowMs: now.getTime(),
          host: {
            name: DUELS.SPRINT_HOST_NAME,
            line: `${DUELS.SPRINT_HOST_NAME} is hosting this ${state.variant === 'CRISIS' ? 'crisis duel' : 'sprint'}.`,
          },
        },
        state.variant
      );
      return;
    }
    if (state.phase !== 'TRADING') return;
    const side = this.sideOf(state, userId);
    if (!side) return;
    this.emitToUser(
      userId,
      `${tradingEventPrefix(state.variant)}:started`,
      this.startedPayload(state, side, now),
      state.variant
    );
    this.emitToUser(
      userId,
      `${tradingEventPrefix(state.variant)}:tick`,
      this.tickPayload(state, now),
      state.variant
    );
  }
}
