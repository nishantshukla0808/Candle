import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DuelStatus, DuelType, Prisma } from '@prisma/client';
import { DUELS, ErrorCode } from '@candle/shared';
import { CONFIG } from '../../config/config.module';
import type { AppConfig } from '../../config/configuration';
import { AppError } from '../../common/errors/app-error';
import { AppLogger } from '../../common/services/logger.service';
import { RedisService } from '../../common/services/redis.service';
import { TransactionService } from '../../database/transaction.service';
import type { BankItemRow } from '../question-bank/question-bank.repository';
import { QuestionBankService } from '../question-bank/question-bank.service';
import type { DuelResponse } from '../ratings/ratings.service';
import { DuelResult as DtoDuelResult } from '../ratings/dto/ratings.dto';
import { RatingsService } from '../ratings/ratings.service';
import type { RewardSummary } from '../gamification/gamification.service';
import { GamificationService } from '../gamification/gamification.service';
import {
  hashSeed,
  mulberry32,
  simulateBot,
  simulateCaseBot,
  simulateChartBot,
} from './bot-simulation';
import {
  buildGameStats,
  decideWinner,
  decideWinnerByPoints,
  mirrorOutcome,
  pointsForAnswer,
  pointsForBlitzAnswer,
  pointsForCaseAnswer,
  type ChartStatWithAnnotation,
  type DuelOutcome as Outcome,
  type GameStats,
} from './duel-scoring';
import { variantConfig, type LiveDuelVariant } from './live-duel-variants';
import { DuelsRepository, type DuelAnswerRow, type DuelRow } from './duels.repository';
import { DuelsService, ratingReasonFor, type DuelResultView } from './duels.service';
import {
  botCorrectOf,
  botScoreOf,
  liveDuelStateKey,
  liveUserDuelKey,
  parseLiveDuelState,
  scoresOf,
  type LiveAnswerState,
  type LiveDuelState,
  type LivePlayerState,
} from './live-duel-state';

/**
 * Transport out of the engine. The engine never imports Socket.IO:
 * the gateway implements this interface, so the engine is unit-testable
 * with a recording emitter and the transport can change without
 * touching duel logic (blueprint §4).
 */
export interface LiveDuelEmitter {
  toUser(userId: string, event: string, payload: unknown): void;
  toRoom(duelId: string, event: string, payload: unknown): void;
}

export interface LivePlayerRef {
  userId: string;
  displayName: string;
  rating: number;
}

export interface MatchedPayload {
  duelId: string;
  /** Live variant: 'LIVE' (Speed Quiz), 'BLITZ' (Myth vs Fact), or 'CASE' (Case Duel). */
  variant: LiveDuelVariant;
  opponent: { userId: string; displayName: string; rating: number; kind: 'HUMAN' | 'BOT' };
  host: { name: string; line: string };
  questionCount: number;
  /** Per-question time limit for this variant (ms): 15000 (LIVE), 10000 (BLITZ), 45000 (CASE), 30000 (CHART). */
  timeLimitMs: number;
  countdownEndsAtMs: number;
  serverNowMs: number;
}

const HOST_RESULT_WIN = 'Well played — that was a sharp duel. Here is what to practise next.';
const HOST_RESULT_LOSS = 'Good fight. Your weakest topic is below — one short lesson will fix it.';
const HOST_RESULT_DRAW = 'A dead heat. Rematch, and the next one is yours.';

/** Selection blueprint for a variant (doc 08 §4 — the format mix is declared, never ad-hoc). */
function blueprintFor(variant: LiveDuelVariant) {
  const config = variantConfig(variant);
  return {
    count: config.questionCount,
    difficultyMix: config.difficultyMix,
    maxPerTopic: config.maxPerTopic,
    types: config.types,
  };
}

/**
 * LiveDuelEngine — docs/05 §3.1/§3.2, docs/09 (Phase 5), Phase 6 (Blitz),
 * Phase 7 (Case Duel, ADR 0009), Phase 8 (Chart Detective, ADR 0010).
 *
 * Owns the live duel: match creation, countdown, server-authoritative
 * question timers, server-side grading, per-question reveal, disconnect
 * grace + forfeit, settlement (Ratings once, then results + XP in one
 * duels transaction — the ADR 0006/7 ordering), and rematch offers.
 *
 * Parameterised by variant (live-duel-variants.ts): the same engine
 * runs Speed Quiz (LIVE: 7 questions, 15 s, MCQ_4 + TRUE_FALSE),
 * Myth vs Fact Blitz (BLITZ: 10 questions, 10 s, TRUE_FALSE only, with
 * the in-duel streak bonus), the Case Duel (CASE: 5 cases, 45 s,
 * CASE_CHOICE only, rubric scoring + a reason window after each case),
 * and Chart Detective (CHART: 5 charts, 30 s, CHART_CHOICE only,
 * standard MCQ_4 scoring + the chart annotation at reveal).
 * The variant fixes the set, the timer, and the scoring; the flow is
 * shared, never duplicated.
 *
 * State lives in Redis; Postgres is the source of truth after the duel
 * ends. Timers live on this process (v1, single server): a reconnect
 * to another server re-arms them from the Redis state (see
 * handleReconnect / rearmTimers), but a process crash mid-duel voids
 * the duel rather than inventing a result — see docs/09 §7.
 */
@Injectable()
export class LiveDuelEngine implements OnModuleDestroy {
  private emitter: LiveDuelEmitter | null = null;
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly redis: RedisService,
    private readonly repo: DuelsRepository,
    private readonly bank: QuestionBankService,
    private readonly ratings: RatingsService,
    private readonly gamification: GamificationService,
    private readonly transactions: TransactionService,
    private readonly duels: DuelsService,
    private readonly logger: AppLogger,
    @Inject(CONFIG) private readonly config: AppConfig
  ) {}

  onModuleDestroy(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }

  /** The gateway binds itself here after init (engine never imports Socket.IO). */
  bindEmitter(emitter: LiveDuelEmitter): void {
    this.emitter = emitter;
  }

  /** Current Redis state for a duel (the gateway re-reads it for rematch emits). */
  async getState(duelId: string): Promise<LiveDuelState | null> {
    return this.loadState(duelId);
  }

  /** Test/ops cleanup: clear every armed timer for a duel (or all). */
  clearTimers(duelId?: string): void {
    for (const [key, t] of [...this.timers.entries()]) {
      if (!duelId || key.startsWith(`${duelId}:`)) {
        clearTimeout(t);
        this.timers.delete(key);
      }
    }
  }

  // --- match creation ---------------------------------------------------------

  /**
   * Creates a human-vs-human live duel: one set for both players
   * (selectSet is called ONCE with both user ids, so the question ids,
   * order, and option order are identical), exposure recorded for both,
   * one Duel row (playerA + playerB), Redis state in COUNTDOWN.
   * `variant` selects the duel's shape (Speed Quiz, Blitz, Case Duel,
   * or Chart Detective) — the flow, timers, and settlement are shared.
   */
  async createLiveDuel(
    a: LivePlayerRef,
    b: LivePlayerRef,
    now: Date = new Date(),
    variant: LiveDuelVariant = 'LIVE'
  ): Promise<LiveDuelState> {
    const config = variantConfig(variant);
    const seed = randomUUID();
    const questions = await this.bank.selectSet([a.userId, b.userId], blueprintFor(variant), {
      now,
      rng: mulberry32(hashSeed(seed)),
    });
    await this.bank.recordExposure(
      a.userId,
      questions.map((q) => q.id),
      now
    );
    await this.bank.recordExposure(
      b.userId,
      questions.map((q) => q.id),
      now
    );
    const duel = await this.repo.createDuel({
      type: config.duelType,
      playerAId: a.userId,
      playerBId: b.userId,
      questionIds: questions.map((q) => q.id),
      seed,
    });
    const state = this.newState(duel, a, b, questions, null, now, variant);
    await this.saveState(state);
    this.arm(
      `${duel.id}:countdown`,
      this.config.LIVE_COUNTDOWN_MS,
      () => void this.startQuestion(duel.id, 0)
    );
    this.logger.info('Live duel created', {
      duelId: duel.id,
      a: a.userId,
      b: b.userId,
      variant,
    });
    return state;
  }

  /**
   * Creates a rated live duel vs the Mira bot (the 30-second bot offer,
   * docs/05 §3.3). The bot is pre-simulated from the duel seed, so her
   * answers and times are fixed before the first question. Rated via
   * recordDuelVsBot at the player's own Rating — the same fallback the
   * Daily Duel uses (ADR 0006/7) — because the player queued for a
   * rated duel; silently switching them to unrated practice would
   * change the stakes after a 30-second wait. In a Blitz duel Mira is
   * simulated on the 10-second timer with the Blitz streak rule, so
   * both sides are scored by the same rule. In a Case Duel she is
   * simulated by `simulateCaseBot` (ADR 0009 §5): she picks an action
   * per case (best / second-best / 0-point) on the 45 s timer, scored
   * by the same Case rule, and submits no reason (null). In a Chart
   * Duel she is simulated by `simulateChartBot` (ADR 0010 §6): she
   * picks an interpretation per chart (correct with her base accuracy
   * for the player's Learning Rating, no difficulty adjustment) on
   * the 30 s timer, scored by the same Chart rule (100 + up to 50
   * speed bonus); Kabir hosts, Mira only plays.
   */
  async createBotDuel(
    player: LivePlayerRef,
    now: Date = new Date(),
    variant: LiveDuelVariant = 'LIVE'
  ): Promise<LiveDuelState> {
    const config = variantConfig(variant);
    const seed = randomUUID();
    const questions = await this.bank.selectSet([player.userId], blueprintFor(variant), {
      now,
      rng: mulberry32(hashSeed(seed)),
    });
    await this.bank.recordExposure(
      player.userId,
      questions.map((q) => q.id),
      now
    );
    const duel = await this.repo.createDuel({
      type: config.duelType,
      playerAId: player.userId,
      playerBId: null,
      questionIds: questions.map((q) => q.id),
      seed,
    });
    const items = await this.bank.getItemsForGrading(questions.map((q) => q.id));
    const questionTimeMs = this.questionTimeMsFor(variant);
    const bot =
      variant === 'CASE'
        ? simulateCaseBot(
            seed,
            items.map((i) => ({
              id: i.id,
              difficulty: i.difficulty,
              options: i.options.map((o) => ({
                id: o.id,
                points: o.points ?? 0,
                isCorrect: o.isCorrect,
              })),
            })),
            player.rating
          )
        : variant === 'CHART'
          ? simulateChartBot(
              seed,
              items.map((i) => ({
                id: i.id,
                difficulty: i.difficulty,
                options: i.options.map((o) => ({ id: o.id, isCorrect: o.isCorrect })),
              })),
              player.rating
            )
          : simulateBot(
              seed,
              items.map((i) => ({ id: i.id, difficulty: i.difficulty })),
              player.rating,
              { timeLimitMs: questionTimeMs, streakBonus: variant === 'BLITZ' }
            );
    const botAnswers: LiveAnswerState[] = bot.answers.map((ans) => ({
      questionId: ans.questionId,
      optionId: ans.optionId ?? '',
      timeMs: ans.timeMs,
      correct: ans.correct,
      points: ans.points,
      // The bot submits no reason, ever (ADR 0009 §5) — null from the
      // start, so she never blocks the Case reason window.
      reason: null,
    }));
    const state = this.newState(duel, player, null, questions, botAnswers, now, variant);
    await this.saveState(state);
    this.arm(
      `${duel.id}:countdown`,
      this.config.LIVE_COUNTDOWN_MS,
      () => void this.startQuestion(duel.id, 0)
    );
    this.logger.info('Live bot duel created', { duelId: duel.id, userId: player.userId, variant });
    return state;
  }

  /** Payload the gateway sends each player on `live:matched`. */
  matchedPayload(state: LiveDuelState, userId: string): MatchedPayload {
    const meIsA = state.playerA.userId === userId;
    const opponent = state.isBot
      ? {
          userId: 'bot:mira',
          displayName: DUELS.BOT_NAME,
          rating: state.playerA.rating,
          kind: 'BOT' as const,
        }
      : meIsA
        ? {
            userId: state.playerB?.userId ?? '',
            displayName: state.playerB?.displayName ?? 'Player',
            rating: state.playerB?.rating ?? 1000,
            kind: 'HUMAN' as const,
          }
        : {
            userId: state.playerA.userId,
            displayName: state.playerA.displayName,
            rating: state.playerA.rating,
            kind: 'HUMAN' as const,
          };
    return {
      duelId: state.duelId,
      variant: state.variant,
      opponent,
      host: {
        name: variantConfig(state.variant).hostName,
        line: variantConfig(state.variant).hostIntro,
      },
      questionCount: state.questions.length,
      timeLimitMs: this.questionTimeMsFor(state.variant),
      countdownEndsAtMs: state.countdownEndsAtMs,
      serverNowMs: Date.now(),
    };
  }

  /**
   * Per-question time limit (ms) for a variant. The config override
   * wins when set (LIVE_QUESTION_MS / BLITZ_QUESTION_MS /
   * CASE_QUESTION_MS / CHART_QUESTION_MS); otherwise the variant's documented default
   * (15,000 / 10,000 / 45,000 / 30,000) applies.
   */
  private questionTimeMsFor(variant: LiveDuelVariant): number {
    if (variant === 'BLITZ') {
      return this.config.BLITZ_QUESTION_MS ?? variantConfig('BLITZ').questionTimeMs;
    }
    if (variant === 'CASE') {
      return this.config.CASE_QUESTION_MS ?? variantConfig('CASE').questionTimeMs;
    }
    if (variant === 'CHART') {
      return this.config.CHART_QUESTION_MS ?? variantConfig('CHART').questionTimeMs;
    }
    return this.config.LIVE_QUESTION_MS ?? variantConfig('LIVE').questionTimeMs;
  }

  /**
   * Reason-window length (ms) for the Case Duel (ADR 0009 §4): the
   * config override wins when set (CASE_REASON_WINDOW_MS), otherwise
   * the shared 10,000 ms default applies. Other variants have no
   * reason window — this is only read on the CASE path.
   */
  private reasonWindowMsFor(): number {
    return this.config.CASE_REASON_WINDOW_MS ?? DUELS.CASE_REASON_WINDOW_MS;
  }

  // --- question flow (server owns the clock) ------------------------------------

  /**
   * Starts one question: phase IN_PROGRESS, deadline = now + question
   * time. The question payload carries the public view only — never
   * the correct option or the explanation (those arrive at reveal).
   */
  async startQuestion(duelId: string, index: number, now: Date = new Date()): Promise<void> {
    const state = await this.loadState(duelId);
    if (!state || state.phase === 'FINISHED' || index >= state.questions.length) return;
    const questionTimeMs = this.questionTimeMsFor(state.variant);
    state.phase = 'IN_PROGRESS';
    state.currentIndex = index;
    state.questionStartedAtMs = now.getTime();
    state.questionDeadlineMs = now.getTime() + questionTimeMs;
    await this.saveState(state);
    const question = state.questions[index];
    if (!question) return;
    this.emitRoom(duelId, 'live:question', {
      duelId,
      index,
      total: state.questions.length,
      question,
      deadlineMs: state.questionDeadlineMs,
      serverNowMs: now.getTime(),
      timeLimitMs: questionTimeMs,
    });
    // When the timer expires the question closes for answers. For a
    // Case Duel that opens the reason window instead of revealing
    // immediately (ADR 0009 §4); other variants reveal at once.
    this.arm(
      `${duelId}:question`,
      questionTimeMs,
      () => void this.closeQuestionForAnswers(duelId, index)
    );
    if (state.isBot && state.botAnswers) {
      const botTime = state.botAnswers[index]?.timeMs ?? questionTimeMs;
      this.arm(
        `${duelId}:bot:${index}`,
        Math.min(botTime, questionTimeMs - 1),
        () => void this.botAnswer(duelId, index)
      );
    }
  }

  /**
   * Records one answer. The server grades from its own clock
   * (timeMs = server now − question start), never from a client
   * value — a live answer carries no timeMs at all. Late, duplicate,
   * out-of-order, or wrong-question answers are rejected; correctness
   * and points are NOT returned here (they arrive at reveal). In a
   * Blitz duel a correct answer extends the player's in-duel streak
   * (streak bonus from the 3rd in a row) and a wrong answer resets it.
   * In a Case Duel the action is graded on the 45 s timer by the
   * stored per-option points + the capped speed bonus
   * (`pointsForCaseAnswer`); the reason is a separate step — it is
   * sent later via `submitReason`, never with the answer, and never
   * scored (ADR 0009 §3/§4).
   */
  async answer(
    userId: string,
    duelId: string,
    questionId: string,
    optionId: string,
    now: Date = new Date()
  ): Promise<{ answeredCount: number; totalQuestions: number }> {
    const state = await this.loadState(duelId);
    if (!state || state.phase === 'FINISHED') {
      throw AppError.duelLiveNotActive('This live duel is not active any more.');
    }
    if (state.phase !== 'IN_PROGRESS') {
      throw AppError.duelLiveNotActive('This question is not open for answers right now.');
    }
    const side = this.sideOf(state, userId);
    if (!side) throw AppError.forbidden();
    const questionTimeMs = this.questionTimeMsFor(state.variant);
    const question = state.questions[state.currentIndex];
    if (!question || question.id !== questionId) {
      throw AppError.validationFailed([
        { field: 'questionId', issue: 'This question is not the current question.' },
      ]);
    }
    if (state.questionDeadlineMs !== null && now.getTime() > state.questionDeadlineMs) {
      throw AppError.validationFailed([
        { field: 'questionId', issue: 'Time is up for this question.' },
      ]);
    }
    const mine = state.answers[userId] ?? {};
    if (mine[state.currentIndex]) {
      throw AppError.conflict('This question was already answered.');
    }
    const items = await this.bank.getItemsForGrading([questionId]);
    const item = items[0] as BankItemRow;
    const option = item.options.find((o) => o.id === optionId);
    if (!option) {
      throw AppError.validationFailed([
        { field: 'optionId', issue: 'This option does not belong to the question.' },
      ]);
    }
    const timeMs = Math.max(
      0,
      Math.min(questionTimeMs, now.getTime() - (state.questionStartedAtMs ?? now.getTime()))
    );
    const correct = option.isCorrect;
    // Blitz streak: a correct answer extends the current run (and pays
    // the streak bonus from the 3rd in a row); a wrong answer resets
    // the run to 0. Speed Quiz never takes a streak bonus.
    if (state.variant === 'BLITZ') {
      side.streak = correct ? side.streak + 1 : 0;
    }
    // Case Duel: the stored per-option points (100 best / 50
    // second-best / 0 other) + up to 20 speed bonus on the 45 s timer.
    // `correct` here means "picked the best action" (the 100-point
    // option); a second-best pick is not correct but still scores 50
    // + speed — which is why the Case winner is decided on points
    // (decideWinnerByPoints), not on correct counts (ADR 0009 §3).
    const points =
      state.variant === 'CASE'
        ? pointsForCaseAnswer(option.points ?? 0, timeMs, questionTimeMs)
        : state.variant === 'BLITZ'
          ? pointsForBlitzAnswer(correct, timeMs, side.streak)
          : pointsForAnswer(correct, timeMs, questionTimeMs);
    await this.repo.createAnswer({
      duelId,
      userId,
      questionId,
      optionId,
      skipped: false,
      correct,
      timeMs,
      points,
      // No reason yet — it arrives later via submitReason (or never,
      // in which case the null stays). Never a lost answer (ADR 0009 §4).
      reason: null,
      order: state.currentIndex,
    });
    const record: LiveAnswerState = { questionId, optionId, timeMs, correct, points };
    state.answers[userId] = { ...mine, [state.currentIndex]: record };
    side.score += points;
    if (correct) side.correct += 1;
    side.totalTimeMs += timeMs;
    await this.saveState(state);
    this.emitToUser(userId, 'live:answer-accepted', {
      duelId,
      questionId,
      answeredCount: Object.keys(state.answers[userId] ?? {}).length,
      totalQuestions: state.questions.length,
    });
    this.emitRoom(duelId, 'live:score', { duelId, scores: scoresOf(state) });
    await this.maybeRevealEarly(state, now);
    return {
      answeredCount: Object.keys(state.answers[userId] ?? {}).length,
      totalQuestions: state.questions.length,
    };
  }

  // --- Case Duel reason window (ADR 0009 §4) ------------------------------------

  /**
   * Records one player's reason for the action they already picked
   * (Case Duel only — `live:reason`). The action is the answer and
   * was graded on the 45 s timer; the reason arrives after it, inside
   * the reason window, and is NEVER scored — it is stored on the
   * DuelAnswer row only. A reason of null is an explicit skip: it
   * counts as "submitted" for closing the window. A missing reason
   * stays null, never a lost answer.
   *
   * Valid only while the reason window is open for the current case
   * (phase IN_PROGRESS, `reasonDeadlineMs` set) and only for a player
   * who answered this case. Reasons after the window closed, for a
   * case the player never answered, duplicates, or for non-CASE
   * duels are rejected.
   */
  async submitReason(
    userId: string,
    duelId: string,
    questionId: string,
    reason: string | null,
    now: Date = new Date()
  ): Promise<{ submitted: boolean }> {
    const state = await this.loadState(duelId);
    if (!state || state.phase === 'FINISHED') {
      throw AppError.duelLiveNotActive('This live duel is not active any more.');
    }
    if (state.variant !== 'CASE') {
      throw AppError.validationFailed([
        { field: 'duelId', issue: 'Reasons are only part of the Case Duel.' },
      ]);
    }
    if (state.phase !== 'IN_PROGRESS' || state.reasonDeadlineMs === null) {
      throw AppError.validationFailed([
        { field: 'questionId', issue: 'The reason window is not open for this case.' },
      ]);
    }
    if (now.getTime() > state.reasonDeadlineMs) {
      throw AppError.validationFailed([
        { field: 'questionId', issue: 'The reason window has closed for this case.' },
      ]);
    }
    const side = this.sideOf(state, userId);
    if (!side) throw AppError.forbidden();
    const question = state.questions[state.currentIndex];
    if (!question || question.id !== questionId) {
      throw AppError.validationFailed([
        { field: 'questionId', issue: 'This question is not the current question.' },
      ]);
    }
    const mine = state.answers[userId]?.[state.currentIndex];
    if (!mine) {
      throw AppError.validationFailed([
        {
          field: 'questionId',
          issue: 'You did not answer this case, so there is no reason to give.',
        },
      ]);
    }
    const mineReasons = state.reasons[userId] ?? {};
    if (Object.prototype.hasOwnProperty.call(mineReasons, state.currentIndex)) {
      throw AppError.conflict('A reason was already submitted for this case.');
    }
    const clean = reason === null ? null : reason.trim();
    if (clean !== null && clean.length === 0) {
      throw AppError.validationFailed([
        { field: 'reason', issue: 'The reason must not be empty — send null to skip it.' },
      ]);
    }
    await this.repo.updateAnswerReason(duelId, userId, questionId, clean);
    state.reasons[userId] = { ...mineReasons, [state.currentIndex]: clean };
    mine.reason = clean;
    await this.saveState(state);
    // Every player who answered has now submitted (or skipped) a
    // reason → the reveal no longer waits for the window to expire.
    if (this.allReasonsIn(state)) {
      this.clearTimer(`${duelId}:reason`);
      await this.revealQuestion(duelId, state.currentIndex);
    }
    return { submitted: true };
  }

  /**
   * The question timer expired (or both players answered): the case
   * closes for answers. For a Case Duel that opens the reason window
   * instead of revealing immediately — the 45 s deadline is NOT
   * extended (a late action is still rejected), the window is only
   * for reasons (ADR 0009 §4). Other variants reveal at once.
   */
  async closeQuestionForAnswers(
    duelId: string,
    index: number,
    now: Date = new Date()
  ): Promise<void> {
    const state = await this.loadState(duelId);
    if (!state || state.phase === 'FINISHED') return;
    if (state.phase !== 'IN_PROGRESS' || state.currentIndex !== index) return;
    if (state.variant === 'CASE') {
      await this.openReasonWindow(state, now);
      return;
    }
    await this.revealQuestion(duelId, index);
  }

  /**
   * Opens the reason window for the current case: deadline = now +
   * the reason window (10 s), a `live:reason-window` event so the
   * clients can show the reason step, and a timer that reveals when
   * the window expires. If every player who answered already has a
   * reason entry (a bot duel, where the bot's reason is null from
   * the start, or both humans submitted instantly), reveal at once.
   * Idempotent: opening an already-open window is a no-op.
   */
  private async openReasonWindow(state: LiveDuelState, now: Date): Promise<void> {
    if (state.reasonDeadlineMs !== null) return;
    this.clearTimer(`${state.duelId}:question`);
    this.clearTimer(`${state.duelId}:reveal-early`);
    state.reasonDeadlineMs = now.getTime() + this.reasonWindowMsFor();
    await this.saveState(state);
    this.emitRoom(state.duelId, 'live:reason-window', {
      duelId: state.duelId,
      index: state.currentIndex,
      reasonDeadlineMs: state.reasonDeadlineMs,
      serverNowMs: now.getTime(),
    });
    if (this.allReasonsIn(state)) {
      await this.revealQuestion(state.duelId, state.currentIndex);
      return;
    }
    this.arm(
      `${state.duelId}:reason`,
      this.reasonWindowMsFor(),
      () => void this.revealQuestion(state.duelId, state.currentIndex)
    );
  }

  /**
   * True when every HUMAN player who answered the current case has a
   * reason entry (a chip string, or null for an explicit skip). A
   * player who never answered needs no reason. The bot is never
   * counted — her reason is null from the start.
   */
  private allReasonsIn(state: LiveDuelState): boolean {
    const players = [state.playerA.userId, state.playerB?.userId].filter(
      (id): id is string => typeof id === 'string'
    );
    for (const userId of players) {
      if (!state.answers[userId]?.[state.currentIndex]) continue;
      const mine = state.reasons[userId] ?? {};
      if (!Object.prototype.hasOwnProperty.call(mine, state.currentIndex)) return false;
    }
    return true;
  }

  /** Mira's simulated answer lands: her score updates, never her answer. */
  async botAnswer(duelId: string, index: number): Promise<void> {
    const state = await this.loadState(duelId);
    if (!state || !state.isBot || state.phase !== 'IN_PROGRESS') return;
    if (state.currentIndex !== index || state.botAnsweredUpToIndex >= index) return;
    state.botAnsweredUpToIndex = index;
    await this.saveState(state);
    this.emitRoom(duelId, 'live:score', { duelId, scores: scoresOf(state) });
    await this.maybeRevealEarly(state, new Date());
  }

  /**
   * Reveals one question to both players: the correct option, the
   * explanation, each player's own correctness/points, and the live
   * scores. Nothing about the opponent's chosen option is sent — the
   * score bar shows scores, not answers (docs/09). A Case reveal
   * additionally carries the rubric (line by line), the per-option
   * points breakdown in plain words, and the player's own reason —
   * so the player can see WHY the best action wins (ADR 0009 §6).
   * A Chart reveal additionally carries the chart `annotation`
   * (trend + highlighted zone) from the grading row, so the page can
   * highlight the trend line / risk zone (ADR 0010 §5).
   */
  async revealQuestion(duelId: string, index: number): Promise<void> {
    const state = await this.loadState(duelId);
    if (!state || state.phase === 'FINISHED') return;
    if (state.phase !== 'IN_PROGRESS' || state.currentIndex !== index) return;
    this.clearTimer(`${duelId}:question`);
    this.clearTimer(`${duelId}:bot:${index}`);
    this.clearTimer(`${duelId}:reason`);
    this.clearTimer(`${duelId}:reveal-early`);
    state.phase = 'REVEAL';
    state.reasonDeadlineMs = null;
    await this.saveState(state);
    const question = state.questions[index];
    if (!question) return;
    const items = await this.bank.getItemsForGrading([question.id]);
    const item = items[0] as BankItemRow;
    const correctOption = item.options.find((o) => o.isCorrect);
    const scores = scoresOf(state);
    // Case Duel only: the rubric + the points each action was worth,
    // in plain words per player ("Best action +100, your action +50 —
    // second-best"). The rubric and the breakdown are the same for
    // both players; only the "your action" line is personalised.
    const caseExtras =
      state.variant === 'CASE'
        ? {
            rubric: item.rubric ?? '',
            optionPoints: item.options.map((o) => ({
              optionId: o.id,
              text: o.text,
              points: o.points ?? 0,
            })),
          }
        : {};
    // Chart Detective only: the reveal-only annotation (trend +
    // highlighted zone) from the grading row's chart, so the web page
    // can highlight the trend line / risk zone (ADR 0010 §5). The
    // public question view never carries it; the stored per-question
    // stat carries it too (buildGameStats).
    const chartExtras =
      state.variant === 'CHART'
        ? {
            annotation:
              (item.chart as unknown as { annotation?: unknown } | null)?.annotation ?? null,
          }
        : {};
    const revealFor = (userId: string): Record<string, unknown> => {
      const mine = state.answers[userId]?.[index];
      const myOptionPoints =
        mine && mine.optionId ? (item.options.find((o) => o.id === mine.optionId)?.points ?? 0) : 0;
      const pointsBreakdown =
        state.variant !== 'CASE'
          ? undefined
          : !mine
            ? 'No action picked — 0 points.'
            : mine.correct
              ? `Best action +100, your action +${myOptionPoints} — best action.`
              : myOptionPoints > 0
                ? `Best action +100, your action +${myOptionPoints} — second-best.`
                : 'Best action +100, your action +0 — not the best action.';
      return {
        duelId,
        index,
        questionId: question.id,
        correctOptionId: correctOption?.id ?? null,
        correctOptionText: correctOption?.text ?? null,
        explanation: item.explanation,
        myCorrect: mine?.correct ?? false,
        mySkipped: !mine,
        myPoints: mine?.points ?? 0,
        myOptionId: mine?.optionId ?? null,
        // The player's own reason (null when skipped/missing) — never
        // the opponent's. The reason is recorded, never scored.
        myReason: state.reasons[userId]?.[index] ?? null,
        scores,
        ...caseExtras,
        ...chartExtras,
        ...(pointsBreakdown !== undefined ? { pointsBreakdown } : {}),
      };
    };
    this.emitToUser(state.playerA.userId, 'live:reveal', revealFor(state.playerA.userId));
    if (state.playerB) {
      this.emitToUser(state.playerB.userId, 'live:reveal', revealFor(state.playerB.userId));
    }
    if (index + 1 < state.questions.length) {
      this.arm(
        `${duelId}:next`,
        this.config.LIVE_REVEAL_PAUSE_MS,
        () => void this.startQuestion(duelId, index + 1)
      );
    } else {
      this.arm(
        `${duelId}:settle`,
        this.config.LIVE_REVEAL_PAUSE_MS,
        () => void this.settleDuel(duelId, new Date())
      );
    }
  }

  // --- disconnect / reconnect / forfeit --------------------------------------------

  /**
   * A socket dropped mid-duel: mark the player disconnected and start
   * the 15-second grace (docs/05 §3.1). The opponent sees a
   * "reconnecting…" notice, not a forfeit — yet.
   */
  async handleDisconnect(userId: string, now: Date = new Date()): Promise<void> {
    const duelId = await this.redis.get(liveUserDuelKey(userId));
    if (!duelId) return;
    const state = await this.loadState(duelId);
    if (!state || state.phase === 'FINISHED') return;
    const side = this.sideOf(state, userId);
    if (!side || side.disconnectedAtMs !== null) return;
    side.disconnectedAtMs = now.getTime();
    await this.saveState(state);
    this.emitRoom(duelId, 'live:opponent-disconnected', {
      duelId,
      userId,
      graceSeconds: Math.round(this.config.LIVE_DISCONNECT_GRACE_MS / 1000),
    });
    this.arm(
      `${duelId}:grace:${userId}`,
      this.config.LIVE_DISCONNECT_GRACE_MS,
      () => void this.forfeitIfStillDisconnected(duelId, userId)
    );
  }

  /**
   * A socket reconnected: clear the grace, tell the opponent, and
   * resend the current question/countdown so play resumes where it
   * was. Late-join is impossible — only the two players on the duel
   * row ever receive its events (the gateway joins no other socket
   * to the room).
   */
  async handleReconnect(userId: string, now: Date = new Date()): Promise<void> {
    const duelId = await this.redis.get(liveUserDuelKey(userId));
    if (!duelId) return;
    const state = await this.loadState(duelId);
    if (!state || state.phase === 'FINISHED') return;
    const side = this.sideOf(state, userId);
    if (!side) return;
    const wasDisconnected = side.disconnectedAtMs !== null;
    side.disconnectedAtMs = null;
    await this.saveState(state);
    this.clearTimer(`${duelId}:grace:${userId}`);
    if (wasDisconnected) {
      this.emitRoom(duelId, 'live:opponent-reconnected', { duelId, userId });
    }
    // Re-arm the timers this process owns from the Redis state, so a
    // reconnect to a different server resumes the duel (docs/05 §3.4).
    this.rearmTimers(state, now);
    await this.resendCurrent(userId, state, now);
  }

  /** Grace expired with no reconnect: the disconnected player forfeits. */
  async forfeitIfStillDisconnected(duelId: string, userId: string): Promise<void> {
    const state = await this.loadState(duelId);
    if (!state || state.phase === 'FINISHED') return;
    const side = this.sideOf(state, userId);
    if (!side || side.disconnectedAtMs === null) return;
    this.logger.info('Live duel forfeit on disconnect', { duelId, userId });
    await this.settleDuel(duelId, new Date(), userId);
  }

  /** A player leaves voluntarily mid-duel: that is a forfeit too. */
  async leaveDuel(userId: string, duelId: string): Promise<void> {
    const state = await this.loadState(duelId);
    if (!state || state.phase === 'FINISHED') return;
    if (!this.sideOf(state, userId)) throw AppError.forbidden();
    await this.settleDuel(duelId, new Date(), userId);
  }

  // --- settlement (Ratings once, then results + XP in one transaction) ------------

  /**
   * Settles a live duel. Ordering follows ADR 0006/7: the Ratings call
   * runs FIRST (a cap failure fails cleanly there — see the fallback
   * below), then duel rows + both DuelGameResult rows + both XP grants
   * commit in one duels transaction. The idempotency key is
   * `duel:{duelId}`; a crash between the two steps is recovered by a
   * re-settle reading the deltas back from history (getDuelOutcome).
   *
   * Rating-cap fallback (deviation, ADR 0007 §8): if the Ratings call
   * fails on a cap/cooldown at settle time, the duel still settles —
   * result + XP are stored, the Rating is left unchanged, and the
   * reason says so in plain words. Losing a played duel's result
   * would be worse than a missed Rating update, and the caps are
   * checked again at the next duel.
   */
  async settleDuel(
    duelId: string,
    now: Date = new Date(),
    forfeitedByUserId?: string
  ): Promise<DuelResultView | null> {
    const state = await this.loadState(duelId);
    const duel = await this.repo.findDuelById(duelId);
    if (!duel) throw AppError.notFound('Duel not found.');
    if (duel.status === DuelStatus.SETTLED) {
      // Already settled (double timer / retry): replay, never re-apply.
      const existing = await this.duels.getResult(duel.playerAId, duelId);
      return existing as DuelResultView;
    }
    if (!state) {
      // Redis state lost mid-duel (docs/05 §3.2): void, no Rating change.
      this.logger.error('Live duel state lost in Redis — voiding without Rating change', {
        duelId,
      });
      throw AppError.serviceUnavailable(
        'This duel could not be finished — the live state was lost. No Rating changed.'
      );
    }
    state.phase = 'FINISHED';
    if (forfeitedByUserId) state.forfeitedByUserId = forfeitedByUserId;
    await this.saveState(state);

    const items = await this.bank.getItemsForGrading(questionIdsOf(duel));
    const playerIds = state.playerB
      ? [state.playerA.userId, state.playerB.userId]
      : [state.playerA.userId];
    const stats = new Map<string, GameStats>();
    for (const userId of playerIds) {
      await this.gradeSkips(userId, duel);
      const answers = await this.repo.listAnswers(duel.id, userId);
      stats.set(userId, buildGameStats(toGradedInputs(answers), toMeta(items)));
    }
    const aStats = stats.get(state.playerA.userId) as GameStats;
    const bStats = state.playerB ? (stats.get(state.playerB.userId) as GameStats) : null;
    const botStats = state.isBot
      ? {
          score: botScoreOf({ ...state, botAnsweredUpToIndex: state.questions.length - 1 }),
          correct: botCorrectOf({ ...state, botAnsweredUpToIndex: state.questions.length - 1 }),
          totalTimeMs: (state.botAnswers ?? []).reduce((s, a) => s + a.timeMs, 0),
        }
      : null;

    let outcomeA: Outcome;
    if (forfeitedByUserId) {
      outcomeA = forfeitedByUserId === state.playerA.userId ? 'LOSS' : 'WIN';
    } else if (state.isBot && botStats) {
      // Case Duel: the winner is decided on POINTS, not on best-action
      // count (a second-best pick still scores — ADR 0009 §3). Speed
      // Quiz and Blitz keep the correct-count rule below.
      outcomeA =
        state.variant === 'CASE'
          ? decideWinnerByPoints(
              { score: aStats.score, totalTimeMs: aStats.totalTimeMs },
              { score: botStats.score, totalTimeMs: botStats.totalTimeMs }
            )
          : decideWinner(
              { correct: aStats.correct, totalTimeMs: aStats.totalTimeMs },
              { correct: botStats.correct, totalTimeMs: botStats.totalTimeMs }
            );
    } else if (bStats) {
      outcomeA =
        state.variant === 'CASE'
          ? decideWinnerByPoints(
              { score: aStats.score, totalTimeMs: aStats.totalTimeMs },
              { score: bStats.score, totalTimeMs: bStats.totalTimeMs }
            )
          : decideWinner(
              { correct: aStats.correct, totalTimeMs: aStats.totalTimeMs },
              { correct: bStats.correct, totalTimeMs: bStats.totalTimeMs }
            );
    } else {
      outcomeA = 'DRAW';
    }

    // --- Ratings first (ADR 0006/7 ordering) --------------------------------------
    let ratingA: { ratingBefore: number; ratingAfter: number; delta: number } | null = null;
    let ratingB: { ratingBefore: number; ratingAfter: number; delta: number } | null = null;
    let ratingFailedReason: string | null = null;
    const key = `duel:${duel.id}`;
    try {
      if (state.isBot) {
        const res = await this.ratings.recordDuelVsBot(state.playerA.userId, outcomeA, key, now);
        ratingA = res.me;
      } else if (state.playerB) {
        const res = await this.recordRatedDuel(
          state.playerA.userId,
          state.playerB.userId,
          outcomeA,
          key,
          now
        );
        ratingA = res.me;
        ratingB = res.opponent;
      }
    } catch (err) {
      if (err instanceof AppError && err.code === ErrorCode.RATING_EVENT_DUPLICATE) {
        const recovered = await this.ratings.getDuelOutcome(state.playerA.userId, key);
        if (recovered) {
          ratingA = recovered.me;
          ratingB = recovered.opponent;
        }
      }
      if (!ratingA) {
        ratingFailedReason =
          err instanceof Error ? err.message : 'The Rating could not be updated.';
        this.logger.error('Live duel Rating failed at settlement — settling without Rating', {
          duelId,
          reason: ratingFailedReason,
        });
      }
    }

    const nameA = state.playerA.displayName;
    const nameB = state.isBot ? DUELS.BOT_NAME : (state.playerB?.displayName ?? 'Player');
    const ratingReasonA =
      ratingA === null
        ? `Your Rating could not be updated for this duel (${ratingFailedReason ?? 'limit reached'}). Your result and XP are saved.`
        : ratingReasonFor(
            outcomeA,
            nameB,
            state.isBot
              ? (ratingA?.ratingBefore ?? state.playerA.rating)
              : (ratingB?.ratingBefore ?? state.playerB?.rating ?? 1000),
            ratingA.delta
          );
    const ratingReasonB =
      ratingB === null
        ? `Your Rating could not be updated for this duel (${ratingFailedReason ?? 'limit reached'}). Your result and XP are saved.`
        : ratingReasonFor(
            mirrorOutcome(outcomeA),
            nameA,
            ratingA?.ratingBefore ?? state.playerB?.rating ?? 1000,
            ratingB.delta
          );

    const winnerId =
      outcomeA === 'WIN'
        ? state.playerA.userId
        : outcomeA === 'LOSS'
          ? (state.playerB?.userId ?? null)
          : null;

    await this.transactions.run(async (tx) => {
      const rewardsA = await this.gamification.grantDuelRewards(tx, {
        userId: state.playerA.userId,
        result: outcomeA,
        reason: 'duel.live_completed',
        xpIdempotencyKey: `duel:${duel.id}:${state.playerA.userId}`,
        atIso: now.toISOString(),
      });
      let rewardsB: RewardSummary | null = null;
      if (state.playerB) {
        rewardsB = await this.gamification.grantDuelRewards(tx, {
          userId: state.playerB.userId,
          result: mirrorOutcome(outcomeA),
          reason: 'duel.live_completed',
          xpIdempotencyKey: `duel:${duel.id}:${state.playerB.userId}`,
          atIso: now.toISOString(),
        });
      }
      await this.repo.updateDuel(
        duel.id,
        {
          status: DuelStatus.SETTLED,
          finishedAt: now,
          winnerId,
          botScore: state.isBot && botStats ? botStats.score : null,
          botCorrect: state.isBot && botStats ? botStats.correct : null,
          botTotalTimeMs: state.isBot && botStats ? botStats.totalTimeMs : null,
        },
        tx
      );
      await this.repo.createGameResult(
        this.resultInput(duel, state.playerA.userId, outcomeA, aStats, {
          before: ratingA?.ratingBefore ?? null,
          after: ratingA?.ratingAfter ?? null,
          delta: ratingA?.delta ?? null,
          reason: ratingReasonA,
          rewards: rewardsA,
        }),
        tx
      );
      if (state.playerB && bStats && rewardsB) {
        await this.repo.createGameResult(
          this.resultInput(duel, state.playerB.userId, mirrorOutcome(outcomeA), bStats, {
            before: ratingB?.ratingBefore ?? null,
            after: ratingB?.ratingAfter ?? null,
            delta: ratingB?.delta ?? null,
            reason: ratingReasonB,
            rewards: rewardsB,
          }),
          tx
        );
      }
    });

    this.clearTimers(duelId);
    await this.redis.del(liveDuelStateKey(duelId));
    await this.redis.del(liveUserDuelKey(state.playerA.userId));
    if (state.playerB) await this.redis.del(liveUserDuelKey(state.playerB.userId));

    // --- finished payloads (stored results, never recomputed) ----------------------
    for (const userId of playerIds) {
      const view = (await this.duels.getResult(userId, duelId)) as DuelResultView;
      const hostLine =
        view.result === 'WIN'
          ? HOST_RESULT_WIN
          : view.result === 'LOSS'
            ? HOST_RESULT_LOSS
            : HOST_RESULT_DRAW;
      this.emitToUser(userId, 'live:finished', {
        ...view,
        host: { name: variantConfig(state.variant).hostName, line: hostLine },
        forfeitedBy: state.forfeitedByUserId,
      });
    }
    this.logger.info('Live duel settled', { duelId, result: outcomeA, forfeitedByUserId });
    return (await this.duels.getResult(state.playerA.userId, duelId)) as DuelResultView;
  }

  // --- rematch ------------------------------------------------------------------------

  /**
   * One-tap rematch after a finished duel. Both players must ask; the
   * second ask creates the new duel directly (no re-queue). The
   * 5-minute rematch cooldown (docs/04 §5) is enforced HERE, at the
   * offer — not at settlement, where it would waste a played duel.
   * Returns `{ matched, newDuelId?, reason?, retryAfterMs? }`.
   */
  async rematch(
    userId: string,
    duelId: string,
    now: Date = new Date()
  ): Promise<{ matched: boolean; newDuelId?: string; reason?: string; retryAfterMs?: number }> {
    const duel = await this.repo.findDuelById(duelId);
    if (
      !duel ||
      (duel.type !== DuelType.LIVE &&
        duel.type !== DuelType.BLITZ &&
        duel.type !== DuelType.CASE &&
        duel.type !== DuelType.CHART)
    ) {
      throw AppError.notFound('Duel not found.');
    }
    if (duel.status !== DuelStatus.SETTLED) {
      throw AppError.duelLiveNotActive('This duel has not finished yet.');
    }
    if (duel.playerAId !== userId && duel.playerBId !== userId) throw AppError.forbidden();
    if (!duel.playerBId) {
      return { matched: false, reason: 'BOT_NO_REMATCH' };
    }
    const otherId = duel.playerAId === userId ? duel.playerBId : duel.playerAId;
    // The cooldown is per pair per variant: a Blitz rematch is not
    // blocked by a recent Speed Quiz against the same player.
    const last = await this.repo.findLastLiveDuelBetween(duel.playerAId, duel.playerBId, duel.type);
    const cooldownMs = 5 * 60 * 1000;
    if (last?.finishedAt && now.getTime() - last.finishedAt.getTime() < cooldownMs) {
      return {
        matched: false,
        reason: 'REMATCH_COOLDOWN',
        retryAfterMs: cooldownMs - (now.getTime() - last.finishedAt.getTime()),
      };
    }
    const key = `live:rematch:${duelId}`;
    const raw = await this.redis.get(key);
    const requested: string[] = raw ? (JSON.parse(raw) as string[]) : [];
    if (!requested.includes(userId)) requested.push(userId);
    await this.redis.set(key, JSON.stringify(requested), 300);
    if (!requested.includes(otherId)) {
      this.emitToUser(otherId, 'live:rematch-requested', { duelId, fromUserId: userId });
      return { matched: false, reason: 'WAITING_OPPONENT' };
    }
    await this.redis.del(key);
    const [aRatings, bRatings] = await Promise.all([
      this.ratings.getUserRatings(duel.playerAId),
      this.ratings.getUserRatings(otherId),
    ]);
    const aUser = await this.repo.findUserById(duel.playerAId);
    const bUser = await this.repo.findUserById(otherId);
    // A rematch replays the SAME variant (a Blitz rematch is Blitz,
    // a Case rematch is a Case Duel, a Chart rematch is Chart Detective).
    const variant: LiveDuelVariant =
      duel.type === DuelType.BLITZ
        ? 'BLITZ'
        : duel.type === DuelType.CASE
          ? 'CASE'
          : duel.type === DuelType.CHART
            ? 'CHART'
            : 'LIVE';
    const state = await this.createLiveDuel(
      {
        userId: duel.playerAId,
        displayName: aUser?.displayName ?? 'Player',
        rating: aRatings.learning.rating,
      },
      {
        userId: otherId,
        displayName: bUser?.displayName ?? 'Player',
        rating: bRatings.learning.rating,
      },
      now,
      variant
    );
    return { matched: true, newDuelId: state.duelId };
  }

  // --- reads (REST) ----------------------------------------------------------------------

  /** My active live duel, if any — for reconnect / resume on page load. */
  async activeDuelSummary(userId: string): Promise<{
    duelId: string;
    /** Live variant: 'LIVE' (Speed Quiz), 'BLITZ' (Myth vs Fact), 'CASE' (Case Duel), or 'CHART' (Chart Detective). */
    variant: LiveDuelVariant;
    /** Prisma DuelType of the duel (same value as variant for live duels). */
    type: DuelType;
    phase: string;
    currentIndex: number;
    totalQuestions: number;
    /** Per-question time limit for this variant (ms): 15000 (LIVE), 10000 (BLITZ), 45000 (CASE), 30000 (CHART). */
    timeLimitMs: number;
    questionDeadlineMs: number | null;
    serverNowMs: number;
    scores: ReturnType<typeof scoresOf>;
    opponent: {
      userId: string;
      displayName: string;
      kind: 'HUMAN' | 'BOT';
      /** The opponent's Rating at match time (from the Redis state) — the play pages show it on resume (Phase 12). */
      rating: number;
    } | null;
  } | null> {
    const duel = await this.repo.findActiveLiveDuelForUser(userId);
    if (!duel) return null;
    const state = await this.loadState(duel.id);
    if (!state) return null;
    const opponent = state.isBot
      ? {
          userId: 'bot:mira',
          displayName: DUELS.BOT_NAME,
          kind: 'BOT' as const,
          rating: state.playerA.rating,
        }
      : state.playerA.userId === userId
        ? {
            userId: state.playerB?.userId ?? '',
            displayName: state.playerB?.displayName ?? 'Player',
            kind: 'HUMAN' as const,
            rating: state.playerB?.rating ?? 1000,
          }
        : {
            userId: state.playerA.userId,
            displayName: state.playerA.displayName,
            kind: 'HUMAN' as const,
            rating: state.playerA.rating,
          };
    return {
      duelId: duel.id,
      variant: state.variant,
      type: duel.type,
      phase: state.phase,
      currentIndex: state.currentIndex,
      totalQuestions: state.questions.length,
      timeLimitMs: this.questionTimeMsFor(state.variant),
      questionDeadlineMs: state.questionDeadlineMs,
      serverNowMs: Date.now(),
      scores: scoresOf(state),
      opponent,
    };
  }

  // --- internals -------------------------------------------------------------------------

  private newState(
    duel: DuelRow,
    a: LivePlayerRef,
    b: LivePlayerRef | null,
    questions: LiveDuelState['questions'],
    botAnswers: LiveAnswerState[] | null,
    now: Date,
    variant: LiveDuelVariant = 'LIVE'
  ): LiveDuelState {
    const player = (ref: LivePlayerRef): LivePlayerState => ({
      userId: ref.userId,
      displayName: ref.displayName,
      rating: ref.rating,
      score: 0,
      correct: 0,
      totalTimeMs: 0,
      streak: 0,
      disconnectedAtMs: null,
    });
    return {
      duelId: duel.id,
      variant,
      playerA: player(a),
      playerB: b ? player(b) : null,
      isBot: b === null,
      botAnswers,
      botAnsweredUpToIndex: -1,
      questions,
      currentIndex: 0,
      phase: 'COUNTDOWN',
      countdownEndsAtMs: now.getTime() + this.config.LIVE_COUNTDOWN_MS,
      questionStartedAtMs: null,
      questionDeadlineMs: null,
      answers: {},
      reasons: {},
      reasonDeadlineMs: null,
      forfeitedByUserId: null,
      createdAtMs: now.getTime(),
    };
  }

  private async saveState(state: LiveDuelState): Promise<void> {
    await this.redis.set(
      liveDuelStateKey(state.duelId),
      JSON.stringify(state),
      DUELS.LIVE_STATE_TTL_SEC
    );
    await this.redis.set(
      liveUserDuelKey(state.playerA.userId),
      state.duelId,
      DUELS.LIVE_STATE_TTL_SEC
    );
    if (state.playerB) {
      await this.redis.set(
        liveUserDuelKey(state.playerB.userId),
        state.duelId,
        DUELS.LIVE_STATE_TTL_SEC
      );
    }
  }

  private async loadState(duelId: string): Promise<LiveDuelState | null> {
    return parseLiveDuelState(await this.redis.get(liveDuelStateKey(duelId)));
  }

  private sideOf(state: LiveDuelState, userId: string): LivePlayerState | null {
    if (state.playerA.userId === userId) return state.playerA;
    if (state.playerB?.userId === userId) return state.playerB;
    return null;
  }

  /** Both humans answered (or the human answered vs the bot) → reveal now. */
  private async maybeRevealEarly(state: LiveDuelState, now: Date): Promise<void> {
    const aAnswered = Boolean(state.answers[state.playerA.userId]?.[state.currentIndex]);
    if (state.isBot) {
      if (aAnswered) {
        if (state.botAnsweredUpToIndex >= state.currentIndex) {
          // Both sides have answered: close the question. For a Case
          // Duel that opens the reason window; otherwise reveal now.
          this.clearTimer(`${state.duelId}:question`);
          await this.closeQuestionForAnswers(state.duelId, state.currentIndex, now);
          return;
        }
        // Reveal when Mira's simulated time lands (her timer is armed).
        const botTime = state.botAnswers?.[state.currentIndex]?.timeMs ?? 0;
        const elapsed = now.getTime() - (state.questionStartedAtMs ?? now.getTime());
        const waitMs = Math.max(0, botTime - elapsed);
        this.clearTimer(`${state.duelId}:question`);
        this.arm(
          `${state.duelId}:reveal-early`,
          waitMs,
          () => void this.closeQuestionForAnswers(state.duelId, state.currentIndex)
        );
      }
      return;
    }
    const bAnswered = state.playerB
      ? Boolean(state.answers[state.playerB.userId]?.[state.currentIndex])
      : false;
    if (aAnswered && bAnswered) {
      this.clearTimer(`${state.duelId}:question`);
      // Case Duel: both answered → open the reason window, not reveal.
      await this.closeQuestionForAnswers(state.duelId, state.currentIndex, now);
    }
  }

  private rearmTimers(state: LiveDuelState, now: Date): void {
    if (state.phase === 'COUNTDOWN') {
      const waitMs = Math.max(0, state.countdownEndsAtMs - now.getTime());
      this.arm(`${state.duelId}:countdown`, waitMs, () => void this.startQuestion(state.duelId, 0));
    } else if (state.phase === 'IN_PROGRESS' && state.questionDeadlineMs !== null) {
      // A Case Duel in its reason window re-arms the REASON timer,
      // not the question timer (the 45 s deadline already passed).
      if (state.variant === 'CASE' && state.reasonDeadlineMs !== null) {
        const waitMs = Math.max(0, state.reasonDeadlineMs - now.getTime());
        this.arm(
          `${state.duelId}:reason`,
          waitMs,
          () => void this.revealQuestion(state.duelId, state.currentIndex)
        );
        return;
      }
      const waitMs = Math.max(0, state.questionDeadlineMs - now.getTime());
      this.arm(
        `${state.duelId}:question`,
        waitMs,
        () => void this.closeQuestionForAnswers(state.duelId, state.currentIndex)
      );
    }
  }

  private async resendCurrent(userId: string, state: LiveDuelState, now: Date): Promise<void> {
    if (state.phase === 'COUNTDOWN') {
      this.emitToUser(userId, 'live:countdown', {
        duelId: state.duelId,
        countdownEndsAtMs: state.countdownEndsAtMs,
        serverNowMs: now.getTime(),
      });
      return;
    }
    if (state.phase !== 'IN_PROGRESS') return;
    const question = state.questions[state.currentIndex];
    if (!question) return;
    this.emitToUser(userId, 'live:question', {
      duelId: state.duelId,
      index: state.currentIndex,
      total: state.questions.length,
      question,
      deadlineMs: state.questionDeadlineMs,
      serverNowMs: now.getTime(),
      timeLimitMs: this.questionTimeMsFor(state.variant),
      resumed: true,
      // Case Duel: a reconnect inside the reason window also learns
      // when that window closes, so the reason step can still be shown.
      reasonDeadlineMs: state.reasonDeadlineMs,
    });
  }

  /** Unanswered questions become skips (idempotent — only missing rows are created). */
  private async gradeSkips(userId: string, duel: DuelRow): Promise<void> {
    const existing = await this.repo.listAnswers(duel.id, userId);
    const answered = new Set(existing.map((a) => a.questionId));
    const ids = questionIdsOf(duel);
    for (let i = 0; i < ids.length; i++) {
      const qid = ids[i] as string;
      if (!answered.has(qid)) {
        await this.repo.createAnswer({
          duelId: duel.id,
          userId,
          questionId: qid,
          optionId: null,
          skipped: true,
          correct: false,
          timeMs: null,
          points: 0,
          reason: null,
          order: i,
        });
      }
    }
  }

  /**
   * Records a rated human duel, recovering the stored outcome when the
   * rating was already applied (same crash-recovery as ADR 0006/7).
   * A cap/cooldown error propagates to the caller's fallback.
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
        { opponentId, result: result as DtoDuelResult, idempotencyKey: key },
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
        reason: 'duel.live_completed',
        rewards: rating.rewards,
      } as unknown as Prisma.InputJsonValue,
    };
  }

  private arm(key: string, ms: number, fn: () => void): void {
    this.clearTimer(key);
    const t = setTimeout(fn, Math.max(0, ms));
    // Timers must not keep the process alive on shutdown.
    if (typeof t.unref === 'function') t.unref();
    this.timers.set(key, t);
  }

  private clearTimer(key: string): void {
    const t = this.timers.get(key);
    if (t) {
      clearTimeout(t);
      this.timers.delete(key);
    }
  }

  private emitRoom(duelId: string, event: string, payload: unknown): void {
    try {
      this.emitter?.toRoom(duelId, event, payload);
    } catch (err) {
      this.logger.error('Live duel emit to room failed', {
        duelId,
        event,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private emitToUser(userId: string, event: string, payload: unknown): void {
    try {
      this.emitter?.toUser(userId, event, payload);
    } catch (err) {
      this.logger.error('Live duel emit to user failed', {
        userId,
        event,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

function questionIdsOf(duel: DuelRow): string[] {
  const ids = duel.questionIds as unknown;
  if (!Array.isArray(ids) || ids.some((i) => typeof i !== 'string')) {
    throw new Error(`Duel ${duel.id} has a malformed question set.`);
  }
  return ids as string[];
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
