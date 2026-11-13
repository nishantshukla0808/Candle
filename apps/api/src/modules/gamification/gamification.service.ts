import { Inject, Injectable, OnModuleInit, forwardRef } from '@nestjs/common';
import { LEVEL_XP_THRESHOLDS, XP } from '@candle/shared';
import { AppLogger } from '../../common/services/logger.service';
import {
  EventBus,
  type LessonCompletedPayload,
  type OnboardingPlacementAcceptedPayload,
  type QuizSubmittedPayload,
  type TradeExecutedPayload,
} from '../../common/events/event-bus';
import { TransactionService } from '../../database/transaction.service';
import type { TxClient } from '../../database/tx-client';
import { LearningService } from '../learning/learning.service';
import { BadgeService } from './badge.service';
import {
  GamificationRepository,
  type BadgeRow,
  type UserStatsRow,
} from './gamification.repository';
import { StreakService } from './streak.service';

export interface RewardSummary {
  xpAwarded: number;
  totalXp: number;
  level: number;
  levelUp: boolean;
  currentStreak: number;
  longestStreak: number;
  newBadges: BadgeRow[];
  /** False when the reward was already applied (idempotent replay). */
  applied: boolean;
}

export interface DashboardResponse {
  stats: {
    totalXp: number;
    level: number;
    currentStreak: number;
    longestStreak: number;
    xpToNextLevel: number | null;
  };
  badges: Array<BadgeRow & { awardedAt: Date }>;
  tracks: Array<{
    trackId: string;
    slug: string;
    title: string;
    totalLessons: number;
    completedLessons: number;
  }>;
}

/** Level N is reached when totalXp >= LEVEL_XP_THRESHOLDS[N-1]. */
export function levelForXp(totalXp: number): number {
  let level = 1;
  for (let i = 0; i < LEVEL_XP_THRESHOLDS.length; i++) {
    const threshold = LEVEL_XP_THRESHOLDS[i];
    if (threshold !== undefined && totalXp >= threshold) level = i + 1;
  }
  return level;
}

/**
 * GamificationService — XP, levels, streaks, badges (blueprint §17).
 *
 * Rewards are computed from domain events (`lesson.completed`,
 * `quiz.submitted`) and applied idempotently: `XpLedger.idempotencyKey`
 * is unique, so neither the primary path (called with the completion
 * transaction) nor the outbox-relay recovery path can double-count
 * (ADR 0002/2).
 */
@Injectable()
export class GamificationService implements OnModuleInit {
  constructor(
    private readonly repo: GamificationRepository,
    private readonly streaks: StreakService,
    private readonly badges: BadgeService,
    private readonly bus: EventBus,
    private readonly transactions: TransactionService,
    private readonly logger: AppLogger,
    @Inject(forwardRef(() => LearningService))
    private readonly learning: LearningService
  ) {}

  onModuleInit(): void {
    // Recovery path: the outbox relay redelivers events after a crash.
    // The same idempotent grant methods run — already-applied rewards
    // are safe no-ops.
    this.bus.on('lesson.completed', (p) => {
      void this.recover('lesson', p as LessonCompletedPayload);
    });
    this.bus.on('quiz.submitted', (p) => {
      void this.recover('quiz', p as QuizSubmittedPayload);
    });
    this.bus.on('trade.executed', (p) => {
      void this.recover('trade', p as TradeExecutedPayload);
    });
    this.bus.on('onboarding.placement_accepted', (p) => {
      void this.recover('onboarding', p as OnboardingPlacementAcceptedPayload);
    });
  }

  private async recover(
    kind: 'lesson' | 'quiz' | 'trade' | 'onboarding',
    payload:
      | LessonCompletedPayload
      | QuizSubmittedPayload
      | TradeExecutedPayload
      | OnboardingPlacementAcceptedPayload
  ): Promise<void> {
    try {
      await this.transactions.run(async (tx) => {
        if (kind === 'lesson') {
          await this.grantCompletionRewards(tx, payload as LessonCompletedPayload);
        } else if (kind === 'quiz') {
          await this.grantQuizRewards(tx, payload as QuizSubmittedPayload);
        } else if (kind === 'trade') {
          await this.grantTradeRewards(tx, payload as TradeExecutedPayload);
        } else {
          await this.grantOnboardingRewards(tx, payload as OnboardingPlacementAcceptedPayload);
        }
      });
    } catch (err) {
      this.logger.error('Gamification recovery failed', {
        kind,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Applies lesson-completion rewards inside the caller's transaction.
   * Idempotent: replays with the same xpIdempotencyKey change nothing.
   */
  async grantCompletionRewards(
    tx: TxClient,
    event: LessonCompletedPayload
  ): Promise<RewardSummary> {
    const stats = await this.repo.getOrCreateStats(event.userId, tx);
    const applied = await this.repo.appendXp(
      event.userId,
      XP.LESSON_COMPLETION,
      'lesson.completed',
      event.xpIdempotencyKey,
      tx
    );
    if (!applied) return this.summary(stats, 0, [], false);

    stats.totalXp += XP.LESSON_COMPLETION;
    const newBadges = await this.applyProgress(tx, stats, event.completedAt);

    const completionBadges = await this.badges.checkAfterCompletion(
      event.userId,
      event.completionsCount,
      event.trackComplete,
      tx
    );
    newBadges.push(...completionBadges);
    return this.summary(stats, XP.LESSON_COMPLETION, newBadges, true);
  }

  /**
   * Applies quiz-submit rewards inside the caller's transaction.
   * XP is granted only for passed attempts; the streak counts any submit.
   */
  async grantQuizRewards(tx: TxClient, event: QuizSubmittedPayload): Promise<RewardSummary> {
    const stats = await this.repo.getOrCreateStats(event.userId, tx);
    const xp = event.passed ? XP.QUIZ_PASS : 0;
    let applied = true;
    if (xp > 0) {
      applied = await this.repo.appendXp(
        event.userId,
        xp,
        'quiz.passed',
        event.xpIdempotencyKey,
        tx
      );
    }
    if (!applied) return this.summary(stats, 0, [], false);

    stats.totalXp += xp;
    const newBadges = await this.applyProgress(tx, stats, event.submittedAt);
    const quizBadges = await this.badges.checkAfterQuiz(
      event.userId,
      event.score === event.totalPoints && event.totalPoints > 0,
      tx
    );
    newBadges.push(...quizBadges);
    return this.summary(stats, xp, newBadges, true);
  }

  /**
   * Applies simulator-trade rewards inside the caller's transaction
   * (ADR 0003/5). One small XP grant per executed trade, idempotent by
   * the order's xpIdempotencyKey — the in-transaction call and the
   * outbox-relay recovery path can never double-count.
   */
  async grantTradeRewards(tx: TxClient, event: TradeExecutedPayload): Promise<RewardSummary> {
    const stats = await this.repo.getOrCreateStats(event.userId, tx);
    const applied = await this.repo.appendXp(
      event.userId,
      XP.TRADE_EXECUTED,
      'trade.executed',
      event.xpIdempotencyKey,
      tx
    );
    if (!applied) return this.summary(stats, 0, [], false);

    stats.totalXp += XP.TRADE_EXECUTED;
    const newBadges = await this.applyProgress(tx, stats, event.executedAt);
    return this.summary(stats, XP.TRADE_EXECUTED, newBadges, true);
  }

  /**
   * Applies duel-completion rewards inside the caller's transaction
   * (ADR 0006/8). No new XP values: a win grants XP.QUIZ_PASS (20, the
   * existing "passed a challenge" value), a draw grants
   * XP.TRADE_EXECUTED (5, the existing small-participation value), a
   * loss grants 0 — but the streak still counts the completion, exactly
   * like a quiz submit (applyProgress runs even at 0 XP). Idempotent by
   * xpIdempotencyKey (`duel:{duelId}:{userId}`): a finish replay is a
   * safe no-op, and the finish-replay path (not the outbox) is the
   * recovery path for duels, so no `duel.completed` event is emitted.
   */
  async grantDuelRewards(
    tx: TxClient,
    event: {
      userId: string;
      result: 'WIN' | 'DRAW' | 'LOSS';
      reason:
        | 'duel.bot_completed'
        | 'duel.daily_completed'
        | 'duel.live_completed'
        | 'duel.sprint_completed'
        | 'duel.crisis_completed'
        | 'duel.weekly_completed';
      xpIdempotencyKey: string;
      atIso: string;
    }
  ): Promise<RewardSummary> {
    const stats = await this.repo.getOrCreateStats(event.userId, tx);
    const xp =
      event.result === 'WIN' ? XP.QUIZ_PASS : event.result === 'DRAW' ? XP.TRADE_EXECUTED : 0;
    let applied = true;
    if (xp > 0) {
      applied = await this.repo.appendXp(
        event.userId,
        xp,
        event.reason,
        event.xpIdempotencyKey,
        tx
      );
    }
    if (!applied) return this.summary(stats, 0, [], false);

    stats.totalXp += xp;
    const newBadges = await this.applyProgress(tx, stats, event.atIso);
    return this.summary(stats, xp, newBadges, true);
  }

  /**
   * Applies the one-time onboarding completion bonus inside the caller's
   * transaction (ADR 0004/2). Idempotent by xpIdempotencyKey
   * (`onboarding:{userId}:{attemptId}`) — the in-transaction call and the
   * outbox-relay recovery path can never double-count.
   */
  async grantOnboardingRewards(
    tx: TxClient,
    event: OnboardingPlacementAcceptedPayload
  ): Promise<RewardSummary> {
    const stats = await this.repo.getOrCreateStats(event.userId, tx);
    const applied = await this.repo.appendXp(
      event.userId,
      XP.ONBOARDING_BONUS,
      'onboarding.completed',
      event.xpIdempotencyKey,
      tx
    );
    if (!applied) return this.summary(stats, 0, [], false);

    stats.totalXp += XP.ONBOARDING_BONUS;
    const newBadges = await this.applyProgress(tx, stats, event.placedAt);
    return this.summary(stats, XP.ONBOARDING_BONUS, newBadges, true);
  }

  /** Shared tail: level, streak, persist. Returns newly awarded badges. */
  private async applyProgress(
    tx: TxClient,
    stats: UserStatsRow,
    atIso: string
  ): Promise<BadgeRow[]> {
    const newLevel = levelForXp(stats.totalXp);
    stats.level = newLevel;

    const today = this.streaks.kolkataDateString(new Date(atIso));
    const next = this.streaks.nextStreak(stats.lastActivityDate, today, stats.currentStreak);
    stats.currentStreak = next.streak;
    stats.longestStreak = Math.max(stats.longestStreak, next.streak);
    stats.lastActivityDate = today;
    await this.repo.saveStats(stats, tx);

    return this.badges.checkAfterStreak(stats.userId, stats.currentStreak, tx);
  }

  private summary(
    stats: UserStatsRow,
    xpAwarded: number,
    newBadges: BadgeRow[],
    applied: boolean
  ): RewardSummary {
    const prevLevel = levelForXp(stats.totalXp - xpAwarded);
    return {
      xpAwarded,
      totalXp: stats.totalXp,
      level: stats.level,
      levelUp: applied && stats.level > prevLevel,
      currentStreak: stats.currentStreak,
      longestStreak: stats.longestStreak,
      newBadges,
      applied,
    };
  }

  async getDashboard(userId: string): Promise<DashboardResponse> {
    const stats = await this.repo.getOrCreateStats(userId);
    const badges = await this.repo.getUserBadges(userId);
    const tracks = await this.learning.getTrackProgress(userId);
    const nextThreshold = LEVEL_XP_THRESHOLDS[stats.level];
    return {
      stats: {
        totalXp: stats.totalXp,
        level: stats.level,
        currentStreak: stats.currentStreak,
        longestStreak: stats.longestStreak,
        xpToNextLevel:
          nextThreshold !== undefined ? Math.max(0, nextThreshold - stats.totalXp) : null,
      },
      badges,
      tracks,
    };
  }
}
