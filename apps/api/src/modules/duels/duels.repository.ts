import { Injectable } from '@nestjs/common';
import { DuelOutcome, DuelStatus, DuelType, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import type { TxClient } from '../../database/tx-client';

/**
 * DuelsRepository — the ONLY file that touches Prisma for duels
 * (blueprint §4). Methods accept an optional transaction client
 * (ADR 0002/9). The service does all the math and rule checks; the
 * repository only persists.
 */

export interface DuelRow {
  id: string;
  type: DuelType;
  status: DuelStatus;
  playerAId: string;
  playerBId: string | null;
  pairedDuelId: string | null;
  dailyDate: string | null;
  dailySetId: string | null;
  questionIds: Prisma.JsonValue;
  seed: string;
  startedAt: Date;
  finishedAt: Date | null;
  winnerId: string | null;
  botScore: number | null;
  botCorrect: number | null;
  botTotalTimeMs: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DuelAnswerRow {
  id: string;
  duelId: string;
  userId: string;
  questionId: string;
  optionId: string | null;
  skipped: boolean;
  correct: boolean;
  timeMs: number | null;
  points: number;
  /** Case Duel only: the player's one-line reason (null = skipped/missing). */
  reason: string | null;
  order: number;
  createdAt: Date;
}

export interface DuelDailySetRow {
  id: string;
  date: string;
  questionIds: Prisma.JsonValue;
  seed: string;
  createdAt: Date;
}

export interface DuelGameResultRow {
  id: string;
  duelId: string;
  userId: string;
  result: DuelOutcome;
  score: number;
  correct: number;
  wrong: number;
  skipped: number;
  accuracy: number;
  avgTimeMs: number | null;
  fastestTimeMs: number | null;
  slowestTimeMs: number | null;
  bestStreak: number;
  perTopic: Prisma.JsonValue;
  perQuestion: Prisma.JsonValue;
  ratingBefore: number | null;
  ratingAfter: number | null;
  ratingDelta: number | null;
  ratingReason: string;
  xpAwarded: number;
  xpBreakdown: Prisma.JsonValue;
  createdAt: Date;
}

export interface CreateDuelInput {
  type: DuelType;
  playerAId: string;
  playerBId?: string | null;
  dailyDate?: string | null;
  dailySetId?: string | null;
  questionIds: string[];
  seed: string;
}

export interface CreateAnswerInput {
  duelId: string;
  userId: string;
  questionId: string;
  optionId: string | null;
  skipped: boolean;
  correct: boolean;
  timeMs: number | null;
  points: number;
  /** Case Duel only: null until the player submits a reason (ADR 0009 §4). */
  reason?: string | null;
  order: number;
}

export interface UpdateDuelInput {
  status?: DuelStatus;
  pairedDuelId?: string | null;
  finishedAt?: Date | null;
  winnerId?: string | null;
  botScore?: number | null;
  botCorrect?: number | null;
  botTotalTimeMs?: number | null;
}

export interface CreateGameResultInput {
  duelId: string;
  userId: string;
  result: DuelOutcome;
  score: number;
  correct: number;
  wrong: number;
  skipped: number;
  accuracy: number;
  avgTimeMs: number | null;
  fastestTimeMs: number | null;
  slowestTimeMs: number | null;
  bestStreak: number;
  perTopic: Prisma.InputJsonValue;
  perQuestion: Prisma.InputJsonValue;
  ratingBefore: number | null;
  ratingAfter: number | null;
  ratingDelta: number | null;
  ratingReason: string;
  xpAwarded: number;
  xpBreakdown: Prisma.InputJsonValue;
}

@Injectable()
export class DuelsRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: TxClient): TxClient {
    return tx ?? this.prisma;
  }

  async createDuel(input: CreateDuelInput, tx?: TxClient): Promise<DuelRow> {
    return this.db(tx).duel.create({
      data: {
        type: input.type,
        playerAId: input.playerAId,
        playerBId: input.playerBId ?? null,
        dailyDate: input.dailyDate ?? null,
        dailySetId: input.dailySetId ?? null,
        questionIds: input.questionIds,
        seed: input.seed,
      },
    });
  }

  async findDuelById(id: string, tx?: TxClient): Promise<DuelRow | null> {
    return this.db(tx).duel.findUnique({ where: { id } });
  }

  async updateDuel(id: string, data: UpdateDuelInput, tx?: TxClient): Promise<DuelRow> {
    return this.db(tx).duel.update({ where: { id }, data });
  }

  /** The caller's Daily Duel for one IST date, if any (1/day rule). */
  async findDailyDuelForUser(
    userId: string,
    dailyDate: string,
    tx?: TxClient
  ): Promise<DuelRow | null> {
    return this.db(tx).duel.findFirst({
      where: { type: DuelType.DAILY, playerAId: userId, dailyDate },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Bot Duels the user started at or after `since` (IST-day cap). */
  async countBotStartedSince(userId: string, since: Date, tx?: TxClient): Promise<number> {
    return this.db(tx).duel.count({
      where: { type: DuelType.BOT, playerAId: userId, startedAt: { gte: since } },
    });
  }

  /**
   * Earliest finished-but-unpaired Daily Duel for a date (pairing is
   * in order of finishing, ADR 0006/6).
   */
  async findWaitingDailyDuel(
    dailyDate: string,
    excludeDuelId: string,
    tx?: TxClient
  ): Promise<DuelRow | null> {
    return this.db(tx).duel.findFirst({
      where: {
        type: DuelType.DAILY,
        dailyDate,
        status: DuelStatus.WAITING_OPPONENT,
        id: { not: excludeDuelId },
      },
      orderBy: { finishedAt: 'asc' },
    });
  }

  /** All finished-but-unpaired Daily Duels for a date (bot fallback). */
  async listWaitingDailyDuels(dailyDate: string, tx?: TxClient): Promise<DuelRow[]> {
    return this.db(tx).duel.findMany({
      where: { type: DuelType.DAILY, dailyDate, status: DuelStatus.WAITING_OPPONENT },
      orderBy: { finishedAt: 'asc' },
    });
  }

  async listDuelsForUser(
    userId: string,
    skip: number,
    take: number,
    tx?: TxClient
  ): Promise<DuelRow[]> {
    return this.db(tx).duel.findMany({
      where: { OR: [{ playerAId: userId }, { playerBId: userId }] },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    });
  }

  async countDuelsForUser(userId: string, tx?: TxClient): Promise<number> {
    return this.db(tx).duel.count({
      where: { OR: [{ playerAId: userId }, { playerBId: userId }] },
    });
  }

  /** The caller's live duel still IN_PROGRESS, if any (one live duel at a time). */
  async findActiveLiveDuelForUser(userId: string, tx?: TxClient): Promise<DuelRow | null> {
    return this.db(tx).duel.findFirst({
      where: {
        type: { in: [DuelType.LIVE, DuelType.BLITZ, DuelType.CASE, DuelType.CHART] },
        status: DuelStatus.IN_PROGRESS,
        OR: [{ playerAId: userId }, { playerBId: userId }],
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Most recent finished live duel of one variant between two players
   * (rematch cooldown). The cooldown is per pair per variant: a Blitz
   * rematch is not blocked by a recent Speed Quiz against the same pair.
   */
  async findLastLiveDuelBetween(
    userAId: string,
    userBId: string,
    type: DuelType = DuelType.LIVE,
    tx?: TxClient
  ): Promise<DuelRow | null> {
    return this.db(tx).duel.findFirst({
      where: {
        type,
        OR: [
          { playerAId: userAId, playerBId: userBId },
          { playerAId: userBId, playerBId: userAId },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // --- answers -------------------------------------------------------------------

  async createAnswer(input: CreateAnswerInput, tx?: TxClient): Promise<DuelAnswerRow> {
    return this.db(tx).duelAnswer.create({
      data: { ...input, reason: input.reason ?? null },
    });
  }

  /**
   * Case Duel only (ADR 0009 §4): records the player's reason on the
   * answer row they already have for this question. The reason arrives
   * after the action (in the reason window), so it is an update, not
   * part of the answer insert — and a missing reason simply leaves the
   * row's null in place, never a lost answer.
   */
  async updateAnswerReason(
    duelId: string,
    userId: string,
    questionId: string,
    reason: string | null,
    tx?: TxClient
  ): Promise<DuelAnswerRow> {
    const existing = await this.db(tx).duelAnswer.findFirst({
      where: { duelId, userId, questionId },
    });
    if (!existing) throw new Error('Duel answer not found.');
    return this.db(tx).duelAnswer.update({
      where: { id: existing.id },
      data: { reason },
    });
  }

  async listAnswers(duelId: string, userId: string, tx?: TxClient): Promise<DuelAnswerRow[]> {
    return this.db(tx).duelAnswer.findMany({
      where: { duelId, userId },
      orderBy: { order: 'asc' },
    });
  }

  // --- daily sets ------------------------------------------------------------------

  async findDailySetByDate(date: string, tx?: TxClient): Promise<DuelDailySetRow | null> {
    return this.db(tx).duelDailySet.findUnique({ where: { date } });
  }

  /**
   * Creates the day's set. The unique `date` constraint is the race
   * guard: two concurrent first players for a day race here, and the
   * loser re-reads the winner's row (service-level catch).
   */
  async createDailySet(
    input: { date: string; questionIds: string[]; seed: string },
    tx?: TxClient
  ): Promise<DuelDailySetRow> {
    return this.db(tx).duelDailySet.create({
      data: {
        date: input.date,
        questionIds: input.questionIds,
        seed: input.seed,
      },
    });
  }

  // --- results ----------------------------------------------------------------------

  async createGameResult(input: CreateGameResultInput, tx?: TxClient): Promise<DuelGameResultRow> {
    return this.db(tx).duelGameResult.create({ data: input });
  }

  async findGameResult(
    duelId: string,
    userId: string,
    tx?: TxClient
  ): Promise<DuelGameResultRow | null> {
    return this.db(tx).duelGameResult.findUnique({ where: { duelId_userId: { duelId, userId } } });
  }

  // --- users (display names for history / results) -----------------------------------

  async findUserById(
    id: string,
    tx?: TxClient
  ): Promise<{ id: string; displayName: string | null } | null> {
    return this.db(tx).user.findUnique({
      where: { id },
      select: { id: true, displayName: true },
    });
  }
}
