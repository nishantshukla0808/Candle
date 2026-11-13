import { Prisma, SimOrderSide, DuelStatus, DuelType } from '@prisma/client';
import { PriceEngine } from '../simulator/price-engine';
import { SprintEngine, type SprintEmitter } from './sprint-engine.service';
import { applyUpdate, mirrorResult, scoreForResult } from '../ratings/rating-math';
import { ErrorCode } from '@candle/shared';
import { AppError } from '../../common/errors/app-error';

/**
 * Crisis Duel engine — docs/15 §3–§8 (ADR 0012).
 * The crisis is a variant of the sprint engine (same file, same
 * timer/order/settlement code), so this spec drives the SHARED engine
 * with variant CRISIS and proves what differs: the seeded crash
 * minute, the crash firing on a tick, crash-adjusted prices, crisis
 * scoring at settlement, the bot selling to cash, and the stored
 * crash fields. Fakes mirror sprint-engine.spec.ts (in-memory Redis,
 * repository honouring the DuelType, Ratings with real ELO math).
 * Fake time: CONFIG SPRINT_DURATION_MS is 60 s, so a crisis minute
 * is 4 s — the crash (minute 7–10) fires 28–40 s after the start.
 */

const INSTRUMENTS = [
  { id: 'inst-nvlt', symbol: 'NVLT', name: 'NovaVolt Energy', basePrice: '842.50' },
  { id: 'inst-kvrf', symbol: 'KVRF', name: 'Kaveri Foods', basePrice: '315.20' },
  { id: 'inst-astl', symbol: 'ASTL', name: 'Astra Steel', basePrice: '1204.00' },
  { id: 'inst-mrum', symbol: 'MRUM', name: 'Maruti Retail', basePrice: '96.75' },
  { id: 'inst-sgnr', symbol: 'SGNR', name: 'Signa Renewables', basePrice: '2210.40' },
  { id: 'inst-helx', symbol: 'HELX', name: 'Helix Biotech', basePrice: '458.90' },
];

class FakeRedis {
  private readonly store = new Map<string, string>();
  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }
  async set(key: string, value: string, _ttl?: number): Promise<'OK'> {
    this.store.set(key, value);
    return 'OK';
  }
  async del(key: string): Promise<number> {
    return this.store.delete(key) ? 1 : 0;
  }
}

type DuelRow = {
  id: string;
  type: DuelType;
  status: DuelStatus;
  playerAId: string;
  playerBId: string | null;
  seed: string;
  startedAt: Date;
  finishedAt: Date | null;
  winnerId: string | null;
  botScore: number | null;
  botCorrect: number | null;
  botTotalTimeMs: number | null;
  createdAt: Date;
  updatedAt: Date;
};

class FakeRepo {
  readonly duels = new Map<string, DuelRow>();
  readonly trades: Array<Record<string, unknown>> = [];
  readonly results: Array<Record<string, unknown>> = [];
  private n = 0;

  async createDuel(input: {
    playerAId: string;
    playerBId: string | null;
    seed: string;
    type?: DuelType;
  }): Promise<DuelRow> {
    const row: DuelRow = {
      id: `duel-${++this.n}`,
      type: input.type ?? DuelType.SPRINT,
      status: DuelStatus.IN_PROGRESS,
      playerAId: input.playerAId,
      playerBId: input.playerBId,
      seed: input.seed,
      startedAt: new Date(),
      finishedAt: null,
      winnerId: null,
      botScore: null,
      botCorrect: null,
      botTotalTimeMs: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.duels.set(row.id, row);
    return row;
  }

  async findDuelById(id: string): Promise<DuelRow | null> {
    return this.duels.get(id) ?? null;
  }

  async updateDuel(id: string, data: Partial<DuelRow>): Promise<DuelRow> {
    const row = this.duels.get(id);
    if (!row) throw new Error('duel not found');
    Object.assign(row, data, { updatedAt: new Date() });
    return row;
  }

  async findActiveSprintForUser(userId: string): Promise<DuelRow | null> {
    return this.findActiveTradingDuelForUser(userId, DuelType.SPRINT);
  }

  async findActiveTradingDuelForUser(userId: string, type: DuelType): Promise<DuelRow | null> {
    for (const row of this.duels.values()) {
      if (
        row.type === type &&
        row.status !== DuelStatus.SETTLED &&
        (row.playerAId === userId || row.playerBId === userId)
      ) {
        return row;
      }
    }
    return null;
  }

  async findLastSprintBetween(a: string, b: string): Promise<DuelRow | null> {
    return this.findLastTradingDuelBetween(a, b, DuelType.SPRINT);
  }

  async findLastTradingDuelBetween(a: string, b: string, type: DuelType): Promise<DuelRow | null> {
    let best: DuelRow | null = null;
    for (const row of this.duels.values()) {
      if (
        row.type !== type ||
        row.status !== DuelStatus.SETTLED ||
        !row.finishedAt ||
        !(
          (row.playerAId === a && row.playerBId === b) ||
          (row.playerAId === b && row.playerBId === a)
        )
      ) {
        continue;
      }
      if (!best || (best.finishedAt && row.finishedAt > best.finishedAt)) best = row;
    }
    return best;
  }

  async createTrade(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    const row = { id: `trade-${this.trades.length + 1}`, ...input };
    this.trades.push(row);
    return row;
  }

  async listTrades(duelId: string, userId: string): Promise<Array<Record<string, unknown>>> {
    return this.trades.filter((t) => t.duelId === duelId && t.userId === userId);
  }

  async createResult(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    const row = { id: `result-${this.results.length + 1}`, createdAt: new Date(), ...input };
    this.results.push(row);
    return row;
  }

  async findResult(duelId: string, userId: string): Promise<Record<string, unknown> | null> {
    return this.results.find((r) => r.duelId === duelId && r.userId === userId) ?? null;
  }

  async listResultsForUser(userId: string): Promise<Array<Record<string, unknown>>> {
    return this.results.filter((r) => r.userId === userId);
  }

  async countResultsForUser(userId: string): Promise<number> {
    return this.results.filter((r) => r.userId === userId).length;
  }

  async findUserById(id: string): Promise<{ id: string; displayName: string } | null> {
    if (id === 'bot:mira') return { id, displayName: 'Mira' };
    return { id, displayName: id === 'a' ? 'Asha' : id === 'b' ? 'Ravi' : 'Player' };
  }
}

const FakeSimRepo = {
  async listActiveInstruments() {
    return INSTRUMENTS.map((i) => ({
      ...i,
      basePrice: new Prisma.Decimal(i.basePrice),
    }));
  },
};

class FakeRatings {
  readonly trading = new Map<string, number>([
    ['a', 1000],
    ['b', 1000],
  ]);
  readonly games = new Map<string, number>();
  readonly history = new Map<string, { me: any; opponent: any | null }>();

  async getUserRatings(userId: string): Promise<any> {
    const trading = this.trading.get(userId) ?? 1000;
    return {
      userId,
      displayName: userId,
      countryCode: 'IN',
      learning: { rating: 1000, gamesPlayed: 0, tier: 'Bronze', season: '2026-W46' },
      trading: {
        rating: trading,
        gamesPlayed: this.games.get(userId) ?? 0,
        tier: 'Bronze',
        season: '2026-W46',
      },
      candle: { rating: 1000, tier: 'Bronze' },
    };
  }

  async recordTradingDuel(
    callerId: string,
    dto: { opponentId: string; result: 'WIN' | 'DRAW' | 'LOSS'; idempotencyKey: string }
  ): Promise<any> {
    if (this.history.has(`${callerId}:${dto.idempotencyKey}`)) {
      throw new AppError(ErrorCode.RATING_EVENT_DUPLICATE, 409, 'Duplicate rating event.');
    }
    const ra = this.trading.get(callerId) ?? 1000;
    const rb = this.trading.get(dto.opponentId) ?? 1000;
    const ga = this.games.get(callerId) ?? 0;
    const gb = this.games.get(dto.opponentId) ?? 0;
    const ua = applyUpdate(ra, rb, scoreForResult(dto.result), ga);
    const ub = applyUpdate(rb, ra, scoreForResult(mirrorResult(dto.result)), gb);
    this.trading.set(callerId, ua.newRating);
    this.trading.set(dto.opponentId, ub.newRating);
    this.games.set(callerId, ga + 1);
    this.games.set(dto.opponentId, gb + 1);
    const out = {
      me: { userId: callerId, ratingBefore: ra, ratingAfter: ua.newRating, delta: ua.delta },
      opponent: {
        userId: dto.opponentId,
        ratingBefore: rb,
        ratingAfter: ub.newRating,
        delta: ub.delta,
      },
    };
    this.history.set(`${callerId}:${dto.idempotencyKey}`, out);
    this.history.set(`${dto.opponentId}:${dto.idempotencyKey}`, {
      me: out.opponent,
      opponent: out.me,
    });
    return out;
  }

  async recordTradingDuelVsBot(
    userId: string,
    result: 'WIN' | 'DRAW' | 'LOSS',
    idempotencyKey: string
  ): Promise<any> {
    if (this.history.has(`${userId}:${idempotencyKey}`)) {
      throw new AppError(ErrorCode.RATING_EVENT_DUPLICATE, 409, 'Duplicate rating event.');
    }
    const ra = this.trading.get(userId) ?? 1000;
    const ga = this.games.get(userId) ?? 0;
    const u = applyUpdate(ra, 1200, scoreForResult(result), ga);
    this.trading.set(userId, u.newRating);
    this.games.set(userId, ga + 1);
    const out = {
      me: { userId, ratingBefore: ra, ratingAfter: u.newRating, delta: u.delta },
      opponent: null,
    };
    this.history.set(`${userId}:${idempotencyKey}`, out);
    return out;
  }

  async getDuelOutcome(userId: string, eventId: string): Promise<any> {
    return this.history.get(`${userId}:${eventId}`) ?? null;
  }
}

const FakeGamification = {
  async grantDuelRewards(_tx: unknown, input: { result: 'WIN' | 'DRAW' | 'LOSS' }): Promise<any> {
    return {
      xpAwarded: input.result === 'WIN' ? 20 : input.result === 'DRAW' ? 5 : 0,
      totalXp: 100,
      level: 1,
      levelUp: false,
      currentStreak: 1,
      newBadges: [],
    };
  },
};

const FakeTx = {
  async run<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
    return fn({});
  },
};

const logger = { info: jest.fn(), error: jest.fn(), warn: jest.fn() } as never;
const CONFIG = {
  LIVE_COUNTDOWN_MS: 100,
  SPRINT_DURATION_MS: 60_000,
  SPRINT_TICK_MS: 10_000,
  LIVE_DISCONNECT_GRACE_MS: 1000,
} as never;

function makeEngine() {
  const redis = new FakeRedis();
  const repo = new FakeRepo();
  const ratings = new FakeRatings();
  const toUser = jest.fn();
  const toRoom = jest.fn();
  const emitter: SprintEmitter = { toUser, toRoom };
  const sprints = {
    async getResult(userId: string, duelId: string): Promise<any> {
      const row = await repo.findResult(duelId, userId);
      if (!row) throw new Error('no stored result');
      const duel = await repo.findDuelById(duelId);
      return {
        duelId,
        type: duel?.type === DuelType.CRISIS ? 'CRISIS' : 'SPRINT',
        status: 'SETTLED',
        result: row.result,
        finalEquity: (row.finalEquity as Prisma.Decimal).toFixed(2),
        returnPct: row.returnPct,
        realisedVolPct: row.realisedVolPct,
        maxDrawdownPct: row.maxDrawdownPct,
        riskAdjustedScore: row.riskAdjustedScore,
        tradeCount: row.tradeCount,
        perInstrument: row.perInstrument,
        equityCurve: row.equityCurve,
        opponent: {
          userId: duel?.playerAId === userId ? duel?.playerBId : duel?.playerAId,
          displayName: 'Opponent',
          kind: 'HUMAN',
          riskScore: row.opponentRiskScore,
          equity: row.opponentEquity ? (row.opponentEquity as Prisma.Decimal).toFixed(2) : null,
          tradeCount: row.opponentTradeCount,
          ratingDelta: null,
        },
        ratingBefore: row.ratingBefore,
        ratingAfter: row.ratingAfter,
        ratingDelta: row.ratingDelta,
        ratingReason: row.ratingReason,
        xp: {
          awarded: row.xpAwarded,
          totalXp: 100,
          level: 1,
          levelUp: false,
          currentStreak: 1,
          newBadges: [],
        },
        finishedAt: duel?.finishedAt ?? null,
        crisis:
          row.crashMinute !== null && row.crashMinute !== undefined
            ? {
                crashMinute: row.crashMinute,
                crashDrawdownPct: row.crashDrawdownPct,
                tradesDuringCrash: row.tradesDuringCrash,
                panicSold: row.panicSold,
              }
            : undefined,
      };
    },
  };
  const engine = new SprintEngine(
    redis as never,
    repo as never,
    FakeSimRepo as never,
    ratings as never,
    FakeGamification as never,
    FakeTx as never,
    sprints as never,
    logger,
    CONFIG
  );
  engine.bindEmitter(emitter, 'SPRINT');
  engine.bindEmitter(emitter, 'CRISIS');
  return { engine, redis, repo, ratings, toUser, toRoom };
}

const A = { userId: 'a', displayName: 'Asha', rating: 1000 };
const B = { userId: 'b', displayName: 'Ravi', rating: 1000 };
const T0 = new Date('2026-11-12T10:00:00.000Z');
const atMs = (ms: number) => new Date(T0.getTime() + ms);

/** NVLT price at T0 (pre-crash base price, from the real engine). */
function nvltPriceAt(t: Date): number {
  return Number(PriceEngine.price('NVLT', '842.50', t));
}

/** Quantity of NVLT that spends ~99% of the ₹100,000 starting cash. */
function allInQty(t: Date): number {
  return Math.floor(99_000 / nvltPriceAt(t));
}

describe('CrisisDuel engine', () => {
  it('creates a crisis duel: CRISIS Duel row, seeded crash minute 7–10, crash not yet fired', async () => {
    const { engine, repo } = makeEngine();
    const state = await engine.createCrisis(A, B, T0);
    engine.clearTimers(state.duelId);
    expect(state.variant).toBe('CRISIS');
    expect(state.crashMinute).toBeGreaterThanOrEqual(7);
    expect(state.crashMinute).toBeLessThanOrEqual(10);
    expect(state.crashFired).toBe(false);
    expect(state.crashFiredAtMs).toBeNull();
    const duel = await repo.findDuelById(state.duelId);
    expect(duel?.type).toBe(DuelType.CRISIS);
    const matched = engine.matchedPayload(state, 'a');
    expect(matched.host.name).toBe('Tara');
    expect(matched.host.line).toContain('crash');
    expect(matched.host.line).not.toMatch(/minute [789]/);
  });

  it('the crash fires on a tick at the seeded minute and emits crisis:crash once', async () => {
    const { engine, toRoom } = makeEngine();
    const state = await engine.createCrisis(A, B, T0);
    engine.clearTimers(state.duelId);
    const crashMinute = state.crashMinute as number;
    await engine.startTrading(state.duelId, T0);
    engine.clearTimers(state.duelId);

    // One tick before the crash minute: no crash yet.
    await engine.tick(state.duelId, atMs((crashMinute - 1) * 4000));
    let after = await engine.getState(state.duelId);
    expect(after?.crashFired).toBe(false);
    expect(toRoom.mock.calls.filter((c) => c[1] === 'crisis:crash')).toHaveLength(0);

    // The tick at the crash minute fires it — exactly once.
    await engine.tick(state.duelId, atMs(crashMinute * 4000));
    after = await engine.getState(state.duelId);
    expect(after?.crashFired).toBe(true);
    expect(after?.crashFiredAtMs).toBe(atMs(crashMinute * 4000).getTime());
    const crashEvents = toRoom.mock.calls.filter((c) => c[1] === 'crisis:crash');
    expect(crashEvents).toHaveLength(1);
    expect(crashEvents[0]?.[2]).toMatchObject({
      duelId: state.duelId,
      crashMinute,
      dropPct: 12,
      dropMinutes: 3,
      recoveryPct: 5,
    });

    // A later tick does not fire it again, and the tick carries crashFired.
    await engine.tick(state.duelId, atMs((crashMinute + 2) * 4000));
    expect(toRoom.mock.calls.filter((c) => c[1] === 'crisis:crash')).toHaveLength(1);
    const ticks = toRoom.mock.calls.filter((c) => c[1] === 'crisis:tick');
    expect(ticks[ticks.length - 1]?.[2]).toMatchObject({ crashFired: true });
  });

  it('crash prices fall ~4% per minute for 3 minutes, then recover — identical for both players', async () => {
    const { engine, toRoom } = makeEngine();
    const state = await engine.createCrisis(A, B, T0);
    engine.clearTimers(state.duelId);
    const crashMinute = state.crashMinute as number;
    await engine.startTrading(state.duelId, T0);
    engine.clearTimers(state.duelId);
    const tickPrices = async (minute: number): Promise<number> => {
      toRoom.mockClear();
      await engine.tick(state.duelId, atMs(minute * 4000));
      const tick = toRoom.mock.calls.find((c) => c[1] === 'crisis:tick');
      const nvlt = tick?.[2]?.prices?.find((p: any) => p.symbol === 'NVLT');
      return Number(nvlt?.price);
    };
    const before = await tickPrices(crashMinute - 1);
    const m0 = await tickPrices(crashMinute);
    const m1 = await tickPrices(crashMinute + 1);
    const m2 = await tickPrices(crashMinute + 2);
    const m5 = await tickPrices(crashMinute + 5);
    const m8 = await tickPrices(crashMinute + 8);
    // The base engine barely moves inside one wall-clock minute, so the
    // visible move IS the crash factor: 0.96 / 0.92 / 0.88, then recovery.
    expect(m0).toBeCloseTo(before * 0.96, 0);
    expect(m1).toBeCloseTo(before * 0.92, 0);
    expect(m2).toBeCloseTo(before * 0.88, 0);
    expect(m5).toBeCloseTo(before * 0.91, 0);
    expect(m8).toBeCloseTo(before * 0.93, 0);
  });

  it('cash-early beats the holder end to end: settle, crisis scores, mirrored ±20 Trading Rating', async () => {
    const { engine, repo, ratings, toUser } = makeEngine();
    const state = await engine.createCrisis(A, B, T0);
    engine.clearTimers(state.duelId);
    const crashMinute = state.crashMinute as number;
    await engine.startTrading(state.duelId, T0);
    engine.clearTimers(state.duelId);

    // A goes (nearly) all-in on NVLT before the crash; B stays in cash.
    const qty = allInQty(T0);
    const buy = await engine.placeOrder(
      'a',
      state.duelId,
      {
        instrumentId: 'inst-nvlt',
        side: SimOrderSide.BUY,
        quantity: qty,
        clientOrderId: '11111111-1111-4111-8111-111111111111',
      },
      atMs(1000)
    );
    expect(buy.order.symbol).toBe('NVLT');

    // Crash fires, bottom passes, recovery runs, duel ends at 15 crisis minutes.
    await engine.tick(state.duelId, atMs(crashMinute * 4000));
    await engine.tick(state.duelId, atMs((crashMinute + 3) * 4000));
    await engine.tick(state.duelId, atMs(15 * 4000));
    const view = await engine.settleDuel(state.duelId, atMs(15 * 4000));
    expect(view?.result).toBe('LOSS');

    const rowA = await repo.findResult(state.duelId, 'a');
    const rowB = await repo.findResult(state.duelId, 'b');
    expect(rowA?.result).toBe('LOSS');
    expect(rowB?.result).toBe('WIN');
    // Crisis scoring: A lost ~7% (0.93× after the recovery), B lost nothing.
    expect(rowA?.returnPct).toBeLessThan(-5);
    expect(rowB?.returnPct).toBe(0);
    expect(rowA?.riskAdjustedScore).toBeLessThan(0);
    expect(rowB?.riskAdjustedScore).toBe(0);
    // Stored crash fields (docs/15 §8).
    expect(rowA?.crashMinute).toBe(crashMinute);
    expect(rowA?.crashDrawdownPct).toBeGreaterThan(5);
    expect(rowA?.tradesDuringCrash).toBe(0);
    expect(rowA?.panicSold).toBe(false);
    expect(rowB?.crashDrawdownPct).toBe(0);
    expect(rowB?.panicSold).toBe(false);
    // Mirrored Trading Rating deltas (provisional K=40, expected 0.5).
    expect(rowA?.ratingDelta).toBe(-20);
    expect(rowB?.ratingDelta).toBe(20);
    expect(ratings.trading.get('a')).toBe(980);
    expect(ratings.trading.get('b')).toBe(1020);
    // The finished payloads went out on crisis:finished (never sprint:finished).
    const finished = toUser.mock.calls.filter((c) => c[1] === 'crisis:finished');
    expect(finished).toHaveLength(2);
    expect(toUser.mock.calls.filter((c) => c[1] === 'sprint:finished')).toHaveLength(0);
    expect(finished[0]?.[2]).toMatchObject({ type: 'CRISIS' });
    expect(String(finished[0]?.[2]?.ratingReason)).toContain('Crisis Duel');
  });

  it('panic seller loses to the calm holder, and is flagged panicSold', async () => {
    const { engine, repo } = makeEngine();
    const state = await engine.createCrisis(A, B, T0);
    engine.clearTimers(state.duelId);
    const crashMinute = state.crashMinute as number;
    await engine.startTrading(state.duelId, T0);
    engine.clearTimers(state.duelId);

    // Both go all-in on NVLT before the crash.
    const qty = allInQty(T0);
    await engine.placeOrder(
      'a',
      state.duelId,
      {
        instrumentId: 'inst-nvlt',
        side: SimOrderSide.BUY,
        quantity: qty,
        clientOrderId: '22222222-2222-4222-8222-222222222222',
      },
      atMs(1000)
    );
    await engine.placeOrder(
      'b',
      state.duelId,
      {
        instrumentId: 'inst-nvlt',
        side: SimOrderSide.BUY,
        quantity: qty,
        clientOrderId: '33333333-3333-4333-8333-333333333333',
      },
      atMs(1000)
    );

    // Crash fires; A panic-sells everything at the bottom (the last
    // fall minute, factor 0.88) — locking the full −12% and missing
    // the +5% recovery. Selling one minute into the fall (0.92 vs the
    // holder's 0.93) would leave only a 1% gap that the base engine's
    // minute-to-minute drift could overturn; the bottom is the panic
    // case the scoring is designed around (docs/15 §5).
    await engine.tick(state.duelId, atMs(crashMinute * 4000));
    const sell = await engine.placeOrder(
      'a',
      state.duelId,
      {
        instrumentId: 'inst-nvlt',
        side: SimOrderSide.SELL,
        quantity: qty,
        clientOrderId: '44444444-4444-4444-8444-444444444444',
      },
      atMs((crashMinute + 2) * 4000)
    );
    expect(sell.order.side).toBe('SELL');
    await engine.tick(state.duelId, atMs(15 * 4000));
    await engine.settleDuel(state.duelId, atMs(15 * 4000));

    const rowA = await repo.findResult(state.duelId, 'a');
    const rowB = await repo.findResult(state.duelId, 'b');
    expect(rowA?.result).toBe('LOSS');
    expect(rowB?.result).toBe('WIN');
    expect(rowA?.panicSold).toBe(true);
    expect(rowA?.tradesDuringCrash).toBe(1);
    expect(rowB?.panicSold).toBe(false);
    expect(rowB?.tradesDuringCrash).toBe(0);
    // A locked the fall and missed the recovery; B recovered part of it.
    expect(rowA?.returnPct).toBeLessThan(rowB?.returnPct as number);
    expect(rowA?.riskAdjustedScore).toBeLessThan(rowB?.riskAdjustedScore as number);
  });

  it('a sale executing one crisis minute past the fall still flags panicSold', async () => {
    // Execution-grace case (docs/15 §6): the sale is placed for the
    // bottom but executes in the first recovery minute (factor 0.89,
    // one step off the bottom) — inside the panic window, so it still
    // flags and still counts as a trade during the crash. A sale a
    // minute later (factor 0.90) would not. A still loses: locking
    // −11% beats neither the holder's −7% nor the recovery.
    const { engine, repo } = makeEngine();
    const state = await engine.createCrisis(A, B, T0);
    engine.clearTimers(state.duelId);
    const crashMinute = state.crashMinute as number;
    await engine.startTrading(state.duelId, T0);
    engine.clearTimers(state.duelId);

    const qty = allInQty(T0);
    await engine.placeOrder(
      'a',
      state.duelId,
      {
        instrumentId: 'inst-nvlt',
        side: SimOrderSide.BUY,
        quantity: qty,
        clientOrderId: '55555555-5555-4555-8555-555555555555',
      },
      atMs(1000)
    );
    await engine.placeOrder(
      'b',
      state.duelId,
      {
        instrumentId: 'inst-nvlt',
        side: SimOrderSide.BUY,
        quantity: qty,
        clientOrderId: '66666666-6666-4666-8666-666666666666',
      },
      atMs(1000)
    );

    await engine.tick(state.duelId, atMs(crashMinute * 4000));
    const sell = await engine.placeOrder(
      'a',
      state.duelId,
      {
        instrumentId: 'inst-nvlt',
        side: SimOrderSide.SELL,
        quantity: qty,
        clientOrderId: '77777777-7777-4777-8777-777777777777',
      },
      atMs((crashMinute + 3) * 4000)
    );
    expect(sell.order.side).toBe('SELL');
    await engine.tick(state.duelId, atMs(15 * 4000));
    await engine.settleDuel(state.duelId, atMs(15 * 4000));

    const rowA = await repo.findResult(state.duelId, 'a');
    const rowB = await repo.findResult(state.duelId, 'b');
    expect(rowA?.result).toBe('LOSS');
    expect(rowB?.result).toBe('WIN');
    expect(rowA?.panicSold).toBe(true);
    expect(rowA?.tradesDuringCrash).toBe(1);
    expect(rowB?.panicSold).toBe(false);
    expect(rowB?.tradesDuringCrash).toBe(0);
    expect(rowA?.returnPct).toBeLessThan(rowB?.returnPct as number);
    expect(rowA?.riskAdjustedScore).toBeLessThan(rowB?.riskAdjustedScore as number);
  });

  it('the Mira bot sells to cash on the crash tick and never re-buys', async () => {
    const { engine } = makeEngine();
    const state = await engine.createBotCrisis(A, T0);
    engine.clearTimers(state.duelId);
    const crashMinute = state.crashMinute as number;
    await engine.startTrading(state.duelId, T0);
    engine.clearTimers(state.duelId);

    // Minute ticks (wall-clock minutes advance, so the bot steps):
    // the crash fires on the first tick past the seeded minute.
    await engine.tick(state.duelId, atMs(61_000));
    const afterCrash = await engine.getState(state.duelId);
    expect(afterCrash?.crashFired).toBe(true);
    expect(afterCrash?.playerB?.holdings).toEqual({});
    const tradesAtCrash = afterCrash?.playerB?.tradeCount ?? 0;

    // Later minute ticks: she never buys again, even with strong momentum.
    await engine.tick(state.duelId, atMs(121_000));
    await engine.tick(state.duelId, atMs(181_000));
    const later = await engine.getState(state.duelId);
    expect(later?.playerB?.holdings).toEqual({});
    expect(later?.playerB?.tradeCount).toBe(tradesAtCrash);
    expect(crashMinute).toBeGreaterThanOrEqual(7);
  });

  it('a crisis order before the crash executes at the base price; during the crash at the crashed price', async () => {
    const { engine } = makeEngine();
    const state = await engine.createCrisis(A, B, T0);
    engine.clearTimers(state.duelId);
    const crashMinute = state.crashMinute as number;
    await engine.startTrading(state.duelId, T0);
    engine.clearTimers(state.duelId);
    const before = await engine.placeOrder(
      'a',
      state.duelId,
      {
        instrumentId: 'inst-nvlt',
        side: SimOrderSide.BUY,
        quantity: 1,
        clientOrderId: '55555555-5555-4555-8555-555555555555',
      },
      atMs(1000)
    );
    expect(Number(before.order.price)).toBeCloseTo(nvltPriceAt(T0), 0);
    await engine.tick(state.duelId, atMs((crashMinute + 2) * 4000));
    const during = await engine.placeOrder(
      'b',
      state.duelId,
      {
        instrumentId: 'inst-nvlt',
        side: SimOrderSide.BUY,
        quantity: 1,
        clientOrderId: '66666666-6666-4666-8666-666666666666',
      },
      atMs((crashMinute + 2) * 4000)
    );
    expect(Number(during.order.price)).toBeCloseTo(nvltPriceAt(T0) * 0.88, 0);
  });
});
