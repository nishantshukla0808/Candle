import { DUELS } from '@candle/shared';

/**
 * Sprint state — docs/05 §3.1/§3.2, docs/14 (Phase 9).
 *
 * Pure types + helpers (no I/O). The state is the server's picture of
 * one Paper Trading Sprint: it lives in Redis (`sprint:duel:{duelId}`,
 * JSON, TTL DUELS.SPRINT_STATE_TTL_SEC) and Postgres is the source of
 * truth only after the sprint ends (the Duel row + SprintTrade rows +
 * SprintDuelResult rows). If Redis is lost mid-sprint the sprint is
 * voided — no Trading Rating changes (docs/05 §3.2).
 *
 * ## Phases (one sprint, server is the authority)
 * COUNTDOWN → TRADING (15 min, server timer) → FINISHED.
 * The client timer is display only; the server owns every deadline.
 *
 * ## What the state never holds
 * The opponent's orders or holdings. A tick broadcasts prices and both
 * players' TOTAL equity only (docs/14 §4) — the equivalent of the live
 * duel score bar. Holdings and the trade log are per-player: the engine
 * sends each player only their own portfolio, and the opponent's equity
 * is a single number. A leaked state can never reveal what the opponent
 * bought.
 *
 * ## Money
 * Cash, quantities, and average costs are Decimal strings (2dp cash /
 * 2dp avg cost, 6dp quantities — the simulator's shapes). The engine
 * does the arithmetic with Prisma.Decimal; this file only carries the
 * strings.
 */

export type SprintPhase = 'COUNTDOWN' | 'TRADING' | 'FINISHED';

/**
 * Which trading duel a state belongs to. The sprint engine serves
 * BOTH variants (docs/15 §3 — the Crisis Duel is a variant of the
 * sprint engine, not a second 1305-line engine): the variant picks
 * the Redis keyspace, the socket event prefix, the price path (the
 * crash factor, crisis only), the scoring (crisis only) and the bot
 * step (crisis only). Everything else — timer, order execution,
 * disconnect grace, settlement ordering — is shared, unchanged.
 */
export type TradingDuelVariant = 'SPRINT' | 'CRISIS';

export interface SprintHoldingState {
  /** Units held (Decimal string, 6dp). */
  quantity: string;
  /** Weighted-average buy price per unit (Decimal string, 2dp). */
  avgCost: string;
}

export interface SprintPlayerState {
  userId: string;
  displayName: string;
  /** Trading Rating at match time (shown in the queue / matched screens). */
  rating: number;
  /** Virtual cash (Decimal string, 2dp). */
  cash: string;
  holdings: Record<string, SprintHoldingState>;
  tradeCount: number;
  /** Executed clientOrderIds — a retried order is an ack replay, never a second trade. */
  executedOrderIds: string[];
  /** Set when the socket drops; cleared on reconnect (15 s grace). */
  disconnectedAtMs: number | null;
}

export interface SprintTradeEntry {
  userId: string;
  instrumentId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: string;
  price: string;
  totalValue: string;
  clientOrderId: string;
  executedAtMs: number;
}

export interface SprintInstrumentState {
  id: string;
  symbol: string;
  name: string;
  /** Anchor price for the deterministic price engine (Decimal string, 2dp). */
  basePrice: string;
}

export interface SprintEquityPoint {
  /** Server timestamp (ms) of the sample. */
  t: number;
  /** Portfolio value at the sample (Decimal string, 2dp). */
  equity: string;
}

export interface SprintState {
  duelId: string;
  /** SPRINT (Phase 9) or CRISIS (Phase 10, docs/15) — see TradingDuelVariant. */
  variant: TradingDuelVariant;
  /** Market seed (the Duel row's seed): the bot's seed + the sprint's identity. */
  seed: string;
  /** Crisis only: the seeded crash minute (7–10, deriveCrashMinute) — null for sprints. */
  crashMinute: number | null;
  /** True once the crash has fired in this duel (the `crisis:crash` event was sent). */
  crashFired: boolean;
  /** Server timestamp (ms) the crash fired at, or null before it fires. */
  crashFiredAtMs: number | null;
  /** Starting cash for BOTH players (Decimal string, 2dp) — always SIMULATOR_STARTING_CASH. */
  startCash: string;
  /** The sprint's instruments: every active fictional instrument at match time. */
  instruments: SprintInstrumentState[];
  /** Player A is the matchmaker's first player; player B is null vs the bot. */
  playerA: SprintPlayerState;
  playerB: SprintPlayerState | null;
  /** True when the opponent is the Mira bot (no human player B). */
  isBot: boolean;
  phase: SprintPhase;
  countdownEndsAtMs: number;
  startedAtMs: number | null;
  endsAtMs: number | null;
  /** Whole-minute index of the last equity sample (null before the first). */
  lastSampleMinute: number | null;
  /** Minute-sampled equity curves, per player (the bot's key is 'bot:mira'). */
  equityCurve: Record<string, SprintEquityPoint[]>;
  /** Human trades only — the bot's trades are reproducible from the seed
   * (docs/14 §5) and are not stored here (her summary is computed from
   * her player state at settlement). */
  trades: SprintTradeEntry[];
  /** Set at settlement: who forfeited by disconnecting (if anyone). */
  forfeitedByUserId: string | null;
  createdAtMs: number;
}

export function sprintDuelRoom(duelId: string): string {
  return `sprint:${duelId}`;
}

export function sprintDuelStateKey(duelId: string): string {
  return `sprint:duel:${duelId}`;
}

export function sprintUserDuelKey(userId: string): string {
  return `sprint:user-duel:${userId}`;
}

export function sprintQueueKey(): string {
  // One queue for the whole sprint: a sprint waiter is never matched
  // into a learning duel, and vice versa (docs/14 §6).
  return 'sprint:queue';
}

export function sprintQueueEntryKey(userId: string): string {
  return `sprint:queue-entry:${userId}`;
}

export function sprintRematchKey(duelId: string): string {
  return `sprint:rematch:${duelId}`;
}

// --- Crisis Duel keys (docs/15 §3/§6) -------------------------------------------
// The crisis queue/state live in their own `crisis:*` keyspace: a crisis
// waiter is never matched into a sprint (or a learning duel), and vice
// versa — separation is structural, not a filter. The key shapes mirror
// the sprint ones exactly, so the engine can switch keyspace by variant.

export function crisisDuelRoom(duelId: string): string {
  return `crisis:${duelId}`;
}

export function crisisDuelStateKey(duelId: string): string {
  return `crisis:duel:${duelId}`;
}

export function crisisUserDuelKey(userId: string): string {
  return `crisis:user-duel:${userId}`;
}

export function crisisQueueKey(): string {
  return 'crisis:queue';
}

export function crisisQueueEntryKey(userId: string): string {
  return `crisis:queue-entry:${userId}`;
}

export function crisisRematchKey(duelId: string): string {
  return `crisis:rematch:${duelId}`;
}

/** The Redis state key for a duel of this variant. */
export function tradingDuelStateKey(duelId: string, variant: TradingDuelVariant): string {
  return variant === 'CRISIS' ? crisisDuelStateKey(duelId) : sprintDuelStateKey(duelId);
}

/** The per-user active-duel key for this variant. */
export function tradingUserDuelKey(userId: string, variant: TradingDuelVariant): string {
  return variant === 'CRISIS' ? crisisUserDuelKey(userId) : sprintUserDuelKey(userId);
}

/** The socket event prefix for this variant (`sprint` or `crisis`). */
export function tradingEventPrefix(variant: TradingDuelVariant): string {
  return variant === 'CRISIS' ? 'crisis' : 'sprint';
}

/** The rematch key for a duel of this variant. */
export function tradingRematchKey(duelId: string, variant: TradingDuelVariant): string {
  return variant === 'CRISIS' ? crisisRematchKey(duelId) : sprintRematchKey(duelId);
}

/**
 * Matchmaking window for a wait (docs/05 §3.3 — the same windows as the
 * live duels, on the TRADING Rating): ±50 for the first 5 s, ±100 to
 * 15 s, ±200 to 30 s, ±400 after that. Pure — unit-tested. (Duplicated
 * from duels/live-duel-state.ts, not imported, so the trading module
 * does not depend on the duels module's internals.)
 */
export function sprintWindowForWait(waitedMs: number): number {
  for (const w of DUELS.LIVE_MATCH_WINDOWS) {
    if (waitedMs <= w.maxWaitSec * 1000) return w.delta;
  }
  return 400;
}

/** The bot offer is due once the player has waited this long (docs/05 §3.3). */
export function sprintBotOfferDue(waitedMs: number): boolean {
  return waitedMs >= DUELS.LIVE_BOT_OFFER_AFTER_SEC * 1000;
}

export function parseSprintState(raw: string | null): SprintState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SprintState;
    if (!parsed || typeof parsed.duelId !== 'string' || !Array.isArray(parsed.instruments)) {
      return null;
    }
    if (parsed.phase !== 'COUNTDOWN' && parsed.phase !== 'TRADING' && parsed.phase !== 'FINISHED') {
      return null;
    }
    if (!parsed.equityCurve || typeof parsed.equityCurve !== 'object') parsed.equityCurve = {};
    if (!Array.isArray(parsed.trades)) parsed.trades = [];
    // Pre-Phase 10 states carry no variant/crash fields: they are sprints.
    if (parsed.variant !== 'SPRINT' && parsed.variant !== 'CRISIS') parsed.variant = 'SPRINT';
    if (typeof parsed.crashMinute !== 'number') parsed.crashMinute = null;
    if (typeof parsed.crashFired !== 'boolean') parsed.crashFired = false;
    if (typeof parsed.crashFiredAtMs !== 'number') parsed.crashFiredAtMs = null;
    return parsed;
  } catch {
    return null;
  }
}
