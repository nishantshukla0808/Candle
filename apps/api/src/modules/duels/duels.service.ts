import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DuelBankQuestionType, DuelStatus, DuelType, Prisma } from '@prisma/client';
import { DUELS, ErrorCode } from '@candle/shared';
import { AppError } from '../../common/errors/app-error';
import { AppLogger } from '../../common/services/logger.service';
import { TransactionService } from '../../database/transaction.service';
import type { TxClient } from '../../database/tx-client';
import { buildPaginationMeta } from '../../common/utils/pagination';
import type { PublicQuestionView } from '../question-bank/question-bank.service';
import { QuestionBankService } from '../question-bank/question-bank.service';
import type { BankItemRow } from '../question-bank/question-bank.repository';
import type { RewardSummary } from '../gamification/gamification.service';
import { GamificationService } from '../gamification/gamification.service';
import type { DuelResponse } from '../ratings/ratings.service';
import { DuelResult } from '../ratings/dto/ratings.dto';
import { RatingsService } from '../ratings/ratings.service';
import { botBaseAccuracy, mulberry32, hashSeed, simulateBot } from './bot-simulation';
import { istDayStartUtc, isValidIstDate, kolkataDateString } from './duel-dates';
import {
  buildGameStats,
  decideWinner,
  mirrorOutcome,
  pointsForAnswer,
  type ChartStatWithAnnotation,
  type DuelOutcome as Outcome,
  type GameStats,
} from './duel-scoring';
import type { AnswerDuelDto, SettleUnpairedDto } from './dto/duels.dto';
import {
  DuelsRepository,
  type DuelAnswerRow,
  type DuelGameResultRow,
  type DuelRow,
} from './duels.repository';

/**
 * Carried on every duel endpoint's OpenAPI docs
 * (blueprint §16 — the disclaimer lives in the product, not just docs).
 */
export const DUELS_DISCLAIMER =
  'Educational purpose only — this is not investment advice. ' +
  'All questions are original Candle content. All companies, tickers, ' +
  'and numbers are fictional illustrations.';

export type DuelQuestionView = PublicQuestionView;

export interface StartDuelResponse {
  duelId: string;
  type: DuelType;
  /** IST date for DAILY duels; null for BOT. */
  date: string | null;
  questions: DuelQuestionView[];
  opponent: { name: string; kind: 'BOT' | 'HUMAN'; baseAccuracy?: number };
  startedAt: Date;
}

export interface AnswerResponse {
  duelId: string;
  questionId: string;
  answeredCount: number;
  totalQuestions: number;
  nextQuestionId: string | null;
}

export interface WaitingResponse {
  duelId: string;
  type: DuelType;
  status: 'WAITING_OPPONENT';
  myScore: number;
  myCorrect: number;
  myTotalTimeMs: number;
  totalQuestions: number;
  message: string;
}

export interface OpponentSummary {
  name: string;
  kind: 'BOT' | 'HUMAN';
  score: number | null;
  correct: number | null;
}

export interface DuelResultView {
  duelId: string;
  type: DuelType;
  status: 'SETTLED';
  result: Outcome;
  score: number;
  opponent: OpponentSummary;
  correct: number;
  wrong: number;
  skipped: number;
  accuracy: number;
  avgTimeMs: number | null;
  fastestTimeMs: number | null;
  slowestTimeMs: number | null;
  bestStreak: number;
  perTopic: GameStats['perTopic'];
  perQuestion: GameStats['perQuestion'];
  ratingBefore: number | null;
  ratingAfter: number | null;
  ratingDelta: number | null;
  ratingReason: string;
  xp: {
    awarded: number;
    totalXp: number;
    level: number;
    levelUp: boolean;
    currentStreak: number;
    newBadges: Array<{ slug: string; name: string }>;
  };
  finishedAt: Date | null;
}

export interface DailyTodayResponse {
  date: string;
  questionCount: number;
  setReady: boolean;
  myDuel: { duelId: string; status: DuelStatus } | null;
}

export interface DuelHistoryItem {
  duelId: string;
  type: DuelType;
  status: DuelStatus;
  date: string | null;
  startedAt: Date;
  finishedAt: Date | null;
  result: Outcome | null;
  myScore: number | null;
  opponentScore: number | null;
  opponentName: string | null;
  ratingDelta: number | null;
}

export interface SettleUnpairedResponse {
  date: string;
  settled: number;
  failed: Array<{ duelId: string; reason: string }>;
}

const BOT_BLUEPRINT = {
  count: DUELS.BOT_QUESTION_COUNT,
  difficultyMix: DUELS.BOT_DIFFICULTY_MIX as unknown as Record<number, number>,
  // MCQ_4 + TRUE_FALSE only (doc 08 §4): CASE_CHOICE has its own 45 s
  // timer and rubric reveal, and CHART_CHOICE its own 30 s timer and
  // annotation reveal — neither belongs in a Bot/Daily duel, whose
  // format is the 15 s Speed Quiz one.
  types: [...DUELS.LIVE_TYPES] as DuelBankQuestionType[],
  maxPerTopic: DUELS.MAX_PER_TOPIC,
};
const DAILY_BLUEPRINT = {
  count: DUELS.DAILY_QUESTION_COUNT,
  difficultyMix: DUELS.DAILY_DIFFICULTY_MIX as unknown as Record<number, number>,
  // Same format guard as BOT_BLUEPRINT above.
  types: [...DUELS.LIVE_TYPES] as DuelBankQuestionType[],
  maxPerTopic: DUELS.MAX_PER_TOPIC,
};

function questionIdsOf(duel: DuelRow): string[] {
  const ids = duel.questionIds as unknown;
  if (!Array.isArray(ids) || ids.some((i) => typeof i !== 'string')) {
    throw new Error(`Duel ${duel.id} has a malformed question set.`);
  }
  return ids as string[];
}

/** Plain-words Rating reason, shared with the live duel settlement (docs/09). */
export function ratingReasonFor(
  result: Outcome,
  opponentName: string,
  opponentRating: number | null,
  delta: number | null
): string {
  const deltaText =
    delta === null
      ? ''
      : delta > 0
        ? ` Your Learning Rating went up by ${delta}.`
        : delta < 0
          ? ` Your Learning Rating went down by ${Math.abs(delta)}.`
          : ' Your Learning Rating did not change.';
  const rated = opponentRating === null ? '' : ` (rated ${Math.round(opponentRating)})`;
  if (result === 'WIN') return `You beat ${opponentName}${rated}.${deltaText}`;
  if (result === 'DRAW') return `You drew with ${opponentName}${rated}.${deltaText}`;
  return `${opponentName}${rated} beat you.${deltaText}`;
}

function xpView(rewards: RewardSummary): DuelResultView['xp'] {
  return {
    awarded: rewards.xpAwarded,
    totalXp: rewards.totalXp,
    level: rewards.level,
    levelUp: rewards.levelUp,
    currentStreak: rewards.currentStreak,
    newBadges: rewards.newBadges.map((b) => ({ slug: b.slug, name: b.name })),
  };
}

/**
 * DuelsService — docs/05 §1/§7 Step 2, docs/07 (Phase 4).
 *
 * Bot Duel (P1, unrated, vs Mira) + Async Daily Duel (L5, rated, 1 per
 * user per IST day). No live gateway, no matchmaking — those arrive in
 * Step 3. The service owns duel state, timing validation, scoring,
 * pairing, settlement, and post-game stats; Ratings owns the rating
 * (called exactly once per rated duel, ADR 0006/7) and Gamification
 * owns XP/streaks (grantDuelRewards, ADR 0006/8).
 *
 * Two-transaction settlement, documented honestly (ADR 0006/7):
 * RatingsService.recordDuel owns its own transaction and accepts no
 * tx, so settlement calls it FIRST (nothing mutated yet — a cap
 * failure fails cleanly), then stores results + XP in the duels
 * transaction. A crash between the two is recovered by re-calling
 * finish: the duplicate is detected (IDEMPOTENCY_REPLAY with the
 * original, or RATING_EVENT_DUPLICATE) and the deltas are read back
 * from history via RatingsService.getDuelOutcome.
 */
@Injectable()
export class DuelsService {
  constructor(
    private readonly repo: DuelsRepository,
    private readonly bank: QuestionBankService,
    private readonly ratings: RatingsService,
    private readonly gamification: GamificationService,
    private readonly transactions: TransactionService,
    private readonly logger: AppLogger
  ) {}

  // --- Bot Duel (P1, unrated) -------------------------------------------------

  /**
   * Starts a Bot Duel: 7 questions (2 easy + 3 medium + 2 hard),
   * selected for the caller with the bank's exposure rules, against
   * Mira at a base accuracy matched to the caller's Learning Rating.
   * Capped at 10 starts per user per IST day. The bot seed is stored
   * on the duel so the bot result is replayable.
   */
  async startBot(userId: string, now: Date = new Date()): Promise<StartDuelResponse> {
    const started = await this.repo.countBotStartedSince(userId, istDayStartUtc(now));
    if (started >= DUELS.BOT_DAILY_LIMIT) {
      throw AppError.duelBotDailyLimit(`Bot Duels are capped at ${DUELS.BOT_DAILY_LIMIT} per day.`);
    }
    const rating = (await this.ratings.getUserRatings(userId)).learning.rating;
    const questions = await this.bank.selectSet([userId], BOT_BLUEPRINT, { now });
    const ids = questions.map((q) => q.id);
    // Exposure is recorded before the duel row is created: if the
    // create then fails, the user merely "saw" items they never
    // played (conservative — selection will avoid them), whereas the
    // reverse order could start a duel whose exposure was never
    // recorded. The bank service has no tx to join here.
    await this.bank.recordExposure(userId, ids, now);
    const duel = await this.repo.createDuel({
      type: DuelType.BOT,
      playerAId: userId,
      questionIds: ids,
      seed: randomUUID(),
    });
    return {
      duelId: duel.id,
      type: DuelType.BOT,
      date: null,
      questions,
      opponent: { name: DUELS.BOT_NAME, kind: 'BOT', baseAccuracy: botBaseAccuracy(rating) },
      startedAt: duel.startedAt,
    };
  }

  async answerBot(userId: string, duelId: string, dto: AnswerDuelDto): Promise<AnswerResponse> {
    return this.answer(userId, duelId, dto, DuelType.BOT);
  }

  /**
   * Finishes a Bot Duel: unanswered questions become skips, Mira is
   * simulated from the stored seed, XP/streaks are granted, and the
   * post-game stats are stored — all in one transaction. No Rating
   * change ever. Re-finishing a settled duel replays the stored
   * result (never double-applies XP — the ledger key is unique).
   */
  async finishBot(userId: string, duelId: string, now: Date = new Date()): Promise<DuelResultView> {
    const duel = await this.requireOwnedDuel(userId, duelId, DuelType.BOT);
    if (duel.status === DuelStatus.SETTLED) {
      return this.storedResultView(userId, duel);
    }
    if (duel.status !== DuelStatus.IN_PROGRESS) {
      throw AppError.duelNotInProgress('This Bot Duel is not in progress any more.');
    }

    const rating = (await this.ratings.getUserRatings(userId)).learning.rating;
    const items = await this.bank.getItemsForGrading(questionIdsOf(duel));
    const result = await this.transactions.run(async (tx) => {
      const stats = await this.gradeAndSkip(userId, duel, items, tx);
      const bot = simulateBot(
        duel.seed,
        items.map((i) => ({ id: i.id, difficulty: i.difficulty })),
        rating
      );
      const outcome = decideWinner(
        { correct: stats.correct, totalTimeMs: stats.totalTimeMs },
        { correct: bot.correctCount, totalTimeMs: bot.totalTimeMs }
      );
      const rewards = await this.gamification.grantDuelRewards(tx, {
        userId,
        result: outcome,
        reason: 'duel.bot_completed',
        xpIdempotencyKey: `duel:${duel.id}:${userId}`,
        atIso: now.toISOString(),
      });
      await this.repo.updateDuel(
        duel.id,
        {
          status: DuelStatus.SETTLED,
          finishedAt: now,
          winnerId: outcome === 'WIN' ? userId : null,
          botScore: bot.score,
          botCorrect: bot.correctCount,
          botTotalTimeMs: bot.totalTimeMs,
        },
        tx
      );
      const stored = await this.repo.createGameResult(
        {
          duelId: duel.id,
          userId,
          result: outcome,
          score: stats.score,
          correct: stats.correct,
          wrong: stats.wrong,
          skipped: stats.skipped,
          accuracy: stats.accuracy,
          avgTimeMs: stats.avgTimeMs,
          fastestTimeMs: stats.fastestTimeMs,
          slowestTimeMs: stats.slowestTimeMs,
          bestStreak: stats.bestStreak,
          perTopic: stats.perTopic as unknown as Prisma.InputJsonValue,
          perQuestion: stats.perQuestion as unknown as Prisma.InputJsonValue,
          ratingBefore: null,
          ratingAfter: null,
          ratingDelta: null,
          ratingReason: 'no Rating change — practice',
          xpAwarded: rewards.xpAwarded,
          xpBreakdown: {
            result: outcome,
            reason: 'duel.bot_completed',
            rewards,
          } as unknown as Prisma.InputJsonValue,
        },
        tx
      );
      return { stored, bot };
    });

    this.logger.info('Bot Duel finished', {
      userId,
      duelId: duel.id,
      result: result.stored.result,
      score: result.stored.score,
    });
    const settledDuel: DuelRow = {
      ...duel,
      status: DuelStatus.SETTLED,
      finishedAt: now,
      winnerId: result.stored.result === 'WIN' ? userId : null,
      botScore: result.bot.score,
      botCorrect: result.bot.correctCount,
      botTotalTimeMs: result.bot.totalTimeMs,
    };
    return this.toResultView(userId, settledDuel, result.stored, {
      name: DUELS.BOT_NAME,
      kind: 'BOT',
      score: result.bot.score,
      correct: result.bot.correctCount,
    });
  }

  // --- Async Daily Duel (L5, rated, 1/day IST) ----------------------------------

  /**
   * Today's Daily Duel (no questions — the set is only revealed by
   * starting). Generates the day's fixed set on first read, so the
   * set exists before anyone plays.
   */
  async getDailyToday(userId: string, now: Date = new Date()): Promise<DailyTodayResponse> {
    const date = kolkataDateString(now);
    await this.getOrCreateDailySet(date, now);
    const mine = await this.repo.findDailyDuelForUser(userId, date);
    return {
      date,
      questionCount: DUELS.DAILY_QUESTION_COUNT,
      setReady: true,
      myDuel: mine ? { duelId: mine.id, status: mine.status } : null,
    };
  }

  /**
   * Starts today's Daily Duel: the fixed 5-question set for the IST
   * date, same set and same order for every player that day. One per
   * user per IST day — a second start is 409 (the in-progress duel is
   * resumed via GET /duels/daily/today, not by starting again).
   */
  async startDaily(userId: string, now: Date = new Date()): Promise<StartDuelResponse> {
    const date = kolkataDateString(now);
    const existing = await this.repo.findDailyDuelForUser(userId, date);
    if (existing) {
      throw AppError.duelDailyAlreadyPlayed(
        'You have already played today’s Daily Duel. Come back tomorrow.'
      );
    }
    const set = await this.getOrCreateDailySet(date, now);
    const items = await this.bank.getItemsForGrading(questionIdsOfSet(set));
    const questions = toPublicViews(items, mulberry32(hashSeed(`daily-${date}`)));
    const ids = questions.map((q) => q.id);
    await this.bank.recordExposure(userId, ids, now);
    const duel = await this.repo.createDuel({
      type: DuelType.DAILY,
      playerAId: userId,
      dailyDate: date,
      dailySetId: set.id,
      questionIds: ids,
      seed: set.seed,
    });
    return {
      duelId: duel.id,
      type: DuelType.DAILY,
      date,
      questions,
      opponent: { name: 'To be paired', kind: 'HUMAN' },
      startedAt: duel.startedAt,
    };
  }

  async answerDaily(userId: string, duelId: string, dto: AnswerDuelDto): Promise<AnswerResponse> {
    return this.answer(userId, duelId, dto, DuelType.DAILY);
  }

  /**
   * Finishes a Daily Duel. Flow:
   * - IN_PROGRESS → grade (rest become skips), mark WAITING_OPPONENT.
   * - WAITING_OPPONENT → attempt pairing (also the retry path when a
   *   previous settlement failed on a Ratings cap).
   * - SETTLED → replay the stored result.
   * When a waiting opponent exists, the pair settles immediately
   * (ADR 0006/7): Ratings first (clean 409 on a cap violation, nothing
   * mutated), then results + XP in one transaction.
   */
  async finishDaily(
    userId: string,
    duelId: string,
    now: Date = new Date()
  ): Promise<DuelResultView | WaitingResponse> {
    const duel = await this.requireOwnedDuel(userId, duelId, DuelType.DAILY);
    if (duel.status === DuelStatus.SETTLED) {
      return this.storedResultView(userId, duel);
    }
    if (duel.status === DuelStatus.IN_PROGRESS) {
      const items = await this.bank.getItemsForGrading(questionIdsOf(duel));
      await this.transactions.run(async (tx) => {
        await this.gradeAndSkip(userId, duel, items, tx);
        await this.repo.updateDuel(
          duel.id,
          { status: DuelStatus.WAITING_OPPONENT, finishedAt: now },
          tx
        );
      });
    }
    const waiter = await this.repo.findWaitingDailyDuel(duel.dailyDate as string, duel.id);
    if (!waiter) {
      const stats = await this.myStats(userId, duel);
      return {
        duelId: duel.id,
        type: DuelType.DAILY,
        status: 'WAITING_OPPONENT',
        myScore: stats.score,
        myCorrect: stats.correct,
        myTotalTimeMs: stats.totalTimeMs,
        totalQuestions: questionIdsOf(duel).length,
        message:
          'Finished. Waiting for another player to finish today’s set — your result will appear when you are paired.',
      };
    }
    return this.settlePair(duel, waiter, now);
  }

  /**
   * ADMIN: settles every unpaired Daily Duel for an IST date against
   * the Mira bot at each player's own Rating (ADR 0006/7). Only run
   * for a date whose day has ended (23:59 IST) — settling early would
   * pair players against the bot while others may still join. One
   * failure (e.g. a Ratings daily cap) skips that duel and is reported;
   * it never aborts the batch.
   */
  async settleUnpaired(
    adminId: string,
    dto: SettleUnpairedDto,
    now: Date = new Date()
  ): Promise<SettleUnpairedResponse> {
    if (!isValidIstDate(dto.date)) {
      throw AppError.validationFailed([
        { field: 'date', issue: 'date must be a real YYYY-MM-DD date.' },
      ]);
    }
    const waiting = await this.repo.listWaitingDailyDuels(dto.date);
    let settled = 0;
    const failed: Array<{ duelId: string; reason: string }> = [];
    for (const duel of waiting) {
      try {
        await this.settleVsBot(duel, now);
        settled += 1;
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'Settlement failed.';
        failed.push({ duelId: duel.id, reason });
        this.logger.error('Daily Duel bot fallback failed', { adminId, duelId: duel.id, reason });
      }
    }
    this.logger.info('Daily Duel unpaired settled vs bot', {
      adminId,
      date: dto.date,
      settled,
      failed: failed.length,
    });
    return { date: dto.date, settled, failed };
  }

  // --- reads -----------------------------------------------------------------------

  /** One duel's result (mine). Unsettled duels return their status, not a result. */
  async getResult(
    userId: string,
    duelId: string
  ): Promise<
    | DuelResultView
    | WaitingResponse
    | { duelId: string; type: DuelType; status: 'IN_PROGRESS'; result: null }
  > {
    const duel = await this.requireOwnedDuel(userId, duelId);
    if (duel.status === DuelStatus.SETTLED) return this.storedResultView(userId, duel);
    if (duel.status === DuelStatus.WAITING_OPPONENT) {
      const stats = await this.myStats(userId, duel);
      return {
        duelId: duel.id,
        type: duel.type,
        status: 'WAITING_OPPONENT',
        myScore: stats.score,
        myCorrect: stats.correct,
        myTotalTimeMs: stats.totalTimeMs,
        totalQuestions: questionIdsOf(duel).length,
        message:
          'Finished. Waiting for another player to finish today’s set — your result will appear when you are paired.',
      };
    }
    return { duelId: duel.id, type: duel.type, status: 'IN_PROGRESS', result: null };
  }

  async listHistory(
    userId: string,
    page: number,
    limit: number
  ): Promise<{ items: DuelHistoryItem[]; meta: ReturnType<typeof buildPaginationMeta> }> {
    const [total, duels] = await Promise.all([
      this.repo.countDuelsForUser(userId),
      this.repo.listDuelsForUser(userId, (page - 1) * limit, limit),
    ]);
    const items: DuelHistoryItem[] = [];
    for (const duel of duels) {
      const mine = await this.repo.findGameResult(duel.id, userId);
      let opponentName: string | null = null;
      let opponentScore: number | null = null;
      if (duel.type === DuelType.BOT) {
        opponentName = DUELS.BOT_NAME;
        opponentScore = duel.botScore;
      } else if (
        duel.type === DuelType.LIVE ||
        duel.type === DuelType.BLITZ ||
        duel.type === DuelType.CASE ||
        duel.type === DuelType.CHART
      ) {
        // LIVE / BLITZ / CASE / CHART duels are ONE row with both players on it (playerA/playerB),
        // not a Daily pair linked by pairedDuelId.
        const otherId = duel.playerAId === userId ? duel.playerBId : duel.playerAId;
        const other = otherId ? await this.repo.findUserById(otherId) : null;
        opponentName = other?.displayName ?? 'Player';
        const otherResult = otherId ? await this.repo.findGameResult(duel.id, otherId) : null;
        opponentScore = otherResult?.score ?? null;
      } else if (duel.pairedDuelId) {
        const paired = await this.repo.findDuelById(duel.pairedDuelId);
        if (paired) {
          const other = await this.repo.findUserById(paired.playerAId);
          opponentName = other?.displayName ?? 'Player';
          const otherResult = await this.repo.findGameResult(paired.id, paired.playerAId);
          opponentScore = otherResult?.score ?? null;
        }
      }
      items.push({
        duelId: duel.id,
        type: duel.type,
        status: duel.status,
        date: duel.dailyDate,
        startedAt: duel.startedAt,
        finishedAt: duel.finishedAt,
        result: mine?.result ?? null,
        myScore: mine?.score ?? null,
        opponentScore,
        opponentName,
        ratingDelta: mine?.ratingDelta ?? null,
      });
    }
    return { items, meta: buildPaginationMeta(page, limit, total) };
  }

  // --- answers (shared) ------------------------------------------------------------

  /**
   * Records one answer. Server owns timing/scoring: the question must
   * be the next unanswered one, in order; the first answer only;
   * timeMs 0–15000 (validated by the DTO); correctness and points are
   * computed here and never returned before reveal.
   */
  private async answer(
    userId: string,
    duelId: string,
    dto: AnswerDuelDto,
    type: DuelType
  ): Promise<AnswerResponse> {
    const duel = await this.requireOwnedDuel(userId, duelId, type);
    if (duel.status !== DuelStatus.IN_PROGRESS) {
      throw AppError.duelNotInProgress('This duel is not in progress any more.');
    }
    const ids = questionIdsOf(duel);
    const index = ids.indexOf(dto.questionId);
    if (index === -1) {
      throw AppError.validationFailed([
        { field: 'questionId', issue: 'This question is not part of this duel.' },
      ]);
    }
    const existing = await this.repo.listAnswers(duelId, userId);
    if (existing.some((a) => a.questionId === dto.questionId)) {
      throw AppError.conflict('This question was already answered.');
    }
    if (index !== existing.length) {
      throw AppError.validationFailed([
        { field: 'questionId', issue: 'Answer the questions in order.' },
      ]);
    }
    const items = await this.bank.getItemsForGrading([dto.questionId]);
    const item = items[0] as BankItemRow;
    const option = item.options.find((o) => o.id === dto.optionId);
    if (!option) {
      throw AppError.validationFailed([
        { field: 'optionId', issue: 'This option does not belong to the question.' },
      ]);
    }
    const correct = option.isCorrect;
    await this.repo.createAnswer({
      duelId,
      userId,
      questionId: dto.questionId,
      optionId: dto.optionId,
      skipped: false,
      correct,
      timeMs: dto.timeMs,
      points: pointsForAnswer(correct, dto.timeMs),
      order: index,
    });
    return {
      duelId,
      questionId: dto.questionId,
      answeredCount: existing.length + 1,
      totalQuestions: ids.length,
      nextQuestionId: ids[existing.length + 1] ?? null,
    };
  }

  // --- settlement ---------------------------------------------------------------------

  /**
   * Settles a Daily pair immediately (second finisher triggers it).
   * Ratings FIRST (clean 409 on a cap, nothing mutated), then results
   * + XP in one transaction. `finisher` is the caller of finishDaily;
   * `waiter` finished earlier. The idempotency key is
   * `duel:{finisherDuelId}`.
   */
  private async settlePair(finisher: DuelRow, waiter: DuelRow, now: Date): Promise<DuelResultView> {
    const finisherId = finisher.playerAId;
    const waiterId = waiter.playerAId;
    const items = await this.bank.getItemsForGrading(questionIdsOf(finisher));
    const finisherStats = await this.statsFor(finisherId, finisher, items);
    const waiterStats = await this.statsFor(waiterId, waiter, items);
    const finisherOutcome = decideWinner(
      { correct: finisherStats.correct, totalTimeMs: finisherStats.totalTimeMs },
      { correct: waiterStats.correct, totalTimeMs: waiterStats.totalTimeMs }
    );
    const key = `duel:${finisher.id}`;

    const outcome = await this.recordRatedDuel(finisherId, waiterId, finisherOutcome, key, now);
    const finisherRating = outcome.me;
    const waiterRating = outcome.opponent;

    const waiterUser = await this.repo.findUserById(waiterId);
    const finisherUser = await this.repo.findUserById(finisherId);
    const waiterName = waiterUser?.displayName ?? 'Player';
    const finisherName = finisherUser?.displayName ?? 'Player';

    const views = await this.transactions.run(async (tx) => {
      const finisherRewards = await this.gamification.grantDuelRewards(tx, {
        userId: finisherId,
        result: finisherOutcome,
        reason: 'duel.daily_completed',
        xpIdempotencyKey: `duel:${finisher.id}:${finisherId}`,
        atIso: now.toISOString(),
      });
      const waiterRewards = await this.gamification.grantDuelRewards(tx, {
        userId: waiterId,
        result: mirrorOutcome(finisherOutcome),
        reason: 'duel.daily_completed',
        xpIdempotencyKey: `duel:${waiter.id}:${waiterId}`,
        atIso: now.toISOString(),
      });
      const winnerId =
        finisherOutcome === 'WIN' ? finisherId : finisherOutcome === 'LOSS' ? waiterId : null;
      await this.repo.updateDuel(
        finisher.id,
        { status: DuelStatus.SETTLED, pairedDuelId: waiter.id, winnerId },
        tx
      );
      await this.repo.updateDuel(
        waiter.id,
        { status: DuelStatus.SETTLED, pairedDuelId: finisher.id, winnerId },
        tx
      );
      const finisherStored = await this.repo.createGameResult(
        this.resultInput(finisher, finisherId, finisherOutcome, finisherStats, {
          before: finisherRating.ratingBefore,
          after: finisherRating.ratingAfter,
          delta: finisherRating.delta,
          reason: ratingReasonFor(
            finisherOutcome,
            waiterName,
            waiterRating.ratingBefore,
            finisherRating.delta
          ),
          rewards: finisherRewards,
        }),
        tx
      );
      const waiterStored = await this.repo.createGameResult(
        this.resultInput(waiter, waiterId, mirrorOutcome(finisherOutcome), waiterStats, {
          before: waiterRating.ratingBefore,
          after: waiterRating.ratingAfter,
          delta: waiterRating.delta,
          reason: ratingReasonFor(
            mirrorOutcome(finisherOutcome),
            finisherName,
            finisherRating.ratingBefore,
            waiterRating.delta
          ),
          rewards: waiterRewards,
        }),
        tx
      );
      return { finisherStored, waiterStored };
    });

    this.logger.info('Daily Duel settled', {
      finisherId,
      waiterId,
      finisherDuelId: finisher.id,
      result: finisherOutcome,
    });
    const settledFinisher = { ...finisher, status: DuelStatus.SETTLED, pairedDuelId: waiter.id };
    return this.toResultView(finisherId, settledFinisher, views.finisherStored, {
      name: waiterName,
      kind: 'HUMAN',
      score: waiterStats.score,
      correct: waiterStats.correct,
    });
  }

  /**
   * Settles one unpaired Daily Duel against Mira at the player's own
   * Rating (bot fallback, ADR 0006/7). Same ordering as settlePair:
   * Ratings first (recordDuelVsBot, key `duel:{duelId}`), then the
   * duel row + result + XP in one transaction.
   */
  private async settleVsBot(duel: DuelRow, now: Date): Promise<DuelResultView> {
    const userId = duel.playerAId;
    const items = await this.bank.getItemsForGrading(questionIdsOf(duel));
    const stats = await this.statsFor(userId, duel, items);
    const rating = (await this.ratings.getUserRatings(userId)).learning.rating;
    const bot = simulateBot(
      duel.seed,
      items.map((i) => ({ id: i.id, difficulty: i.difficulty })),
      rating
    );
    const outcome = decideWinner(
      { correct: stats.correct, totalTimeMs: stats.totalTimeMs },
      { correct: bot.correctCount, totalTimeMs: bot.totalTimeMs }
    );
    const key = `duel:${duel.id}`;
    let rated: { ratingBefore: number; ratingAfter: number; delta: number };
    try {
      const res = await this.ratings.recordDuelVsBot(userId, outcome, key, now);
      rated = res.me;
    } catch (err) {
      rated = await this.recoverBotRating(userId, key, err);
    }

    const stored = await this.transactions.run(async (tx) => {
      const rewards = await this.gamification.grantDuelRewards(tx, {
        userId,
        result: outcome,
        reason: 'duel.daily_completed',
        xpIdempotencyKey: `duel:${duel.id}:${userId}`,
        atIso: now.toISOString(),
      });
      await this.repo.updateDuel(
        duel.id,
        {
          status: DuelStatus.SETTLED,
          winnerId: outcome === 'WIN' ? userId : null,
          botScore: bot.score,
          botCorrect: bot.correctCount,
          botTotalTimeMs: bot.totalTimeMs,
        },
        tx
      );
      return this.repo.createGameResult(
        this.resultInput(duel, userId, outcome, stats, {
          before: rated.ratingBefore,
          after: rated.ratingAfter,
          delta: rated.delta,
          reason:
            `No other player finished today’s set, so you played it against Mira (bot) at your own Rating (${Math.round(rating)}).` +
            (rated.delta > 0
              ? ` Your Learning Rating went up by ${rated.delta}.`
              : rated.delta < 0
                ? ` Your Learning Rating went down by ${Math.abs(rated.delta)}.`
                : ' Your Learning Rating did not change.'),
          rewards,
        }),
        tx
      );
    });
    const settled = { ...duel, status: DuelStatus.SETTLED };
    return this.toResultView(userId, settled, stored, {
      name: DUELS.BOT_NAME,
      kind: 'BOT',
      score: bot.score,
      correct: bot.correctCount,
    });
  }

  /**
   * Records a rated human duel, recovering the stored outcome when
   * the rating was already applied (crash between the Ratings call
   * and the duels transaction — ADR 0006/7). A cap/cooldown error
   * propagates: nothing was mutated, the pair stays waiting.
   */
  private async recordRatedDuel(
    callerId: string,
    opponentId: string,
    result: Outcome,
    key: string,
    now: Date
  ): Promise<{ me: DuelResponse['me']; opponent: DuelResponse['opponent'] }> {
    try {
      const res = await this.ratings.recordDuel(
        callerId,
        // Outcome and DuelResult are the same three literals ('WIN' /
        // 'DRAW' / 'LOSS'); the cast is only the boundary between the
        // duels module's union and the ratings DTO enum.
        { opponentId, result: result as DuelResult, idempotencyKey: key },
        key,
        now
      );
      return { me: res.me, opponent: res.opponent };
    } catch (err) {
      if (err instanceof AppError && err.code === ErrorCode.IDEMPOTENCY_REPLAY) {
        const original = (err.details as { original?: DuelResponse } | undefined)?.original;
        if (original) return { me: original.me, opponent: original.opponent };
      }
      if (err instanceof AppError && err.code === ErrorCode.RATING_EVENT_DUPLICATE) {
        const recovered = await this.ratings.getDuelOutcome(callerId, key);
        if (recovered && recovered.opponent) {
          return { me: recovered.me, opponent: recovered.opponent };
        }
      }
      throw err;
    }
  }

  /** Same recovery for the bot path (BotDuelResponse is the replay original). */
  private async recoverBotRating(
    userId: string,
    key: string,
    err: unknown
  ): Promise<{ ratingBefore: number; ratingAfter: number; delta: number }> {
    if (err instanceof AppError && err.code === ErrorCode.IDEMPOTENCY_REPLAY) {
      const original = (
        err.details as
          | { original?: { me?: { ratingBefore: number; ratingAfter: number; delta: number } } }
          | undefined
      )?.original;
      if (original?.me) return original.me;
    }
    if (err instanceof AppError && err.code === ErrorCode.RATING_EVENT_DUPLICATE) {
      const recovered = await this.ratings.getDuelOutcome(userId, key);
      if (recovered) return recovered.me;
    }
    throw err;
  }

  // --- internals ------------------------------------------------------------------------

  /**
   * The day's fixed set, generated once, deterministically: the seed
   * is the date string, so the same date always selects the same set
   * from the same bank. The unique `date` constraint is the race guard
   * (two concurrent first players — the loser re-reads).
   */
  private async getOrCreateDailySet(date: string, now: Date) {
    const existing = await this.repo.findDailySetByDate(date);
    if (existing) return existing;
    const seed = `daily-${date}`;
    const rng = mulberry32(hashSeed(seed));
    const questions = await this.bank.selectSet([], DAILY_BLUEPRINT, { now, rng });
    try {
      return await this.repo.createDailySet({
        date,
        questionIds: questions.map((q) => q.id),
        seed,
      });
    } catch {
      const raced = await this.repo.findDailySetByDate(date);
      if (!raced) throw new Error(`Daily set race lost for ${date} with no winner.`);
      return raced;
    }
  }

  /** Grades a finished duel: unanswered questions become skips, then stats. */
  private async gradeAndSkip(
    userId: string,
    duel: DuelRow,
    items: BankItemRow[],
    tx: TxClient
  ): Promise<GameStats> {
    const ids = questionIdsOf(duel);
    const existing = await this.repo.listAnswers(duel.id, userId, tx);
    const answered = new Set(existing.map((a) => a.questionId));
    for (let i = 0; i < ids.length; i++) {
      const qid = ids[i] as string;
      if (!answered.has(qid)) {
        await this.repo.createAnswer(
          {
            duelId: duel.id,
            userId,
            questionId: qid,
            optionId: null,
            skipped: true,
            correct: false,
            timeMs: null,
            points: 0,
            order: i,
          },
          tx
        );
      }
    }
    const all = await this.repo.listAnswers(duel.id, userId, tx);
    return buildGameStats(toGradedInputs(all), toMeta(items));
  }

  private async statsFor(userId: string, duel: DuelRow, items: BankItemRow[]): Promise<GameStats> {
    const answers = await this.repo.listAnswers(duel.id, userId);
    return buildGameStats(toGradedInputs(answers), toMeta(items));
  }

  private async myStats(userId: string, duel: DuelRow): Promise<GameStats> {
    const items = await this.bank.getItemsForGrading(questionIdsOf(duel));
    return this.statsFor(userId, duel, items);
  }

  private resultInput(
    duel: DuelRow,
    userId: string,
    result: Outcome,
    stats: GameStats,
    rating: {
      before: number | null;
      after: number | null;
      delta: number | null;
      reason: string;
      rewards: RewardSummary;
    }
  ) {
    return {
      duelId: duel.id,
      userId,
      result,
      score: stats.score,
      correct: stats.correct,
      wrong: stats.wrong,
      skipped: stats.skipped,
      accuracy: stats.accuracy,
      avgTimeMs: stats.avgTimeMs,
      fastestTimeMs: stats.fastestTimeMs,
      slowestTimeMs: stats.slowestTimeMs,
      bestStreak: stats.bestStreak,
      perTopic: stats.perTopic as unknown as Prisma.InputJsonValue,
      perQuestion: stats.perQuestion as unknown as Prisma.InputJsonValue,
      ratingBefore: rating.before,
      ratingAfter: rating.after,
      ratingDelta: rating.delta,
      ratingReason: rating.reason,
      xpAwarded: rating.rewards.xpAwarded,
      xpBreakdown: {
        result,
        reason: 'duel.daily_completed',
        rewards: rating.rewards,
      } as unknown as Prisma.InputJsonValue,
    };
  }

  private async storedResultView(userId: string, duel: DuelRow): Promise<DuelResultView> {
    const stored = await this.repo.findGameResult(duel.id, userId);
    if (!stored) throw AppError.notFound('This duel has no stored result yet.');
    let opponent: OpponentSummary;
    if (duel.type === DuelType.BOT || duel.botScore !== null) {
      opponent = {
        name: DUELS.BOT_NAME,
        kind: 'BOT',
        score: duel.botScore,
        correct: duel.botCorrect,
      };
    } else if (
      duel.type === DuelType.LIVE ||
      duel.type === DuelType.BLITZ ||
      duel.type === DuelType.CASE ||
      duel.type === DuelType.CHART
    ) {
      // LIVE / BLITZ / CASE / CHART duels are ONE row with both players on it. The opponent is
      // the other player on the row; a bot opponent is stored in botScore.
      const otherId = duel.playerAId === userId ? duel.playerBId : duel.playerAId;
      if (duel.playerBId === null && duel.botScore !== null) {
        opponent = {
          name: DUELS.BOT_NAME,
          kind: 'BOT',
          score: duel.botScore,
          correct: duel.botCorrect,
        };
      } else {
        const other = otherId ? await this.repo.findUserById(otherId) : null;
        const otherResult = otherId ? await this.repo.findGameResult(duel.id, otherId) : null;
        opponent = {
          name: other?.displayName ?? 'Player',
          kind: 'HUMAN',
          score: otherResult?.score ?? null,
          correct: otherResult?.correct ?? null,
        };
      }
    } else if (duel.pairedDuelId) {
      const paired = await this.repo.findDuelById(duel.pairedDuelId);
      const other = paired ? await this.repo.findUserById(paired.playerAId) : null;
      const otherResult = paired
        ? await this.repo.findGameResult(paired.id, paired.playerAId)
        : null;
      opponent = {
        name: other?.displayName ?? 'Player',
        kind: 'HUMAN',
        score: otherResult?.score ?? null,
        correct: otherResult?.correct ?? null,
      };
    } else {
      opponent = { name: 'To be paired', kind: 'HUMAN', score: null, correct: null };
    }
    return this.toResultView(userId, duel, stored, opponent);
  }

  private toResultView(
    userId: string,
    duel: DuelRow,
    stored: DuelGameResultRow,
    opponent: OpponentSummary
  ): DuelResultView {
    const breakdown = stored.xpBreakdown as unknown as { rewards?: RewardSummary };
    const rewards = breakdown.rewards;
    return {
      duelId: duel.id,
      type: duel.type,
      status: 'SETTLED',
      result: stored.result,
      score: stored.score,
      opponent,
      correct: stored.correct,
      wrong: stored.wrong,
      skipped: stored.skipped,
      accuracy: stored.accuracy,
      avgTimeMs: stored.avgTimeMs,
      fastestTimeMs: stored.fastestTimeMs,
      slowestTimeMs: stored.slowestTimeMs,
      bestStreak: stored.bestStreak,
      perTopic: stored.perTopic as unknown as GameStats['perTopic'],
      perQuestion: stored.perQuestion as unknown as GameStats['perQuestion'],
      ratingBefore: stored.ratingBefore,
      ratingAfter: stored.ratingAfter,
      ratingDelta: stored.ratingDelta,
      ratingReason: stored.ratingReason,
      xp: rewards
        ? xpView(rewards)
        : {
            awarded: stored.xpAwarded,
            totalXp: 0,
            level: 1,
            levelUp: false,
            currentStreak: 0,
            newBadges: [],
          },
      finishedAt: duel.finishedAt,
    };
  }

  private async requireOwnedDuel(
    userId: string,
    duelId: string,
    type?: DuelType
  ): Promise<DuelRow> {
    const duel = await this.repo.findDuelById(duelId);
    if (!duel || (type !== undefined && duel.type !== type)) {
      throw AppError.notFound('Duel not found.');
    }
    if (duel.playerAId !== userId && duel.playerBId !== userId) {
      throw AppError.forbidden();
    }
    return duel;
  }
}

function questionIdsOfSet(set: { questionIds: Prisma.JsonValue }): string[] {
  const ids = set.questionIds as unknown;
  if (!Array.isArray(ids) || ids.some((i) => typeof i !== 'string')) {
    throw new Error('Daily set has a malformed question list.');
  }
  return ids as string[];
}

/** Public views for a daily set: same option order for every player that day. */
function toPublicViews(items: BankItemRow[], rng: () => number): DuelQuestionView[] {
  return items.map((item) => ({
    id: item.id,
    stem: item.stem,
    options: shuffle(rng, item.options).map((o) => ({
      id: o.id,
      text: o.text,
      order: o.order,
      consequence: o.consequence ?? null,
    })),
    type: item.type,
    topic: item.topic,
    skill: item.skill,
    difficulty: item.difficulty,
    ...(item.type === 'CASE_CHOICE'
      ? { context: (item.context as Record<string, string | number> | null) ?? null }
      : {}),
  }));
}

function shuffle<T>(rng: () => number, items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i] as T;
    arr[i] = arr[j] as T;
    arr[j] = tmp;
  }
  return arr;
}

function toGradedInputs(answers: DuelAnswerRow[]) {
  return answers.map((a) => ({
    questionId: a.questionId,
    optionId: a.optionId,
    skipped: a.skipped,
    correct: a.correct,
    timeMs: a.timeMs,
    points: a.points,
  }));
}

function toMeta(items: BankItemRow[]) {
  return items.map((i) => ({
    id: i.id,
    topic: i.topic,
    skill: i.skill,
    difficulty: i.difficulty,
    stem: i.stem,
    explanation: i.explanation,
    // CASE_CHOICE only: the rubric rides into the stored per-question
    // stat so the result screen can show it (ADR 0009 §6).
    rubric: i.rubric ?? null,
    // CHART_CHOICE only: the full chart (public part + annotation)
    // rides into the stored per-question stat; buildGameStats splits
    // it so the result screen can draw the annotated chart (ADR 0010 §5).
    chart: (i.chart as unknown as ChartStatWithAnnotation | null) ?? null,
    options: i.options.map((o) => ({ id: o.id, text: o.text, isCorrect: o.isCorrect })),
  }));
}
