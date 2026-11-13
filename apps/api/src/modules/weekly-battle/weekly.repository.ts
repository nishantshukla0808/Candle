import { Injectable } from '@nestjs/common';
import { DuelOutcome, Prisma, SimOrderSide, WeeklySeasonStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import type { TxClient } from '../../database/tx-client';

/**
 * WeeklyRepository — the ONLY file that touches Prisma for the Weekly
 * Portfolio Battle (blueprint §4). Methods accept an optional
 * transaction client (ADR 0002/9). The service does all the math and
 * rule checks; the repository only persists.
 *
 * A weekly battle has no Duel row (docs/16 §2, ADR 0013 §2): the
 * season/league/membership/trade/result tables are its whole store.
 */

export interface WeeklySeasonRow {
  id: string;
  weekStart: string;
  status: WeeklySeasonStatus;
  scheduledStartsAt: Date;
  scheduledEndsAt: Date;
  startedAt: Date | null;
  endsAt: Date | null;
  indexReturnPct: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface WeeklyLeagueRow {
  id: string;
  seasonId: string;
  tier: number;
  leagueNumber: number;
  createdAt: Date;
}

export interface WeeklyMembershipRow {
  id: string;
  seasonId: string;
  leagueId: string | null;
  userId: string;
  tradingRating: number;
  tier: number;
  carried: boolean;
  joinedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface WeeklyTradeRow {
  id: string;
  seasonId: string;
  leagueId: string;
  userId: string;
  instrumentId: string;
  side: SimOrderSide;
  quantity: Prisma.Decimal;
  price: Prisma.Decimal;
  totalValue: Prisma.Decimal;
  clientOrderId: string;
  executedAt: Date;
}

export interface WeeklyResultRow {
  id: string;
  seasonId: string;
  leagueId: string;
  userId: string;
  rank: number;
  leagueSize: number;
  tier: number;
  nextTier: number;
  result: DuelOutcome;
  finalEquity: Prisma.Decimal;
  returnPct: number;
  realisedVolPct: number;
  maxDrawdownPct: number;
  riskAdjustedScore: number;
  tradeCount: number;
  perInstrument: Prisma.JsonValue;
  equityCurve: Prisma.JsonValue;
  ratingBefore: number | null;
  ratingAfter: number | null;
  ratingDelta: number | null;
  ratingResult: string | null;
  ratingReason: string;
  xpAwarded: number;
  xpBreakdown: Prisma.JsonValue;
  createdAt: Date;
}

export interface CreateWeeklyTradeInput {
  seasonId: string;
  leagueId: string;
  userId: string;
  instrumentId: string;
  side: SimOrderSide;
  quantity: Prisma.Decimal;
  price: Prisma.Decimal;
  totalValue: Prisma.Decimal;
  clientOrderId: string;
  executedAt: Date;
}

export interface CreateWeeklyResultInput {
  seasonId: string;
  leagueId: string;
  userId: string;
  rank: number;
  leagueSize: number;
  tier: number;
  nextTier: number;
  result: DuelOutcome;
  finalEquity: Prisma.Decimal;
  returnPct: number;
  realisedVolPct: number;
  maxDrawdownPct: number;
  riskAdjustedScore: number;
  tradeCount: number;
  perInstrument: Prisma.InputJsonValue;
  equityCurve: Prisma.InputJsonValue;
  ratingBefore: number | null;
  ratingAfter: number | null;
  ratingDelta: number | null;
  ratingResult: string | null;
  ratingReason: string;
  xpAwarded: number;
  xpBreakdown: Prisma.InputJsonValue;
}

@Injectable()
export class WeeklyRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: TxClient): TxClient {
    return tx ?? this.prisma;
  }

  // --- seasons -------------------------------------------------------------------

  async createSeason(
    input: {
      weekStart: string;
      scheduledStartsAt: Date;
      scheduledEndsAt: Date;
    },
    tx?: TxClient
  ): Promise<WeeklySeasonRow> {
    return this.db(tx).weeklySeason.create({ data: input });
  }

  async findSeasonById(id: string, tx?: TxClient): Promise<WeeklySeasonRow | null> {
    return this.db(tx).weeklySeason.findUnique({ where: { id } });
  }

  async findSeasonByWeekStart(weekStart: string, tx?: TxClient): Promise<WeeklySeasonRow | null> {
    return this.db(tx).weeklySeason.findUnique({ where: { weekStart } });
  }

  async listSeasons(tx?: TxClient): Promise<WeeklySeasonRow[]> {
    return this.db(tx).weeklySeason.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async updateSeason(
    id: string,
    data: {
      status?: WeeklySeasonStatus;
      startedAt?: Date | null;
      endsAt?: Date | null;
      indexReturnPct?: number | null;
    },
    tx?: TxClient
  ): Promise<WeeklySeasonRow> {
    return this.db(tx).weeklySeason.update({ where: { id }, data });
  }

  async countLeaguesForSeason(seasonId: string, tx?: TxClient): Promise<number> {
    return this.db(tx).weeklyLeague.count({ where: { seasonId } });
  }

  async countMembershipsForSeason(seasonId: string, tx?: TxClient): Promise<number> {
    return this.db(tx).weeklyLeagueMembership.count({ where: { seasonId } });
  }

  // --- leagues -------------------------------------------------------------------

  async createLeague(
    input: { seasonId: string; tier: number; leagueNumber: number },
    tx?: TxClient
  ): Promise<WeeklyLeagueRow> {
    return this.db(tx).weeklyLeague.create({ data: input });
  }

  async listLeaguesForSeason(seasonId: string, tx?: TxClient): Promise<WeeklyLeagueRow[]> {
    return this.db(tx).weeklyLeague.findMany({
      where: { seasonId },
      orderBy: { leagueNumber: 'asc' },
    });
  }

  // --- memberships ----------------------------------------------------------------

  async createMembership(
    input: {
      seasonId: string;
      userId: string;
      tradingRating: number;
      tier?: number;
      carried?: boolean;
    },
    tx?: TxClient
  ): Promise<WeeklyMembershipRow> {
    return this.db(tx).weeklyLeagueMembership.create({ data: input });
  }

  async findMembership(
    seasonId: string,
    userId: string,
    tx?: TxClient
  ): Promise<WeeklyMembershipRow | null> {
    return this.db(tx).weeklyLeagueMembership.findUnique({
      where: { seasonId_userId: { seasonId, userId } },
    });
  }

  async listMembershipsForSeason(seasonId: string, tx?: TxClient): Promise<WeeklyMembershipRow[]> {
    return this.db(tx).weeklyLeagueMembership.findMany({
      where: { seasonId },
      orderBy: { joinedAt: 'asc' },
    });
  }

  async listMembershipsForLeague(leagueId: string, tx?: TxClient): Promise<WeeklyMembershipRow[]> {
    return this.db(tx).weeklyLeagueMembership.findMany({
      where: { leagueId },
      orderBy: { joinedAt: 'asc' },
    });
  }

  /** Carried joiners of a season (lone joiners, no league) — the next season's join pool. */
  async listCarriedMemberships(seasonId: string, tx?: TxClient): Promise<WeeklyMembershipRow[]> {
    return this.db(tx).weeklyLeagueMembership.findMany({
      where: { seasonId, carried: true },
      orderBy: { joinedAt: 'asc' },
    });
  }

  async updateMembership(
    id: string,
    data: { leagueId?: string | null; tier?: number; carried?: boolean },
    tx?: TxClient
  ): Promise<WeeklyMembershipRow> {
    return this.db(tx).weeklyLeagueMembership.update({ where: { id }, data });
  }

  /** The user's latest settled weekly result (for next season's tier). */
  async findLatestResultForUser(userId: string, tx?: TxClient): Promise<WeeklyResultRow | null> {
    return this.db(tx).weeklyResult.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  // --- trades ---------------------------------------------------------------------

  async createTrade(input: CreateWeeklyTradeInput, tx?: TxClient): Promise<WeeklyTradeRow> {
    return this.db(tx).weeklyTrade.create({ data: input });
  }

  async findTradeByClientOrderId(
    seasonId: string,
    userId: string,
    clientOrderId: string,
    tx?: TxClient
  ): Promise<WeeklyTradeRow | null> {
    return this.db(tx).weeklyTrade.findUnique({
      where: { seasonId_userId_clientOrderId: { seasonId, userId, clientOrderId } },
    });
  }

  async listTradesForSeasonUser(
    seasonId: string,
    userId: string,
    tx?: TxClient
  ): Promise<WeeklyTradeRow[]> {
    return this.db(tx).weeklyTrade.findMany({
      where: { seasonId, userId },
      orderBy: { executedAt: 'asc' },
    });
  }

  async countTradesForSeasonUser(seasonId: string, userId: string, tx?: TxClient): Promise<number> {
    return this.db(tx).weeklyTrade.count({ where: { seasonId, userId } });
  }

  // --- results ---------------------------------------------------------------------

  async createResult(input: CreateWeeklyResultInput, tx?: TxClient): Promise<WeeklyResultRow> {
    return this.db(tx).weeklyResult.create({ data: input });
  }

  async findResult(
    seasonId: string,
    userId: string,
    tx?: TxClient
  ): Promise<WeeklyResultRow | null> {
    return this.db(tx).weeklyResult.findUnique({
      where: { seasonId_userId: { seasonId, userId } },
    });
  }

  async listResultsForLeague(leagueId: string, tx?: TxClient): Promise<WeeklyResultRow[]> {
    return this.db(tx).weeklyResult.findMany({
      where: { leagueId },
      orderBy: { rank: 'asc' },
    });
  }

  async listResultsForUser(
    userId: string,
    skip: number,
    take: number,
    tx?: TxClient
  ): Promise<WeeklyResultRow[]> {
    return this.db(tx).weeklyResult.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    });
  }

  async countResultsForUser(userId: string, tx?: TxClient): Promise<number> {
    return this.db(tx).weeklyResult.count({ where: { userId } });
  }

  // --- users (display names for standings / results) --------------------------------

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
