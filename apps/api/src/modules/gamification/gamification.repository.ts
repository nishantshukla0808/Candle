import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import type { TxClient } from '../../database/tx-client';

/**
 * GamificationRepository — the ONLY file that touches Prisma for
 * gamification (blueprint §4). Methods accept an optional transaction
 * client (ADR 0002/9).
 */

export interface UserStatsRow {
  userId: string;
  totalXp: number;
  level: number;
  currentStreak: number;
  longestStreak: number;
  lastActivityDate: string | null;
}

export interface BadgeRow {
  id: string;
  slug: string;
  name: string;
  description: string;
}

export interface UserBadgeRow extends BadgeRow {
  awardedAt: Date;
}

@Injectable()
export class GamificationRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: TxClient): TxClient {
    return tx ?? this.prisma;
  }

  // --- XP ledger (append-only, idempotent by key) -------------------------------

  /**
   * Appends an XP grant. Returns false when the idempotency key was already
   * used — the grant is skipped, never double-counted (ADR 0002/2).
   */
  async appendXp(
    userId: string,
    amount: number,
    reason: string,
    idempotencyKey: string,
    tx?: TxClient
  ): Promise<boolean> {
    try {
      await this.db(tx).xpLedger.create({
        data: { userId, amount, reason, idempotencyKey },
      });
      return true;
    } catch (err) {
      if (isUniqueViolation(err)) return false;
      throw err;
    }
  }

  // --- stats ---------------------------------------------------------------------

  async getOrCreateStats(userId: string, tx?: TxClient): Promise<UserStatsRow> {
    const client = this.db(tx);
    const existing = await client.userStats.findUnique({ where: { userId } });
    if (existing) return existing;
    return client.userStats.create({ data: { userId } });
  }

  async saveStats(stats: UserStatsRow, tx?: TxClient): Promise<UserStatsRow> {
    return this.db(tx).userStats.update({
      where: { userId: stats.userId },
      data: {
        totalXp: stats.totalXp,
        level: stats.level,
        currentStreak: stats.currentStreak,
        longestStreak: stats.longestStreak,
        lastActivityDate: stats.lastActivityDate,
      },
    });
  }

  // --- badges ---------------------------------------------------------------------

  async ensureBadge(
    def: { slug: string; name: string; description: string },
    tx?: TxClient
  ): Promise<BadgeRow> {
    return this.db(tx).badge.upsert({
      where: { slug: def.slug },
      update: { name: def.name, description: def.description },
      create: def,
    });
  }

  /**
   * Awards a badge. Returns the badge on first award, null when the user
   * already has it.
   */
  async awardBadge(userId: string, badgeId: string, tx?: TxClient): Promise<boolean> {
    try {
      await this.db(tx).userBadge.create({ data: { userId, badgeId } });
      return true;
    } catch (err) {
      if (isUniqueViolation(err)) return false;
      throw err;
    }
  }

  async getUserBadges(userId: string, tx?: TxClient): Promise<UserBadgeRow[]> {
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

  async countUserBadges(userId: string, tx?: TxClient): Promise<number> {
    return this.db(tx).userBadge.count({ where: { userId } });
  }
}

/** Prisma unique-constraint violation (P2002). */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === 'P2002'
  );
}
