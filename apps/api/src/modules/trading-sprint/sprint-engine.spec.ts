import { Prisma, SimOrderSide, DuelStatus, DuelType } from '@prisma/client';
import { ErrorCode } from '@candle/shared';
import { AppError } from '../../common/errors/app-error';
import { SprintEngine, type SprintEmitter } from './sprint-engine.service';
import { applyUpdate, mirrorResult, scoreForResult } from '../ratings/rating-math';

/**
 * Sprint engine — docs/14 §2–§7 (ADR 0011).
 * In-memory fakes: Redis, the sprint repository, the simulator
 * repository, Ratings (real ELO math via rating-math.ts), gamification,
 * transactions, and the stored-result service. No sockets, no DB.
 *
 * Prices come from the real deterministic PriceEngine via the engine,
 * so a trade's cost is whatever the engine priced it at — the test
 * reads the order's own price instead of hard-coding one.
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
  }): Promise<DuelRow> {
    const row: DuelRow = {
      id: `duel-${++this.n}`,
      type: DuelType.SPRINT,
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
    for (const row of this.duels.values()) {
      if (
        row.type === DuelType.SPRINT &&
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

/** Ratings fake with the real ELO math (rating-math.ts) and idempotency. */
class FakeRatings {
  readonly trading = new Map<string, number>([
    ['a', 1000],
    ['b', 1000],
  ]);
  readonly games = new Map<string, number>();
  readonly history = new Map<string, { me: any; opponent: any | null }>();
  recordTradingDuelCalls = 0;
  recordTradingDuelVsBotCalls = 0;

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
    this.recordTradingDuelCalls += 1;
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
    this.recordTradingDuelVsBotCalls += 1;
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
        type: 'SPRINT',
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
  engine.bindEmitter(emitter);
  return { engine, redis, repo, ratings, toUser, toRoom };
}

const A = { userId: 'a', displayName: 'Asha', rating: 1000 };
const B = { userId: 'b', displayName: 'Ravi', rating: 1000 };
const T0 = new Date('2026-11-12T10:00:00.000Z');

describe('SprintEngine', () => {
  it('creates a sprint on one market: same cash, same instruments, COUNTDOWN, host Tara', async () => {
    const { engine } = makeEngine();
    const state = await engine.createSprint(A, B, T0);
    engine.clearTimers(state.duelId);
    expect(state.phase).toBe('COUNTDOWN');
    expect(state.startCash).toBe('100000.00');
    expect(state.playerA.cash).toBe('100000.00');
    expect(state.playerB?.cash).toBe('100000.00');
    expect(state.instruments).toHaveLength(6);
    expect(state.instruments.map((i) => i.symbol)).toEqual([
      'NVLT',
      'KVRF',
      'ASTL',
      'MRUM',
      'SGNR',
      'HELX',
    ]);
    const matched = engine.matchedPayload(state, 'a');
    expect(matched.host.name).toBe('Tara');
    expect(matched.startingCash).toBe('100000.00');
  });

  it('creates a bot sprint vs Mira at the player’s own Trading Rating', async () => {
    const { engine } = makeEngine();
    const state = await engine.createBotSprint(A, T0);
    engine.clearTimers(state.duelId);
    expect(state.isBot).toBe(true);
    expect(state.playerB?.userId).toBe('bot:mira');
    expect(state.playerB?.displayName).toBe('Mira');
    expect(state.playerB?.rating).toBe(1000);
  });

  it('rejects orders before trading starts', async () => {
    const { engine } = makeEngine();
    const state = await engine.createSprint(A, B, T0);
    engine.clearTimers(state.duelId);
    await expect(
      engine.placeOrder(
        'a',
        state.duelId,
        {
          instrumentId: 'inst-nvlt',
          side: SimOrderSide.BUY,
          quantity: 1,
          clientOrderId: 'order-1',
        },
        T0
      )
    ).rejects.toMatchObject({ code: ErrorCode.SPRINT_NOT_ACTIVE });
  });

  it('buys, sells, and prices from the deterministic engine; replay is idempotent', async () => {
    const { engine } = makeEngine();
    const state = await engine.createSprint(A, B, T0);
    engine.clearTimers(state.duelId);
    await engine.startTrading(state.duelId, T0);
    engine.clearTimers(state.duelId);

    const buy = await engine.placeOrder(
      'a',
      state.duelId,
      {
        instrumentId: 'inst-nvlt',
        side: SimOrderSide.BUY,
        quantity: 10,
        clientOrderId: 'order-buy-1',
      },
      T0
    );
    const cost = Number(buy.order.price) * 10;
    expect(buy.order.symbol).toBe('NVLT');
    expect(buy.portfolio.cash).toBe((100000 - cost).toFixed(2));
    expect(buy.portfolio.holdings).toHaveLength(1);
    expect(buy.portfolio.holdings[0]?.quantity).toBe('10');

    // A retried clientOrderId replays the stored order — no second trade.
    const replay = await engine.placeOrder(
      'a',
      state.duelId,
      {
        instrumentId: 'inst-nvlt',
        side: SimOrderSide.BUY,
        quantity: 10,
        clientOrderId: 'order-buy-1',
      },
      T0
    );
    expect(replay.order).toEqual(buy.order);
    const after = await engine.getState(state.duelId);
    expect(after?.playerA.tradeCount).toBe(1);

    const sell = await engine.placeOrder(
      'a',
      state.duelId,
      {
        instrumentId: 'inst-nvlt',
        side: SimOrderSide.SELL,
        quantity: 5,
        clientOrderId: 'order-sell-1',
      },
      T0
    );
    expect(sell.portfolio.holdings[0]?.quantity).toBe('5');
  });

  it('rejects orders with no funds, no holdings, bad quantity, or an unknown instrument', async () => {
    const { engine } = makeEngine();
    const state = await engine.createSprint(A, B, T0);
    engine.clearTimers(state.duelId);
    await engine.startTrading(state.duelId, T0);
    engine.clearTimers(state.duelId);

    await expect(
      engine.placeOrder(
        'a',
        state.duelId,
        {
          instrumentId: 'inst-sgnr',
          side: SimOrderSide.BUY,
          quantity: 100000,
          clientOrderId: 'o1',
        },
        T0
      )
    ).rejects.toMatchObject({ code: ErrorCode.INSUFFICIENT_FUNDS });
    await expect(
      engine.placeOrder(
        'a',
        state.duelId,
        { instrumentId: 'inst-nvlt', side: SimOrderSide.SELL, quantity: 1, clientOrderId: 'o2' },
        T0
      )
    ).rejects.toMatchObject({ code: ErrorCode.INSUFFICIENT_HOLDINGS });
    await expect(
      engine.placeOrder(
        'a',
        state.duelId,
        { instrumentId: 'inst-nvlt', side: SimOrderSide.BUY, quantity: 0, clientOrderId: 'o3' },
        T0
      )
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
    await expect(
      engine.placeOrder(
        'a',
        state.duelId,
        { instrumentId: 'inst-nope', side: SimOrderSide.BUY, quantity: 1, clientOrderId: 'o4' },
        T0
      )
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
    await expect(
      engine.placeOrder(
        'c',
        state.duelId,
        { instrumentId: 'inst-nvlt', side: SimOrderSide.BUY, quantity: 1, clientOrderId: 'o5' },
        T0
      )
    ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
  });

  it('ticks broadcast prices + both total equities, never holdings', async () => {
    const { engine, toRoom } = makeEngine();
    const state = await engine.createSprint(A, B, T0);
    engine.clearTimers(state.duelId);
    await engine.startTrading(state.duelId, T0);
    engine.clearTimers(state.duelId);
    await engine.placeOrder(
      'a',
      state.duelId,
      {
        instrumentId: 'inst-nvlt',
        side: SimOrderSide.BUY,
        quantity: 10,
        clientOrderId: 'o1',
      },
      T0
    );
    toRoom.mockClear();
    await engine.tick(state.duelId, new Date(T0.getTime() + 30_000));
    const tickCall = toRoom.mock.calls.find((c) => c[1] === 'sprint:tick');
    expect(tickCall).toBeDefined();
    const payload = tickCall?.[2] as Record<string, unknown>;
    expect(payload.prices).toBeDefined();
    expect(payload.equities).toBeDefined();
    expect(JSON.stringify(payload)).not.toContain('holdings');
    expect(JSON.stringify(payload)).not.toContain('order');
  });

  it('settles a no-trade sprint as a draw: no Rating change, 5 XP each, both rows stored', async () => {
    const { engine, repo, ratings } = makeEngine();
    const state = await engine.createSprint(A, B, T0);
    engine.clearTimers(state.duelId);
    await engine.startTrading(state.duelId, T0);
    engine.clearTimers(state.duelId);
    const view = await engine.settleDuel(state.duelId, new Date(T0.getTime() + 15 * 60_000));
    expect(view?.result).toBe('DRAW');
    expect(view?.ratingDelta).toBe(0);
    expect(view?.xp.awarded).toBe(5);
    expect(view?.tradeCount).toBe(0);
    expect(ratings.recordTradingDuelCalls).toBe(1);
    expect(repo.results).toHaveLength(2);
    expect(repo.results.map((r) => r.result)).toEqual(['DRAW', 'DRAW']);
    const duel = await repo.findDuelById(state.duelId);
    expect(duel?.status).toBe(DuelStatus.SETTLED);
    expect(duel?.winnerId).toBeNull();

    // A re-settle replays the stored result — the Rating is applied once.
    const replay = await engine.settleDuel(state.duelId, new Date(T0.getTime() + 15 * 60_000));
    expect(replay?.result).toBe('DRAW');
    expect(ratings.recordTradingDuelCalls).toBe(1);
  });

  it('settles a traded sprint: one winner on risk-adjusted return, mirrored Rating deltas', async () => {
    const { engine, repo, ratings } = makeEngine();
    const state = await engine.createSprint(A, B, T0);
    engine.clearTimers(state.duelId);
    await engine.startTrading(state.duelId, T0);
    engine.clearTimers(state.duelId);
    await engine.placeOrder(
      'a',
      state.duelId,
      {
        instrumentId: 'inst-nvlt',
        side: SimOrderSide.BUY,
        quantity: 10,
        clientOrderId: 'o1',
      },
      T0
    );
    const view = await engine.settleDuel(state.duelId, new Date(T0.getTime() + 15 * 60_000));
    // A traded, B held cash: the scores differ, so there is a winner.
    expect(['WIN', 'LOSS']).toContain(view?.result);
    const aRow = repo.results.find((r) => r.userId === 'a');
    const bRow = repo.results.find((r) => r.userId === 'b');
    expect(aRow?.ratingDelta).toBe(-(bRow?.ratingDelta as number));
    expect(Math.abs(aRow?.ratingDelta as number)).toBe(20); // K=40 provisional, |Sa − Ea| = 0.5
    expect(repo.trades).toHaveLength(1);
    expect(aRow?.tradeCount).toBe(1);
    expect(aRow?.perInstrument).toHaveLength(1);
    expect(ratings.recordTradingDuelCalls).toBe(1);
  });

  it('forfeit: the leaver loses, the opponent wins +20 Trading Rating, 0/20 XP', async () => {
    const { engine, repo, ratings } = makeEngine();
    const state = await engine.createSprint(A, B, T0);
    engine.clearTimers(state.duelId);
    await engine.startTrading(state.duelId, T0);
    engine.clearTimers(state.duelId);
    await engine.leaveSprint('a', state.duelId);
    const aRow = repo.results.find((r) => r.userId === 'a');
    const bRow = repo.results.find((r) => r.userId === 'b');
    expect(aRow?.result).toBe('LOSS');
    expect(bRow?.result).toBe('WIN');
    expect(aRow?.ratingDelta).toBe(-20);
    expect(bRow?.ratingDelta).toBe(20);
    expect(aRow?.xpAwarded).toBe(0);
    expect(bRow?.xpAwarded).toBe(20);
    const duel = await repo.findDuelById(state.duelId);
    expect(duel?.winnerId).toBe('b');
    expect(ratings.recordTradingDuelCalls).toBe(1);
  });

  it('disconnect grace: opponent is told, reconnect clears it, expiry forfeits', async () => {
    const { engine, repo, toRoom } = makeEngine();
    const state = await engine.createSprint(A, B, T0);
    engine.clearTimers(state.duelId);
    await engine.startTrading(state.duelId, T0);
    engine.clearTimers(state.duelId);

    await engine.handleDisconnect('a', T0);
    expect(toRoom).toHaveBeenCalledWith(
      expect.any(String),
      'sprint:opponent-disconnected',
      expect.objectContaining({ userId: 'a', graceSeconds: 1 })
    );
    const mid = await engine.getState(state.duelId);
    expect(mid?.playerA.disconnectedAtMs).toBe(T0.getTime());

    await engine.handleReconnect('a', new Date(T0.getTime() + 5000));
    expect(toRoom).toHaveBeenCalledWith(
      expect.any(String),
      'sprint:opponent-reconnected',
      expect.objectContaining({ userId: 'a' })
    );
    const after = await engine.getState(state.duelId);
    expect(after?.playerA.disconnectedAtMs).toBeNull();

    // A second disconnect that is never cleared forfeits on grace expiry.
    await engine.handleDisconnect('a', new Date(T0.getTime() + 6000));
    await engine.forfeitIfStillDisconnected(state.duelId, 'a');
    const aRow = repo.results.find((r) => r.userId === 'a');
    expect(aRow?.result).toBe('LOSS');
    engine.clearTimers(state.duelId);
  });

  it('bot sprint settles via the bot Rating path and stores the bot summary on the Duel', async () => {
    const { engine, repo, ratings } = makeEngine();
    const state = await engine.createBotSprint(A, T0);
    engine.clearTimers(state.duelId);
    await engine.startTrading(state.duelId, T0);
    engine.clearTimers(state.duelId);
    const view = await engine.settleDuel(state.duelId, new Date(T0.getTime() + 15 * 60_000));
    expect(ratings.recordTradingDuelVsBotCalls).toBe(1);
    expect(ratings.recordTradingDuelCalls).toBe(0);
    expect(repo.results).toHaveLength(1); // human only
    expect(view?.result).toBeDefined();
    const duel = await repo.findDuelById(state.duelId);
    expect(duel?.botScore).toBeDefined();
    expect(typeof duel?.botCorrect).toBe('number');
  });

  it('rematch: cooldown right after a sprint, then both ask and a new sprint starts', async () => {
    const { engine } = makeEngine();
    const state = await engine.createSprint(A, B, T0);
    engine.clearTimers(state.duelId);
    await engine.startTrading(state.duelId, T0);
    engine.clearTimers(state.duelId);
    const settledAt = new Date(T0.getTime() + 15 * 60_000);
    await engine.settleDuel(state.duelId, settledAt);

    const tooSoon = await engine.rematch('a', state.duelId, new Date(settledAt.getTime() + 60_000));
    expect(tooSoon.matched).toBe(false);
    expect(tooSoon.reason).toBe('REMATCH_COOLDOWN');
    expect(tooSoon.retryAfterMs).toBeGreaterThan(0);

    const waiting = await engine.rematch(
      'a',
      state.duelId,
      new Date(settledAt.getTime() + 6 * 60_000)
    );
    expect(waiting.matched).toBe(false);
    expect(waiting.reason).toBe('WAITING_OPPONENT');

    const matched = await engine.rematch(
      'b',
      state.duelId,
      new Date(settledAt.getTime() + 6 * 60_000)
    );
    expect(matched.matched).toBe(true);
    expect(matched.newDuelId).toBeDefined();
    expect(matched.newDuelId).not.toBe(state.duelId);
    const fresh = await engine.getState(matched.newDuelId as string);
    expect(fresh?.phase).toBe('COUNTDOWN');
    engine.clearTimers(matched.newDuelId);
  });

  it('rematch is not offered for a bot sprint', async () => {
    const { engine } = makeEngine();
    const state = await engine.createBotSprint(A, T0);
    engine.clearTimers(state.duelId);
    await engine.startTrading(state.duelId, T0);
    engine.clearTimers(state.duelId);
    await engine.settleDuel(state.duelId, new Date(T0.getTime() + 15 * 60_000));
    const res = await engine.rematch('a', state.duelId, new Date(T0.getTime() + 21 * 60_000));
    expect(res.matched).toBe(false);
    expect(res.reason).toBe('BOT_NO_REMATCH');
  });
});
