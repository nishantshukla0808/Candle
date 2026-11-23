import { Injectable } from '@nestjs/common';
import { Prisma, SimOrderSide } from '@prisma/client';
import { ErrorCode, SIMULATOR_STARTING_CASH } from '@candle/shared';
import { AppError } from '../../common/errors/app-error';
import { AppLogger } from '../../common/services/logger.service';
import { type TradeExecutedPayload } from '../../common/events/event-bus';
import { OutboxRepository } from '../../common/events/outbox.repository';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { TransactionService } from '../../database/transaction.service';
import { buildPaginationMeta } from '../../common/utils/pagination';
import { GamificationService, type RewardSummary } from '../gamification/gamification.service';
import { PriceEngine } from './price-engine';
import { PlaceOrderDto } from './dto/simulator.dto';
import { SimulatorRepository, type InstrumentRow, type OrderRow } from './simulator.repository';

/**
 * Carried on every simulator endpoint's OpenAPI docs and UI text
 * (blueprint §16 — the disclaimer lives in the product, not just docs).
 */
export const SIMULATOR_DISCLAIMER =
  'Educational purpose only — this is not investment advice. ' +
  'All tickers are fictional and all money is virtual.';

export interface InstrumentQuote {
  id: string;
  symbol: string;
  name: string;
  description: string;
  /** Current simulated price, 2dp string. */
  price: string;
}

export interface HoldingView {
  instrumentId: string;
  symbol: string;
  name: string;
  quantity: string;
  avgCost: string;
  currentPrice: string;
  marketValue: string;
  unrealizedPnl: string;
}

export interface PortfolioView {
  cash: string;
  /** cash + Σ market value, 2dp string. */
  totalEquity: string;
  holdings: HoldingView[];
}

export interface OrderView {
  id: string;
  instrumentId: string;
  symbol: string;
  side: SimOrderSide;
  quantity: string;
  price: string;
  totalValue: string;
  executedAt: Date;
}

export interface PlaceOrderResponse {
  order: OrderView;
  rewards: RewardSummary;
}

/**
 * Simulator showcase valuation (Phase 13, docs/06 §1.8, ADR 0015 §4):
 * virtual total equity + return vs starting cash + top 3 holdings by
 * market value, by symbol only. Never exact cash, never quantities,
 * never order history. Null when the user never opened the simulator
 * (no portfolio row) — the showcase then shows "No simulator activity
 * yet", not ₹0.
 */
export interface ShowcaseValuation {
  /** cash + Σ market value, 2dp string. */
  totalEquity: string;
  /** (equity − starting cash) / starting cash × 100, 2dp. */
  returnPct: number;
  /** Top 3 holdings by market value: symbol + market value only. */
  topHoldings: Array<{ symbol: string; marketValue: string }>;
}

const STARTING_CASH = new Prisma.Decimal(SIMULATOR_STARTING_CASH);
const ZERO = new Prisma.Decimal(0);
const TWO_DP = 2;

function money(d: Prisma.Decimal): Prisma.Decimal {
  return d.toDecimalPlaces(TWO_DP, Prisma.Decimal.ROUND_HALF_UP);
}

/** Money as a fixed 2dp string — standard shape for all money fields (§7). */
function fmt(d: Prisma.Decimal): string {
  return money(d).toFixed(TWO_DP);
}

@Injectable()
export class SimulatorService {
  constructor(
    private readonly repo: SimulatorRepository,
    private readonly outbox: OutboxRepository,
    private readonly idempotency: IdempotencyService,
    private readonly transactions: TransactionService,
    private readonly gamification: GamificationService,
    private readonly logger: AppLogger
  ) {}

  // --- quotes (public, simulated) ---------------------------------------------------

  /** Current simulated quotes for all active fictional instruments. */
  async listInstruments(at: Date = new Date()): Promise<InstrumentQuote[]> {
    const instruments = await this.repo.listActiveInstruments();
    return instruments.map((i) => this.toQuote(i, at));
  }

  // --- portfolio ----------------------------------------------------------------------

  /**
   * The caller's portfolio, created lazily with virtual starting cash.
   * Holdings are valued at current simulated prices.
   */
  async getPortfolio(userId: string, at: Date = new Date()): Promise<PortfolioView> {
    const portfolio = await this.repo.getOrCreatePortfolio(userId, STARTING_CASH);
    const holdings = await this.repo.listHoldings(portfolio.id);
    const instruments = await this.repo.listActiveInstruments();
    const byId = new Map(instruments.map((i) => [i.id, i]));

    let equity = portfolio.cash;
    const views: HoldingView[] = [];
    for (const h of holdings) {
      const instrument = byId.get(h.instrumentId);
      if (!instrument) continue; // instrument deactivated after purchase — skip from valuation
      const price = PriceEngine.price(instrument.symbol, instrument.basePrice, at);
      const marketValue = money(price.mul(h.quantity));
      const costBasis = money(h.avgCost.mul(h.quantity));
      equity = equity.add(marketValue);
      views.push({
        instrumentId: h.instrumentId,
        symbol: instrument.symbol,
        name: instrument.name,
        quantity: h.quantity.toString(),
        avgCost: fmt(h.avgCost),
        currentPrice: fmt(price),
        marketValue: fmt(marketValue),
        unrealizedPnl: fmt(marketValue.sub(costBasis)),
      });
    }
    return { cash: fmt(portfolio.cash), totalEquity: fmt(equity), holdings: views };
  }

  /**
   * Showcase valuation (Phase 13, ADR 0015 §4). Find-only: returns null
   * when the user has no portfolio (never opened the simulator) and
   * never creates one — a profile read must not create simulator state.
   * Valuation is identical to getPortfolio (same price engine, same
   * rounding); only the shape differs (no cash, no quantities).
   */
  async peekPortfolioValuation(
    userId: string,
    at: Date = new Date()
  ): Promise<ShowcaseValuation | null> {
    const portfolio = await this.repo.findPortfolioByUser(userId);
    if (!portfolio) return null;
    const holdings = await this.repo.listHoldings(portfolio.id);
    const instruments = await this.repo.listActiveInstruments();
    const byId = new Map(instruments.map((i) => [i.id, i]));

    let equity = portfolio.cash;
    const valued: Array<{ symbol: string; marketValue: Prisma.Decimal }> = [];
    for (const h of holdings) {
      const instrument = byId.get(h.instrumentId);
      if (!instrument) continue;
      const price = PriceEngine.price(instrument.symbol, instrument.basePrice, at);
      const marketValue = money(price.mul(h.quantity));
      equity = equity.add(marketValue);
      valued.push({ symbol: instrument.symbol, marketValue });
    }
    valued.sort((a, b) => b.marketValue.comparedTo(a.marketValue));
    const returnPct = Number(
      equity.sub(STARTING_CASH).div(STARTING_CASH).mul(100).toFixed(2)
    );
    return {
      totalEquity: fmt(equity),
      returnPct,
      topHoldings: valued.slice(0, 3).map((v) => ({ symbol: v.symbol, marketValue: fmt(v.marketValue) })),
    };
  }

  // --- orders ---------------------------------------------------------------------------

  /**
   * Places a simulated order. ONE transaction holds: validations, cash
   * move, holding update, the order row, the XP grant, the outbox event,
   * and the idempotency record (blueprint §12, ADR 0002/2).
   *
   * Requires an Idempotency-Key header. Replays return 409
   * IDEMPOTENCY_REPLAY with the original result — never double-applied.
   */
  async placeOrder(
    userId: string,
    dto: PlaceOrderDto,
    idempotencyKey: string | undefined,
    at: Date = new Date()
  ): Promise<PlaceOrderResponse> {
    await this.idempotency.guard(idempotencyKey, userId);
    const key = idempotencyKey as string;

    const instrument = await this.repo.findInstrumentById(dto.instrumentId);
    if (!instrument || !instrument.active) throw AppError.notFound('Instrument not found.');

    return this.transactions.run(async (tx) => {
      const raced = await this.repo.findOrderByIdempotencyKey(key, tx);
      if (raced) {
        // A concurrent request won the race: the idempotency record holds
        // the original response for a same-key replay.
        const stored = await this.idempotency.find(key, userId, tx);
        if (stored !== null) {
          throw new AppError(ErrorCode.IDEMPOTENCY_REPLAY, 409, undefined, { original: stored });
        }
        throw new AppError(ErrorCode.CONFLICT, 409, 'Order already placed.');
      }

      const portfolio = await this.repo.getOrCreatePortfolio(userId, STARTING_CASH, tx);
      const price = PriceEngine.price(instrument.symbol, instrument.basePrice, at);
      const qty = new Prisma.Decimal(dto.quantity);

      let newCash: Prisma.Decimal;
      if (dto.side === SimOrderSide.BUY) {
        const cost = money(price.mul(qty));
        if (cost.greaterThan(portfolio.cash)) {
          throw AppError.insufficientFunds(
            `This order costs ${fmt(cost)} virtual cash but the portfolio holds ${fmt(portfolio.cash)}.`
          );
        }
        newCash = portfolio.cash.sub(cost);
        const holding = await this.repo.findHolding(portfolio.id, instrument.id, tx);
        const prevQty = holding?.quantity ?? ZERO;
        const prevCost = holding ? holding.avgCost.mul(prevQty) : ZERO;
        const newQty = prevQty.add(qty);
        const newAvg = money(prevCost.add(cost).div(newQty));
        await this.repo.upsertHolding(portfolio.id, instrument.id, newQty, newAvg, tx);
      } else {
        const holding = await this.repo.findHolding(portfolio.id, instrument.id, tx);
        if (!holding || holding.quantity.lessThan(qty)) {
          throw AppError.insufficientHoldings(
            `Cannot sell ${qty.toString()} units — the portfolio holds ${holding?.quantity.toString() ?? '0'}.`
          );
        }
        const proceeds = money(price.mul(qty));
        newCash = portfolio.cash.add(proceeds);
        const newQty = holding.quantity.sub(qty);
        if (newQty.isZero()) {
          await this.repo.deleteHolding(portfolio.id, instrument.id, tx);
        } else {
          await this.repo.upsertHolding(portfolio.id, instrument.id, newQty, holding.avgCost, tx);
        }
      }
      await this.repo.updateCash(portfolio.id, money(newCash), tx);

      const totalValue = money(price.mul(qty));
      const order = await this.repo.createOrder(
        {
          portfolioId: portfolio.id,
          instrumentId: instrument.id,
          side: dto.side,
          quantity: qty,
          price,
          totalValue,
          idempotencyKey: key,
        },
        tx
      );

      const event: TradeExecutedPayload = {
        userId,
        orderId: order.id,
        instrumentId: instrument.id,
        symbol: instrument.symbol,
        side: dto.side,
        quantity: qty.toString(),
        xpIdempotencyKey: `trade:${order.id}`,
        executedAt: order.createdAt.toISOString(),
      };
      const rewards = await this.gamification.grantTradeRewards(tx, event);
      await this.outbox.append('trade.executed', event, tx);

      const response: PlaceOrderResponse = {
        order: this.toOrderView(order, instrument.symbol),
        rewards,
      };
      await this.idempotency.store(key, userId, response, tx);

      // No secrets or PII: ids, symbol, side, and amounts are operational data.
      this.logger.info('Simulator order executed', {
        userId,
        orderId: order.id,
        symbol: instrument.symbol,
        side: dto.side,
        quantity: qty.toString(),
        price: price.toString(),
      });
      return response;
    });
  }

  /** The caller's order history, newest first. */
  async listOrders(userId: string, page: number, limit: number) {
    const portfolio = await this.repo.getOrCreatePortfolio(userId, STARTING_CASH);
    const [total, orders] = await Promise.all([
      this.repo.countOrders(portfolio.id),
      this.repo.listOrders(portfolio.id, (page - 1) * limit, limit),
    ]);
    const instruments = await this.repo.listActiveInstruments();
    const symbols = new Map(instruments.map((i) => [i.id, i.symbol]));
    return {
      items: orders.map((o) => this.toOrderView(o, symbols.get(o.instrumentId) ?? 'UNKNOWN')),
      meta: buildPaginationMeta(page, limit, total),
    };
  }

  // --- mappers ----------------------------------------------------------------------------

  private toQuote(i: InstrumentRow, at: Date): InstrumentQuote {
    return {
      id: i.id,
      symbol: i.symbol,
      name: i.name,
      description: i.description,
      price: fmt(PriceEngine.price(i.symbol, i.basePrice, at)),
    };
  }

  private toOrderView(o: OrderRow, symbol: string): OrderView {
    return {
      id: o.id,
      instrumentId: o.instrumentId,
      symbol,
      side: o.side,
      quantity: o.quantity.toString(),
      price: fmt(o.price),
      totalValue: fmt(o.totalValue),
      executedAt: o.createdAt,
    };
  }
}
