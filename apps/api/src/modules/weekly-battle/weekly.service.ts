import { Inject, Injectable } from '@nestjs/common';
import { ErrorCode, SIMULATOR_STARTING_CASH, DUELS } from '@candle/shared';
import { Prisma, RatingKind, SimOrderSide, WeeklySeasonStatus } from '@prisma/client';
import { AppError } from '../../common/errors/app-error';
import { AppLogger } from '../../common/services/logger.service';
import { buildPaginationMeta } from '../../common/utils/pagination';
import { CONFIG } from '../../config/config.module';
import type { AppConfig } from '../../config/configuration';
import { TransactionService } from '../../database/transaction.service';
import { GamificationService } from '../gamification/gamification.service';
import { RatingsService, type TradingWeekResponse } from '../ratings/ratings.service';
import { tradingScore } from '../ratings/rating-math';
import { PriceEngine } from '../simulator/price-engine';
import { SimulatorRepository, type InstrumentRow } from '../simulator/simulator.repository';
import { summariseTrades } from '../trading-sprint/sprint-scoring';
import { formLeagues, leagueZoneFor, nextTierFor } from './weekly-leagues';
import {
  buildWeeklyEquityCurve,
  replayWeeklyPortfolio,
  weeklyEquityAt,
  weeklyIndexReturnPct,
  type WeeklyInstrumentLike,
  type WeeklyPriceFn,
  type WeeklyTradeLike,
} from './weekly-portfolio';
import {
  rankLeagueEntries,
  weeklyRatingReasonFor,
  weeklyRiskMetrics,
  WEEKLY_MIN_TRADES,
  type WeeklyLeagueOutcome,
} from './weekly-scoring';
import type { CreateWeeklySeasonDto, WeeklyTradeDto } from './dto/weekly.dto';
import {
  WeeklyRepository,
  type WeeklyLeagueRow,
  type WeeklyMembershipRow,
  type WeeklyResultRow,
  type WeeklySeasonRow,
  type WeeklyTradeRow,
} from './weekly.repository';

/**
 * Carried on every weekly endpoint's OpenAPI docs and UI text
 * (blueprint §16 — the disclaimer lives in the product, not just docs).
 */
export const WEEKLY_DISCLAIMER =
  'Educational purpose only — this is not investment advice. ' +
  'All tickers are fictional, all money is virtual, and no mentor ' +
  'gives personalised buy or sell recommendations.';

/** Host lines (doc 08 §2.2 — Anaya speaks before/after only). */
export const WEEKLY_HOST = {
  name: DUELS.WEEKLY_HOST_NAME,
  role: 'Portfolio Architect',
  intro:
    'One week, same fictional market, same ₹1,00,000. Best risk-adjusted return wins your ' +
    'league — and your Trading Rating moves against the market index, not your rivals. Good luck.',
  settled:
    'The week is settled. Your league rank is yours; your Trading Rating moved against the ' +
    'index. Come back Monday for the next season.',
} as const;

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
/** Asia/Kolkata is UTC+5:30, no daylight saving. */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export interface WeeklySeasonView {
  id: string;
  weekStart: string;
  status: WeeklySeasonStatus;
  scheduledStartsAt: Date;
  scheduledEndsAt: Date;
  startedAt: Date | null;
  endsAt: Date | null;
  indexReturnPct: number | null;
  leagueCount: number;
  memberCount: number;
  host: { name: string; role: string };
}

export interface WeeklyStandingEntry {
  rank: number;
  userId: string;
  displayName: string | null;
  returnPct: number;
  riskAdjustedScore: number;
  tradeCount: number;
  promotionZone: boolean;
  relegationZone: boolean;
}

export interface WeeklyStandingsView {
  seasonId: string;
  weekStart: string;
  status: WeeklySeasonStatus;
  endsAt: Date | null;
  leagues: Array<{
    leagueId: string;
    tier: number;
    leagueNumber: number;
    entries: WeeklyStandingEntry[];
  }>;
}

export interface WeeklyHoldingView {
  instrumentId: string;
  symbol: string;
  name: string;
  quantity: number;
  avgCost: string;
  currentPrice: string;
  marketValue: string;
  unrealizedPnl: string;
}

export interface WeeklyPortfolioView {
  seasonId: string;
  cash: string;
  totalEquity: string;
  holdings: WeeklyHoldingView[];
  prices: Array<{ instrumentId: string; symbol: string; price: string }>;
}

export interface WeeklyTradeView {
  id: string;
  seasonId: string;
  leagueId: string;
  instrumentId: string;
  symbol: string;
  side: SimOrderSide;
  quantity: string;
  price: string;
  totalValue: string;
  clientOrderId: string;
  executedAt: Date;
  portfolio: WeeklyPortfolioView;
}

export interface WeeklyResultView {
  seasonId: string;
  weekStart: string;
  leagueId: string;
  tier: number;
  leagueNumber: number;
  rank: number;
  leagueSize: number;
  nextTier: number;
  result: WeeklyLeagueOutcome;
  finalEquity: string;
  returnPct: number;
  realisedVolPct: number;
  maxDrawdownPct: number;
  riskAdjustedScore: number;
  tradeCount: number;
  perInstrument: Array<{
    instrumentId: string;
    symbol: string;
    trades: number;
    buyQty: number;
    sellQty: number;
    realisedPnl: number;
    finalQty: number;
    finalValue: number;
  }>;
  equityCurve: Array<{ t: number; equity: string }>;
  ratingBefore: number | null;
  ratingAfter: number | null;
  ratingDelta: number | null;
  ratingResult: WeeklyLeagueOutcome | null;
  ratingReason: string;
  xp: {
    awarded: number;
    totalXp: number;
    level: number;
    levelUp: boolean;
    currentStreak: number;
    newBadges: Array<{ slug: string; name: string }>;
  };
  settledAt: Date;
}

export interface WeeklySettlementView {
  seasonId: string;
  weekStart: string;
  status: 'SETTLED';
  indexReturnPct: number;
  leaguesSettled: number;
  playersSettled: number;
  host: { name: string; line: string };
}

export interface WeeklyHistoryItem {
  seasonId: string;
  weekStart: string;
  leagueId: string;
  tier: number;
  leagueNumber: number;
  rank: number;
  leagueSize: number;
  nextTier: number;
  result: WeeklyLeagueOutcome;
  finalEquity: string;
  returnPct: number;
  riskAdjustedScore: number;
  ratingDelta: number | null;
  xpAwarded: number;
  settledAt: Date;
}

/** Monday 00:00 IST of a YYYY-MM-DD date, as a UTC instant. */
export function mondayStartMs(weekStart: string): number {
  const parts = weekStart.split('-').map(Number);
  const y = parts[0] ?? 0;
  const m = parts[1] ?? 1;
  const d = parts[2] ?? 1;
  return Date.UTC(y, m - 1, d) - IST_OFFSET_MS;
}

/** True when the YYYY-MM-DD date is a Monday in Asia/Kolkata. */
export function isMondayIst(weekStart: string): boolean {
  const parts = weekStart.split('-').map(Number);
  const y = parts[0] ?? 0;
  const m = parts[1] ?? 1;
  const d = parts[2] ?? 1;
  // Noon UTC is 17:30 IST the same calendar date — safely inside the day.
  const at = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
  }).format(at);
  return weekday === 'Mon';
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function money(n: Prisma.Decimal | number): string {
  return new Prisma.Decimal(n).toDecimalPlaces(2).toFixed(2);
}

function toNumber(d: Prisma.Decimal | number | string): number {
  return new Prisma.Decimal(d).toNumber();
}

interface MemberMetrics {
  userId: string;
  displayName: string | null;
  joinedAtMs: number;
  tradeCount: number;
  finalEquity: number;
  returnPct: number;
  realisedVolPct: number;
  maxDrawdownPct: number;
  riskAdjustedScore: number;
  perInstrument: WeeklyResultView['perInstrument'];
  equityCurve: WeeklyResultView['equityCurve'];
}

/**
 * WeeklyService — docs/16 (Phase 11).
 *
 * The Weekly Portfolio Battle (T3): a week-long ASYNC trading duel.
 * No WebSocket namespace, no Redis state, no matchmaking queue — the
 * season is a set of Postgres rows, trading is REST, standings are
 * computed on demand from stored trades + current prices, and
 * settlement is a manual ADMIN endpoint in v1 (no scheduler exists).
 *
 * Rating first, then one transaction per league (docs/16 §9): the
 * Trading Rating update per player runs before that league's result
 * rows + XP grants commit, with idempotency key
 * `weekly:{seasonId}:{userId}` and crash recovery through
 * getDuelOutcome / the stored idempotency response (ADR 0013 §8).
 */
@Injectable()
export class WeeklyService {
  constructor(
    private readonly repo: WeeklyRepository,
    private readonly simRepo: SimulatorRepository,
    private readonly ratings: RatingsService,
    private readonly gamification: GamificationService,
    private readonly transactions: TransactionService,
    private readonly logger: AppLogger,
    @Inject(CONFIG) private readonly config: AppConfig
  ) {}

  private priceAt: WeeklyPriceFn = (symbol, basePrice, at) =>
    PriceEngine.price(symbol, basePrice, at).toNumber();

  // --- seasons -------------------------------------------------------------------

  /**
   * ADMIN: create one season for a Monday. The season opens in OPEN
   * (join window open). Carried joiners from the most recent previous
   * season (lone joiners with no league) are enrolled automatically
   * — they kept their place, they do not have to re-join (docs/16 §4).
   */
  async createSeason(
    adminId: string,
    dto: CreateWeeklySeasonDto,
    now: Date = new Date()
  ): Promise<WeeklySeasonView> {
    if (!isMondayIst(dto.weekStart)) {
      throw AppError.validationFailed([
        { field: 'weekStart', issue: 'weekStart must be a Monday (YYYY-MM-DD, Asia/Kolkata).' },
      ]);
    }
    const existing = await this.repo.findSeasonByWeekStart(dto.weekStart);
    if (existing) {
      throw AppError.conflict(`A weekly season already exists for ${dto.weekStart}.`);
    }
    const startMs = mondayStartMs(dto.weekStart);
    const season = await this.repo.createSeason({
      weekStart: dto.weekStart,
      scheduledStartsAt: new Date(startMs),
      scheduledEndsAt: new Date(startMs + WEEK_MS),
    });

    // Carry lone joiners forward (docs/16 §4): the most recent season
    // before this one may hold carried memberships; they join this
    // season automatically, at their current Trading Rating.
    const previous = (await this.repo.listSeasons()).filter((s) => s.id !== season.id)[0];
    if (previous) {
      const carried = await this.repo.listCarriedMemberships(previous.id);
      for (const c of carried) {
        try {
          const rating = (await this.ratings.getUserRatings(c.userId, now)).trading.rating;
          await this.repo.createMembership({
            seasonId: season.id,
            userId: c.userId,
            tradingRating: rating,
          });
        } catch (err) {
          this.logger.error('Carried weekly joiner could not be enrolled', {
            adminId,
            seasonId: season.id,
            userId: c.userId,
            err: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    this.logger.info('Weekly season created', {
      adminId,
      seasonId: season.id,
      weekStart: dto.weekStart,
    });
    return this.toSeasonView(season);
  }

  async listSeasons(): Promise<WeeklySeasonView[]> {
    const rows = await this.repo.listSeasons();
    const views: WeeklySeasonView[] = [];
    for (const row of rows) views.push(await this.toSeasonView(row));
    return views;
  }

  async getSeason(seasonId: string): Promise<WeeklySeasonView> {
    const season = await this.requireSeason(seasonId);
    return this.toSeasonView(season);
  }

  // --- joining + league formation --------------------------------------------------

  /**
   * Join a season. Only while OPEN — joining mid-season is NOT
   * allowed (docs/16 §4, ADR 0013 §4): leagues are seeded by Trading
   * Rating at season start, and a mid-season joiner would enter a
   * league whose rivals have a week's head start. The Trading Rating
   * at join time is the seeding number.
   */
  async joinSeason(
    userId: string,
    seasonId: string,
    now: Date = new Date()
  ): Promise<{ seasonId: string; userId: string; tradingRating: number; joinedAt: Date }> {
    const season = await this.requireSeason(seasonId);
    if (season.status !== WeeklySeasonStatus.OPEN) {
      throw AppError.weeklyJoinClosed('This weekly season has already started.');
    }
    const existing = await this.repo.findMembership(seasonId, userId);
    if (existing) throw AppError.weeklyAlreadyJoined('You have already joined this weekly season.');
    const rating = (await this.ratings.getUserRatings(userId, now)).trading.rating;
    const row = await this.repo.createMembership({ seasonId, userId, tradingRating: rating });
    return { seasonId, userId, tradingRating: rating, joinedAt: row.joinedAt };
  }

  /**
   * ADMIN: start the season — closes joining, forms leagues from the
   * joiners (docs/16 §4), opens the trading window
   * [now, now + WEEKLY_SEASON_DURATION_MS). In production the admin
   * (later the cron) starts on Monday 00:00 IST, so the window is the
   * calendar week; in tests the duration is 15 s so a full cycle runs
   * in test time (ADR 0013 §6).
   */
  async startSeason(
    adminId: string,
    seasonId: string,
    now: Date = new Date()
  ): Promise<{ season: WeeklySeasonView; leagues: WeeklyLeagueRow[]; carriedUserIds: string[] }> {
    const season = await this.requireSeason(seasonId);
    if (season.status === WeeklySeasonStatus.ACTIVE) {
      throw AppError.conflict('This weekly season has already started.');
    }
    if (season.status === WeeklySeasonStatus.SETTLED) {
      throw AppError.conflict('This weekly season is already settled.');
    }
    const joiners = await this.repo.listMembershipsForSeason(seasonId);
    const nextTierByUser = new Map<string, number | null>();
    for (const j of joiners) {
      const latest = await this.repo.findLatestResultForUser(j.userId);
      nextTierByUser.set(j.userId, latest ? latest.nextTier : null);
    }
    const formation = formLeagues(
      joiners.map((j) => ({
        userId: j.userId,
        tradingRating: j.tradingRating,
        joinedAtMs: j.joinedAt.getTime(),
        nextTier: nextTierByUser.get(j.userId) ?? null,
      }))
    );

    const leagueRows: WeeklyLeagueRow[] = [];
    await this.transactions.run(async (tx) => {
      for (const league of formation.leagues) {
        const row = await this.repo.createLeague(
          { seasonId, tier: league.tier, leagueNumber: league.leagueNumber },
          tx
        );
        leagueRows.push(row);
        for (const userId of league.memberUserIds) {
          const m = joiners.find((x) => x.userId === userId);
          if (!m) continue;
          await this.repo.updateMembership(
            m.id,
            { leagueId: row.id, tier: league.tier, carried: false },
            tx
          );
        }
      }
      for (const userId of formation.carriedUserIds) {
        const m = joiners.find((x) => x.userId === userId);
        if (!m) continue;
        await this.repo.updateMembership(
          m.id,
          { leagueId: null, tier: formation.tierByUserId.get(userId) ?? 1, carried: true },
          tx
        );
      }
    });
    const started = await this.repo.updateSeason(seasonId, {
      status: WeeklySeasonStatus.ACTIVE,
      startedAt: now,
      endsAt: new Date(now.getTime() + this.config.WEEKLY_SEASON_DURATION_MS),
    });
    this.logger.info('Weekly season started', {
      adminId,
      seasonId,
      leagues: leagueRows.length,
      carried: formation.carriedUserIds.length,
    });
    return {
      season: await this.toSeasonView(started),
      leagues: leagueRows,
      carriedUserIds: formation.carriedUserIds,
    };
  }

  // --- trading ---------------------------------------------------------------------

  /**
   * One order in the active season. Server-priced via PriceEngine at
   * the current minute (same execution rules as the sprint: funds /
   * holdings checks, whole units, idempotent clientOrderId). Orders
   * are persisted as rows — they are the audit trail the equity curve
   * is rebuilt from (docs/16 §5). No XP per trade.
   */
  async trade(
    userId: string,
    seasonId: string,
    dto: WeeklyTradeDto,
    now: Date = new Date()
  ): Promise<WeeklyTradeView> {
    const season = await this.requireSeason(seasonId);
    if (season.status === WeeklySeasonStatus.OPEN) {
      throw AppError.weeklyNotStarted('This weekly season has not started yet.');
    }
    if (season.status === WeeklySeasonStatus.SETTLED || !season.startedAt || !season.endsAt) {
      throw AppError.weeklyNotActive('This weekly season is not active any more.');
    }
    if (now.getTime() >= season.endsAt.getTime()) {
      throw AppError.weeklyNotActive('This weekly season has ended.');
    }
    const membership = await this.repo.findMembership(seasonId, userId);
    if (!membership || !membership.leagueId) {
      throw AppError.weeklyNotInLeague(
        'You are not in a league for this weekly season, so you cannot trade in it.'
      );
    }
    const existing = await this.repo.findTradeByClientOrderId(seasonId, userId, dto.clientOrderId);
    if (existing) {
      // Idempotent replay: the retried order returns the stored trade,
      // never a second trade (blueprint §6).
      return this.toTradeView(existing, await this.portfolioView(userId, season, now));
    }
    const tradeCount = await this.repo.countTradesForSeasonUser(seasonId, userId);
    if (tradeCount >= DUELS.WEEKLY_MAX_ORDERS_PER_PLAYER) {
      throw AppError.validationFailed([
        {
          field: 'quantity',
          issue: `You have placed the maximum ${DUELS.WEEKLY_MAX_ORDERS_PER_PLAYER} orders for this season.`,
        },
      ]);
    }
    const instruments = await this.activeInstruments();
    const instrument = instruments.find((i) => i.id === dto.instrumentId);
    if (!instrument) {
      throw AppError.validationFailed([
        { field: 'instrumentId', issue: 'This instrument is not part of this weekly season.' },
      ]);
    }
    const price = this.priceAt(instrument.symbol, instrument.basePrice, now);
    const totalValue = round2(price * dto.quantity);
    const portfolio = await this.replayPortfolio(userId, seasonId, instruments);
    if (dto.side === SimOrderSide.BUY) {
      if (totalValue > portfolio.cash) {
        throw AppError.insufficientFunds(
          `This order costs ₹${totalValue.toFixed(2)} virtual cash but the portfolio holds ₹${portfolio.cash.toFixed(2)}.`
        );
      }
    } else {
      const held = portfolio.holdings.find((h) => h.instrumentId === dto.instrumentId);
      if (!held || held.quantity < dto.quantity) {
        throw AppError.insufficientHoldings(
          `Cannot sell ${dto.quantity} units — the portfolio holds ${held?.quantity ?? 0}.`
        );
      }
    }
    const row = await this.repo.createTrade({
      seasonId,
      leagueId: membership.leagueId,
      userId,
      instrumentId: dto.instrumentId,
      side: dto.side,
      quantity: new Prisma.Decimal(dto.quantity),
      price: new Prisma.Decimal(price),
      totalValue: new Prisma.Decimal(totalValue),
      clientOrderId: dto.clientOrderId,
      executedAt: now,
    });
    return this.toTradeView(row, await this.portfolioView(userId, season, now));
  }

  // --- standings + portfolio ---------------------------------------------------------

  /**
   * Live standings, computed on demand from stored trades + current
   * prices (no background job exists). Totals/scores only — never
   * another player's holdings or orders (docs/16 §6). A SETTLED
   * season returns its stored results, never recomputed.
   */
  async getStandings(seasonId: string, now: Date = new Date()): Promise<WeeklyStandingsView> {
    const season = await this.requireSeason(seasonId);
    if (season.status === WeeklySeasonStatus.OPEN) {
      throw AppError.weeklyNotStarted('This weekly season has not started yet.');
    }
    const leagues = await this.repo.listLeaguesForSeason(seasonId);
    const instruments = await this.activeInstruments();
    const out: WeeklyStandingsView['leagues'] = [];
    for (const league of leagues) {
      let entries: WeeklyStandingEntry[];
      if (season.status === WeeklySeasonStatus.SETTLED) {
        const results = await this.repo.listResultsForLeague(league.id);
        entries = [];
        for (const r of results) {
          const user = await this.repo.findUserById(r.userId);
          const zone = leagueZoneFor(r.rank, r.leagueSize);
          entries.push({
            rank: r.rank,
            userId: r.userId,
            displayName: user?.displayName ?? null,
            returnPct: r.returnPct,
            riskAdjustedScore: r.riskAdjustedScore,
            tradeCount: r.tradeCount,
            promotionZone: zone === 'TOP',
            relegationZone: zone === 'BOTTOM',
          });
        }
      } else {
        const members = await this.repo.listMembershipsForLeague(league.id);
        const inputs = [];
        for (const m of members) {
          const metrics = await this.memberMetrics(m, season, instruments, now.getTime());
          inputs.push({
            userId: m.userId,
            displayName: metrics.displayName,
            riskAdjustedScore: metrics.riskAdjustedScore,
            returnPct: metrics.returnPct,
            tradeCount: metrics.tradeCount,
            joinedAtMs: m.joinedAt.getTime(),
          });
        }
        entries = rankLeagueEntries(inputs).map((e) => ({
          rank: e.rank,
          userId: e.userId,
          displayName: e.displayName,
          returnPct: e.returnPct,
          riskAdjustedScore: e.riskAdjustedScore,
          tradeCount: e.tradeCount,
          promotionZone: e.promotionZone,
          relegationZone: e.relegationZone,
        }));
      }
      out.push({
        leagueId: league.id,
        tier: league.tier,
        leagueNumber: league.leagueNumber,
        entries,
      });
    }
    return {
      seasonId,
      weekStart: season.weekStart,
      status: season.status,
      endsAt: season.endsAt,
      leagues: out,
    };
  }

  /** My portfolio in a season: cash, holdings, current prices, equity. */
  async getPortfolio(
    userId: string,
    seasonId: string,
    now: Date = new Date()
  ): Promise<WeeklyPortfolioView> {
    const season = await this.requireSeason(seasonId);
    if (season.status === WeeklySeasonStatus.OPEN) {
      throw AppError.weeklyNotStarted('This weekly season has not started yet.');
    }
    const membership = await this.repo.findMembership(seasonId, userId);
    if (!membership || !membership.leagueId) {
      throw AppError.weeklyNotInLeague('You are not in a league for this weekly season.');
    }
    return this.portfolioView(userId, season, now);
  }

  // --- settlement --------------------------------------------------------------------

  /**
   * ADMIN: settle the whole season. One transaction per league
   * (docs/16 §9): a failure in one league never blocks the others,
   * and each league's write is bounded (≤ 31 players). Rating first,
   * then the league transaction — the sprint settlement order
   * (ADR 0011 §6). Re-calling settle on a SETTLED season replays the
   * stored results, never double-applies (idempotency + status check
   * + unique result rows). A crash between the Rating step and the
   * league transaction is recovered on the next call: the Rating call
   * throws RATING_EVENT_DUPLICATE / IDEMPOTENCY_REPLAY and the stored
   * deltas are read back instead of applied twice.
   */
  async settleSeason(
    adminId: string,
    seasonId: string,
    now: Date = new Date()
  ): Promise<WeeklySettlementView> {
    const season = await this.requireSeason(seasonId);
    if (season.status === WeeklySeasonStatus.SETTLED) {
      return this.settlementView(season);
    }
    if (season.status === WeeklySeasonStatus.OPEN || !season.startedAt || !season.endsAt) {
      throw AppError.weeklyNotStarted('This weekly season has not started yet.');
    }
    if (now.getTime() < season.endsAt.getTime()) {
      throw AppError.weeklyNotEnded('This weekly season has not ended yet.');
    }
    const instruments = await this.activeInstruments();
    const indexReturnPct = weeklyIndexReturnPct(
      instruments,
      this.priceAt,
      season.startedAt.getTime(),
      now.getTime()
    );
    const leagues = await this.repo.listLeaguesForSeason(seasonId);
    let playersSettled = 0;
    for (const league of leagues) {
      const members = await this.repo.listMembershipsForLeague(league.id);
      const already = await this.repo.listResultsForLeague(league.id);
      const settledIds = new Set(already.map((r) => r.userId));
      playersSettled += already.length;
      const pending = members.filter((m) => !settledIds.has(m.userId));
      if (pending.length === 0) continue;

      // Metrics first (pure computation, no writes).
      const metricsByUser = new Map<string, MemberMetrics>();
      for (const m of pending) {
        metricsByUser.set(
          m.userId,
          await this.memberMetrics(m, season, instruments, now.getTime())
        );
      }
      const ranked = rankLeagueEntries(
        pending.map((m) => {
          const metrics = metricsByUser.get(m.userId) as MemberMetrics;
          return {
            userId: m.userId,
            displayName: metrics.displayName,
            riskAdjustedScore: metrics.riskAdjustedScore,
            returnPct: metrics.returnPct,
            tradeCount: metrics.tradeCount,
            joinedAtMs: m.joinedAt.getTime(),
          };
        })
      );

      // Rating first (one call per player, outside the league tx).
      const ratingByUser = new Map<
        string,
        {
          before: number | null;
          after: number | null;
          delta: number | null;
          result: WeeklyLeagueOutcome | null;
        }
      >();
      for (const entry of ranked) {
        const metrics = metricsByUser.get(entry.userId) as MemberMetrics;
        if (metrics.tradeCount < WEEKLY_MIN_TRADES) {
          ratingByUser.set(entry.userId, { before: null, after: null, delta: null, result: null });
          continue;
        }
        const score = tradingScore(metrics.returnPct, indexReturnPct);
        const ratingResult: WeeklyLeagueOutcome =
          score === 1 ? 'WIN' : score === 0 ? 'LOSS' : 'DRAW';
        const key = `weekly:${seasonId}:${entry.userId}`;
        try {
          const res = await this.ratings.recordTradingWeek(
            adminId,
            {
              userId: entry.userId,
              portfolioReturnPct: metrics.returnPct,
              indexReturnPct,
              tradeCount: metrics.tradeCount,
              weekStart: season.weekStart,
              idempotencyKey: key,
            },
            now
          );
          ratingByUser.set(entry.userId, {
            before: res.applied ? (res.ratingBefore ?? null) : null,
            after: res.applied ? (res.ratingAfter ?? null) : null,
            delta: res.applied ? (res.delta ?? null) : null,
            result: res.applied ? ratingResult : null,
          });
        } catch (err) {
          // Crash recovery (docs/16 §9): the Rating step already ran
          // before a crash between it and the league transaction.
          // Read the stored deltas back instead of applying them twice.
          ratingByUser.set(
            entry.userId,
            await this.recoverWeeklyRating(err, entry.userId, key, ratingResult)
          );
        }
      }

      // Then one transaction: result rows + XP grants for the league.
      await this.transactions.run(async (tx) => {
        for (const entry of ranked) {
          const metrics = metricsByUser.get(entry.userId) as MemberMetrics;
          const rating = ratingByUser.get(entry.userId) as {
            before: number | null;
            after: number | null;
            delta: number | null;
            result: WeeklyLeagueOutcome | null;
          };
          const reason = weeklyRatingReasonFor({
            rank: entry.rank,
            leagueSize: members.length,
            tier: league.tier,
            leagueNumber: league.leagueNumber,
            tradeCount: metrics.tradeCount,
            returnPct: metrics.returnPct,
            indexReturnPct,
            ratingResult: rating.result,
            ratingDelta: rating.delta,
          });
          const rewards = await this.gamification.grantDuelRewards(tx, {
            userId: entry.userId,
            result: entry.xpOutcome,
            reason: 'duel.weekly_completed',
            xpIdempotencyKey: `weekly:${seasonId}:${entry.userId}`,
            atIso: now.toISOString(),
          });
          await this.repo.createResult(
            {
              seasonId,
              leagueId: league.id,
              userId: entry.userId,
              rank: entry.rank,
              leagueSize: members.length,
              tier: league.tier,
              nextTier: nextTierFor(entry.rank, members.length, league.tier),
              result: entry.xpOutcome,
              finalEquity: new Prisma.Decimal(metrics.finalEquity),
              returnPct: metrics.returnPct,
              realisedVolPct: metrics.realisedVolPct,
              maxDrawdownPct: metrics.maxDrawdownPct,
              riskAdjustedScore: metrics.riskAdjustedScore,
              tradeCount: metrics.tradeCount,
              perInstrument: metrics.perInstrument,
              equityCurve: metrics.equityCurve,
              ratingBefore: rating.before,
              ratingAfter: rating.after,
              ratingDelta: rating.delta,
              ratingResult: rating.result,
              ratingReason: reason,
              xpAwarded: rewards.xpAwarded,
              xpBreakdown: {
                result: entry.xpOutcome,
                xp: rewards.xpAwarded,
                reason: 'duel.weekly_completed',
              },
            },
            tx
          );
          playersSettled += 1;
        }
      });
    }
    const settled = await this.repo.updateSeason(seasonId, {
      status: WeeklySeasonStatus.SETTLED,
      indexReturnPct,
    });
    this.logger.info('Weekly season settled', {
      adminId,
      seasonId,
      leagues: leagues.length,
      players: playersSettled,
      indexReturnPct,
    });
    return this.settlementView(settled, leagues.length, playersSettled);
  }

  /** One season's stored result, for the player who played it. */
  async getMyResult(userId: string, seasonId: string): Promise<WeeklyResultView> {
    const season = await this.requireSeason(seasonId);
    const row = await this.repo.findResult(seasonId, userId);
    if (!row) throw AppError.notFound('This season has no stored result for you yet.');
    const league = (await this.repo.listLeaguesForSeason(seasonId)).find(
      (l) => l.id === row.leagueId
    );
    return this.toResultView(row, season, league?.leagueNumber ?? 0);
  }

  /** My weekly history, newest first. */
  async listHistory(
    userId: string,
    page: number,
    limit: number
  ): Promise<{ items: WeeklyHistoryItem[]; meta: ReturnType<typeof buildPaginationMeta> }> {
    const [total, rows] = await Promise.all([
      this.repo.countResultsForUser(userId),
      this.repo.listResultsForUser(userId, (page - 1) * limit, limit),
    ]);
    const items: WeeklyHistoryItem[] = [];
    for (const row of rows) {
      const season = await this.repo.findSeasonById(row.seasonId);
      const league = (await this.repo.listLeaguesForSeason(row.seasonId)).find(
        (l) => l.id === row.leagueId
      );
      items.push({
        seasonId: row.seasonId,
        weekStart: season?.weekStart ?? '',
        leagueId: row.leagueId,
        tier: row.tier,
        leagueNumber: league?.leagueNumber ?? 0,
        rank: row.rank,
        leagueSize: row.leagueSize,
        nextTier: row.nextTier,
        result: row.result,
        finalEquity: money(row.finalEquity),
        returnPct: row.returnPct,
        riskAdjustedScore: row.riskAdjustedScore,
        ratingDelta: row.ratingDelta,
        xpAwarded: row.xpAwarded,
        settledAt: row.createdAt,
      });
    }
    return { items, meta: buildPaginationMeta(page, limit, total) };
  }

  // --- crash recovery ------------------------------------------------------------

  /**
   * A Rating call that fails because the week was already rated
   * (crash between the Rating step and the league transaction):
   * read the stored deltas back instead of applying them twice.
   * - IDEMPOTENCY_REPLAY carries the original TradingWeekResponse in
   *   `error.details.original` (the stored result of the first call).
   * - RATING_EVENT_DUPLICATE means a history row exists for the key:
   *   getDuelOutcome reads the deltas from history (kind TRADING).
   * Anything else is a genuine failure: the week settles unrated
   * (nulls) rather than losing the played season's result — the
   * sprint's crash rule (ADR 0011 §6), carried over.
   */
  private async recoverWeeklyRating(
    err: unknown,
    userId: string,
    key: string,
    ratingResult: WeeklyLeagueOutcome
  ): Promise<{
    before: number | null;
    after: number | null;
    delta: number | null;
    result: WeeklyLeagueOutcome | null;
  }> {
    const unrated = {
      before: null,
      after: null,
      delta: null,
      result: null as WeeklyLeagueOutcome | null,
    };
    if (!(err instanceof AppError)) return unrated;
    if (err.code === ErrorCode.IDEMPOTENCY_REPLAY) {
      const original = (err.details as { original?: TradingWeekResponse } | undefined)?.original;
      if (original?.applied) {
        return {
          before: original.ratingBefore ?? null,
          after: original.ratingAfter ?? null,
          delta: original.delta ?? null,
          result: ratingResult,
        };
      }
      return unrated;
    }
    if (err.code === ErrorCode.RATING_EVENT_DUPLICATE) {
      try {
        const outcome = await this.ratings.getDuelOutcome(userId, key, RatingKind.TRADING);
        if (outcome) {
          return {
            before: outcome.me.ratingBefore,
            after: outcome.me.ratingAfter,
            delta: outcome.me.delta,
            result: ratingResult,
          };
        }
      } catch {
        // History unreadable: settle unrated, keep the result.
      }
      return unrated;
    }
    return unrated;
  }

  // --- helpers ---------------------------------------------------------------------

  private async requireSeason(seasonId: string): Promise<WeeklySeasonRow> {
    const season = await this.repo.findSeasonById(seasonId);
    if (!season) throw AppError.notFound('Weekly season not found.');
    return season;
  }

  private async toSeasonView(season: WeeklySeasonRow): Promise<WeeklySeasonView> {
    const [leagueCount, memberCount] = await Promise.all([
      this.repo.countLeaguesForSeason(season.id),
      this.repo.countMembershipsForSeason(season.id),
    ]);
    return {
      id: season.id,
      weekStart: season.weekStart,
      status: season.status,
      scheduledStartsAt: season.scheduledStartsAt,
      scheduledEndsAt: season.scheduledEndsAt,
      startedAt: season.startedAt,
      endsAt: season.endsAt,
      indexReturnPct: season.indexReturnPct,
      leagueCount,
      memberCount,
      host: { name: WEEKLY_HOST.name, role: WEEKLY_HOST.role },
    };
  }

  private async settlementView(
    season: WeeklySeasonRow,
    leaguesSettled?: number,
    playersSettled?: number
  ): Promise<WeeklySettlementView> {
    const leagues = leaguesSettled ?? (await this.repo.listLeaguesForSeason(season.id)).length;
    let players = playersSettled;
    if (players === undefined) {
      players = 0;
      for (const league of await this.repo.listLeaguesForSeason(season.id)) {
        players += (await this.repo.listResultsForLeague(league.id)).length;
      }
    }
    return {
      seasonId: season.id,
      weekStart: season.weekStart,
      status: 'SETTLED',
      indexReturnPct: season.indexReturnPct ?? 0,
      leaguesSettled: leagues,
      playersSettled: players,
      host: { name: WEEKLY_HOST.name, line: WEEKLY_HOST.settled },
    };
  }

  private async activeInstruments(): Promise<WeeklyInstrumentLike[]> {
    const rows = await this.simRepo.listActiveInstruments();
    return rows.map((r: InstrumentRow) => ({
      id: r.id,
      symbol: r.symbol,
      name: r.name,
      basePrice: toNumber(r.basePrice),
    }));
  }

  private tradesAsLikes(
    rows: WeeklyTradeRow[],
    instruments: WeeklyInstrumentLike[]
  ): WeeklyTradeLike[] {
    const symbolById = new Map(instruments.map((i) => [i.id, i.symbol]));
    return rows.map((r) => ({
      instrumentId: r.instrumentId,
      symbol: symbolById.get(r.instrumentId) ?? '',
      side: r.side,
      quantity: toNumber(r.quantity),
      price: toNumber(r.price),
      executedAtMs: r.executedAt.getTime(),
    }));
  }

  private async replayPortfolio(
    userId: string,
    seasonId: string,
    instruments: WeeklyInstrumentLike[]
  ): Promise<{
    cash: number;
    holdings: Array<{ instrumentId: string; symbol: string; quantity: number; avgCost: number }>;
  }> {
    const rows = await this.repo.listTradesForSeasonUser(seasonId, userId);
    return replayWeeklyPortfolio(this.tradesAsLikes(rows, instruments));
  }

  private async portfolioView(
    userId: string,
    season: WeeklySeasonRow,
    now: Date
  ): Promise<WeeklyPortfolioView> {
    const instruments = await this.activeInstruments();
    const portfolio = await this.replayPortfolio(userId, season.id, instruments);
    const prices = instruments.map((i) => ({
      instrumentId: i.id,
      symbol: i.symbol,
      price: money(this.priceAt(i.symbol, i.basePrice, now)),
    }));
    const priceById = new Map(
      instruments.map((i) => [i.id, this.priceAt(i.symbol, i.basePrice, now)])
    );
    const holdings: WeeklyHoldingView[] = portfolio.holdings.map((h) => {
      const current = priceById.get(h.instrumentId) ?? 0;
      const marketValue = round2(h.quantity * current);
      const inst = instruments.find((i) => i.id === h.instrumentId);
      return {
        instrumentId: h.instrumentId,
        symbol: h.symbol,
        name: inst?.name ?? h.symbol,
        quantity: h.quantity,
        avgCost: money(h.avgCost),
        currentPrice: money(current),
        marketValue: money(marketValue),
        unrealizedPnl: money(round2(marketValue - h.quantity * h.avgCost)),
      };
    });
    return {
      seasonId: season.id,
      cash: money(portfolio.cash),
      totalEquity: money(weeklyEquityAt(portfolio, priceById)),
      holdings,
      prices,
    };
  }

  private async memberMetrics(
    m: WeeklyMembershipRow,
    season: WeeklySeasonRow,
    instruments: WeeklyInstrumentLike[],
    atMs: number
  ): Promise<MemberMetrics> {
    const rows = await this.repo.listTradesForSeasonUser(season.id, m.userId);
    const likes = this.tradesAsLikes(rows, instruments);
    const startedAtMs = (season.startedAt ?? season.scheduledStartsAt).getTime();
    const curve = buildWeeklyEquityCurve(likes, instruments, this.priceAt, startedAtMs, atMs);
    const metrics = weeklyRiskMetrics(
      curve.map((p) => p.equity),
      SIMULATOR_STARTING_CASH
    );
    const finalPrices = new Map(
      instruments.map((i) => [i.id, this.priceAt(i.symbol, i.basePrice, new Date(atMs))])
    );
    const perInstrument = summariseTrades(
      likes.map((t) => ({
        instrumentId: t.instrumentId,
        symbol: t.symbol,
        side: t.side,
        quantity: t.quantity,
        price: t.price,
      })),
      finalPrices
    );
    const user = await this.repo.findUserById(m.userId);
    return {
      userId: m.userId,
      displayName: user?.displayName ?? null,
      joinedAtMs: m.joinedAt.getTime(),
      tradeCount: rows.length,
      finalEquity: curve[curve.length - 1]?.equity ?? SIMULATOR_STARTING_CASH,
      returnPct: metrics.returnPct,
      realisedVolPct: metrics.realisedVolPct,
      maxDrawdownPct: metrics.maxDrawdownPct,
      riskAdjustedScore: metrics.riskAdjustedScore,
      perInstrument,
      equityCurve: curve.map((p) => ({ t: p.t, equity: money(p.equity) })),
    };
  }

  private toTradeView(row: WeeklyTradeRow, portfolio: WeeklyPortfolioView): WeeklyTradeView {
    return {
      id: row.id,
      seasonId: row.seasonId,
      leagueId: row.leagueId,
      instrumentId: row.instrumentId,
      symbol: portfolio.prices.find((p) => p.instrumentId === row.instrumentId)?.symbol ?? '',
      side: row.side,
      quantity: toNumber(row.quantity).toFixed(6),
      price: money(row.price),
      totalValue: money(row.totalValue),
      clientOrderId: row.clientOrderId,
      executedAt: row.executedAt,
      portfolio,
    };
  }

  /**
   * The stored-result view for a row settlement wrote. The XP view
   * comes from the stored xpBreakdown (same shape as the sprint's
   * toView) — the stored row does not carry the full XP breakdown
   * view, so the caller-supplied rewards are not available on a
   * later read.
   */
  private toResultView(
    row: WeeklyResultRow,
    season: WeeklySeasonRow,
    leagueNumber: number
  ): WeeklyResultView {
    const xpBreakdown = row.xpBreakdown as unknown as {
      totalXp?: number;
      level?: number;
      levelUp?: boolean;
      currentStreak?: number;
      newBadges?: Array<{ slug: string; name: string }>;
    };
    return {
      seasonId: row.seasonId,
      weekStart: season.weekStart,
      leagueId: row.leagueId,
      tier: row.tier,
      leagueNumber,
      rank: row.rank,
      leagueSize: row.leagueSize,
      nextTier: row.nextTier,
      result: row.result,
      finalEquity: money(row.finalEquity),
      returnPct: row.returnPct,
      realisedVolPct: row.realisedVolPct,
      maxDrawdownPct: row.maxDrawdownPct,
      riskAdjustedScore: row.riskAdjustedScore,
      tradeCount: row.tradeCount,
      perInstrument: (row.perInstrument as unknown as WeeklyResultView['perInstrument']) ?? [],
      equityCurve: (row.equityCurve as unknown as WeeklyResultView['equityCurve']) ?? [],
      ratingBefore: row.ratingBefore,
      ratingAfter: row.ratingAfter,
      ratingDelta: row.ratingDelta,
      ratingResult: (row.ratingResult as WeeklyLeagueOutcome | null) ?? null,
      ratingReason: row.ratingReason,
      xp: {
        awarded: row.xpAwarded,
        totalXp: xpBreakdown.totalXp ?? 0,
        level: xpBreakdown.level ?? 1,
        levelUp: xpBreakdown.levelUp ?? false,
        currentStreak: xpBreakdown.currentStreak ?? 0,
        newBadges: xpBreakdown.newBadges ?? [],
      },
      settledAt: row.createdAt,
    };
  }
}
