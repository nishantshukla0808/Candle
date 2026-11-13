import { Injectable } from '@nestjs/common';
import { RatingEventSource, RatingKind } from '@prisma/client';
import {
  RATING_DAILY_EVENT_LIMIT,
  RATING_DUEL_DAILY_PAIR_LIMIT,
  RATING_DUEL_REMATCH_COOLDOWN_MINUTES,
  RATING_LEADERBOARD_TOP,
  RATING_PROVISIONAL_EVENTS,
  RATING_START,
  RATING_TRADING_MIN_TRADES,
} from '@candle/shared';
import { AppError } from '../../common/errors/app-error';
import { AppLogger } from '../../common/services/logger.service';
import { RedisService } from '../../common/services/redis.service';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { TransactionService } from '../../database/transaction.service';
import type { TxClient } from '../../database/tx-client';
import { buildPaginationMeta } from '../../common/utils/pagination';
import {
  INDEX_OPPONENT_RATING,
  applyUpdate,
  candleRating,
  currentSeason,
  decayFor,
  displayRating,
  mirrorResult,
  mondayOfWeek,
  round1,
  scoreForResult,
  softReset,
  startOfUtcDay,
  tierFor,
  tradingScore,
  type DuelResult,
} from './rating-math';
import type {
  DecayDto,
  LeaderboardQueryDto,
  RecordDuelDto,
  RecordTradingWeekDto,
  SeasonResetDto,
} from './dto/ratings.dto';
import { RatingsRepository, type RatingHistoryRow, type UserRatingRow } from './ratings.repository';

/**
 * Carried on every rating/leaderboard endpoint's OpenAPI docs
 * (blueprint §16 — the disclaimer lives in the product, not just docs).
 */
export const RATINGS_DISCLAIMER =
  'Educational purpose only — this is not investment advice. ' +
  'Ratings measure learning and simulated-trading skill only. ' +
  'All trading is simulated with virtual money.';

export interface RatingView {
  kind: RatingKind;
  /** Stored rating, 1 decimal place. */
  rating: number;
  /** Display rating, rounded to the nearest integer. */
  displayRating: number;
  tier: string;
  provisional: boolean;
  gamesPlayed: number;
  wins: number;
  draws: number;
  losses: number;
  lastRatedAt: Date | null;
  season: string;
  countryCode: string | null;
  /** 1-based rank, or null when the user is not on that leaderboard. */
  globalRank: number | null;
  globalPercentile: number | null;
  countryRank: number | null;
  countryPercentile: number | null;
}

export interface RatingsOverview {
  userId: string;
  displayName: string | null;
  countryCode: string | null;
  learning: RatingView;
  trading: RatingView;
  /** Headline Candle Rating (0.5 × Learning + 0.5 × Trading), derived. */
  candleRating: number;
  candleDisplayRating: number;
  candleTier: string;
}

export interface DuelSideView {
  userId: string;
  ratingBefore: number;
  ratingAfter: number;
  delta: number;
  tier: string;
  provisional: boolean;
  gamesPlayed: number;
}

export interface BotDuelResponse {
  eventId: string;
  kind: RatingKind;
  result: DuelResult;
  me: DuelSideView;
  /** The bot's rating at event time — always the player's own rating. */
  botRating: number;
}

export interface DuelOutcomeView {
  eventId: string;
  me: DuelSideView;
  opponent: DuelSideView | null;
}

export interface DuelResponse {
  eventId: string;
  kind: RatingKind;
  result: DuelResult;
  me: DuelSideView;
  opponent: DuelSideView;
}

export interface TradingWeekResponse {
  applied: boolean;
  userId: string;
  weekStart: string;
  tradeCount: number;
  reason?: string;
  score?: 'WIN' | 'DRAW' | 'LOSS';
  ratingBefore?: number;
  ratingAfter?: number;
  delta?: number;
  tier?: string;
  provisional?: boolean;
  gamesPlayed?: number;
}

export interface HistoryItemView {
  id: string;
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

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  displayName: string | null;
  rating: number;
  displayRating: number;
  tier: string;
  provisional: boolean;
  percentile: number;
}

export interface LeaderboardResponse {
  kind: RatingKind;
  scope: 'global' | 'country';
  country: string | null;
  total: number;
  entries: LeaderboardEntry[];
}

export interface SeasonResetResponse {
  season: string;
  updated: number;
  skipped: number;
}

export interface DecayApplied {
  userId: string;
  kind: RatingKind;
  ratingBefore: number;
  ratingAfter: number;
  delta: number;
}

export interface DecayResponse {
  asOf: string;
  weekStart: string;
  applied: DecayApplied[];
  skipped: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

function leaderboardKey(kind: RatingKind, scope: 'global' | 'country', country?: string): string {
  return scope === 'country'
    ? `ratings:lb:${kind}:country:${country}`
    : `ratings:lb:${kind}:global`;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * RatingsService — docs/04-ratings-and-deployment.md (Phase 3).
 *
 * Separate Learning and Trading ratings per user, one formula for every
 * rated event, both sides of a duel updated in ONE transaction, history
 * as the audit trail, Redis sorted sets for leaderboards with Postgres
 * as the source of truth.
 *
 * The module never queries the simulator: trading weeks arrive as
 * numbers supplied by the caller (ADR 0005/7).
 */
@Injectable()
export class RatingsService {
  constructor(
    private readonly repo: RatingsRepository,
    private readonly redis: RedisService,
    private readonly idempotency: IdempotencyService,
    private readonly transactions: TransactionService,
    private readonly logger: AppLogger
  ) {}

  // --- duels (Learning, rated events are duels only) -----------------------------

  /**
   * Records one rated learning duel. Both players are updated in ONE
   * transaction; the header key and the body key must match (ADR 0005/5)
   * and double as the history eventId for both sides.
   *
   * Anti-gaming (docs/04 §5): same pair max 3 rated duels/day, max 10
   * rated events/user/day (both sides), 5-minute rematch cooldown.
   */
  async recordDuel(
    callerId: string,
    dto: RecordDuelDto,
    headerKey: string | undefined,
    now: Date = new Date()
  ): Promise<DuelResponse> {
    if (dto.opponentId === callerId) {
      throw AppError.validationFailed([
        { field: 'opponentId', issue: 'You cannot duel yourself.' },
      ]);
    }
    if (headerKey !== undefined && headerKey !== dto.idempotencyKey) {
      throw AppError.validationFailed([
        {
          field: 'idempotencyKey',
          issue: 'Body idempotencyKey must match the Idempotency-Key header.',
        },
      ]);
    }
    await this.idempotency.guard(headerKey, callerId);
    const key = headerKey as string;
    const season = currentSeason(now);

    const response = await this.transactions.run(async (tx) => {
      const [caller, opponent] = await Promise.all([
        this.repo.findUserById(callerId, tx),
        this.repo.findUserById(dto.opponentId, tx),
      ]);
      if (!caller) throw AppError.notFound('User not found.');
      if (!opponent) throw AppError.notFound('Opponent not found.');

      // Idempotency, belt-and-braces: the guard above covers the caller,
      // the history lookup covers the opponent (and a same-key race).
      for (const userId of [callerId, dto.opponentId]) {
        const existing = await this.repo.findHistoryByEventId(userId, key, tx);
        if (existing) throw AppError.ratingEventDuplicate('This duel was already recorded.');
      }

      const dayStart = startOfUtcDay(now);
      const [callerToday, opponentToday, pairToday] = await Promise.all([
        this.repo.countEventsSince(callerId, dayStart, tx),
        this.repo.countEventsSince(dto.opponentId, dayStart, tx),
        this.repo.countPairDuelsSince(callerId, dto.opponentId, dayStart, tx),
      ]);
      if (callerToday >= RATING_DAILY_EVENT_LIMIT || opponentToday >= RATING_DAILY_EVENT_LIMIT) {
        throw AppError.ratingDailyLimit(
          `Rated events are capped at ${RATING_DAILY_EVENT_LIMIT} per user per day.`
        );
      }
      if (pairToday >= RATING_DUEL_DAILY_PAIR_LIMIT) {
        throw AppError.ratingDailyLimit(
          `The same pair can play at most ${RATING_DUEL_DAILY_PAIR_LIMIT} rated duels per day.`
        );
      }
      const lastDuel = await this.repo.lastPairDuel(callerId, dto.opponentId, tx);
      if (
        lastDuel &&
        now.getTime() - lastDuel.createdAt.getTime() <
          RATING_DUEL_REMATCH_COOLDOWN_MINUTES * MINUTE_MS
      ) {
        throw AppError.ratingDuelCooldown(
          `Wait ${RATING_DUEL_REMATCH_COOLDOWN_MINUTES} minutes before a rematch against the same opponent.`
        );
      }

      const [callerRating, opponentRating] = await Promise.all([
        this.repo.getOrCreateRating(callerId, RatingKind.LEARNING, season, caller.countryCode, tx),
        this.repo.getOrCreateRating(
          dto.opponentId,
          RatingKind.LEARNING,
          season,
          opponent.countryCode,
          tx
        ),
      ]);

      const callerScore = scoreForResult(dto.result);
      const opponentScore = scoreForResult(mirrorResult(dto.result));
      const callerUpdate = applyUpdate(
        callerRating.rating,
        opponentRating.rating,
        callerScore,
        callerRating.gamesPlayed
      );
      const opponentUpdate = applyUpdate(
        opponentRating.rating,
        callerRating.rating,
        opponentScore,
        opponentRating.gamesPlayed
      );

      const callerSaved = await this.saveRatedRow(
        tx,
        callerRating,
        callerUpdate,
        dto.result,
        caller.countryCode,
        season,
        now
      );
      const opponentSaved = await this.saveRatedRow(
        tx,
        opponentRating,
        opponentUpdate,
        mirrorResult(dto.result),
        opponent.countryCode,
        season,
        now
      );

      await this.repo.createHistory(
        {
          userId: callerId,
          kind: RatingKind.LEARNING,
          source: RatingEventSource.DUEL,
          eventId: key,
          opponentId: dto.opponentId,
          opponentRating: opponentRating.rating,
          expectedScore: callerUpdate.expected,
          actualScore: callerScore,
          kFactor: callerUpdate.k,
          delta: callerUpdate.delta,
          ratingBefore: callerRating.rating,
          ratingAfter: callerUpdate.newRating,
          season,
        },
        tx
      );
      await this.repo.createHistory(
        {
          userId: dto.opponentId,
          kind: RatingKind.LEARNING,
          source: RatingEventSource.DUEL,
          eventId: key,
          opponentId: callerId,
          opponentRating: callerRating.rating,
          expectedScore: opponentUpdate.expected,
          actualScore: opponentScore,
          kFactor: opponentUpdate.k,
          delta: opponentUpdate.delta,
          ratingBefore: opponentRating.rating,
          ratingAfter: opponentUpdate.newRating,
          season,
        },
        tx
      );

      const result: DuelResponse = {
        eventId: key,
        kind: RatingKind.LEARNING,
        result: dto.result,
        me: this.toSideView(callerId, callerRating.rating, callerUpdate, callerSaved),
        opponent: this.toSideView(
          dto.opponentId,
          opponentRating.rating,
          opponentUpdate,
          opponentSaved
        ),
      };
      await this.idempotency.store(key, callerId, result, tx);
      this.logger.info('Rated duel recorded', {
        userId: callerId,
        opponentId: dto.opponentId,
        result: dto.result,
        delta: callerUpdate.delta,
      });
      return result;
    });

    // Leaderboards sync AFTER the transaction commits. Redis is a cache:
    // a failure here must never roll back the rating, and a rebuild from
    // Postgres recovers any missed write (docs/04 §7).
    await this.syncLeaderboardSafe(
      callerId,
      RatingKind.LEARNING,
      response.me.ratingAfter,
      await this.countryOf(callerId)
    );
    await this.syncLeaderboardSafe(
      dto.opponentId,
      RatingKind.LEARNING,
      response.opponent.ratingAfter,
      await this.countryOf(dto.opponentId)
    );
    return response;
  }

  // --- duels vs the bot (Daily Duel fallback, ADR 0006/7) ------------------------

  /**
   * Records one rated duel against the Mira bot, for a Daily Duel player
   * left unpaired at day end (docs/05 §1 L5, ADR 0006/7). The bot has no
   * user account, so the existing two-player duel path cannot apply:
   * this method updates ONLY the caller, with the bot fixed at the
   * caller's own rating (expected score 0.5, so a win always pays and a
   * loss always costs, symmetrically). One history row, opponentId null,
   * opponentRating = the caller's rating before the event.
   *
   * Same guards as a human duel: idempotency key (guard + history
   * lookup), max 10 rated events/user/day (UTC, ADR 0005/2). No pair
   * limit and no rematch cooldown apply — there is no human pair.
   * The key is `duel:{duelId}`; a replay throws RATING_EVENT_DUPLICATE
   * (history guard) or IDEMPOTENCY_REPLAY (header guard, with the
   * original result) — the duels module recovers the deltas from
   * getDuelOutcome instead of applying the rating twice.
   */
  async recordDuelVsBot(
    userId: string,
    result: DuelResult,
    idempotencyKey: string,
    now: Date = new Date()
  ): Promise<BotDuelResponse> {
    await this.idempotency.guard(idempotencyKey, userId);
    const season = currentSeason(now);

    const response = await this.transactions.run(async (tx) => {
      const user = await this.repo.findUserById(userId, tx);
      if (!user) throw AppError.notFound('User not found.');
      const existing = await this.repo.findHistoryByEventId(userId, idempotencyKey, tx);
      if (existing) throw AppError.ratingEventDuplicate('This duel was already recorded.');

      const dayStart = startOfUtcDay(now);
      const today = await this.repo.countEventsSince(userId, dayStart, tx);
      if (today >= RATING_DAILY_EVENT_LIMIT) {
        throw AppError.ratingDailyLimit(
          `Rated events are capped at ${RATING_DAILY_EVENT_LIMIT} per user per day.`
        );
      }

      const row = await this.repo.getOrCreateRating(
        userId,
        RatingKind.LEARNING,
        season,
        user.countryCode,
        tx
      );
      const score = scoreForResult(result);
      const update = applyUpdate(row.rating, row.rating, score, row.gamesPlayed);
      const saved = await this.saveRatedRow(tx, row, update, result, user.countryCode, season, now);
      await this.repo.createHistory(
        {
          userId,
          kind: RatingKind.LEARNING,
          source: RatingEventSource.DUEL,
          eventId: idempotencyKey,
          opponentId: null,
          opponentRating: row.rating,
          expectedScore: update.expected,
          actualScore: score,
          kFactor: update.k,
          delta: update.delta,
          ratingBefore: row.rating,
          ratingAfter: update.newRating,
          season,
        },
        tx
      );

      const out: BotDuelResponse = {
        eventId: idempotencyKey,
        kind: RatingKind.LEARNING,
        result,
        me: this.toSideView(userId, row.rating, update, saved),
        botRating: row.rating,
      };
      await this.idempotency.store(idempotencyKey, userId, out, tx);
      this.logger.info('Rated duel vs bot recorded', {
        userId,
        result,
        delta: update.delta,
      });
      return out;
    });

    await this.syncLeaderboardSafe(
      userId,
      RatingKind.LEARNING,
      response.me.ratingAfter,
      await this.countryOf(userId)
    );
    return response;
  }

  // --- trading duels (Trading, Paper Trading Sprint T1) ---------------------

  /**
   * Records one rated Paper Trading Sprint (docs/14 §7, ADR 0011 §6):
   * a head-to-head duel that changes the TRADING Rating. This is the
   * doc-05-authorised extension of doc 04 §5: doc 04 §9's "weekly
   * seasons only" rule was scoped to Phase 3 v1 ("No live head-to-head
   * trading duels (weekly seasons only)" under "What is NOT in Phase 3
   * v1"), and doc 05 §1 lists the Sprint as rated (T1). The weekly
   * season path (recordTradingWeek, vs the index at 1200) is untouched
   * — a sprint is a second rated-trading event type, not a replacement.
   *
   * Same formula, caps, and ordering as recordDuel, but kind TRADING
   * and source DUEL: both players update in ONE transaction, same pair
   * max 3 rated sprints/day, max 10 rated events/user/day (shared
   * across kinds — countEventsSince counts any kind), 5-minute rematch
   * cooldown. The pair cap / cooldown read TRADING history only
   * (countPairTradingDuelsSince / lastPairTradingDuel), so learning
   * duels never consume a sprint cap. Idempotency key `duel:{duelId}`.
   *
   * Called by the sprint engine (internal call — no HTTP header, so
   * no header/body key match is checked here, unlike recordDuel).
   */
  async recordTradingDuel(
    callerId: string,
    dto: RecordDuelDto,
    now: Date = new Date()
  ): Promise<DuelResponse> {
    if (dto.opponentId === callerId) {
      throw AppError.validationFailed([
        { field: 'opponentId', issue: 'You cannot duel yourself.' },
      ]);
    }
    await this.idempotency.guard(dto.idempotencyKey, callerId);
    const key = dto.idempotencyKey;
    const season = currentSeason(now);

    const response = await this.transactions.run(async (tx) => {
      const [caller, opponent] = await Promise.all([
        this.repo.findUserById(callerId, tx),
        this.repo.findUserById(dto.opponentId, tx),
      ]);
      if (!caller) throw AppError.notFound('User not found.');
      if (!opponent) throw AppError.notFound('Opponent not found.');

      for (const userId of [callerId, dto.opponentId]) {
        const existing = await this.repo.findHistoryByEventId(userId, key, tx);
        if (existing) throw AppError.ratingEventDuplicate('This duel was already recorded.');
      }

      const dayStart = startOfUtcDay(now);
      const [callerToday, opponentToday, pairToday] = await Promise.all([
        this.repo.countEventsSince(callerId, dayStart, tx),
        this.repo.countEventsSince(dto.opponentId, dayStart, tx),
        this.repo.countPairTradingDuelsSince(callerId, dto.opponentId, dayStart, tx),
      ]);
      if (callerToday >= RATING_DAILY_EVENT_LIMIT || opponentToday >= RATING_DAILY_EVENT_LIMIT) {
        throw AppError.ratingDailyLimit(
          `Rated events are capped at ${RATING_DAILY_EVENT_LIMIT} per user per day.`
        );
      }
      if (pairToday >= RATING_DUEL_DAILY_PAIR_LIMIT) {
        throw AppError.ratingDailyLimit(
          `The same pair can play at most ${RATING_DUEL_DAILY_PAIR_LIMIT} rated duels per day.`
        );
      }
      const lastDuel = await this.repo.lastPairTradingDuel(callerId, dto.opponentId, tx);
      if (
        lastDuel &&
        now.getTime() - lastDuel.createdAt.getTime() <
          RATING_DUEL_REMATCH_COOLDOWN_MINUTES * MINUTE_MS
      ) {
        throw AppError.ratingDuelCooldown(
          `Wait ${RATING_DUEL_REMATCH_COOLDOWN_MINUTES} minutes before a rematch against the same opponent.`
        );
      }

      const [callerRating, opponentRating] = await Promise.all([
        this.repo.getOrCreateRating(callerId, RatingKind.TRADING, season, caller.countryCode, tx),
        this.repo.getOrCreateRating(
          dto.opponentId,
          RatingKind.TRADING,
          season,
          opponent.countryCode,
          tx
        ),
      ]);

      const callerScore = scoreForResult(dto.result);
      const opponentScore = scoreForResult(mirrorResult(dto.result));
      const callerUpdate = applyUpdate(
        callerRating.rating,
        opponentRating.rating,
        callerScore,
        callerRating.gamesPlayed
      );
      const opponentUpdate = applyUpdate(
        opponentRating.rating,
        callerRating.rating,
        opponentScore,
        opponentRating.gamesPlayed
      );

      const callerSaved = await this.saveRatedRow(
        tx,
        callerRating,
        callerUpdate,
        dto.result,
        caller.countryCode,
        season,
        now
      );
      const opponentSaved = await this.saveRatedRow(
        tx,
        opponentRating,
        opponentUpdate,
        mirrorResult(dto.result),
        opponent.countryCode,
        season,
        now
      );

      await this.repo.createHistory(
        {
          userId: callerId,
          kind: RatingKind.TRADING,
          source: RatingEventSource.DUEL,
          eventId: key,
          opponentId: dto.opponentId,
          opponentRating: opponentRating.rating,
          expectedScore: callerUpdate.expected,
          actualScore: callerScore,
          kFactor: callerUpdate.k,
          delta: callerUpdate.delta,
          ratingBefore: callerRating.rating,
          ratingAfter: callerUpdate.newRating,
          season,
        },
        tx
      );
      await this.repo.createHistory(
        {
          userId: dto.opponentId,
          kind: RatingKind.TRADING,
          source: RatingEventSource.DUEL,
          eventId: key,
          opponentId: callerId,
          opponentRating: callerRating.rating,
          expectedScore: opponentUpdate.expected,
          actualScore: opponentScore,
          kFactor: opponentUpdate.k,
          delta: opponentUpdate.delta,
          ratingBefore: opponentRating.rating,
          ratingAfter: opponentUpdate.newRating,
          season,
        },
        tx
      );

      const result: DuelResponse = {
        eventId: key,
        kind: RatingKind.TRADING,
        result: dto.result,
        me: this.toSideView(callerId, callerRating.rating, callerUpdate, callerSaved),
        opponent: this.toSideView(
          dto.opponentId,
          opponentRating.rating,
          opponentUpdate,
          opponentSaved
        ),
      };
      await this.idempotency.store(key, callerId, result, tx);
      this.logger.info('Rated trading duel recorded', {
        userId: callerId,
        opponentId: dto.opponentId,
        result: dto.result,
        delta: callerUpdate.delta,
      });
      return result;
    });

    await this.syncLeaderboardSafe(
      callerId,
      RatingKind.TRADING,
      response.me.ratingAfter,
      await this.countryOf(callerId)
    );
    await this.syncLeaderboardSafe(
      dto.opponentId,
      RatingKind.TRADING,
      response.opponent.ratingAfter,
      await this.countryOf(dto.opponentId)
    );
    return response;
  }

  /**
   * Records one rated Paper Trading Sprint against the Mira bot
   * (docs/14 §5/§7, ADR 0011 §6) — the trading mirror of
   * recordDuelVsBot. Only the caller updates, with the bot fixed at
   * the caller's own TRADING Rating (expected score 0.5). One history
   * row, kind TRADING, source DUEL, opponentId null. Same guards where
   * they apply: idempotency key `duel:{duelId}`, max 10 rated
   * events/user/day (UTC). No pair limit, no rematch cooldown.
   */
  async recordTradingDuelVsBot(
    userId: string,
    result: DuelResult,
    idempotencyKey: string,
    now: Date = new Date()
  ): Promise<BotDuelResponse> {
    await this.idempotency.guard(idempotencyKey, userId);
    const season = currentSeason(now);

    const response = await this.transactions.run(async (tx) => {
      const user = await this.repo.findUserById(userId, tx);
      if (!user) throw AppError.notFound('User not found.');
      const existing = await this.repo.findHistoryByEventId(userId, idempotencyKey, tx);
      if (existing) throw AppError.ratingEventDuplicate('This duel was already recorded.');

      const dayStart = startOfUtcDay(now);
      const today = await this.repo.countEventsSince(userId, dayStart, tx);
      if (today >= RATING_DAILY_EVENT_LIMIT) {
        throw AppError.ratingDailyLimit(
          `Rated events are capped at ${RATING_DAILY_EVENT_LIMIT} per user per day.`
        );
      }

      const row = await this.repo.getOrCreateRating(
        userId,
        RatingKind.TRADING,
        season,
        user.countryCode,
        tx
      );
      const score = scoreForResult(result);
      const update = applyUpdate(row.rating, row.rating, score, row.gamesPlayed);
      const saved = await this.saveRatedRow(tx, row, update, result, user.countryCode, season, now);
      await this.repo.createHistory(
        {
          userId,
          kind: RatingKind.TRADING,
          source: RatingEventSource.DUEL,
          eventId: idempotencyKey,
          opponentId: null,
          opponentRating: row.rating,
          expectedScore: update.expected,
          actualScore: score,
          kFactor: update.k,
          delta: update.delta,
          ratingBefore: row.rating,
          ratingAfter: update.newRating,
          season,
        },
        tx
      );

      const out: BotDuelResponse = {
        eventId: idempotencyKey,
        kind: RatingKind.TRADING,
        result,
        me: this.toSideView(userId, row.rating, update, saved),
        botRating: row.rating,
      };
      await this.idempotency.store(idempotencyKey, userId, out, tx);
      this.logger.info('Rated trading duel vs bot recorded', {
        userId,
        result,
        delta: update.delta,
      });
      return out;
    });

    await this.syncLeaderboardSafe(
      userId,
      RatingKind.TRADING,
      response.me.ratingAfter,
      await this.countryOf(userId)
    );
    return response;
  }

  /**
   * Recovers the stored outcome of a rated duel by its idempotency key
   * (ADR 0006/7 — the duels module's crash-recovery path: when a
   * settlement retry finds the rating already applied, it reads the
   * deltas back from history instead of applying them twice).
   * Returns null when no history row exists for this user + key.
   */
  async getDuelOutcome(
    userId: string,
    eventId: string,
    kind: RatingKind = RatingKind.LEARNING
  ): Promise<DuelOutcomeView | null> {
    const mine = await this.repo.findHistoryByEventId(userId, eventId);
    if (!mine) return null;
    const myRow = await this.repo.findRating(userId, kind);
    const me: DuelSideView = {
      userId,
      ratingBefore: mine.ratingBefore,
      ratingAfter: mine.ratingAfter,
      delta: mine.delta,
      tier: tierFor(mine.ratingAfter),
      provisional: myRow ? myRow.provisional : true,
      gamesPlayed: myRow ? myRow.gamesPlayed : 0,
    };
    let opponent: DuelSideView | null = null;
    if (mine.opponentId) {
      const theirs = await this.repo.findHistoryByEventId(mine.opponentId, eventId);
      const theirRow = await this.repo.findRating(mine.opponentId, kind);
      if (theirs) {
        opponent = {
          userId: mine.opponentId,
          ratingBefore: theirs.ratingBefore,
          ratingAfter: theirs.ratingAfter,
          delta: theirs.delta,
          tier: tierFor(theirs.ratingAfter),
          provisional: theirRow ? theirRow.provisional : true,
          gamesPlayed: theirRow ? theirRow.gamesPlayed : 0,
        };
      }
    }
    return { eventId, me, opponent };
  }

  // --- trading weeks (Trading, weekly seasons only) ------------------------------

  /**
   * Records one user's weekly trading rating against the simulated
   * index (fixed at 1200). The caller supplies the numbers — the
   * Ratings module never reads the simulator (ADR 0005/7).
   *
   * Fewer than 3 trades = unrated week: no change, applied:false, and
   * the key is NOT consumed, so a corrected resubmission can still rate
   * the week. One rated update per user per week, enforced by the
   * weekStart lookup as well as the idempotency key.
   */
  async recordTradingWeek(
    adminId: string,
    dto: RecordTradingWeekDto,
    now: Date = new Date()
  ): Promise<TradingWeekResponse> {
    await this.idempotency.guard(dto.idempotencyKey, dto.userId);
    const weekStart = mondayOfWeek(new Date(dto.weekStart));
    const season = currentSeason(now);

    const response = await this.transactions.run(async (tx) => {
      const user = await this.repo.findUserById(dto.userId, tx);
      if (!user) throw AppError.notFound('User not found.');

      const existingWeek = await this.repo.findTradingWeek(dto.userId, weekStart, tx);
      if (existingWeek) {
        throw AppError.ratingEventDuplicate(
          'This user already has a trading rating for that week.'
        );
      }
      const existingKey = await this.repo.findHistoryByEventId(dto.userId, dto.idempotencyKey, tx);
      if (existingKey) {
        throw AppError.ratingEventDuplicate('This trading-week event was already recorded.');
      }

      if (dto.tradeCount < RATING_TRADING_MIN_TRADES) {
        return {
          applied: false,
          userId: dto.userId,
          weekStart: isoDate(weekStart),
          tradeCount: dto.tradeCount,
          reason: 'MIN_TRADES_NOT_MET',
        } satisfies TradingWeekResponse;
      }

      const score = tradingScore(dto.portfolioReturnPct, dto.indexReturnPct);
      const row = await this.repo.getOrCreateRating(
        dto.userId,
        RatingKind.TRADING,
        season,
        user.countryCode,
        tx
      );
      const update = applyUpdate(row.rating, INDEX_OPPONENT_RATING, score, row.gamesPlayed);
      const resultLabel: DuelResult = score === 1 ? 'WIN' : score === 0 ? 'LOSS' : 'DRAW';
      const saved = await this.saveRatedRow(
        tx,
        row,
        update,
        resultLabel,
        user.countryCode,
        season,
        now
      );
      await this.repo.createHistory(
        {
          userId: dto.userId,
          kind: RatingKind.TRADING,
          source: RatingEventSource.TRADING_WEEK,
          eventId: dto.idempotencyKey,
          opponentId: null,
          opponentRating: INDEX_OPPONENT_RATING,
          expectedScore: update.expected,
          actualScore: score,
          kFactor: update.k,
          delta: update.delta,
          ratingBefore: row.rating,
          ratingAfter: update.newRating,
          season,
          weekStart,
        },
        tx
      );

      const result: TradingWeekResponse = {
        applied: true,
        userId: dto.userId,
        weekStart: isoDate(weekStart),
        tradeCount: dto.tradeCount,
        score: resultLabel,
        ratingBefore: row.rating,
        ratingAfter: update.newRating,
        delta: update.delta,
        tier: tierFor(update.newRating),
        provisional: saved.provisional,
        gamesPlayed: saved.gamesPlayed,
      };
      await this.idempotency.store(dto.idempotencyKey, dto.userId, result, tx);
      this.logger.info('Trading week rated', {
        adminId,
        userId: dto.userId,
        weekStart: isoDate(weekStart),
        score: resultLabel,
        delta: update.delta,
      });
      return result;
    });

    if (response.applied && response.ratingAfter !== undefined) {
      await this.syncLeaderboardSafe(
        dto.userId,
        RatingKind.TRADING,
        response.ratingAfter,
        await this.countryOf(dto.userId)
      );
    }
    return response;
  }

  // --- seasons ---------------------------------------------------------------------

  /**
   * Quarterly soft reset (docs/04 §6): every rating moves halfway
   * toward 1000. Idempotent per season: a rating with a reset history
   * row for this season is skipped, so re-running the endpoint never
   * double-resets. Ratings already at 1000 are no-ops (skipped).
   * Decay is NOT applied here; lastRatedAt is untouched — a reset is
   * not a rated event.
   */
  async seasonReset(
    adminId: string,
    dto: SeasonResetDto,
    now: Date = new Date()
  ): Promise<SeasonResetResponse> {
    const season = dto.season ?? currentSeason(now);
    const rows = await this.repo.listAllRatings();
    let updated = 0;
    let skipped = 0;
    const synced: Array<{ userId: string; kind: RatingKind; rating: number }> = [];

    await this.transactions.run(async (tx) => {
      for (const row of rows) {
        const eventId = `season-reset:${season}:${row.kind}`;
        const existing = await this.repo.findHistoryByEventId(row.userId, eventId, tx);
        const newRating = softReset(row.rating);
        if (existing || newRating === row.rating) {
          skipped += 1;
          continue;
        }
        await this.repo.saveRating(
          row.userId,
          row.kind,
          {
            rating: newRating,
            gamesPlayed: row.gamesPlayed,
            wins: row.wins,
            draws: row.draws,
            losses: row.losses,
            provisional: row.provisional,
            lastRatedAt: row.lastRatedAt,
            season,
            countryCode: row.countryCode,
          },
          tx
        );
        await this.repo.createHistory(
          {
            userId: row.userId,
            kind: row.kind,
            source: RatingEventSource.SEASON_RESET,
            eventId,
            opponentId: null,
            opponentRating: null,
            expectedScore: 0,
            actualScore: 0,
            kFactor: 0,
            delta: round1(newRating - row.rating),
            ratingBefore: row.rating,
            ratingAfter: newRating,
            season,
          },
          tx
        );
        updated += 1;
        synced.push({ userId: row.userId, kind: row.kind, rating: newRating });
      }
    });

    this.logger.info('Season reset applied', { adminId, season, updated, skipped });
    for (const s of synced) {
      await this.syncLeaderboardSafe(s.userId, s.kind, s.rating, await this.countryOf(s.userId));
    }
    return { season, updated, skipped };
  }

  // --- inactivity decay -------------------------------------------------------------

  /**
   * Inactivity decay (docs/04 §5): after 30 days with no rated event
   * in a rating, it drifts toward 1000 (10/week past the grace, max 50
   * per run, never below the floor). One decay per user/kind/week —
   * the history eventId carries the week, so re-running in the same
   * week is a no-op. Decay never touches lastRatedAt: it is not a
   * rated event, and moving it would hide the inactivity.
   */
  async runDecay(adminId: string, dto: DecayDto, now: Date = new Date()): Promise<DecayResponse> {
    const asOf = dto.asOf ? new Date(dto.asOf) : now;
    const weekStart = mondayOfWeek(asOf);
    const season = currentSeason(asOf);
    const rows = await this.repo.listAllRatings();
    const applied: DecayApplied[] = [];
    let skipped = 0;

    await this.transactions.run(async (tx) => {
      for (const row of rows) {
        if (!row.lastRatedAt) {
          skipped += 1;
          continue;
        }
        const daysInactive = Math.floor((asOf.getTime() - row.lastRatedAt.getTime()) / DAY_MS);
        const { delta, newRating } = decayFor(row.rating, daysInactive);
        const eventId = `decay:${row.kind}:${isoDate(weekStart)}`;
        if (delta === 0) {
          skipped += 1;
          continue;
        }
        const existing = await this.repo.findHistoryByEventId(row.userId, eventId, tx);
        if (existing) {
          skipped += 1;
          continue;
        }
        await this.repo.saveRating(
          row.userId,
          row.kind,
          {
            rating: newRating,
            gamesPlayed: row.gamesPlayed,
            wins: row.wins,
            draws: row.draws,
            losses: row.losses,
            provisional: row.provisional,
            lastRatedAt: row.lastRatedAt,
            season: row.season,
            countryCode: row.countryCode,
          },
          tx
        );
        await this.repo.createHistory(
          {
            userId: row.userId,
            kind: row.kind,
            source: RatingEventSource.DECAY,
            eventId,
            opponentId: null,
            opponentRating: null,
            expectedScore: 0,
            actualScore: 0,
            kFactor: 0,
            delta,
            ratingBefore: row.rating,
            ratingAfter: newRating,
            season,
            weekStart,
          },
          tx
        );
        applied.push({
          userId: row.userId,
          kind: row.kind,
          ratingBefore: row.rating,
          ratingAfter: newRating,
          delta,
        });
      }
    });

    this.logger.info('Decay run applied', {
      adminId,
      weekStart: isoDate(weekStart),
      applied: applied.length,
      skipped,
    });
    for (const a of applied) {
      await this.syncLeaderboardSafe(
        a.userId,
        a.kind,
        a.ratingAfter,
        await this.countryOf(a.userId)
      );
    }
    return { asOf: asOf.toISOString(), weekStart: isoDate(weekStart), applied, skipped };
  }

  // --- reads --------------------------------------------------------------------------

  /** My ratings (or any user's, via getUserRatings): defaults when unrated. */
  async getMyRatings(userId: string, now: Date = new Date()): Promise<RatingsOverview> {
    return this.getUserRatings(userId, now);
  }

  async getUserRatings(userId: string, now: Date = new Date()): Promise<RatingsOverview> {
    const user = await this.repo.findUserById(userId);
    if (!user) throw AppError.notFound('User not found.');
    const season = currentSeason(now);
    const [learning, trading] = await Promise.all([
      this.toView(userId, RatingKind.LEARNING, season, user.countryCode),
      this.toView(userId, RatingKind.TRADING, season, user.countryCode),
    ]);
    const candle = candleRating(learning.rating, trading.rating);
    return {
      userId,
      displayName: user.displayName,
      countryCode: user.countryCode,
      learning,
      trading,
      candleRating: candle,
      candleDisplayRating: displayRating(candle),
      candleTier: tierFor(candle),
    };
  }

  async listHistory(
    userId: string,
    page: number,
    limit: number,
    kind?: RatingKind
  ): Promise<{ items: HistoryItemView[]; meta: ReturnType<typeof buildPaginationMeta> }> {
    const [total, rows] = await Promise.all([
      this.repo.countHistory(userId, kind),
      this.repo.listHistory(userId, kind, (page - 1) * limit, limit),
    ]);
    return {
      items: rows.map((r) => this.toHistoryView(r)),
      meta: buildPaginationMeta(page, limit, total),
    };
  }

  /**
   * Public leaderboard, top 100 per scope. Redis is read first; when a
   * set is empty it is rebuilt from Postgres (the source of truth) and
   * re-read, so a cold cache never serves an empty board. Only display
   * names and tiers are exposed — never email, phone, or holdings.
   */
  async getLeaderboard(query: LeaderboardQueryDto): Promise<LeaderboardResponse> {
    const kind = query.kind ?? RatingKind.LEARNING;
    const scope = query.scope ?? 'global';
    if (scope === 'country' && !query.country) {
      throw AppError.validationFailed([
        { field: 'country', issue: 'country is required when scope=country.' },
      ]);
    }
    const country: string | null = scope === 'country' ? (query.country ?? null) : null;
    const limit = Math.min(query.limit ?? RATING_LEADERBOARD_TOP, RATING_LEADERBOARD_TOP);
    const key = leaderboardKey(kind, scope, country ?? undefined);

    let total = await this.redis.zcard(key);
    if (total === 0) {
      await this.rebuildLeaderboards(kind);
      total = await this.redis.zcard(key);
    }
    const raw = await this.redis.zrevrange(key, 0, limit - 1);
    const ids: string[] = [];
    const scores = new Map<string, number>();
    for (let i = 0; i < raw.length; i += 2) {
      const member = raw[i];
      const score = raw[i + 1];
      if (member === undefined || score === undefined) continue;
      ids.push(member);
      scores.set(member, Number(score));
    }
    const [ratingRows, users] = await Promise.all([
      this.repo.findRatingsByUserIds(kind, ids),
      this.repo.findUsersByIds(ids),
    ]);
    const ratingById = new Map(ratingRows.map((r) => [r.userId, r]));
    const userById = new Map(users.map((u) => [u.id, u]));
    const entries: LeaderboardEntry[] = ids.map((id, i) => {
      const rank = i + 1;
      const row = ratingById.get(id);
      const rating = scores.get(id) ?? row?.rating ?? RATING_START;
      return {
        rank,
        userId: id,
        displayName: userById.get(id)?.displayName ?? null,
        rating,
        displayRating: displayRating(rating),
        tier: tierFor(rating),
        provisional: row ? row.provisional : true,
        percentile: total > 0 ? round1(((total - rank) / total) * 100) : 0,
      };
    });
    return { kind, scope, country, total, entries };
  }

  /** Rebuilds leaderboard sets for a kind from Postgres (source of truth). */
  async rebuildLeaderboards(kind?: RatingKind): Promise<void> {
    const rows = await this.repo.listAllRatings(kind);
    for (const row of rows) {
      await this.redis.zadd(leaderboardKey(row.kind, 'global'), row.rating, row.userId);
      if (row.countryCode) {
        await this.redis.zadd(
          leaderboardKey(row.kind, 'country', row.countryCode),
          row.rating,
          row.userId
        );
      }
    }
  }

  /**
   * Keeps the denormalised countryCode on rating rows truthful when a
   * user changes country (called from UsersService). Also moves the
   * user's leaderboard membership to the new national set.
   */
  async syncCountry(
    userId: string,
    newCountryCode: string | null,
    oldCountryCode?: string | null
  ): Promise<void> {
    await this.repo.updateCountryForUser(userId, newCountryCode);
    for (const kind of [RatingKind.LEARNING, RatingKind.TRADING]) {
      const rows = await this.repo.findRatingsByUserIds(kind, [userId]);
      const row = rows[0];
      if (!row) continue;
      if (oldCountryCode && oldCountryCode !== newCountryCode) {
        await this.redis.zrem(leaderboardKey(kind, 'country', oldCountryCode), userId);
      }
      if (newCountryCode) {
        await this.redis.zadd(leaderboardKey(kind, 'country', newCountryCode), row.rating, userId);
      }
    }
  }

  // --- helpers -------------------------------------------------------------------------

  private async saveRatedRow(
    tx: TxClient,
    row: UserRatingRow,
    update: { k: number; expected: number; delta: number; newRating: number },
    result: DuelResult,
    countryCode: string | null,
    season: string,
    now: Date
  ): Promise<UserRatingRow> {
    const gamesPlayed = row.gamesPlayed + 1;
    return this.repo.saveRating(
      row.userId,
      row.kind,
      {
        rating: update.newRating,
        gamesPlayed,
        wins: row.wins + (result === 'WIN' ? 1 : 0),
        draws: row.draws + (result === 'DRAW' ? 1 : 0),
        losses: row.losses + (result === 'LOSS' ? 1 : 0),
        provisional: gamesPlayed < RATING_PROVISIONAL_EVENTS,
        lastRatedAt: now,
        season,
        countryCode,
      },
      tx
    );
  }

  private toSideView(
    userId: string,
    ratingBefore: number,
    update: { delta: number; newRating: number },
    saved: UserRatingRow
  ): DuelSideView {
    return {
      userId,
      ratingBefore,
      ratingAfter: update.newRating,
      delta: update.delta,
      tier: tierFor(update.newRating),
      provisional: saved.provisional,
      gamesPlayed: saved.gamesPlayed,
    };
  }

  private async toView(
    userId: string,
    kind: RatingKind,
    season: string,
    countryCode: string | null
  ): Promise<RatingView> {
    const row = await this.repo.findRating(userId, kind);
    const rating = row?.rating ?? RATING_START;
    const [globalRank, countryRank] = await Promise.all([
      this.rankIn(leaderboardKey(kind, 'global'), userId),
      countryCode
        ? this.rankIn(leaderboardKey(kind, 'country', countryCode), userId)
        : Promise.resolve(null),
    ]);
    return {
      kind,
      rating,
      displayRating: displayRating(rating),
      tier: tierFor(rating),
      provisional: row?.provisional ?? true,
      gamesPlayed: row?.gamesPlayed ?? 0,
      wins: row?.wins ?? 0,
      draws: row?.draws ?? 0,
      losses: row?.losses ?? 0,
      lastRatedAt: row?.lastRatedAt ?? null,
      season: row?.season ?? season,
      countryCode: row?.countryCode ?? countryCode,
      globalRank: globalRank?.rank ?? null,
      globalPercentile: globalRank?.percentile ?? null,
      countryRank: countryRank?.rank ?? null,
      countryPercentile: countryRank?.percentile ?? null,
    };
  }

  private async rankIn(
    key: string,
    userId: string
  ): Promise<{ rank: number; percentile: number } | null> {
    const [rank0, total] = await Promise.all([
      this.redis.zrevrank(key, userId),
      this.redis.zcard(key),
    ]);
    if (rank0 === null || total === 0) return null;
    const rank = rank0 + 1;
    return { rank, percentile: round1(((total - rank) / total) * 100) };
  }

  private async countryOf(userId: string): Promise<string | null> {
    const user = await this.repo.findUserById(userId);
    return user?.countryCode ?? null;
  }

  /** Leaderboard sync that never fails the request (see recordDuel). */
  private async syncLeaderboardSafe(
    userId: string,
    kind: RatingKind,
    rating: number,
    countryCode: string | null
  ): Promise<void> {
    try {
      await this.redis.zadd(leaderboardKey(kind, 'global'), rating, userId);
      if (countryCode) {
        await this.redis.zadd(leaderboardKey(kind, 'country', countryCode), rating, userId);
      }
    } catch (err) {
      this.logger.error('Leaderboard sync failed', {
        userId,
        kind,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private toHistoryView(r: RatingHistoryRow): HistoryItemView {
    return {
      id: r.id,
      kind: r.kind,
      source: r.source,
      eventId: r.eventId,
      opponentId: r.opponentId,
      opponentRating: r.opponentRating,
      expectedScore: r.expectedScore,
      actualScore: r.actualScore,
      kFactor: r.kFactor,
      delta: r.delta,
      ratingBefore: r.ratingBefore,
      ratingAfter: r.ratingAfter,
      season: r.season,
      weekStart: r.weekStart,
      createdAt: r.createdAt,
    };
  }
}
