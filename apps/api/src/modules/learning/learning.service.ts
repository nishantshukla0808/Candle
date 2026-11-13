import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { ErrorCode } from '@candle/shared';
import { ProgressStatus } from '@prisma/client';
import { AppError } from '../../common/errors/app-error';
import { AppLogger } from '../../common/services/logger.service';
import type { LessonCompletedPayload } from '../../common/events/event-bus';
import { OutboxRepository } from '../../common/events/outbox.repository';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { TransactionService } from '../../database/transaction.service';
import type { TxClient } from '../../database/tx-client';
import { GamificationService, type RewardSummary } from '../gamification/gamification.service';
import { OnboardingService } from '../onboarding/onboarding.service';
import { QuizService } from '../quiz/quiz.service';
import {
  LearningRepository,
  type LessonNode,
  type ModuleNode,
  type TrackNode,
} from './learning.repository';

/**
 * LearningService — tracks, lessons, completions (blueprint §17).
 *
 * Progression is linear across a track: lesson N unlocks when lesson N-1
 * is complete, and completing a lesson requires passing its quiz when the
 * published version has questions. Both rules are DOMAIN errors
 * (PREREQUISITE_NOT_COMPLETED), never validation errors (blueprint §8).
 */

export interface LessonWithProgress extends LessonNode {
  completed: boolean;
  locked: boolean;
}

export interface ModuleWithProgress extends Omit<ModuleNode, 'lessons'> {
  lessons: LessonWithProgress[];
}

export interface TrackWithProgress extends Omit<TrackNode, 'modules'> {
  modules: ModuleWithProgress[];
  totalLessons: number;
  completedLessons: number;
}

export interface LessonDetail {
  id: string;
  title: string;
  order: number;
  moduleId: string;
  moduleTitle: string;
  trackId: string;
  trackSlug: string;
  version: number;
  contentMarkdown: string;
  disclaimer: string;
  questionCount: number;
  completed: boolean;
  locked: boolean;
}

export interface CompletionResponse {
  completion: { id: string; lessonId: string; completedAt: Date };
  rewards: RewardSummary;
}

export const LESSON_DISCLAIMER =
  'Educational purpose only — this is not investment advice. All companies, ' +
  'tickers, and numbers are fictional illustrations.';

@Injectable()
export class LearningService {
  constructor(
    private readonly repo: LearningRepository,
    private readonly outbox: OutboxRepository,
    private readonly idempotency: IdempotencyService,
    private readonly transactions: TransactionService,
    private readonly logger: AppLogger,
    @Inject(forwardRef(() => GamificationService))
    private readonly gamification: GamificationService,
    @Inject(forwardRef(() => QuizService))
    private readonly quiz: QuizService,
    @Inject(forwardRef(() => OnboardingService))
    private readonly onboarding: OnboardingService
  ) {}

  // --- public reads (published content only) ------------------------------------

  async listTracks(): Promise<
    Array<{ id: string; slug: string; title: string; description: string }>
  > {
    const tracks = await this.repo.getPublishedTrackTree();
    return tracks.map((t) => ({
      id: t.id,
      slug: t.slug,
      title: t.title,
      description: t.description,
    }));
  }

  async getTrack(slug: string, userId?: string): Promise<TrackWithProgress> {
    const tracks = await this.repo.getPublishedTrackTree();
    const track = tracks.find((t) => t.slug === slug);
    if (!track) throw AppError.notFound('Track not found.');
    const completed = userId ? await this.repo.getCompletedLessonIds(userId) : new Set<string>();
    // Placement waiver (ADR 0004/5): modules with order below the waived
    // threshold unlock. Null when the user holds no waiver — the gate is
    // then byte-for-byte the old behavior.
    const waivedUpTo =
      userId !== undefined ? await this.onboarding.getWaivedUpToOrder(userId, track.id) : null;
    const order = this.flattenOrder(track);
    let completedCount = 0;
    const modules: ModuleWithProgress[] = track.modules.map((m) => ({
      ...m,
      lessons: m.lessons.map((l) => {
        const isCompleted = completed.has(l.id);
        if (isCompleted) completedCount += 1;
        const idx = order.indexOf(l.id);
        const locked =
          l.published === null || (idx > 0 && !completed.has(order[idx - 1] as string));
        const waived = waivedUpTo !== null && m.order < waivedUpTo;
        return { ...l, completed: isCompleted, locked: locked && !waived };
      }),
    }));
    return {
      ...track,
      modules,
      totalLessons: order.length,
      completedLessons: completedCount,
    };
  }

  async getLesson(lessonId: string, userId?: string): Promise<LessonDetail> {
    const family = await this.repo.getLessonWithTrack(lessonId);
    if (!family) throw AppError.notFound('Lesson not found.');
    const version = await this.repo.getPublishedVersion(lessonId);
    if (!version) throw AppError.notFound('This lesson is not published yet.');
    const track = await this.getTrack(family.module.track.slug, userId);
    const flat = this.flattenLessons(track);
    const node = flat.find((l) => l.id === lessonId);
    if (!node) throw AppError.notFound('Lesson not found.');
    return {
      id: family.id,
      title: version.title,
      order: family.order,
      moduleId: family.moduleId,
      moduleTitle: family.module.title,
      trackId: family.module.track.id,
      trackSlug: family.module.track.slug,
      version: version.version,
      contentMarkdown: version.contentMarkdown,
      disclaimer: LESSON_DISCLAIMER,
      questionCount: version.questions.length,
      completed: node.completed,
      locked: node.locked,
    };
  }

  /**
   * Published version with questions — the quiz module's read port.
   * Returns null when the lesson has no published version.
   */
  async getPublishedVersionForQuiz(lessonId: string, tx?: TxClient) {
    return this.repo.getPublishedVersion(lessonId, tx);
  }

  /** Marks a lesson IN_PROGRESS (quiz started). Public for the quiz module. */
  async markInProgress(userId: string, lessonId: string, tx?: TxClient): Promise<void> {
    const existing = await this.repo.findCompletion(userId, lessonId, tx);
    if (!existing) {
      await this.repo.upsertProgress(userId, lessonId, ProgressStatus.IN_PROGRESS, tx);
    }
  }

  /** Per-track progress for the gamification dashboard. */
  async getTrackProgress(userId: string): Promise<
    Array<{
      trackId: string;
      slug: string;
      title: string;
      totalLessons: number;
      completedLessons: number;
    }>
  > {
    const tracks = await this.repo.getPublishedTrackTree();
    const out = [];
    for (const t of tracks) {
      const total = await this.repo.countLessonsInTrack(t.id);
      const done = await this.repo.countCompletionsInTrack(userId, t.id);
      out.push({
        trackId: t.id,
        slug: t.slug,
        title: t.title,
        totalLessons: total,
        completedLessons: done,
      });
    }
    return out;
  }

  // --- completion (the transactional core) ----------------------------------------

  /**
   * Completes a lesson. ONE transaction holds: validations, the completion
   * row, progress, XP grant, streak update, badge checks, the outbox event,
   * and the idempotency record (blueprint §17, ADR 0002/2).
   *
   * Requires an Idempotency-Key header. Replays return 409
   * IDEMPOTENCY_REPLAY with the original result — never double-applied.
   */
  async completeLesson(
    userId: string,
    lessonId: string,
    idempotencyKey: string | undefined
  ): Promise<CompletionResponse> {
    await this.idempotency.guard(idempotencyKey, userId);
    const key = idempotencyKey as string;

    const family = await this.repo.getLessonWithTrack(lessonId);
    if (!family) throw AppError.notFound('Lesson not found.');
    const version = await this.repo.getPublishedVersion(lessonId);
    if (!version) throw AppError.notFound('This lesson is not published yet.');

    return this.transactions.run(async (tx) => {
      const existing = await this.repo.findCompletion(userId, lessonId, tx);
      if (existing) {
        // A concurrent request won the race: the idempotency record holds
        // the original response for a same-key replay.
        const stored = await this.idempotency.find(key, userId, tx);
        if (stored !== null) {
          throw new AppError(ErrorCode.IDEMPOTENCY_REPLAY, 409, undefined, { original: stored });
        }
        throw new AppError(ErrorCode.CONFLICT, 409, 'Lesson already completed.');
      }

      // Prerequisite: linear progression across the track.
      const order = await this.repo.getTrackLessonOrder(family.module.track.id, tx);
      const idx = order.indexOf(lessonId);
      if (idx > 0) {
        const prev = await this.repo.findCompletion(userId, order[idx - 1] as string, tx);
        if (!prev) {
          // Placement waiver (ADR 0004/5): the gate consults onboarding's
          // public interface. No-ops when the user holds no waiver.
          const waivedUpTo = await this.onboarding.getWaivedUpToOrder(
            userId,
            family.module.track.id,
            tx
          );
          const prevModuleOrder = await this.repo.getLessonModuleOrder(
            order[idx - 1] as string,
            tx
          );
          if (waivedUpTo === null || prevModuleOrder === null || prevModuleOrder >= waivedUpTo) {
            throw AppError.prerequisiteNotCompleted();
          }
        }
      }

      // Quiz gate: pass the current version's quiz first (when it has questions).
      let quizAttemptId: string | undefined;
      if (version.questions.length > 0) {
        const passed = await this.quiz.getPassedAttempt(userId, version.id, tx);
        if (!passed) {
          throw AppError.prerequisiteNotCompleted('Pass this lesson’s quiz before completing it.');
        }
        quizAttemptId = passed.id;
      }

      const completion = await this.repo.createCompletion(
        {
          userId,
          lessonId,
          lessonVersionId: version.id,
          ...(quizAttemptId ? { quizAttemptId } : {}),
          idempotencyKey: key,
        },
        tx
      );
      await this.repo.upsertProgress(userId, lessonId, ProgressStatus.COMPLETED, tx);

      const completionsInTrack = await this.repo.countCompletionsInTrack(
        userId,
        family.module.track.id,
        tx
      );
      const lessonsInTrack = await this.repo.countLessonsInTrack(family.module.track.id, tx);

      const event: LessonCompletedPayload = {
        userId,
        lessonId,
        lessonVersionId: version.id,
        completionId: completion.id,
        xpIdempotencyKey: `lesson:${completion.id}`,
        completedAt: completion.completedAt.toISOString(),
        trackId: family.module.track.id,
        trackSlug: family.module.track.slug,
        completionsCount: completionsInTrack,
        trackComplete: completionsInTrack >= lessonsInTrack && lessonsInTrack > 0,
      };

      const rewards = await this.gamification.grantCompletionRewards(tx, event);
      await this.outbox.append('lesson.completed', event, tx);

      const response: CompletionResponse = {
        completion: {
          id: completion.id,
          lessonId,
          completedAt: completion.completedAt,
        },
        rewards,
      };
      await this.idempotency.store(key, userId, response, tx);

      this.logger.info('Lesson completed', {
        userId,
        lessonId,
        xpAwarded: rewards.xpAwarded,
      });
      return response;
    });
  }

  // --- helpers -------------------------------------------------------------------------

  private flattenOrder(track: TrackNode): string[] {
    return track.modules.flatMap((m) => m.lessons.map((l) => l.id));
  }

  private flattenLessons(track: TrackWithProgress): LessonWithProgress[] {
    return track.modules.flatMap((m) => m.lessons);
  }
}
