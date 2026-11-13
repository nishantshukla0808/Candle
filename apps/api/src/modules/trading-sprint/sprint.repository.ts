import { Injectable } from '@nestjs/common';
import { DuelOutcome, DuelStatus, DuelType, Prisma, SimOrderSide } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import type { TxClient } from '../../database/tx-client';

/**
 * SprintRepository — the ONLY file that touches Prisma for the
 * Paper Trading Sprint (blueprint §4). Methods accept an optional
 * transaction client (ADR 0002/9). The service/engine do all the math
 * and rule checks; the repository only persists.
 *
 * Duel rows of type SPRINT are owned here (create / read / update /
 * active / last-between): the duels module never writes a SPRINT row,
 * and this module never writes a learning duel row.
 */

export interface SprintDuelRow {
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
}

export interface SprintTradeRow {
  id: string;
  duelId: string;
  userId: string;
  instrumentId: string;
  side: SimOrderSide;
  quantity: Prisma.Decimal;
  price: Prisma.Decimal;
  totalValue: Prisma.Decimal;
  clientOrderId: string;
  executedAt: Date;
}

export interface SprintDuelResultRow {
  id: string;
  duelId: string;
  userId: string;
  result: DuelOutcome;
  finalEquity: Prisma.Decimal;
  returnPct: number;
  realisedVolPct: number;
  maxDrawdownPct: number;
  riskAdjustedScore: number;
  tradeCount: number;
  perInstrument: Prisma.JsonValue;
  equityCurve: Prisma.JsonValue;
  opponentRiskScore: number;
  opponentEquity: Prisma.Decimal | null;
  opponentTradeCount: number;
  ratingBefore: number | null;
  ratingAfter: number | null;
  ratingDelta: number | null;
  ratingReason: string;
  xpAwarded: number;
  xpBreakdown: Prisma.JsonValue;
  createdAt: Date;
  /** Crisis Duel only (docs/15 §8): the seeded crash minute (7–10), or null for sprints. */
  crashMinute: number | null;
  /** Crisis Duel only: this player's peak-to-trough fall across the crash window, %. */
  crashDrawdownPct: number | null;
  /** Crisis Duel only: this player's trades executed during the crash window. */
  tradesDuringCrash: number | null;
  /** Crisis Duel only: true when the player sold ≥ half of a holding during the crash window. */
  panicSold: boolean | null;
}

export interface CreateSprintTradeInput {
  duelId: string;
  userId: string;
  instrumentId: string;
  side: SimOrderSide;
  quantity: Prisma.Decimal;
  price: Prisma.Decimal;
  totalValue: Prisma.Decimal;
  clientOrderId: string;
  executedAt: Date;
}

export interface CreateSprintResultInput {
  duelId: string;
  userId: string;
  result: DuelOutcome;
  finalEquity: Prisma.Decimal;
  returnPct: number;
  realisedVolPct: number;
  maxDrawdownPct: number;
  riskAdjustedScore: number;
  tradeCount: number;
  perInstrument: Prisma.InputJsonValue;
  equityCurve: Prisma.InputJsonValue;
  opponentRiskScore: number;
  opponentEquity: Prisma.Decimal | null;
  opponentTradeCount: number;
  ratingBefore: number | null;
  ratingAfter: number | null;
  ratingDelta: number | null;
  ratingReason: string;
  xpAwarded: number;
  xpBreakdown: Prisma.InputJsonValue;
  /** Crisis Duel only (docs/15 §8) — omitted (null) for sprints. */
  crashMinute?: number | null;
  crashDrawdownPct?: number | null;
  tradesDuringCrash?: number | null;
  panicSold?: boolean | null;
}

@Injectable()
export class SprintRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: TxClient): TxClient {
    return tx ?? this.prisma;
  }

  // --- duel rows (type SPRINT only) ------------------------------------------------

  async createDuel(
    input: { playerAId: string; playerBId?: string | null; seed: string; type?: DuelType },
    tx?: TxClient
  ): Promise<SprintDuelRow> {
    const row = await this.db(tx).duel.create({
      data: {
        type: input.type ?? DuelType.SPRINT,
        playerAId: input.playerAId,
        playerBId: input.playerBId ?? null,
        questionIds: [],
        seed: input.seed,
      },
    });
    return this.toDuelRow(row);
  }

  async findDuelById(id: string, tx?: TxClient): Promise<SprintDuelRow | null> {
    const row = await this.db(tx).duel.findUnique({ where: { id } });
    return row ? this.toDuelRow(row) : null;
  }

  async updateDuel(
    id: string,
    data: {
      status?: DuelStatus;
      finishedAt?: Date | null;
      winnerId?: string | null;
      botScore?: number | null;
      botCorrect?: number | null;
      botTotalTimeMs?: number | null;
    },
    tx?: TxClient
  ): Promise<SprintDuelRow> {
    const row = await this.db(tx).duel.update({ where: { id }, data });
    return this.toDuelRow(row);
  }

  /** The caller's sprint still IN_PROGRESS, if any (one sprint at a time). */
  async findActiveSprintForUser(userId: string, tx?: TxClient): Promise<SprintDuelRow | null> {
    return this.findActiveTradingDuelForUser(userId, DuelType.SPRINT, tx);
  }

  /**
   * The caller's trading duel of this type still IN_PROGRESS, if any.
   * The sprint and crisis engines each check their own type — and the
   * crisis matchmaking also checks SPRINT, so a player cannot hold a
   * sprint and a crisis duel at once (docs/15 §6).
   */
  async findActiveTradingDuelForUser(
    userId: string,
    type: DuelType,
    tx?: TxClient
  ): Promise<SprintDuelRow | null> {
    const row = await this.db(tx).duel.findFirst({
      where: {
        type,
        status: DuelStatus.IN_PROGRESS,
        OR: [{ playerAId: userId }, { playerBId: userId }],
      },
      orderBy: { createdAt: 'desc' },
    });
    return row ? this.toDuelRow(row) : null;
  }

  /**
   * Most recent finished sprint between two players (rematch cooldown).
   * The cooldown is per pair for sprints: a sprint rematch is not
   * blocked by a recent learning duel against the same player.
   */
  async findLastSprintBetween(
    userAId: string,
    userBId: string,
    tx?: TxClient
  ): Promise<SprintDuelRow | null> {
    return this.findLastTradingDuelBetween(userAId, userBId, DuelType.SPRINT, tx);
  }

  /** Most recent finished trading duel of this type between two players (rematch cooldown). */
  async findLastTradingDuelBetween(
    userAId: string,
    userBId: string,
    type: DuelType,
    tx?: TxClient
  ): Promise<SprintDuelRow | null> {
    const row = await this.db(tx).duel.findFirst({
      where: {
        type,
        OR: [
          { playerAId: userAId, playerBId: userBId },
          { playerAId: userBId, playerBId: userAId },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });
    return row ? this.toDuelRow(row) : null;
  }

  // --- trades ----------------------------------------------------------------------

  async createTrade(input: CreateSprintTradeInput, tx?: TxClient): Promise<SprintTradeRow> {
    return this.db(tx).sprintTrade.create({ data: input });
  }

  async listTrades(duelId: string, userId: string, tx?: TxClient): Promise<SprintTradeRow[]> {
    return this.db(tx).sprintTrade.findMany({
      where: { duelId, userId },
      orderBy: { executedAt: 'asc' },
    });
  }

  // --- results ----------------------------------------------------------------------

  async createResult(input: CreateSprintResultInput, tx?: TxClient): Promise<SprintDuelResultRow> {
    return this.db(tx).sprintDuelResult.create({ data: input });
  }

  async findResult(
    duelId: string,
    userId: string,
    tx?: TxClient
  ): Promise<SprintDuelResultRow | null> {
    return this.db(tx).sprintDuelResult.findUnique({
      where: { duelId_userId: { duelId, userId } },
    });
  }

  async listResultsForUser(
    userId: string,
    skip: number,
    take: number,
    tx?: TxClient
  ): Promise<SprintDuelResultRow[]> {
    return this.db(tx).sprintDuelResult.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    });
  }

  /** Finished results of one trading duel type only (crisis history lists crisis duels). */
  async listResultsForUserByType(
    userId: string,
    type: DuelType,
    skip: number,
    take: number,
    tx?: TxClient
  ): Promise<SprintDuelResultRow[]> {
    return this.db(tx).sprintDuelResult.findMany({
      where: { userId, duel: { type } },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    });
  }

  async countResultsForUser(userId: string, tx?: TxClient): Promise<number> {
    return this.db(tx).sprintDuelResult.count({ where: { userId } });
  }

  async countResultsForUserByType(userId: string, type: DuelType, tx?: TxClient): Promise<number> {
    return this.db(tx).sprintDuelResult.count({ where: { userId, duel: { type } } });
  }

  // --- users (display names for results / history) -----------------------------------

  async findUserById(
    id: string,
    tx?: TxClient
  ): Promise<{ id: string; displayName: string | null } | null> {
    return this.db(tx).user.findUnique({
      where: { id },
      select: { id: true, displayName: true },
    });
  }

  private toDuelRow(row: {
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
  }): SprintDuelRow {
    return { ...row };
  }
}
