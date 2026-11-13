import { randomUUID } from 'crypto';
import { ErrorCode } from '@candle/shared';
import { RatingEventSource, RatingKind } from '@prisma/client';
import { AppError } from '../../common/errors/app-error';
import type { AppLogger } from '../../common/services/logger.service';
import type { RedisService } from '../../common/services/redis.service';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import type { IdempotencyRepository } from '../../common/idempotency/idempotency.repository';
import type { TransactionService } from '../../database/transaction.service';
import { RatingsService } from './ratings.service';
import { DuelResult } from './dto/ratings.dto';
import type { RatingsRepository, UserRatingRow } from './ratings.repository';

/**
 * Service spec — RatingsService against in-memory fakes (same port-boundary
 * pattern as the e2e suite). The clock is controllable so cooldowns and
 * daily caps are deterministic.
 */

const NOW = new Date('2026-11-11T10:00:00.000Z'); // a Wednesday, 2026-Q4

class FakeRatingsRepo {
  clock = new Date(NOW);
  users = new Map<string, { id: string; displayName: string | null; countryCode: string | null }>();
  ratings = new Map<string, UserRatingRow>();
  history: any[] = [];

  seedUser(id: string, displayName: string | null = null, countryCode: string | null = null): void {
    this.users.set(id, { id, displayName, countryCode });
  }

  seedRating(userId: string, kind: RatingKind, patch: Partial<UserRatingRow> = {}): UserRatingRow {
    const row: UserRatingRow = {
      userId,
      kind,
      rating: 1000,
      gamesPlayed: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      provisional: true,
      lastRatedAt: null,
      season: '2026-Q4',
      countryCode: this.users.get(userId)?.countryCode ?? null,
      createdAt: new Date(this.clock),
      updatedAt: new Date(this.clock),
      ...patch,
    };
    this.ratings.set(`${userId}:${kind}`, { ...row });
    return { ...row };
  }

  seedHistory(patch: Record<string, unknown>): void {
    this.history.push({
      id: randomUUID(),
      kind: RatingKind.LEARNING,
      source: RatingEventSource.DUEL,
      eventId: randomUUID(),
      opponentId: null,
      opponentRating: null,
      expectedScore: 0.5,
      actualScore: 1,
      kFactor: 40,
      delta: 20,
      ratingBefore: 1000,
      ratingAfter: 1020,
      season: '2026-Q4',
      weekStart: null,
      createdAt: new Date(this.clock),
      ...patch,
    });
  }

  async findUserById(id: string): Promise<any | null> {
    const u = this.users.get(id);
    return u ? { ...u } : null;
  }

  async findUsersByIds(ids: string[]): Promise<any[]> {
    return ids
      .map((id) => this.users.get(id))
      .filter(Boolean)
      .map((u) => ({ ...u }));
  }

  async findRating(userId: string, kind: RatingKind): Promise<any | null> {
    const r = this.ratings.get(`${userId}:${kind}`);
    return r ? { ...r } : null;
  }

  async findRatingsByUserIds(kind: RatingKind, userIds: string[]): Promise<any[]> {
    return userIds
      .map((id) => this.ratings.get(`${id}:${kind}`))
      .filter(Boolean)
      .map((r) => ({ ...r }));
  }

  async listAllRatings(): Promise<any[]> {
    return [...this.ratings.values()].map((r) => ({ ...r }));
  }

  async getOrCreateRating(
    userId: string,
    kind: RatingKind,
    season: string,
    countryCode: string | null
  ): Promise<any> {
    const key = `${userId}:${kind}`;
    const existing = this.ratings.get(key);
    if (existing) return { ...existing };
    return this.seedRating(userId, kind, { season, countryCode });
  }

  async saveRating(userId: string, kind: RatingKind, data: any): Promise<any> {
    const row = this.ratings.get(`${userId}:${kind}`);
    if (!row) throw new Error('rating not found');
    Object.assign(row, data, { updatedAt: new Date(this.clock) });
    return { ...row };
  }

  async updateCountryForUser(userId: string, countryCode: string | null): Promise<void> {
    for (const r of this.ratings.values()) {
      if (r.userId === userId) r.countryCode = countryCode;
    }
  }

  async createHistory(input: any): Promise<any> {
    const row = { id: randomUUID(), createdAt: new Date(this.clock), ...input };
    this.history.push(row);
    return { ...row };
  }

  async findHistoryByEventId(userId: string, eventId: string): Promise<any | null> {
    return this.history.find((h) => h.userId === userId && h.eventId === eventId) ?? null;
  }

  async findTradingWeek(userId: string, weekStart: Date): Promise<any | null> {
    return (
      this.history.find(
        (h) =>
          h.userId === userId &&
          h.kind === RatingKind.TRADING &&
          h.source === RatingEventSource.TRADING_WEEK &&
          h.weekStart?.getTime() === weekStart.getTime()
      ) ?? null
    );
  }

  async listHistory(
    userId: string,
    kind: RatingKind | undefined,
    skip: number,
    take: number
  ): Promise<any[]> {
    return this.history
      .filter((h) => h.userId === userId && (!kind || h.kind === kind))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(skip, skip + take)
      .map((h) => ({ ...h }));
  }

  async countHistory(userId: string, kind: RatingKind | undefined): Promise<number> {
    return this.history.filter((h) => h.userId === userId && (!kind || h.kind === kind)).length;
  }

  async countEventsSince(userId: string, since: Date): Promise<number> {
    return this.history.filter((h) => h.userId === userId && h.createdAt >= since).length;
  }

  async countPairDuelsSince(userId: string, opponentId: string, since: Date): Promise<number> {
    return this.history.filter(
      (h) =>
        h.kind === RatingKind.LEARNING &&
        h.source === RatingEventSource.DUEL &&
        h.createdAt >= since &&
        ((h.userId === userId && h.opponentId === opponentId) ||
          (h.userId === opponentId && h.opponentId === userId))
    ).length;
  }

  async lastPairDuel(userId: string, opponentId: string): Promise<any | null> {
    const rows = this.history
      .filter(
        (h) =>
          h.kind === RatingKind.LEARNING &&
          h.source === RatingEventSource.DUEL &&
          ((h.userId === userId && h.opponentId === opponentId) ||
            (h.userId === opponentId && h.opponentId === userId))
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return rows[0] ? { ...rows[0] } : null;
  }

  /** Phase 9 (ADR 0011 §6): TRADING-only pair counters, so learning duels never consume sprint caps. */
  async countPairTradingDuelsSince(
    userId: string,
    opponentId: string,
    since: Date
  ): Promise<number> {
    return this.history.filter(
      (h) =>
        h.kind === RatingKind.TRADING &&
        h.source === RatingEventSource.DUEL &&
        h.createdAt >= since &&
        ((h.userId === userId && h.opponentId === opponentId) ||
          (h.userId === opponentId && h.opponentId === userId))
    ).length;
  }

  async lastPairTradingDuel(userId: string, opponentId: string): Promise<any | null> {
    const rows = this.history
      .filter(
        (h) =>
          h.kind === RatingKind.TRADING &&
          h.source === RatingEventSource.DUEL &&
          ((h.userId === userId && h.opponentId === opponentId) ||
            (h.userId === opponentId && h.opponentId === userId))
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return rows[0] ? { ...rows[0] } : null;
  }
}

class FakeRedis {
  zsets = new Map<string, Map<string, number>>();

  private sorted(key: string): Array<[string, number]> {
    const m = this.zsets.get(key);
    if (!m) return [];
    return [...m.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? 1 : -1));
  }

  async zadd(key: string, score: number, member: string): Promise<number> {
    let m = this.zsets.get(key);
    if (!m) {
      m = new Map();
      this.zsets.set(key, m);
    }
    m.set(member, score);
    return 1;
  }

  async zrevrange(key: string, start: number, stop: number): Promise<string[]> {
    const out: string[] = [];
    for (const [member, score] of this.sorted(key).slice(start, stop + 1)) {
      out.push(member, String(score));
    }
    return out;
  }

  async zrevrank(key: string, member: string): Promise<number | null> {
    const idx = this.sorted(key).findIndex(([m]) => m === member);
    return idx === -1 ? null : idx;
  }

  async zcard(key: string): Promise<number> {
    return this.zsets.get(key)?.size ?? 0;
  }

  async zrem(key: string, member: string): Promise<number> {
    return this.zsets.get(key)?.delete(member) ? 1 : 0;
  }
}

class FakeIdempotencyRepo {
  store_ = new Map<string, unknown>();
  async find(key: string, userId: string): Promise<unknown | null> {
    return this.store_.get(`${key}:${userId}`) ?? null;
  }
  async store(key: string, userId: string, response: unknown): Promise<void> {
    this.store_.set(`${key}:${userId}`, response);
  }
}

const loggerStub = { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() };

function buildService(): { service: RatingsService; repo: FakeRatingsRepo; redis: FakeRedis } {
  const repo = new FakeRatingsRepo();
  const redis = new FakeRedis();
  const service = new RatingsService(
    repo as unknown as RatingsRepository,
    redis as unknown as RedisService,
    new IdempotencyService(new FakeIdempotencyRepo() as unknown as IdempotencyRepository),
    {
      run: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn({}),
    } as unknown as TransactionService,
    loggerStub as unknown as AppLogger
  );
  return { service, repo, redis };
}

async function expectCode(promise: Promise<unknown>, code: ErrorCode): Promise<void> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe(code);
    return;
  }
  throw new Error(`expected rejection with ${code}, but the call succeeded`);
}

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

describe('RatingsService', () => {
  describe('recordDuel — the doc worked example', () => {
    it('1200 vs 1400, K=32, underdog win: +24.3 / −24.3, points conserved', async () => {
      const { service, repo } = buildService();
      repo.seedUser(A, 'Alice');
      repo.seedUser(B, 'Bob');
      repo.seedRating(A, RatingKind.LEARNING, {
        rating: 1200,
        gamesPlayed: 10,
        provisional: false,
      });
      repo.seedRating(B, RatingKind.LEARNING, {
        rating: 1400,
        gamesPlayed: 10,
        provisional: false,
      });

      const res = await service.recordDuel(
        A,
        { opponentId: B, result: DuelResult.WIN, idempotencyKey: 'duel-1' },
        'duel-1',
        new Date(NOW)
      );
      expect(res.me.ratingBefore).toBe(1200);
      expect(res.me.ratingAfter).toBe(1224.3);
      expect(res.me.delta).toBe(24.3);
      expect(res.me.gamesPlayed).toBe(11);
      expect(res.opponent.ratingAfter).toBe(1375.7);
      expect(res.opponent.delta).toBe(-24.3);
      expect(res.me.delta + res.opponent.delta).toBe(0);
      // History: one row per side, replayable.
      expect(repo.history).toHaveLength(2);
      expect(repo.history.map((h) => h.userId).sort()).toEqual([A, B].sort());
      expect(repo.history.find((h) => h.userId === A)?.expectedScore).toBeCloseTo(0.2403, 4);
    });

    it('expected win pays only +7.7', async () => {
      const { service, repo } = buildService();
      repo.seedUser(A, 'Alice');
      repo.seedUser(B, 'Bob');
      repo.seedRating(A, RatingKind.LEARNING, {
        rating: 1200,
        gamesPlayed: 10,
        provisional: false,
      });
      repo.seedRating(B, RatingKind.LEARNING, {
        rating: 1400,
        gamesPlayed: 10,
        provisional: false,
      });

      const res = await service.recordDuel(
        B,
        { opponentId: A, result: DuelResult.WIN, idempotencyKey: 'duel-1' },
        'duel-1',
        new Date(NOW)
      );
      expect(res.me.delta).toBe(7.7);
      expect(res.me.ratingAfter).toBe(1407.7);
      expect(res.opponent.delta).toBe(-7.7);
    });

    it('a draw at equal ratings changes nothing but still counts as a game', async () => {
      const { service, repo } = buildService();
      repo.seedUser(A, 'Alice');
      repo.seedUser(B, 'Bob');
      const res = await service.recordDuel(
        A,
        { opponentId: B, result: DuelResult.DRAW, idempotencyKey: 'duel-draw' },
        'duel-draw',
        new Date(NOW)
      );
      expect(res.me.delta).toBe(0);
      expect(res.me.ratingAfter).toBe(1000);
      expect(res.me.gamesPlayed).toBe(1);
      expect(res.me.provisional).toBe(true);
      expect(repo.history).toHaveLength(2);
    });

    it('a provisional win moves with K=40', async () => {
      const { service, repo } = buildService();
      repo.seedUser(A, 'Alice');
      repo.seedUser(B, 'Bob');
      const res = await service.recordDuel(
        A,
        { opponentId: B, result: DuelResult.WIN, idempotencyKey: 'duel-prov' },
        'duel-prov',
        new Date(NOW)
      );
      expect(res.me.delta).toBe(20);
      expect(res.me.ratingAfter).toBe(1020);
    });
  });

  describe('recordDuel — validation and anti-gaming', () => {
    it('rejects a duel against yourself', async () => {
      const { service, repo } = buildService();
      repo.seedUser(A, 'Alice');
      await expectCode(
        service.recordDuel(
          A,
          { opponentId: A, result: DuelResult.WIN, idempotencyKey: 'k' },
          'k',
          new Date(NOW)
        ),
        ErrorCode.VALIDATION_FAILED
      );
    });

    it('rejects an unknown opponent', async () => {
      const { service, repo } = buildService();
      repo.seedUser(A, 'Alice');
      await expectCode(
        service.recordDuel(
          A,
          { opponentId: B, result: DuelResult.WIN, idempotencyKey: 'k' },
          'k',
          new Date(NOW)
        ),
        ErrorCode.NOT_FOUND
      );
    });

    it('rejects a body key that does not match the header', async () => {
      const { service, repo } = buildService();
      repo.seedUser(A, 'Alice');
      repo.seedUser(B, 'Bob');
      await expectCode(
        service.recordDuel(
          A,
          { opponentId: B, result: DuelResult.WIN, idempotencyKey: 'body-key' },
          'header-key',
          new Date(NOW)
        ),
        ErrorCode.VALIDATION_FAILED
      );
    });

    it('requires the Idempotency-Key header', async () => {
      const { service, repo } = buildService();
      repo.seedUser(A, 'Alice');
      repo.seedUser(B, 'Bob');
      await expectCode(
        service.recordDuel(
          A,
          { opponentId: B, result: DuelResult.WIN, idempotencyKey: 'k' },
          undefined,
          new Date(NOW)
        ),
        ErrorCode.VALIDATION_FAILED
      );
    });

    it('replaying the same key returns IDEMPOTENCY_REPLAY, never double-applies', async () => {
      const { service, repo } = buildService();
      repo.seedUser(A, 'Alice');
      repo.seedUser(B, 'Bob');
      const dto = { opponentId: B, result: DuelResult.WIN, idempotencyKey: 'duel-1' };
      const first = await service.recordDuel(A, dto, 'duel-1', new Date(NOW));
      await expectCode(
        service.recordDuel(A, dto, 'duel-1', new Date(NOW)),
        ErrorCode.IDEMPOTENCY_REPLAY
      );
      const rating = await repo.findRating(A, RatingKind.LEARNING);
      expect(rating?.rating).toBe(first.me.ratingAfter);
      expect(rating?.gamesPlayed).toBe(1);
    });

    it('the opponent replaying the same key hits the duplicate-event guard', async () => {
      const { service, repo } = buildService();
      repo.seedUser(A, 'Alice');
      repo.seedUser(B, 'Bob');
      await service.recordDuel(
        A,
        { opponentId: B, result: DuelResult.WIN, idempotencyKey: 'duel-1' },
        'duel-1',
        new Date(NOW)
      );
      await expectCode(
        service.recordDuel(
          B,
          { opponentId: A, result: DuelResult.LOSS, idempotencyKey: 'duel-1' },
          'duel-1',
          new Date(NOW)
        ),
        ErrorCode.RATING_EVENT_DUPLICATE
      );
    });

    it('enforces the 5-minute rematch cooldown for the same pair', async () => {
      const { service, repo } = buildService();
      repo.seedUser(A, 'Alice');
      repo.seedUser(B, 'Bob');
      await service.recordDuel(
        A,
        { opponentId: B, result: DuelResult.WIN, idempotencyKey: 'duel-1' },
        'duel-1',
        new Date(NOW)
      );
      await expectCode(
        service.recordDuel(
          A,
          { opponentId: B, result: DuelResult.WIN, idempotencyKey: 'duel-2' },
          'duel-2',
          new Date(NOW)
        ),
        ErrorCode.RATING_DUEL_COOLDOWN
      );
    });

    it('allows a rematch after the cooldown (clock advanced 6 minutes)', async () => {
      const { service, repo } = buildService();
      repo.seedUser(A, 'Alice');
      repo.seedUser(B, 'Bob');
      await service.recordDuel(
        A,
        { opponentId: B, result: DuelResult.WIN, idempotencyKey: 'duel-1' },
        'duel-1',
        new Date(NOW)
      );
      repo.clock = new Date(NOW.getTime() + 6 * 60 * 1000);
      const res = await service.recordDuel(
        A,
        { opponentId: B, result: DuelResult.DRAW, idempotencyKey: 'duel-2' },
        'duel-2',
        new Date(repo.clock)
      );
      expect(res.me.gamesPlayed).toBe(2);
    });

    it('caps the same pair at 3 rated duels per day', async () => {
      const { service, repo } = buildService();
      repo.seedUser(A, 'Alice');
      repo.seedUser(B, 'Bob');
      for (let i = 0; i < 3; i++) {
        repo.seedHistory({ userId: A, opponentId: B, eventId: `seed-${i}` });
      }
      await expectCode(
        service.recordDuel(
          A,
          { opponentId: B, result: DuelResult.WIN, idempotencyKey: 'duel-x' },
          'duel-x',
          new Date(NOW)
        ),
        ErrorCode.RATING_DAILY_LIMIT
      );
    });

    it('caps each user at 10 rated events per day', async () => {
      const { service, repo } = buildService();
      repo.seedUser(A, 'Alice');
      repo.seedUser(B, 'Bob');
      for (let i = 0; i < 10; i++) {
        repo.seedHistory({ userId: A, opponentId: C, eventId: `seed-${i}` });
      }
      await expectCode(
        service.recordDuel(
          A,
          { opponentId: B, result: DuelResult.WIN, idempotencyKey: 'duel-x' },
          'duel-x',
          new Date(NOW)
        ),
        ErrorCode.RATING_DAILY_LIMIT
      );
    });
  });

  describe('recordDuelVsBot (ADR 0006/7 — Daily Duel bot fallback)', () => {
    it('rates a win against the bot at the player’s own rating (expected 0.5)', async () => {
      const { service, repo } = buildService();
      repo.seedUser(A, 'Alice');
      // 1000 vs 1000, K=40 (provisional): win ⇒ +20.0
      const res = await service.recordDuelVsBot(A, DuelResult.WIN, 'duel:bot-1', new Date(NOW));
      expect(res.me.ratingBefore).toBe(1000);
      expect(res.me.ratingAfter).toBe(1020);
      expect(res.me.delta).toBe(20);
      expect(res.botRating).toBe(1000);
      const row = await repo.findRating(A, RatingKind.LEARNING);
      expect(row?.gamesPlayed).toBe(1);
      const history = repo.history.find((h) => h.userId === A && h.eventId === 'duel:bot-1');
      expect(history?.opponentId).toBeNull();
      expect(history?.opponentRating).toBe(1000);
      expect(history?.expectedScore).toBe(0.5);
    });

    it('a loss against the bot costs the same as a win pays', async () => {
      const { service, repo } = buildService();
      repo.seedUser(A, 'Alice');
      const res = await service.recordDuelVsBot(A, DuelResult.LOSS, 'duel:bot-1', new Date(NOW));
      expect(res.me.delta).toBe(-20);
    });

    it('replaying the same key returns IDEMPOTENCY_REPLAY, never double-applies', async () => {
      const { service, repo } = buildService();
      repo.seedUser(A, 'Alice');
      await service.recordDuelVsBot(A, DuelResult.WIN, 'duel:bot-1', new Date(NOW));
      await expectCode(
        service.recordDuelVsBot(A, DuelResult.WIN, 'duel:bot-1', new Date(NOW)),
        ErrorCode.IDEMPOTENCY_REPLAY
      );
      const row = await repo.findRating(A, RatingKind.LEARNING);
      expect(row?.gamesPlayed).toBe(1);
    });

    it('enforces the 10-rated-events-per-day cap', async () => {
      const { service, repo } = buildService();
      repo.seedUser(A, 'Alice');
      for (let i = 0; i < 10; i++) {
        repo.seedHistory({ userId: A, opponentId: C, eventId: `seed-${i}` });
      }
      await expectCode(
        service.recordDuelVsBot(A, DuelResult.WIN, 'duel:bot-1', new Date(NOW)),
        ErrorCode.RATING_DAILY_LIMIT
      );
    });

    it('getDuelOutcome recovers a stored human duel for both sides', async () => {
      const { service, repo } = buildService();
      repo.seedUser(A, 'Alice');
      repo.seedUser(B, 'Bob');
      await service.recordDuel(
        A,
        { opponentId: B, result: DuelResult.WIN, idempotencyKey: 'duel-1' },
        'duel-1',
        new Date(NOW)
      );
      const out = await service.getDuelOutcome(A, 'duel-1');
      expect(out?.me.delta).toBe(20);
      expect(out?.opponent?.delta).toBe(-20);
      expect(out?.opponent?.userId).toBe(B);
      expect(await service.getDuelOutcome(A, 'duel:missing')).toBeNull();
    });
  });

  describe('recordTradingDuel (Phase 9 — Paper Trading Sprint, ADR 0011 §6)', () => {
    it('win at equal Trading Ratings: +20 / −20, kind TRADING, points conserved', async () => {
      const { service, repo } = buildService();
      repo.seedUser(A, 'Alice');
      repo.seedUser(B, 'Bob');
      const res = await service.recordTradingDuel(
        A,
        { opponentId: B, result: DuelResult.WIN, idempotencyKey: 'duel:sprint-1' },
        new Date(NOW)
      );
      expect(res.kind).toBe(RatingKind.TRADING);
      expect(res.me.ratingBefore).toBe(1000);
      expect(res.me.ratingAfter).toBe(1020);
      expect(res.me.delta).toBe(20);
      expect(res.opponent?.ratingAfter).toBe(980);
      expect(res.opponent?.delta).toBe(-20);
      const aRow = await repo.findRating(A, RatingKind.TRADING);
      const bRow = await repo.findRating(B, RatingKind.TRADING);
      expect(aRow?.gamesPlayed).toBe(1);
      expect(bRow?.gamesPlayed).toBe(1);
      // Learning Rating untouched by a trading duel.
      expect(await repo.findRating(A, RatingKind.LEARNING)).toBeNull();
      const rows = repo.history.filter((h) => h.eventId === 'duel:sprint-1');
      expect(rows).toHaveLength(2);
      expect(
        rows.every((h) => h.kind === RatingKind.TRADING && h.source === RatingEventSource.DUEL)
      ).toBe(true);
    });

    it('rejects a duel against yourself and an unknown opponent', async () => {
      const { service, repo } = buildService();
      repo.seedUser(A, 'Alice');
      await expectCode(
        service.recordTradingDuel(
          A,
          { opponentId: A, result: DuelResult.WIN, idempotencyKey: 'k' },
          new Date(NOW)
        ),
        ErrorCode.VALIDATION_FAILED
      );
      await expectCode(
        service.recordTradingDuel(
          A,
          { opponentId: B, result: DuelResult.WIN, idempotencyKey: 'k' },
          new Date(NOW)
        ),
        ErrorCode.NOT_FOUND
      );
    });

    it('replaying the same key returns IDEMPOTENCY_REPLAY, never double-applies', async () => {
      const { service, repo } = buildService();
      repo.seedUser(A, 'Alice');
      repo.seedUser(B, 'Bob');
      const dto = { opponentId: B, result: DuelResult.WIN, idempotencyKey: 'duel:sprint-1' };
      const first = await service.recordTradingDuel(A, dto, new Date(NOW));
      await expectCode(
        service.recordTradingDuel(A, dto, new Date(NOW)),
        ErrorCode.IDEMPOTENCY_REPLAY
      );
      const rating = await repo.findRating(A, RatingKind.TRADING);
      expect(rating?.rating).toBe(first.me.ratingAfter);
      expect(rating?.gamesPlayed).toBe(1);
    });

    it('the opponent replaying the same key hits the duplicate-event guard', async () => {
      const { service, repo } = buildService();
      repo.seedUser(A, 'Alice');
      repo.seedUser(B, 'Bob');
      await service.recordTradingDuel(
        A,
        { opponentId: B, result: DuelResult.WIN, idempotencyKey: 'duel:sprint-1' },
        new Date(NOW)
      );
      await expectCode(
        service.recordTradingDuel(
          B,
          { opponentId: A, result: DuelResult.LOSS, idempotencyKey: 'duel:sprint-1' },
          new Date(NOW)
        ),
        ErrorCode.RATING_EVENT_DUPLICATE
      );
    });

    it('enforces the 5-minute rematch cooldown for the same pair', async () => {
      const { service, repo } = buildService();
      repo.seedUser(A, 'Alice');
      repo.seedUser(B, 'Bob');
      await service.recordTradingDuel(
        A,
        { opponentId: B, result: DuelResult.WIN, idempotencyKey: 'duel:sprint-1' },
        new Date(NOW)
      );
      await expectCode(
        service.recordTradingDuel(
          A,
          { opponentId: B, result: DuelResult.WIN, idempotencyKey: 'duel:sprint-2' },
          new Date(NOW.getTime() + 60_000)
        ),
        ErrorCode.RATING_DUEL_COOLDOWN
      );
      const after = await service.recordTradingDuel(
        A,
        { opponentId: B, result: DuelResult.WIN, idempotencyKey: 'duel:sprint-2' },
        new Date(NOW.getTime() + 6 * 60_000)
      );
      // Second win is worth less: A is now 1020 vs B's 980, expected 0.557 → +17.7.
      expect(after.me.ratingAfter).toBe(1037.7);
    });

    it('caps the same pair at 3 rated trading duels per day', async () => {
      const { service, repo } = buildService();
      repo.seedUser(A, 'Alice');
      repo.seedUser(B, 'Bob');
      for (let i = 0; i < 3; i++) {
        repo.seedHistory({
          userId: A,
          opponentId: B,
          kind: RatingKind.TRADING,
          eventId: `seed-${i}`,
          createdAt: new Date(NOW.getTime() - (10 + i) * 60_000),
        });
      }
      await expectCode(
        service.recordTradingDuel(
          A,
          { opponentId: B, result: DuelResult.WIN, idempotencyKey: 'duel:sprint-1' },
          new Date(NOW)
        ),
        ErrorCode.RATING_DAILY_LIMIT
      );
    });

    it('learning duels do NOT consume the sprint pair cap', async () => {
      const { service, repo } = buildService();
      repo.seedUser(A, 'Alice');
      repo.seedUser(B, 'Bob');
      for (let i = 0; i < 3; i++) {
        repo.seedHistory({
          userId: A,
          opponentId: B,
          kind: RatingKind.LEARNING,
          eventId: `seed-learn-${i}`,
          createdAt: new Date(NOW.getTime() - (10 + i) * 60_000),
        });
      }
      const res = await service.recordTradingDuel(
        A,
        { opponentId: B, result: DuelResult.WIN, idempotencyKey: 'duel:sprint-1' },
        new Date(NOW)
      );
      expect(res.me.delta).toBe(20);
    });

    it('caps each user at 10 rated events per day', async () => {
      const { service, repo } = buildService();
      repo.seedUser(A, 'Alice');
      repo.seedUser(B, 'Bob');
      for (let i = 0; i < 10; i++) {
        repo.seedHistory({
          userId: A,
          opponentId: C,
          kind: RatingKind.TRADING,
          eventId: `seed-${i}`,
        });
      }
      await expectCode(
        service.recordTradingDuel(
          A,
          { opponentId: B, result: DuelResult.WIN, idempotencyKey: 'duel:sprint-1' },
          new Date(NOW)
        ),
        ErrorCode.RATING_DAILY_LIMIT
      );
    });

    it('getDuelOutcome(kind TRADING) recovers a stored sprint for the settlement retry path', async () => {
      const { service, repo } = buildService();
      repo.seedUser(A, 'Alice');
      repo.seedUser(B, 'Bob');
      await service.recordTradingDuel(
        A,
        { opponentId: B, result: DuelResult.WIN, idempotencyKey: 'duel:sprint-1' },
        new Date(NOW)
      );
      const out = await service.getDuelOutcome(A, 'duel:sprint-1', RatingKind.TRADING);
      expect(out?.me.delta).toBe(20);
      expect(out?.opponent?.delta).toBe(-20);
      expect(out?.opponent?.userId).toBe(B);
    });
  });

  describe('recordTradingDuelVsBot (Phase 9 — Mira bot sprint, ADR 0011 §6)', () => {
    it('win vs the bot at your own Trading Rating: +20, bot fixed at your rating', async () => {
      const { service, repo } = buildService();
      repo.seedUser(A, 'Alice');
      const res = await service.recordTradingDuelVsBot(
        A,
        DuelResult.WIN,
        'duel:sprint-bot-1',
        new Date(NOW)
      );
      expect(res.kind).toBe(RatingKind.TRADING);
      expect(res.me.ratingBefore).toBe(1000);
      expect(res.me.ratingAfter).toBe(1020);
      expect(res.me.delta).toBe(20);
      expect(res.botRating).toBe(1000);
      expect('opponent' in res).toBe(false); // no opponent side — the bot is not a user
      const row = await repo.findRating(A, RatingKind.TRADING);
      expect(row?.gamesPlayed).toBe(1);
    });

    it('draw is 0 and loss is −20 against the bot', async () => {
      const { service, repo } = buildService();
      repo.seedUser(A, 'Alice');
      const draw = await service.recordTradingDuelVsBot(
        A,
        DuelResult.DRAW,
        'duel:bot-draw',
        new Date(NOW)
      );
      expect(draw.me.delta).toBe(0);
      const loss = await service.recordTradingDuelVsBot(
        A,
        DuelResult.LOSS,
        'duel:bot-loss',
        new Date(NOW)
      );
      expect(loss.me.delta).toBe(-20);
    });

    it('replaying the same key returns IDEMPOTENCY_REPLAY, never double-applies', async () => {
      const { service, repo } = buildService();
      repo.seedUser(A, 'Alice');
      const first = await service.recordTradingDuelVsBot(
        A,
        DuelResult.WIN,
        'duel:bot-1',
        new Date(NOW)
      );
      await expectCode(
        service.recordTradingDuelVsBot(A, DuelResult.WIN, 'duel:bot-1', new Date(NOW)),
        ErrorCode.IDEMPOTENCY_REPLAY
      );
      const rating = await repo.findRating(A, RatingKind.TRADING);
      expect(rating?.rating).toBe(first.me.ratingAfter);
      expect(rating?.gamesPlayed).toBe(1);
    });

    it('caps the user at 10 rated events per day', async () => {
      const { service, repo } = buildService();
      repo.seedUser(A, 'Alice');
      for (let i = 0; i < 10; i++) {
        repo.seedHistory({
          userId: A,
          opponentId: C,
          kind: RatingKind.TRADING,
          eventId: `seed-${i}`,
        });
      }
      await expectCode(
        service.recordTradingDuelVsBot(A, DuelResult.WIN, 'duel:bot-1', new Date(NOW)),
        ErrorCode.RATING_DAILY_LIMIT
      );
    });
  });

  describe('recordTradingWeek', () => {
    it('beats the index by >2: win vs 1200, provisional K=40', async () => {
      const { service, repo } = buildService();
      repo.seedUser(A, 'Alice');
      const res = await service.recordTradingWeek(
        'admin-1',
        {
          userId: A,
          portfolioReturnPct: 5,
          indexReturnPct: 1,
          tradeCount: 5,
          weekStart: '2026-11-11',
          idempotencyKey: 'tw-1',
        },
        new Date(NOW)
      );
      expect(res.applied).toBe(true);
      expect(res.score).toBe('WIN');
      expect(res.weekStart).toBe('2026-11-09'); // Wednesday normalises to its Monday
      expect(res.ratingBefore).toBe(1000);
      expect(res.delta).toBe(30.4);
      expect(res.ratingAfter).toBe(1030.4);
      const row = await repo.findRating(A, RatingKind.TRADING);
      expect(row?.gamesPlayed).toBe(1);
      expect(row?.lastRatedAt?.toISOString()).toBe(NOW.toISOString());
    });

    it('fewer than 3 trades: unrated week, no change, key not consumed', async () => {
      const { service, repo } = buildService();
      repo.seedUser(A, 'Alice');
      const res = await service.recordTradingWeek(
        'admin-1',
        {
          userId: A,
          portfolioReturnPct: 9,
          indexReturnPct: 1,
          tradeCount: 2,
          weekStart: '2026-11-09',
          idempotencyKey: 'tw-1',
        },
        new Date(NOW)
      );
      expect(res.applied).toBe(false);
      expect(res.reason).toBe('MIN_TRADES_NOT_MET');
      expect(repo.ratings.size).toBe(0);
      expect(repo.history).toHaveLength(0);
      // The same key can still rate the week once the count is corrected.
      const rated = await service.recordTradingWeek(
        'admin-1',
        {
          userId: A,
          portfolioReturnPct: 9,
          indexReturnPct: 1,
          tradeCount: 4,
          weekStart: '2026-11-09',
          idempotencyKey: 'tw-1',
        },
        new Date(NOW)
      );
      expect(rated.applied).toBe(true);
    });

    it('one rated update per user per week, even with a fresh key', async () => {
      const { service, repo } = buildService();
      repo.seedUser(A, 'Alice');
      const dto = {
        userId: A,
        portfolioReturnPct: 5,
        indexReturnPct: 1,
        tradeCount: 5,
        weekStart: '2026-11-09',
        idempotencyKey: 'tw-1',
      };
      await service.recordTradingWeek('admin-1', dto, new Date(NOW));
      await expectCode(
        service.recordTradingWeek('admin-1', { ...dto, idempotencyKey: 'tw-2' }, new Date(NOW)),
        ErrorCode.RATING_EVENT_DUPLICATE
      );
    });

    it('a draw within ±2% moves the rating toward the index expectation', async () => {
      const { service, repo } = buildService();
      repo.seedUser(A, 'Alice');
      repo.seedRating(A, RatingKind.TRADING, { rating: 1200, gamesPlayed: 10, provisional: false });
      const res = await service.recordTradingWeek(
        'admin-1',
        {
          userId: A,
          portfolioReturnPct: 1.5,
          indexReturnPct: 1,
          tradeCount: 3,
          weekStart: '2026-11-09',
          idempotencyKey: 'tw-draw',
        },
        new Date(NOW)
      );
      expect(res.score).toBe('DRAW');
      expect(res.delta).toBe(0);
      expect(res.ratingAfter).toBe(1200);
    });
  });

  describe('seasonReset', () => {
    it('moves every rating halfway toward 1000 and is idempotent per season', async () => {
      const { service, repo } = buildService();
      repo.seedUser(A, 'Alice');
      repo.seedUser(B, 'Bob');
      repo.seedRating(A, RatingKind.LEARNING, {
        rating: 1600,
        gamesPlayed: 20,
        provisional: false,
      });
      repo.seedRating(A, RatingKind.TRADING, { rating: 800, gamesPlayed: 20, provisional: false });
      repo.seedRating(B, RatingKind.LEARNING, { rating: 1000, gamesPlayed: 5 });

      const first = await service.seasonReset('admin-1', { season: '2027-Q1' }, new Date(NOW));
      expect(first).toEqual({ season: '2027-Q1', updated: 2, skipped: 1 });
      expect((await repo.findRating(A, RatingKind.LEARNING))?.rating).toBe(1300);
      expect((await repo.findRating(A, RatingKind.TRADING))?.rating).toBe(900);
      expect(repo.history.filter((h) => h.source === RatingEventSource.SEASON_RESET)).toHaveLength(
        2
      );

      const second = await service.seasonReset('admin-1', { season: '2027-Q1' }, new Date(NOW));
      expect(second).toEqual({ season: '2027-Q1', updated: 0, skipped: 3 });
      expect((await repo.findRating(A, RatingKind.LEARNING))?.rating).toBe(1300);
    });
  });

  describe('runDecay', () => {
    it('drifts idle ratings toward 1000, once per week, never touching lastRatedAt', async () => {
      const { service, repo } = buildService();
      repo.seedUser(A, 'Alice');
      repo.seedUser(B, 'Bob');
      repo.seedUser(C, 'Carol');
      const fortyDaysAgo = new Date(NOW.getTime() - 40 * 24 * 60 * 60 * 1000);
      repo.seedRating(A, RatingKind.LEARNING, {
        rating: 1300,
        gamesPlayed: 20,
        provisional: false,
        lastRatedAt: fortyDaysAgo,
      });
      repo.seedRating(B, RatingKind.TRADING, {
        rating: 800,
        gamesPlayed: 20,
        provisional: false,
        lastRatedAt: fortyDaysAgo,
      });
      repo.seedRating(C, RatingKind.LEARNING, {
        rating: 1500,
        gamesPlayed: 20,
        provisional: false,
        lastRatedAt: new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000),
      });

      const res = await service.runDecay('admin-1', {}, new Date(NOW));
      expect(res.applied).toHaveLength(2);
      expect(res.applied.find((a) => a.userId === A)).toEqual({
        userId: A,
        kind: RatingKind.LEARNING,
        ratingBefore: 1300,
        ratingAfter: 1280,
        delta: -20,
      });
      expect(res.applied.find((a) => a.userId === B)?.delta).toBe(20);
      expect(res.skipped).toBe(1); // C is exactly at the 30-day grace
      const rowA = await repo.findRating(A, RatingKind.LEARNING);
      expect(rowA?.lastRatedAt?.getTime()).toBe(fortyDaysAgo.getTime());

      // Same week again: no double-apply.
      const again = await service.runDecay('admin-1', {}, new Date(NOW));
      expect(again.applied).toHaveLength(0);
    });

    it('skips ratings that were never rated', async () => {
      const { service, repo } = buildService();
      repo.seedUser(A, 'Alice');
      repo.seedRating(A, RatingKind.LEARNING, { rating: 1000, lastRatedAt: null });
      const res = await service.runDecay('admin-1', {}, new Date(NOW));
      expect(res.applied).toHaveLength(0);
      expect(res.skipped).toBe(1);
    });
  });

  describe('reads and leaderboards', () => {
    it('fresh users default to 1000 / Bronze / provisional, candle 1000', async () => {
      const { service, repo } = buildService();
      repo.seedUser(A, 'Alice', 'IN');
      const me = await service.getMyRatings(A, new Date(NOW));
      expect(me.learning.rating).toBe(1000);
      expect(me.trading.rating).toBe(1000);
      expect(me.candleRating).toBe(1000);
      expect(me.candleTier).toBe('Bronze');
      expect(me.learning.provisional).toBe(true);
      expect(me.learning.globalRank).toBeNull();
      expect(me.countryCode).toBe('IN');
    });

    it('unknown users are 404', async () => {
      const { service } = buildService();
      await expectCode(service.getUserRatings(A, new Date(NOW)), ErrorCode.NOT_FOUND);
    });

    it('leaderboard ranks by rating with percentiles; country scope filters', async () => {
      const { service, repo, redis } = buildService();
      repo.seedUser(A, 'Alice', 'IN');
      repo.seedUser(B, 'Bob', 'US');
      repo.seedUser(C, 'Carol', null);
      repo.seedRating(A, RatingKind.LEARNING, {
        rating: 1200,
        gamesPlayed: 10,
        provisional: false,
      });
      repo.seedRating(B, RatingKind.LEARNING, {
        rating: 1400,
        gamesPlayed: 10,
        provisional: false,
      });
      repo.seedRating(C, RatingKind.LEARNING, {
        rating: 1100,
        gamesPlayed: 10,
        provisional: false,
      });
      await service.rebuildLeaderboards(RatingKind.LEARNING);

      const global = await service.getLeaderboard({ kind: RatingKind.LEARNING, scope: 'global' });
      expect(global.total).toBe(3);
      expect(global.entries.map((e) => e.userId)).toEqual([B, A, C]);
      expect(global.entries[0]?.rank).toBe(1);
      expect(global.entries[0]?.percentile).toBe(66.7);
      expect(global.entries[2]?.percentile).toBe(0);
      expect(global.entries[0]?.tier).toBe('Gold');
      expect(global.entries[0]).not.toHaveProperty('email');

      const india = await service.getLeaderboard({
        kind: RatingKind.LEARNING,
        scope: 'country',
        country: 'IN',
      });
      expect(india.total).toBe(1);
      expect(india.entries.map((e) => e.userId)).toEqual([A]);

      // A user with no country never appears on a national board.
      const us = await service.getLeaderboard({
        kind: RatingKind.LEARNING,
        scope: 'country',
        country: 'US',
      });
      expect(us.entries.map((e) => e.userId)).toEqual([B]);
      expect(redis.zsets.get('ratings:lb:LEARNING:country:IN')?.has(C)).toBe(false);
    });

    it('country scope without a country code is a validation error', async () => {
      const { service } = buildService();
      await expectCode(
        service.getLeaderboard({ kind: RatingKind.LEARNING, scope: 'country' }),
        ErrorCode.VALIDATION_FAILED
      );
    });

    it('an empty Redis set is rebuilt from Postgres on read', async () => {
      const { service, repo } = buildService();
      repo.seedUser(A, 'Alice');
      repo.seedRating(A, RatingKind.LEARNING, {
        rating: 1250,
        gamesPlayed: 12,
        provisional: false,
      });
      const board = await service.getLeaderboard({ kind: RatingKind.LEARNING, scope: 'global' });
      expect(board.total).toBe(1);
      expect(board.entries[0]?.userId).toBe(A);
      expect(board.entries[0]?.rating).toBe(1250);
    });

    it('history lists newest first with pagination meta', async () => {
      const { service, repo } = buildService();
      repo.seedUser(A, 'Alice');
      repo.seedUser(B, 'Bob');
      await service.recordDuel(
        A,
        { opponentId: B, result: DuelResult.WIN, idempotencyKey: 'duel-1' },
        'duel-1',
        new Date(NOW)
      );
      repo.clock = new Date(NOW.getTime() + 6 * 60 * 1000);
      await service.recordDuel(
        A,
        { opponentId: B, result: DuelResult.DRAW, idempotencyKey: 'duel-2' },
        'duel-2',
        new Date(repo.clock)
      );
      const page = await service.listHistory(A, 1, 1, RatingKind.LEARNING);
      expect(page.meta.total).toBe(2);
      expect(page.meta.totalPages).toBe(2);
      expect(page.items).toHaveLength(1);
      expect(page.items[0]?.actualScore).toBe(0.5); // the draw is newest
    });

    it('syncCountry moves national leaderboard membership and rating rows', async () => {
      const { service, repo, redis } = buildService();
      repo.seedUser(A, 'Alice', 'IN');
      repo.seedRating(A, RatingKind.LEARNING, {
        rating: 1200,
        gamesPlayed: 10,
        provisional: false,
      });
      await service.rebuildLeaderboards(RatingKind.LEARNING);
      expect(redis.zsets.get('ratings:lb:LEARNING:country:IN')?.has(A)).toBe(true);

      await service.syncCountry(A, 'US', 'IN');
      expect((await repo.findRating(A, RatingKind.LEARNING))?.countryCode).toBe('US');
      expect(redis.zsets.get('ratings:lb:LEARNING:country:IN')?.has(A)).toBe(false);
      expect(redis.zsets.get('ratings:lb:LEARNING:country:US')?.has(A)).toBe(true);
      // Global membership is untouched.
      expect(redis.zsets.get('ratings:lb:LEARNING:global')?.has(A)).toBe(true);
    });
  });
});
