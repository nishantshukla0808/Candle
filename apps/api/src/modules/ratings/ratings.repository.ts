import { Injectable } from '@nestjs/common';
import { RatingEventSource, RatingKind } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import type { TxClient } from '../../database/tx-client';

/**
 * RatingsRepository — the ONLY file that touches Prisma for ratings
 * (blueprint §4). Methods accept an optional transaction client
 * (ADR 0002/9). The service does all the math and rule checks; the
 * repository only persists.
 *
 * User reads (existence, display name, country) go through this
 * repository too, so the ratings module imports no other feature module
 * (ADR 0005/7).
 */

export interface RatingUserRow {
  id: string;
  displayName: string | null;
  countryCode: string | null;
}

export interface UserRatingRow {
  userId: string;
  kind: RatingKind;
  rating: number;
  gamesPlayed: number;
  wins: number;
  draws: number;
  losses: number;
  provisional: boolean;
  lastRatedAt: Date | null;
  season: string;
  countryCode: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RatingHistoryRow {
  id: string;
  userId: string;
  kind: RatingKind;
  source: RatingEventSource;
  eventId: string;
  opponentId: string | null;
  opponentRating: number | null;
  expectedScore: number;
  actualScore: number;
  kFactor: number;
  delta: number;
  ratingBefore: number;
  ratingAfter: number;
  season: string;
  weekStart: Date | null;
  createdAt: Date;
}

export interface CreateHistoryInput {
  userId: string;
  kind: RatingKind;
  source: RatingEventSource;
  eventId: string;
  opponentId?: string | null;
  opponentRating?: number | null;
  expectedScore: number;
  actualScore: number;
  kFactor: number;
  delta: number;
  ratingBefore: number;
  ratingAfter: number;
  season: string;
  weekStart?: Date | null;
}

export interface UpsertRatingInput {
  rating: number;
  gamesPlayed: number;
  wins: number;
  draws: number;
  losses: number;
  provisional: boolean;
  lastRatedAt: Date | null;
  season: string;
  countryCode: string | null;
}

@Injectable()
export class RatingsRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: TxClient): TxClient {
    return tx ?? this.prisma;
  }

  // --- users (read-only, for existence / display / country) --------------------

  async findUserById(id: string, tx?: TxClient): Promise<RatingUserRow | null> {
    return this.db(tx).user.findUnique({
      where: { id },
      select: { id: true, displayName: true, countryCode: true },
    });
  }

  async findUsersByIds(ids: string[], tx?: TxClient): Promise<RatingUserRow[]> {
    if (ids.length === 0) return [];
    return this.db(tx).user.findMany({
      where: { id: { in: ids } },
      select: { id: true, displayName: true, countryCode: true },
    });
  }

  // --- ratings ------------------------------------------------------------------

  async findRating(userId: string, kind: RatingKind, tx?: TxClient): Promise<UserRatingRow | null> {
    return this.db(tx).userRating.findUnique({ where: { userId_kind: { userId, kind } } });
  }

  async findRatingsByUserIds(
    kind: RatingKind,
    userIds: string[],
    tx?: TxClient
  ): Promise<UserRatingRow[]> {
    if (userIds.length === 0) return [];
    return this.db(tx).userRating.findMany({
      where: { kind, userId: { in: userIds } },
    });
  }

  async listAllRatings(kind?: RatingKind, tx?: TxClient): Promise<UserRatingRow[]> {
    return this.db(tx).userRating.findMany({
      where: kind ? { kind } : undefined,
      orderBy: [{ kind: 'asc' }, { rating: 'desc' }],
    });
  }

  /**
   * Get-or-create: a rating row starts at 1000, provisional, 0 games.
   * The unique(userId, kind) key makes concurrent creation safe — the
   * loser reads the winner's row (same pattern as simulator portfolios).
   */
  async getOrCreateRating(
    userId: string,
    kind: RatingKind,
    season: string,
    countryCode: string | null,
    tx?: TxClient
  ): Promise<UserRatingRow> {
    const db = this.db(tx);
    const existing = await db.userRating.findUnique({ where: { userId_kind: { userId, kind } } });
    if (existing) return existing;
    try {
      return await db.userRating.create({
        data: { userId, kind, rating: 1000, season, countryCode },
      });
    } catch {
      const raced = await db.userRating.findUnique({ where: { userId_kind: { userId, kind } } });
      if (!raced) throw new Error('Rating creation race lost with no winner');
      return raced;
    }
  }

  async saveRating(
    userId: string,
    kind: RatingKind,
    data: UpsertRatingInput,
    tx?: TxClient
  ): Promise<UserRatingRow> {
    return this.db(tx).userRating.update({
      where: { userId_kind: { userId, kind } },
      data,
    });
  }

  /** Denormalised country refresh when a user changes country (ADR 0005/8). */
  async updateCountryForUser(
    userId: string,
    countryCode: string | null,
    tx?: TxClient
  ): Promise<void> {
    await this.db(tx).userRating.updateMany({
      where: { userId },
      data: { countryCode },
    });
  }

  // --- history ------------------------------------------------------------------

  async createHistory(input: CreateHistoryInput, tx?: TxClient): Promise<RatingHistoryRow> {
    return this.db(tx).ratingHistory.create({
      data: {
        userId: input.userId,
        kind: input.kind,
        source: input.source,
        eventId: input.eventId,
        opponentId: input.opponentId ?? null,
        opponentRating: input.opponentRating ?? null,
        expectedScore: input.expectedScore,
        actualScore: input.actualScore,
        kFactor: input.kFactor,
        delta: input.delta,
        ratingBefore: input.ratingBefore,
        ratingAfter: input.ratingAfter,
        season: input.season,
        weekStart: input.weekStart ?? null,
      },
    });
  }

  async findHistoryByEventId(
    userId: string,
    eventId: string,
    tx?: TxClient
  ): Promise<RatingHistoryRow | null> {
    return this.db(tx).ratingHistory.findUnique({
      where: { userId_eventId: { userId, eventId } },
    });
  }

  async findTradingWeek(
    userId: string,
    weekStart: Date,
    tx?: TxClient
  ): Promise<RatingHistoryRow | null> {
    return this.db(tx).ratingHistory.findFirst({
      where: {
        userId,
        kind: RatingKind.TRADING,
        source: RatingEventSource.TRADING_WEEK,
        weekStart,
      },
    });
  }

  async listHistory(
    userId: string,
    kind: RatingKind | undefined,
    skip: number,
    take: number,
    tx?: TxClient
  ): Promise<RatingHistoryRow[]> {
    return this.db(tx).ratingHistory.findMany({
      where: { userId, ...(kind ? { kind } : {}) },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    });
  }

  async countHistory(userId: string, kind: RatingKind | undefined, tx?: TxClient): Promise<number> {
    return this.db(tx).ratingHistory.count({ where: { userId, ...(kind ? { kind } : {}) } });
  }

  /** Rated events by this user since `since` (any kind, any source). */
  async countEventsSince(userId: string, since: Date, tx?: TxClient): Promise<number> {
    return this.db(tx).ratingHistory.count({
      where: { userId, createdAt: { gte: since } },
    });
  }

  /** Rated duels between this pair (either direction) since `since`. */
  async countPairDuelsSince(
    userId: string,
    opponentId: string,
    since: Date,
    tx?: TxClient
  ): Promise<number> {
    return this.db(tx).ratingHistory.count({
      where: {
        kind: RatingKind.LEARNING,
        source: RatingEventSource.DUEL,
        createdAt: { gte: since },
        OR: [
          { userId, opponentId },
          { userId: opponentId, opponentId: userId },
        ],
      },
    });
  }

  /**
   * Rated TRADING duels between this pair (either direction) since
   * `since` — the Paper Trading Sprint's pair cap (docs/14 §7, ADR
   * 0011 §6). Same shape as countPairDuelsSince, but kind TRADING:
   * a sprint pair cap must not count learning duels, and vice versa.
   */
  async countPairTradingDuelsSince(
    userId: string,
    opponentId: string,
    since: Date,
    tx?: TxClient
  ): Promise<number> {
    return this.db(tx).ratingHistory.count({
      where: {
        kind: RatingKind.TRADING,
        source: RatingEventSource.DUEL,
        createdAt: { gte: since },
        OR: [
          { userId, opponentId },
          { userId: opponentId, opponentId: userId },
        ],
      },
    });
  }

  /** Most recent rated duel between this pair (either direction). */
  async lastPairDuel(
    userId: string,
    opponentId: string,
    tx?: TxClient
  ): Promise<RatingHistoryRow | null> {
    return this.db(tx).ratingHistory.findFirst({
      where: {
        kind: RatingKind.LEARNING,
        source: RatingEventSource.DUEL,
        OR: [
          { userId, opponentId },
          { userId: opponentId, opponentId: userId },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Most recent rated TRADING duel between this pair (either direction)
   * — the Paper Trading Sprint's rematch cooldown (docs/14 §7, ADR
   * 0011 §6). Kind TRADING, source DUEL: learning duels never cool
   * down a sprint rematch.
   */
  async lastPairTradingDuel(
    userId: string,
    opponentId: string,
    tx?: TxClient
  ): Promise<RatingHistoryRow | null> {
    return this.db(tx).ratingHistory.findFirst({
      where: {
        kind: RatingKind.TRADING,
        source: RatingEventSource.DUEL,
        OR: [
          { userId, opponentId },
          { userId: opponentId, opponentId: userId },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
