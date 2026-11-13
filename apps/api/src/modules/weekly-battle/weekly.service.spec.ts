import { Prisma } from '@prisma/client';
import { ErrorCode } from '@candle/shared';
import { AppError } from '../../common/errors/app-error';
import { applyUpdate, tradingScore } from '../ratings/rating-math';
import { WeeklyService, isMondayIst, mondayStartMs } from './weekly.service';

/**
 * Weekly service — docs/16 (ADR 0013).
 * In-memory fakes: the weekly repository, the simulator repository,
 * Ratings (real ELO math via rating-math.ts), gamification, and
 * transactions. Prices come from the real deterministic PriceEngine
 * via the service, so a trade's cost is whatever the engine priced
 * it at — the test reads the order's own price instead of hard-coding
 * one. No DB, no sockets.
 */

const INSTRUMENTS = [
  {
    id: 'inst-nvlt',
    symbol: 'NVLT',
    name: 'NovaVolt Energy',
    basePrice: new Prisma.Decimal('842.50'),
  },
  {
    id: 'inst-kvrf',
    symbol: 'KVRF',
    name: 'Kaveri Foods',
    basePrice: new Prisma.Decimal('315.20'),
  },
  { id: 'inst-astl', symbol: 'ASTL', name: 'AstraLogix', basePrice: new Prisma.Decimal('1204.00') },
  { id: 'inst-mrum', symbol: 'MRUM', name: 'Meru Motors', basePrice: new Prisma.Decimal('96.75') },
  {
    id: 'inst-sgnr',
    symbol: 'SGNR',
    name: 'Sagar Semiconductors',
    basePrice: new Prisma.Decimal('2210.40'),
  },
  {
    id: 'inst-helx',
    symbol: 'HELX',
    name: 'Helix Healthcare',
    basePrice: new Prisma.Decimal('458.90'),
  },
];

const T0 = new Date('2026-11-09T00:00:00.000Z'); // a Monday
const MONDAY = '2026-11-09';
const DURATION_MS = 15_000;

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

class FakeWeeklyRepo {
  seasons = new Map<string, any>();
  leagues = new Map<string, any>();
  memberships = new Map<string, any>(); // `${seasonId}:${userId}`
  trades: any[] = [];
  results = new Map<string, any>(); // `${seasonId}:${userId}`
  private n = 0;

  private id(prefix: string): string {
    this.n += 1;
    return `${prefix}-${this.n}`;
  }

  async createSeason(input: any): Promise<any> {
    const row = {
      id: this.id('season'),
      status: 'OPEN',
      startedAt: null,
      endsAt: null,
      indexReturnPct: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...input,
    };
    this.seasons.set(row.id, row);
    return { ...row };
  }

  async findSeasonById(id: string): Promise<any | null> {
    const r = this.seasons.get(id);
    return r ? { ...r } : null;
  }

  async findSeasonByWeekStart(weekStart: string): Promise<any | null> {
    const r = [...this.seasons.values()].find((s) => s.weekStart === weekStart);
    return r ? { ...r } : null;
  }

  async listSeasons(): Promise<any[]> {
    return [...this.seasons.values()]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((r) => ({ ...r }));
  }

  async updateSeason(id: string, data: any): Promise<any> {
    const r = this.seasons.get(id);
    Object.assign(r, data, { updatedAt: new Date() });
    return { ...r };
  }

  async countLeaguesForSeason(seasonId: string): Promise<number> {
    return [...this.leagues.values()].filter((l) => l.seasonId === seasonId).length;
  }

  async countMembershipsForSeason(seasonId: string): Promise<number> {
    return [...this.memberships.values()].filter((m) => m.seasonId === seasonId).length;
  }

  async createLeague(input: any): Promise<any> {
    const row = { id: this.id('league'), createdAt: new Date(), ...input };
    this.leagues.set(row.id, row);
    return { ...row };
  }

  async listLeaguesForSeason(seasonId: string): Promise<any[]> {
    return [...this.leagues.values()]
      .filter((l) => l.seasonId === seasonId)
      .sort((a, b) => a.leagueNumber - b.leagueNumber)
      .map((r) => ({ ...r }));
  }

  async createMembership(input: any): Promise<any> {
    const row = {
      id: this.id('member'),
      leagueId: null,
      tier: 1,
      carried: false,
      joinedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      ...input,
    };
    this.memberships.set(`${row.seasonId}:${row.userId}`, row);
    return { ...row };
  }

  async findMembership(seasonId: string, userId: string): Promise<any | null> {
    const r = this.memberships.get(`${seasonId}:${userId}`);
    return r ? { ...r } : null;
  }

  async listMembershipsForSeason(seasonId: string): Promise<any[]> {
    return [...this.memberships.values()]
      .filter((m) => m.seasonId === seasonId)
      .sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime())
      .map((r) => ({ ...r }));
  }

  async listMembershipsForLeague(leagueId: string): Promise<any[]> {
    return [...this.memberships.values()]
      .filter((m) => m.leagueId === leagueId)
      .sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime())
      .map((r) => ({ ...r }));
  }

  async listCarriedMemberships(seasonId: string): Promise<any[]> {
    return [...this.memberships.values()]
      .filter((m) => m.seasonId === seasonId && m.carried)
      .map((r) => ({ ...r }));
  }

  async updateMembership(id: string, data: any): Promise<any> {
    const r = [...this.memberships.values()].find((m) => m.id === id);
    Object.assign(r, data, { updatedAt: new Date() });
    return { ...r };
  }

  async findLatestResultForUser(userId: string): Promise<any | null> {
    const rows = [...this.results.values()]
      .filter((r) => r.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return rows[0] ? { ...rows[0] } : null;
  }

  async createTrade(input: any): Promise<any> {
    const row = { id: this.id('trade'), ...input };
    this.trades.push(row);
    return { ...row };
  }

  async findTradeByClientOrderId(
    seasonId: string,
    userId: string,
    clientOrderId: string
  ): Promise<any | null> {
    const r = this.trades.find(
      (t) => t.seasonId === seasonId && t.userId === userId && t.clientOrderId === clientOrderId
    );
    return r ? { ...r } : null;
  }

  async listTradesForSeasonUser(seasonId: string, userId: string): Promise<any[]> {
    return this.trades
      .filter((t) => t.seasonId === seasonId && t.userId === userId)
      .sort((a, b) => a.executedAt.getTime() - b.executedAt.getTime())
      .map((r) => ({ ...r }));
  }

  async countTradesForSeasonUser(seasonId: string, userId: string): Promise<number> {
    return this.trades.filter((t) => t.seasonId === seasonId && t.userId === userId).length;
  }

  async createResult(input: any): Promise<any> {
    const row = { id: this.id('result'), createdAt: new Date(), ...input };
    this.results.set(`${row.seasonId}:${row.userId}`, row);
    return { ...row };
  }

  async findResult(seasonId: string, userId: string): Promise<any | null> {
    const r = this.results.get(`${seasonId}:${userId}`);
    return r ? { ...r } : null;
  }

  async listResultsForLeague(leagueId: string): Promise<any[]> {
    return [...this.results.values()]
      .filter((r) => r.leagueId === leagueId)
      .sort((a, b) => a.rank - b.rank)
      .map((r) => ({ ...r }));
  }

  async listResultsForUser(userId: string, skip: number, take: number): Promise<any[]> {
    return [...this.results.values()]
      .filter((r) => r.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(skip, skip + take)
      .map((r) => ({ ...r }));
  }

  async countResultsForUser(userId: string): Promise<number> {
    return [...this.results.values()].filter((r) => r.userId === userId).length;
  }

  async findUserById(id: string): Promise<any | null> {
    return { id, displayName: `Player ${id.slice(-2)}` };
  }
}

class FakeSimRepo {
  async listActiveInstruments(): Promise<any[]> {
    return INSTRUMENTS.map((i) => ({
      ...i,
      active: true,
      description: '',
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
  }
}

/** Ratings fake with the real ELO math (rating-math.ts). */
class FakeRatings {
  ratings = new Map<string, { rating: number; gamesPlayed: number }>();
  weeks = new Set<string>(); // `${userId}:${weekStartIso}`
  keys = new Map<string, any>(); // idempotencyKey -> TradingWeekResponse
  calls = 0;
  /** Pre-seed a duplicate: the next recordTradingWeek throws, getDuelOutcome recovers. */
  duplicateSeeds = new Map<string, { before: number; after: number; delta: number }>();

  ratingOf(userId: string): number {
    return this.ratings.get(userId)?.rating ?? 1000;
  }

  async getUserRatings(userId: string): Promise<any> {
    return { trading: { rating: this.ratingOf(userId) } };
  }

  async recordTradingWeek(_adminId: string, dto: any): Promise<any> {
    this.calls += 1;
    if (this.keys.has(dto.idempotencyKey)) {
      throw new AppError(ErrorCode.IDEMPOTENCY_REPLAY, 409, undefined, {
        original: this.keys.get(dto.idempotencyKey),
      });
    }
    const seed = this.duplicateSeeds.get(dto.idempotencyKey);
    if (seed) {
      // The seed stays: getDuelOutcome reads it back, like history.
      throw AppError.ratingEventDuplicate('This trading-week event was already recorded.');
    }
    const weekKey = `${dto.userId}:${dto.weekStart}`;
    if (this.weeks.has(weekKey)) {
      throw AppError.ratingEventDuplicate('This user already has a trading rating for that week.');
    }
    if (dto.tradeCount < 3) {
      return {
        applied: false,
        userId: dto.userId,
        weekStart: dto.weekStart,
        tradeCount: dto.tradeCount,
        reason: 'MIN_TRADES_NOT_MET',
      };
    }
    const score = tradingScore(dto.portfolioReturnPct, dto.indexReturnPct);
    const before = this.ratingOf(dto.userId);
    const gamesPlayed = this.ratings.get(dto.userId)?.gamesPlayed ?? 0;
    const update = applyUpdate(before, 1200, score, gamesPlayed);
    this.ratings.set(dto.userId, { rating: update.newRating, gamesPlayed: gamesPlayed + 1 });
    this.weeks.add(weekKey);
    const res = {
      applied: true,
      userId: dto.userId,
      weekStart: dto.weekStart,
      tradeCount: dto.tradeCount,
      score: score === 1 ? 'WIN' : score === 0 ? 'LOSS' : 'DRAW',
      ratingBefore: before,
      ratingAfter: update.newRating,
      delta: update.delta,
    };
    this.keys.set(dto.idempotencyKey, res);
    return res;
  }

  async getDuelOutcome(userId: string, eventId: string): Promise<any | null> {
    const seed = this.duplicateSeeds.get(eventId);
    if (!seed) {
      const stored = this.keys.get(eventId);
      if (!stored) return null;
      return {
        eventId,
        me: {
          userId,
          ratingBefore: stored.ratingBefore,
          ratingAfter: stored.ratingAfter,
          delta: stored.delta,
          tier: 'Silver',
          provisional: true,
          gamesPlayed: 1,
        },
        opponent: null,
      };
    }
    return {
      eventId,
      me: {
        userId,
        ratingBefore: seed.before,
        ratingAfter: seed.after,
        delta: seed.delta,
        tier: 'Silver',
        provisional: true,
        gamesPlayed: 1,
      },
      opponent: null,
    };
  }
}

class FakeGamification {
  xpByUser = new Map<string, number>();

  async grantDuelRewards(_tx: unknown, event: any): Promise<any> {
    const xp = event.result === 'WIN' ? 20 : event.result === 'DRAW' ? 5 : 0;
    const total = (this.xpByUser.get(event.userId) ?? 0) + xp;
    this.xpByUser.set(event.userId, total);
    return {
      xpAwarded: xp,
      totalXp: total,
      level: 1,
      levelUp: false,
      currentStreak: 1,
      longestStreak: 1,
      newBadges: [],
      applied: true,
    };
  }
}

const logger = { info(): void {}, error(): void {} };
const transactions = {
  async run<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
    return fn({});
  },
};
const config = { WEEKLY_SEASON_DURATION_MS: DURATION_MS } as never;

function buildService() {
  const repo = new FakeWeeklyRepo();
  const ratings = new FakeRatings();
  const gamification = new FakeGamification();
  const service = new WeeklyService(
    repo as never,
    new FakeSimRepo() as never,
    ratings as never,
    gamification as never,
    transactions as never,
    logger as never,
    config
  );
  return { service, repo, ratings, gamification };
}

const ADMIN = 'admin-1';
const U = (n: number): string => uuid(n);

describe('monday helpers', () => {
  it('2026-11-09 is a Monday in Asia/Kolkata; 2026-11-10 is not', () => {
    expect(isMondayIst('2026-11-09')).toBe(true);
    expect(isMondayIst('2026-11-10')).toBe(false);
    expect(isMondayIst('2026-11-08')).toBe(false); // Sunday
  });

  it('mondayStartMs is Monday 00:00 IST (Sunday 18:30 UTC)', () => {
    expect(new Date(mondayStartMs('2026-11-09')).toISOString()).toBe('2026-11-08T18:30:00.000Z');
  });
});

describe('weekly seasons', () => {
  it('rejects a non-Monday weekStart', async () => {
    const { service } = buildService();
    await expect(service.createSeason(ADMIN, { weekStart: '2026-11-10' })).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_FAILED,
    });
  });

  it('creates a season and rejects a duplicate weekStart', async () => {
    const { service } = buildService();
    const s = await service.createSeason(ADMIN, { weekStart: MONDAY }, T0);
    expect(s.status).toBe('OPEN');
    expect(s.weekStart).toBe(MONDAY);
    expect(s.scheduledStartsAt.toISOString()).toBe('2026-11-08T18:30:00.000Z');
    await expect(service.createSeason(ADMIN, { weekStart: MONDAY }, T0)).rejects.toMatchObject({
      code: ErrorCode.CONFLICT,
    });
  });

  it('join works while OPEN, twice is a duplicate, after start it is closed', async () => {
    const { service } = buildService();
    const s = await service.createSeason(ADMIN, { weekStart: MONDAY }, T0);
    const joined = await service.joinSeason(U(1), s.id, T0);
    expect(joined.tradingRating).toBe(1000);
    await expect(service.joinSeason(U(1), s.id, T0)).rejects.toMatchObject({
      code: ErrorCode.WEEKLY_ALREADY_JOINED,
    });
    await service.joinSeason(U(2), s.id, T0);
    await service.startSeason(ADMIN, s.id, T0);
    await expect(service.joinSeason(U(3), s.id, T0)).rejects.toMatchObject({
      code: ErrorCode.WEEKLY_JOIN_CLOSED,
    });
  });

  it('start forms one league of 30 from 30 joiners', async () => {
    const { service } = buildService();
    const s = await service.createSeason(ADMIN, { weekStart: MONDAY }, T0);
    for (let i = 1; i <= 30; i++) await service.joinSeason(U(i), s.id, T0);
    const started = await service.startSeason(ADMIN, s.id, T0);
    expect(started.season.status).toBe('ACTIVE');
    expect(started.leagues).toHaveLength(1);
    expect(started.leagues[0]?.tier).toBe(1);
    expect(started.carriedUserIds).toEqual([]);
    expect(started.season.endsAt?.getTime()).toBe(T0.getTime() + DURATION_MS);
  });

  it('start merges a 31st joiner into the league and carries a lone joiner', async () => {
    const { service } = buildService();
    const s = await service.createSeason(ADMIN, { weekStart: MONDAY }, T0);
    for (let i = 1; i <= 31; i++) await service.joinSeason(U(i), s.id, T0);
    const started = await service.startSeason(ADMIN, s.id, T0);
    expect(started.leagues).toHaveLength(1);
    expect((await service.getStandings(s.id, T0)).leagues[0]?.entries).toHaveLength(31);

    const s2 = await service.createSeason(ADMIN, { weekStart: '2026-11-16' }, T0);
    await service.joinSeason(U(99), s2.id, T0);
    const started2 = await service.startSeason(ADMIN, s2.id, T0);
    expect(started2.leagues).toHaveLength(0);
    expect(started2.carriedUserIds).toEqual([U(99)]);
  });

  it('a carried joiner is enrolled automatically in the next season', async () => {
    const { service, repo } = buildService();
    const s1 = await service.createSeason(ADMIN, { weekStart: MONDAY }, T0);
    await service.joinSeason(U(99), s1.id, T0);
    await service.startSeason(ADMIN, s1.id, T0);
    const s2 = await service.createSeason(ADMIN, { weekStart: '2026-11-16' }, T0);
    const carried = await repo.findMembership(s2.id, U(99));
    expect(carried).not.toBeNull();
    expect(carried.carried).toBe(false);
  });
});

describe('weekly trading', () => {
  async function startedSeason(userCount: number) {
    const ctx = buildService();
    const s = await ctx.service.createSeason(ADMIN, { weekStart: MONDAY }, T0);
    for (let i = 1; i <= userCount; i++) await ctx.service.joinSeason(U(i), s.id, T0);
    await ctx.service.startSeason(ADMIN, s.id, T0);
    return { ...ctx, season: s };
  }

  it('rejects trading before the season starts', async () => {
    const { service } = buildService();
    const s = await service.createSeason(ADMIN, { weekStart: MONDAY }, T0);
    await service.joinSeason(U(1), s.id, T0);
    await expect(
      service.trade(
        U(1),
        s.id,
        {
          instrumentId: 'inst-nvlt',
          side: 'BUY',
          quantity: 10,
          clientOrderId: uuid(1001),
        },
        T0
      )
    ).rejects.toMatchObject({ code: ErrorCode.WEEKLY_NOT_STARTED });
  });

  it('buys spend cash, replays a retried clientOrderId, and validates funds/holdings', async () => {
    const { service } = await startedSeason(2);
    const seasonId = (await service.listSeasons())[0]?.id as string;
    const t1 = new Date(T0.getTime() + 1000);
    const buy = await service.trade(
      U(1),
      seasonId,
      {
        instrumentId: 'inst-nvlt',
        side: 'BUY',
        quantity: 10,
        clientOrderId: uuid(1001),
      },
      t1
    );
    expect(Number(buy.portfolio.cash)).toBeLessThan(100000);
    expect(buy.portfolio.holdings).toHaveLength(1);
    expect(buy.portfolio.holdings[0]?.quantity).toBe(10);
    expect(Number(buy.price)).toBeGreaterThan(0);

    const replay = await service.trade(
      U(1),
      seasonId,
      {
        instrumentId: 'inst-nvlt',
        side: 'BUY',
        quantity: 10,
        clientOrderId: uuid(1001),
      },
      t1
    );
    expect(replay.id).toBe(buy.id);
    expect(Number(replay.portfolio.cash)).toBe(Number(buy.portfolio.cash));

    await expect(
      service.trade(
        U(1),
        seasonId,
        {
          instrumentId: 'inst-nvlt',
          side: 'BUY',
          quantity: 100000,
          clientOrderId: uuid(1002),
        },
        t1
      )
    ).rejects.toMatchObject({ code: ErrorCode.INSUFFICIENT_FUNDS });

    await expect(
      service.trade(
        U(2),
        seasonId,
        {
          instrumentId: 'inst-nvlt',
          side: 'SELL',
          quantity: 5,
          clientOrderId: uuid(1003),
        },
        t1
      )
    ).rejects.toMatchObject({ code: ErrorCode.INSUFFICIENT_HOLDINGS });

    await expect(
      service.trade(
        U(1),
        seasonId,
        {
          instrumentId: 'inst-xxxx',
          side: 'BUY',
          quantity: 1,
          clientOrderId: uuid(1004),
        },
        t1
      )
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
  });

  it('standings show totals only — never holdings or orders', async () => {
    const { service } = await startedSeason(2);
    const seasonId = (await service.listSeasons())[0]?.id as string;
    const t1 = new Date(T0.getTime() + 1000);
    await service.trade(
      U(1),
      seasonId,
      {
        instrumentId: 'inst-nvlt',
        side: 'BUY',
        quantity: 10,
        clientOrderId: uuid(1001),
      },
      t1
    );
    const standings = await service.getStandings(seasonId, t1);
    expect(standings.leagues).toHaveLength(1);
    expect(standings.leagues[0]?.entries).toHaveLength(2);
    expect(JSON.stringify(standings)).not.toContain('holdings');
    expect(JSON.stringify(standings)).not.toContain('clientOrderId');
    expect(standings.leagues[0]?.entries[0]?.promotionZone).toBe(true);
  });

  it('rejects trading after the season ends', async () => {
    const { service } = await startedSeason(2);
    const seasonId = (await service.listSeasons())[0]?.id as string;
    await expect(
      service.trade(
        U(1),
        seasonId,
        {
          instrumentId: 'inst-nvlt',
          side: 'BUY',
          quantity: 1,
          clientOrderId: uuid(1001),
        },
        new Date(T0.getTime() + DURATION_MS + 1000)
      )
    ).rejects.toMatchObject({ code: ErrorCode.WEEKLY_NOT_ACTIVE });
  });
});

describe('weekly settlement', () => {
  async function fullSeason() {
    const ctx = buildService();
    const s = await ctx.service.createSeason(ADMIN, { weekStart: MONDAY }, T0);
    // U1–U3 trade 3 times each; U4 never trades.
    for (let i = 1; i <= 4; i++) await ctx.service.joinSeason(U(i), s.id, T0);
    await ctx.service.startSeason(ADMIN, s.id, T0);
    const t1 = new Date(T0.getTime() + 1000);
    const t2 = new Date(T0.getTime() + 2000);
    const t3 = new Date(T0.getTime() + 3000);
    for (const u of [U(1), U(2), U(3)]) {
      await ctx.service.trade(
        u,
        s.id,
        {
          instrumentId: 'inst-nvlt',
          side: 'BUY',
          quantity: 10,
          clientOrderId: uuid(2000 + Number(u.slice(-2))),
        },
        t1
      );
      await ctx.service.trade(
        u,
        s.id,
        {
          instrumentId: 'inst-kvrf',
          side: 'BUY',
          quantity: 10,
          clientOrderId: uuid(2100 + Number(u.slice(-2))),
        },
        t2
      );
      await ctx.service.trade(
        u,
        s.id,
        {
          instrumentId: 'inst-nvlt',
          side: 'SELL',
          quantity: 5,
          clientOrderId: uuid(2200 + Number(u.slice(-2))),
        },
        t3
      );
    }
    return { ...ctx, season: s };
  }

  it('refuses to settle before the season ends', async () => {
    const { service, season } = await fullSeason();
    await expect(
      service.settleSeason(ADMIN, season.id, new Date(T0.getTime() + 1000))
    ).rejects.toMatchObject({
      code: ErrorCode.WEEKLY_NOT_ENDED,
    });
  });

  it('settles the full cycle: ratings move, never-traded is last and unrated, re-settle replays', async () => {
    const { service, season, ratings, gamification } = await fullSeason();
    const settleAt = new Date(T0.getTime() + DURATION_MS + 1000);
    const settled = await service.settleSeason(ADMIN, season.id, settleAt);
    expect(settled.status).toBe('SETTLED');
    expect(settled.leaguesSettled).toBe(1);
    expect(settled.playersSettled).toBe(4);
    expect(typeof settled.indexReturnPct).toBe('number');

    // Traders: rated (3 trades, draw vs the index at ~0% — prices
    // barely move in 15 s, so the return stays within ±2%).
    for (const u of [U(1), U(2), U(3)]) {
      const res = await service.getMyResult(u, season.id);
      expect(res.tradeCount).toBe(3);
      expect(res.ratingDelta).toBe(10.4);
      expect(res.ratingBefore).toBe(1000);
      expect(res.ratingAfter).toBe(1010.4);
      expect(res.ratingResult).toBe('DRAW');
      expect(res.ratingReason).toContain('within 2% of the simulated index');
      expect(res.rank).toBeGreaterThanOrEqual(1);
      expect(res.rank).toBeLessThanOrEqual(3);
    }
    // Rank 1–3 in a 4-player league: #1 wins (20 XP), #2–#3 draw (5 XP).
    const xpByRank = new Map<number, number>();
    for (const u of [U(1), U(2), U(3)]) {
      const res = await service.getMyResult(u, season.id);
      xpByRank.set(res.rank, res.xp.awarded);
    }
    expect(xpByRank.get(1)).toBe(20);
    expect(xpByRank.get(2)).toBe(5);
    expect(xpByRank.get(3)).toBe(5);

    // Never-traded: rank last, unrated, 0 XP, demoted to tier 2.
    const idle = await service.getMyResult(U(4), season.id);
    expect(idle.rank).toBe(4);
    expect(idle.tradeCount).toBe(0);
    expect(idle.ratingBefore).toBeNull();
    expect(idle.ratingAfter).toBeNull();
    expect(idle.ratingDelta).toBeNull();
    expect(idle.ratingResult).toBeNull();
    expect(idle.ratingReason).toContain('fewer than 3');
    expect(idle.xp.awarded).toBe(0);
    expect(idle.nextTier).toBe(2);
    expect(gamification.xpByUser.get(U(4))).toBe(0);

    // Ratings moved exactly once per trader.
    for (const u of [U(1), U(2), U(3)]) {
      expect(ratings.ratings.get(u)?.gamesPlayed).toBe(1);
    }

    // Re-settle replays the stored results: no second rating call.
    const callsBefore = ratings.calls;
    const replayed = await service.settleSeason(ADMIN, season.id, settleAt);
    expect(replayed.status).toBe('SETTLED');
    expect(replayed.playersSettled).toBe(4);
    expect(ratings.calls).toBe(callsBefore);
    for (const u of [U(1), U(2), U(3)]) {
      expect(ratings.ratings.get(u)?.gamesPlayed).toBe(1);
    }

    // History lists the season.
    const history = await service.listHistory(U(1), 1, 20);
    expect(history.items).toHaveLength(1);
    expect(history.items[0]?.seasonId).toBe(season.id);
    expect(history.meta.total).toBe(1);
  });

  it('recovers a duplicate rating event instead of double-applying it', async () => {
    const { service, season, ratings } = await fullSeason();
    // Simulate a crash after the Rating step for U1: the history row
    // exists, so recordTradingWeek throws RATING_EVENT_DUPLICATE and
    // getDuelOutcome must return the stored deltas.
    const key = `weekly:${season.id}:${U(1)}`;
    ratings.duplicateSeeds.set(key, { before: 1000, after: 1010.4, delta: 10.4 });
    const settleAt = new Date(T0.getTime() + DURATION_MS + 1000);
    const settled = await service.settleSeason(ADMIN, season.id, settleAt);
    expect(settled.status).toBe('SETTLED');
    const res = await service.getMyResult(U(1), season.id);
    expect(res.ratingBefore).toBe(1000);
    expect(res.ratingAfter).toBe(1010.4);
    expect(res.ratingDelta).toBe(10.4);
  });
});
