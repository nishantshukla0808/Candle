import { Injectable } from '@nestjs/common';
import { DuelOutcome, DuelType, Prisma, ProfileVisibility, SimOrderSide } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import type { TxClient } from '../../database/tx-client';

/**
 * ProfilesRepository — the ONLY file that touches Prisma for profiles
 * (blueprint §4). Methods accept an optional transaction client
 * (ADR 0002/9).
 *
 * Read-projection note (ADR 0015 §1): a profile is a VIEW over data
 * owned by other modules (ratings, gamification, learning, duels,
 * trading-sprint, weekly-battle, simulator). This repository READS
 * those tables for the profile view only — it never writes a row
 * outside its own tables (User profile fields, UserPrivacySettings,
 * SimShowcaseSnapshot). Writes to other modules' tables stay with
 * those modules. The profile never duplicates game data: duel history
 * reads the existing DuelGameResult / SprintDuelResult / WeeklyResult
 * rows, and the simulator showcase reads the existing SimPortfolio.
 */

export interface ProfileUserRow {
  id: string;
  displayName: string | null;
  avatarKey: string | null;
  bio: string | null;
  countryCode: string | null;
  profileVisibility: ProfileVisibility;
  displayNameChangedAt: Date | null;
  email: string;
  roles: string[];
  emailVerifiedAt: Date | null;
  createdAt: Date;
  deletedAt: Date | null;
  deletionRequestedAt: Date | null;
  deletionScheduledAt: Date | null;
}

export interface PrivacyRow {
  userId: string;
  showRatings: boolean;
  showRank: boolean;
  showLearningProgress: boolean;
  showDuelHistory: boolean;
  showSimulatorShowcase: boolean;
  showBadges: boolean;
  showFriendsList: boolean;
  allowFriendRequests: boolean;
  allowChallengesFromStrangers: boolean;
  showOnlineStatus: boolean;
}

export type PrivacyPatch = Partial<Omit<PrivacyRow, 'userId'>>;

export interface DuelRef {
  id: string;
  type: DuelType;
  playerAId: string;
  playerBId: string | null;
  winnerId: string | null;
}

export interface GameHistoryRow {
  id: string;
  duelId: string;
  userId: string;
  result: DuelOutcome;
  score: number;
  correct: number;
  wrong: number;
  skipped: number;
  accuracy: number;
  ratingBefore: number | null;
  ratingAfter: number | null;
  ratingDelta: number | null;
  createdAt: Date;
  duel: DuelRef;
}

export interface SprintHistoryRow {
  id: string;
  duelId: string;
  userId: string;
  result: DuelOutcome;
  finalEquity: Prisma.Decimal;
  returnPct: number;
  riskAdjustedScore: number;
  tradeCount: number;
  opponentRiskScore: number;
  opponentEquity: Prisma.Decimal | null;
  opponentTradeCount: number;
  ratingBefore: number | null;
  ratingAfter: number | null;
  ratingDelta: number | null;
  createdAt: Date;
  duel: DuelRef;
}

export interface WeeklyHistoryRow {
  id: string;
  seasonId: string;
  weekStart: string;
  userId: string;
  rank: number;
  leagueSize: number;
  tier: number;
  nextTier: number;
  result: DuelOutcome;
  finalEquity: Prisma.Decimal;
  returnPct: number;
  tradeCount: number;
  ratingBefore: number | null;
  ratingAfter: number | null;
  ratingDelta: number | null;
  ratingResult: string | null;
  createdAt: Date;
}

export interface TrackProgressRow {
  trackId: string;
  slug: string;
  title: string;
  completedLessons: number;
  totalLessons: number;
}

export interface BadgeViewRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  awardedAt: Date;
}

export interface StatsRow {
  userId: string;
  totalXp: number;
  level: number;
  currentStreak: number;
  longestStreak: number;
  lastActivityDate: string | null;
}

export interface XpLedgerRow {
  id: string;
  amount: number;
  reason: string;
  createdAt: Date;
}

export interface SimOrderExportRow {
  id: string;
  symbol: string;
  side: SimOrderSide;
  quantity: string;
  price: string;
  totalValue: string;
  executedAt: Date;
}

export interface ShowcaseSnapshotRow {
  userId: string;
  totalEquity: string;
  returnPct: number;
  topHoldings: Prisma.JsonValue;
  computedAt: Date;
  computedDate: string;
}

const PROFILE_USER_SELECT = {
  id: true,
  displayName: true,
  avatarKey: true,
  bio: true,
  countryCode: true,
  profileVisibility: true,
  displayNameChangedAt: true,
  email: true,
  roles: true,
  emailVerifiedAt: true,
  createdAt: true,
  deletedAt: true,
  deletionRequestedAt: true,
  deletionScheduledAt: true,
} as const;

const PRIVACY_SELECT = {
  userId: true,
  showRatings: true,
  showRank: true,
  showLearningProgress: true,
  showDuelHistory: true,
  showSimulatorShowcase: true,
  showBadges: true,
  showFriendsList: true,
  allowFriendRequests: true,
  allowChallengesFromStrangers: true,
  showOnlineStatus: true,
} as const;

const DUEL_REF_SELECT = {
  id: true,
  type: true,
  playerAId: true,
  playerBId: true,
  winnerId: true,
} as const;

@Injectable()
export class ProfilesRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: TxClient): TxClient {
    return tx ?? this.prisma;
  }

  // --- profile user row ---------------------------------------------------------

  findProfileUser(id: string, tx?: TxClient): Promise<ProfileUserRow | null> {
    return this.db(tx).user.findUnique({ where: { id }, select: PROFILE_USER_SELECT });
  }

  async updateProfileFields(
    id: string,
    data: {
      displayName?: string | null;
      bio?: string | null;
      profileVisibility?: ProfileVisibility;
      displayNameChangedAt?: Date | null;
    },
    tx?: TxClient
  ): Promise<ProfileUserRow> {
    return this.db(tx).user.update({ where: { id }, data, select: PROFILE_USER_SELECT });
  }

  async findDisplayNames(
    ids: string[],
    tx?: TxClient
  ): Promise<Array<{ id: string; displayName: string | null }>> {
    if (ids.length === 0) return [];
    return this.db(tx).user.findMany({
      where: { id: { in: ids } },
      select: { id: true, displayName: true },
    });
  }

  // --- privacy toggles ------------------------------------------------------------

  async getOrCreatePrivacy(userId: string, tx?: TxClient): Promise<PrivacyRow> {
    const client = this.db(tx);
    const existing = await client.userPrivacySettings.findUnique({
      where: { userId },
      select: PRIVACY_SELECT,
    });
    if (existing) return existing;
    return client.userPrivacySettings.create({
      data: { userId },
      select: PRIVACY_SELECT,
    });
  }

  async updatePrivacy(userId: string, patch: PrivacyPatch, tx?: TxClient): Promise<PrivacyRow> {
    await this.getOrCreatePrivacy(userId, tx);
    return this.db(tx).userPrivacySettings.update({
      where: { userId },
      data: patch,
      select: PRIVACY_SELECT,
    });
  }

  // --- duel history (reads only — never duplicates game data) ----------------------

  /**
   * Last `take` RATED results of one learning duel type, newest first.
   * Rated = ratingBefore is set; BOT practice duels (ratingBefore null)
   * never appear (docs/06 §1.9).
   */
  listRecentGameResults(
    userId: string,
    type: DuelType,
    take: number,
    tx?: TxClient
  ): Promise<GameHistoryRow[]> {
    return this.db(tx).duelGameResult.findMany({
      where: { userId, ratingBefore: { not: null }, duel: { type } },
      orderBy: { createdAt: 'desc' },
      take,
      include: { duel: { select: DUEL_REF_SELECT } },
    });
  }

  /** The paired row for one duel (the opponent's score), if it exists. */
  findGameResult(duelId: string, userId: string, tx?: TxClient): Promise<GameHistoryRow | null> {
    return this.db(tx).duelGameResult.findUnique({
      where: { duelId_userId: { duelId, userId } },
      include: { duel: { select: DUEL_REF_SELECT } },
    });
  }

  /** Last `take` RATED results of one trading duel type, newest first. */
  listRecentSprintResults(
    userId: string,
    type: DuelType,
    take: number,
    tx?: TxClient
  ): Promise<SprintHistoryRow[]> {
    return this.db(tx).sprintDuelResult.findMany({
      where: { userId, ratingDelta: { not: null }, duel: { type } },
      orderBy: { createdAt: 'desc' },
      take,
      include: { duel: { select: DUEL_REF_SELECT } },
    });
  }

  /** Last `take` RATED weekly results, newest first (unrated weeks — fewer
   * than 3 trades — have ratingDelta null and never appear). */
  async listRecentWeeklyResults(
    userId: string,
    take: number,
    tx?: TxClient
  ): Promise<WeeklyHistoryRow[]> {
    const rows = await this.db(tx).weeklyResult.findMany({
      where: { userId, ratingDelta: { not: null } },
      orderBy: { createdAt: 'desc' },
      take,
      include: { season: { select: { weekStart: true } } },
    });
    return rows.map((r) => ({
      id: r.id,
      seasonId: r.seasonId,
      weekStart: r.season.weekStart,
      userId: r.userId,
      rank: r.rank,
      leagueSize: r.leagueSize,
      tier: r.tier,
      nextTier: r.nextTier,
      result: r.result,
      finalEquity: r.finalEquity,
      returnPct: r.returnPct,
      tradeCount: r.tradeCount,
      ratingBefore: r.ratingBefore,
      ratingAfter: r.ratingAfter,
      ratingDelta: r.ratingDelta,
      ratingResult: r.ratingResult,
      createdAt: r.createdAt,
    }));
  }

  // --- gamification / learning (reads only) ----------------------------------------

  findStats(userId: string, tx?: TxClient): Promise<StatsRow | null> {
    return this.db(tx).userStats.findUnique({ where: { userId } });
  }

  async listBadges(userId: string, tx?: TxClient): Promise<BadgeViewRow[]> {
    const rows = await this.db(tx).userBadge.findMany({
      where: { userId },
      include: { badge: true },
      orderBy: { awardedAt: 'asc' },
    });
    return rows.map((r) => ({
      id: r.badge.id,
      slug: r.badge.slug,
      name: r.badge.name,
      description: r.badge.description,
      awardedAt: r.awardedAt,
    }));
  }

  async listXpLedger(userId: string, take: number, tx?: TxClient): Promise<XpLedgerRow[]> {
    return this.db(tx).xpLedger.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take,
      select: { id: true, amount: true, reason: true, createdAt: true },
    });
  }

  async listTrackProgress(userId: string, tx?: TxClient): Promise<TrackProgressRow[]> {
    const client = this.db(tx);
    const [tracks, completions] = await Promise.all([
      client.track.findMany({
        include: { modules: { include: { lessons: { select: { id: true } } } } },
        orderBy: { order: 'asc' },
      }),
      client.lessonCompletion.findMany({ where: { userId }, select: { lessonId: true } }),
    ]);
    const completed = new Set(completions.map((c) => c.lessonId));
    return tracks.map((t) => {
      const lessonIds = t.modules.flatMap((m) => m.lessons.map((l) => l.id));
      return {
        trackId: t.id,
        slug: t.slug,
        title: t.title,
        completedLessons: lessonIds.filter((id) => completed.has(id)).length,
        totalLessons: lessonIds.length,
      };
    });
  }

  // --- simulator (reads only; never creates a portfolio on a profile read) ---------

  async listSimOrders(userId: string, take: number, tx?: TxClient): Promise<SimOrderExportRow[]> {
    const client = this.db(tx);
    const portfolio = await client.simPortfolio.findUnique({ where: { userId } });
    if (!portfolio) return [];
    const rows = await client.simOrder.findMany({
      where: { portfolioId: portfolio.id },
      orderBy: { createdAt: 'desc' },
      take,
      include: { instrument: { select: { symbol: true } } },
    });
    return rows.map((r) => ({
      id: r.id,
      symbol: r.instrument.symbol,
      side: r.side,
      quantity: r.quantity.toString(),
      price: r.price.toFixed(2),
      totalValue: r.totalValue.toFixed(2),
      executedAt: r.createdAt,
    }));
  }

  // --- simulator showcase snapshot ---------------------------------------------------

  findShowcaseSnapshot(userId: string, tx?: TxClient): Promise<ShowcaseSnapshotRow | null> {
    return this.db(tx).simShowcaseSnapshot.findUnique({ where: { userId } });
  }

  async upsertShowcaseSnapshot(
    userId: string,
    data: {
      totalEquity: string;
      returnPct: number;
      topHoldings: Prisma.InputJsonValue;
      computedDate: string;
    },
    tx?: TxClient
  ): Promise<ShowcaseSnapshotRow> {
    return this.db(tx).simShowcaseSnapshot.upsert({
      where: { userId },
      create: { userId, ...data },
      update: { ...data, computedAt: new Date() },
    });
  }
}
