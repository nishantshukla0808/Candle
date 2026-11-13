import { Injectable } from '@nestjs/common';
import { Prisma, SimOrderSide } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import type { TxClient } from '../../database/tx-client';

/**
 * SimulatorRepository — the ONLY file that touches Prisma for the
 * simulator (blueprint §4). Methods accept an optional transaction
 * client (ADR 0002/9).
 *
 * Money is Decimal throughout; the service does the arithmetic, the
 * repository only persists.
 */

export interface InstrumentRow {
  id: string;
  symbol: string;
  name: string;
  description: string;
  basePrice: Prisma.Decimal;
  active: boolean;
}

export interface PortfolioRow {
  id: string;
  userId: string;
  cash: Prisma.Decimal;
}

export interface HoldingRow {
  portfolioId: string;
  instrumentId: string;
  quantity: Prisma.Decimal;
  avgCost: Prisma.Decimal;
}

export interface OrderRow {
  id: string;
  portfolioId: string;
  instrumentId: string;
  side: SimOrderSide;
  quantity: Prisma.Decimal;
  price: Prisma.Decimal;
  totalValue: Prisma.Decimal;
  idempotencyKey: string;
  createdAt: Date;
}

export interface CreateOrderInput {
  portfolioId: string;
  instrumentId: string;
  side: SimOrderSide;
  quantity: Prisma.Decimal;
  price: Prisma.Decimal;
  totalValue: Prisma.Decimal;
  idempotencyKey: string;
}

@Injectable()
export class SimulatorRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: TxClient): TxClient {
    return tx ?? this.prisma;
  }

  // --- instruments ------------------------------------------------------------

  async listActiveInstruments(tx?: TxClient): Promise<InstrumentRow[]> {
    return this.db(tx).simInstrument.findMany({
      where: { active: true },
      orderBy: { symbol: 'asc' },
    });
  }

  async findInstrumentById(id: string, tx?: TxClient): Promise<InstrumentRow | null> {
    return this.db(tx).simInstrument.findUnique({ where: { id } });
  }

  // --- portfolio ---------------------------------------------------------------

  /**
   * Get-or-create: one portfolio per user. The unique(userId) constraint
   * makes concurrent creation safe — the loser reads the winner's row.
   */
  async getOrCreatePortfolio(
    userId: string,
    startingCash: Prisma.Decimal,
    tx?: TxClient
  ): Promise<PortfolioRow> {
    const db = this.db(tx);
    const existing = await db.simPortfolio.findUnique({ where: { userId } });
    if (existing) return existing;
    try {
      return await db.simPortfolio.create({ data: { userId, cash: startingCash } });
    } catch {
      const raced = await db.simPortfolio.findUnique({ where: { userId } });
      if (!raced) throw new Error('Portfolio creation race lost with no winner');
      return raced;
    }
  }

  async updateCash(portfolioId: string, cash: Prisma.Decimal, tx?: TxClient): Promise<void> {
    await this.db(tx).simPortfolio.update({ where: { id: portfolioId }, data: { cash } });
  }

  // --- holdings -----------------------------------------------------------------

  async listHoldings(portfolioId: string, tx?: TxClient): Promise<HoldingRow[]> {
    return this.db(tx).simHolding.findMany({ where: { portfolioId } });
  }

  async findHolding(
    portfolioId: string,
    instrumentId: string,
    tx?: TxClient
  ): Promise<HoldingRow | null> {
    return this.db(tx).simHolding.findUnique({
      where: { portfolioId_instrumentId: { portfolioId, instrumentId } },
    });
  }

  async upsertHolding(
    portfolioId: string,
    instrumentId: string,
    quantity: Prisma.Decimal,
    avgCost: Prisma.Decimal,
    tx?: TxClient
  ): Promise<void> {
    await this.db(tx).simHolding.upsert({
      where: { portfolioId_instrumentId: { portfolioId, instrumentId } },
      create: { portfolioId, instrumentId, quantity, avgCost },
      update: { quantity, avgCost },
    });
  }

  async deleteHolding(portfolioId: string, instrumentId: string, tx?: TxClient): Promise<void> {
    await this.db(tx).simHolding.delete({
      where: { portfolioId_instrumentId: { portfolioId, instrumentId } },
    });
  }

  // --- orders --------------------------------------------------------------------

  async createOrder(input: CreateOrderInput, tx?: TxClient): Promise<OrderRow> {
    return this.db(tx).simOrder.create({ data: input });
  }

  async findOrderByIdempotencyKey(key: string, tx?: TxClient): Promise<OrderRow | null> {
    return this.db(tx).simOrder.findUnique({ where: { idempotencyKey: key } });
  }

  async listOrders(
    portfolioId: string,
    skip: number,
    take: number,
    tx?: TxClient
  ): Promise<OrderRow[]> {
    return this.db(tx).simOrder.findMany({
      where: { portfolioId },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    });
  }

  async countOrders(portfolioId: string, tx?: TxClient): Promise<number> {
    return this.db(tx).simOrder.count({ where: { portfolioId } });
  }
}
