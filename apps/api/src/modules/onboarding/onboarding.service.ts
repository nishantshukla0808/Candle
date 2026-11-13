import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import {
  ErrorCode,
  ONBOARDING_ATTEMPT_RESUME_HOURS,
  ONBOARDING_MAX_ATTEMPTS,
  ONBOARDING_RETAKE_COOLDOWN_DAYS,
} from '@candle/shared';
import { AnswerConfidence, PlacementChoice } from '@prisma/client';
import { AppError } from '../../common/errors/app-error';
import { AppLogger } from '../../common/services/logger.service';
import type {
  OnboardingAssessmentSubmittedPayload,
  OnboardingPlacementAcceptedPayload,
} from '../../common/events/event-bus';
import { OutboxRepository } from '../../common/events/outbox.repository';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { TransactionService } from '../../database/transaction.service';
import type { TxClient } from '../../database/tx-client';
import { GamificationService, type RewardSummary } from '../gamification/gamification.service';
import { AcceptPlacementDto, SubmitAssessmentDto } from './dto/onboarding.dto';
import { ONBOARDING_ASSESSMENT_SUBMITTED, ONBOARDING_PLACEMENT_ACCEPTED } from './events';
import {
  OnboardingRepository,
  type AttemptRow,
  type BankQuestionRow,
} from './onboarding.repository';
import { gradeAssessment, type Placement } from './scoring.service';

/** Track the v1 assessment bank is built for (spec §3.1). */
const ASSESSMENT_TRACK_SLUG = 'foundations';

export const ONBOARDING_DISCLAIMER = 'Educational purpose only — this is not investment advice.';

export interface ClientQuestionView {
  id: string;
  text: string;
  kind: 'SINGLE' | 'MULTI';
  order: number;
  options: Array<{ id: string; text: string; order: number }>;
}

export interface AssessmentAttemptView {
  attemptId: string;
  version: number;
  /** Questions WITHOUT topic keys, answers, or explanations (anti-gaming, spec §7). */
  questions: ClientQuestionView[];
}

export interface TopicLevelView {
  topicKey: string;
  level: number;
  label: string;
}

export interface SubmitAssessmentResponse {
  attemptId: string;
  /** Levels only — no scores, no answers (spec §7). */
  topics: TopicLevelView[];
  overallLevel: number;
  placement: Placement;
  submittedAt: Date;
}

export interface AcceptPlacementResponse {
  placementChoice: PlacementChoice;
  /** Null when the user chose FROM_BEGINNING or already held a waiver. */
  waivedUpToModuleOrder: number | null;
  rewards: RewardSummary;
}

/**
 * OnboardingService — knowledge assessment flow (docs/03-onboarding-assessment-design.md).
 *
 * Diagnostic, not summative: correct answers grant no XP. One transaction
 * per submit (grading → answers → result → profile → outbox, spec §6).
 * The one-time 50 XP bonus is granted on first accepted placement via the
 * gamification module's idempotent grant (ADR 0004/2).
 */
@Injectable()
export class OnboardingService {
  constructor(
    private readonly repo: OnboardingRepository,
    private readonly outbox: OutboxRepository,
    private readonly idempotency: IdempotencyService,
    private readonly transactions: TransactionService,
    private readonly logger: AppLogger,
    // Cross-module link, same pattern as learning.service: forwardRef so the
    // onboarding → gamification → learning → onboarding cycle resolves.
    @Inject(forwardRef(() => GamificationService))
    private readonly gamification: GamificationService
  ) {}

  /**
   * Public interface for the learning module's prerequisite gate (ADR 0004/5).
   * Returns the module order below which lessons are unlocked, or null when
   * the user holds no waiver (gate behavior unchanged).
   */
  async getWaivedUpToOrder(userId: string, trackId: string, tx?: TxClient): Promise<number | null> {
    const waiver = await this.repo.getWaiver(userId, trackId, tx);
    return waiver ? waiver.waivedUpToModuleOrder : null;
  }

  /** Starts (or resumes) an assessment attempt on the published bank. */
  async startAssessment(userId: string): Promise<AssessmentAttemptView> {
    const version = await this.repo.getPublishedVersion(ASSESSMENT_TRACK_SLUG);
    if (!version || version.questions.length === 0) {
      throw AppError.notFound('No published assessment is available yet.');
    }

    // Retake policy (spec §7): max attempts, then a cooldown between submits.
    const submittedCount = await this.repo.countSubmittedAttempts(userId, version.id);
    if (submittedCount >= ONBOARDING_MAX_ATTEMPTS) {
      throw new AppError(
        ErrorCode.ASSESSMENT_ATTEMPTS_EXHAUSTED,
        403,
        'You have used all assessment attempts for this version.'
      );
    }
    const latest = await this.repo.latestSubmittedAttempt(userId, version.id);
    if (latest?.submittedAt) {
      const cooldownMs = ONBOARDING_RETAKE_COOLDOWN_DAYS * 24 * 3600 * 1000;
      if (Date.now() - latest.submittedAt.getTime() < cooldownMs) {
        throw new AppError(
          ErrorCode.ASSESSMENT_RETAKE_TOO_SOON,
          429,
          'Please wait a few days before retaking the assessment.'
        );
      }
    }

    // Idempotent start: resume a fresh in-progress attempt instead of
    // minting a new one (spec §6).
    const resumeSince = new Date(Date.now() - ONBOARDING_ATTEMPT_RESUME_HOURS * 3600 * 1000);
    const existing = await this.repo.findResumableAttempt(userId, version.id, resumeSince);
    const attempt =
      existing ??
      (await this.repo.createAttempt({
        userId,
        versionId: version.id,
        questionIds: shuffle(version.questions.map((q) => q.id)),
      }));

    return {
      attemptId: attempt.id,
      version: version.version,
      questions: orderAs(version.questions, attempt.questionIds).map(toClientView),
    };
  }

  /**
   * Submits answers. ONE transaction: grading, answers, result, knowledge
   * profile, outbox event (spec §6). Requires an Idempotency-Key header.
   */
  async submitAssessment(
    userId: string,
    attemptId: string,
    dto: SubmitAssessmentDto,
    idempotencyKey: string | undefined
  ): Promise<SubmitAssessmentResponse> {
    await this.idempotency.guard(idempotencyKey, userId);
    const key = idempotencyKey as string;

    const attempt = await this.repo.getAttempt(attemptId);
    if (!attempt) {
      throw new AppError(ErrorCode.ASSESSMENT_NOT_FOUND, 404, 'Assessment attempt not found.');
    }
    if (attempt.userId !== userId) throw AppError.forbidden();
    if (attempt.status !== 'IN_PROGRESS') {
      const stored = await this.idempotency.find(key, userId);
      if (stored !== null) {
        throw new AppError(ErrorCode.IDEMPOTENCY_REPLAY, 409, undefined, { original: stored });
      }
      throw new AppError(
        ErrorCode.ASSESSMENT_ALREADY_SUBMITTED,
        409,
        'This assessment was already submitted.'
      );
    }

    this.validateAnswerSet(dto, attempt);

    const bank = await this.repo.getVersionQuestionsForGrading(attempt.versionId);
    const byId = new Map(bank.map((q) => [q.id, q]));
    const graded = gradeAssessment(
      dto.answers.map((a) => {
        const q = byId.get(a.questionId) as (typeof bank)[number];
        return {
          questionId: a.questionId,
          topicKey: q.topicKey,
          kind: q.kind,
          correctOptionIds: q.correctOptionIds,
          selectedOptionIds: [...new Set(a.selectedOptionIds)],
          confidence: a.confidence,
        };
      })
    );

    const version = await this.repo.getVersion(attempt.versionId);
    const computedAt = new Date().toISOString();
    const topicLevelsJson = {
      shapeVersion: 1,
      assessmentVersion: version?.version ?? 1,
      computedAt,
      overallLevel: graded.overallLevel,
      topics: Object.fromEntries(
        graded.topics.map((t) => [
          t.topicKey,
          { level: t.level, score: t.score, maxScore: t.maxScore },
        ])
      ),
      placement: {
        kind: graded.placement.kind,
        recommendedStartModuleOrder: graded.placement.recommendedStartModuleOrder,
        userChoice: null,
      },
    };

    return this.transactions.run(async (tx) => {
      const { submittedAt } = await this.repo.submitAttemptTx(tx, {
        attemptId,
        idempotencyKey: key,
        answers: graded.answers.map((a) => ({
          questionId: a.questionId,
          selectedOptionIds:
            dto.answers.find((d) => d.questionId === a.questionId)?.selectedOptionIds ?? [],
          confidence: a.confidence,
          isCorrect: a.isCorrect,
          pointsAwarded: a.pointsAwarded,
        })),
        topicLevels: topicLevelsJson,
        overallLevel: graded.overallLevel,
        placementKind: graded.placement.kind,
        recommendedStartModuleOrder: graded.placement.recommendedStartModuleOrder,
        userId,
        versionId: attempt.versionId,
      });

      const event: OnboardingAssessmentSubmittedPayload = {
        userId,
        attemptId,
        versionId: attempt.versionId,
        overallLevel: graded.overallLevel,
        submittedAt: submittedAt.toISOString(),
      };
      await this.outbox.append(ONBOARDING_ASSESSMENT_SUBMITTED, event, tx);

      const response: SubmitAssessmentResponse = {
        attemptId,
        topics: graded.topics.map((t) => ({
          topicKey: t.topicKey,
          level: t.level,
          label: t.label,
        })),
        overallLevel: graded.overallLevel,
        placement: graded.placement,
        submittedAt,
      };
      await this.idempotency.store(key, userId, response, tx);
      this.logger.info('Assessment submitted', {
        userId,
        attemptId,
        overallLevel: graded.overallLevel,
      });
      return response;
    });
  }

  /** Abandons an in-progress attempt (user exits mid-flow). Idempotent. */
  async abandonAssessment(userId: string, attemptId: string): Promise<void> {
    const attempt = await this.repo.getAttempt(attemptId);
    if (!attempt) {
      throw new AppError(ErrorCode.ASSESSMENT_NOT_FOUND, 404, 'Assessment attempt not found.');
    }
    if (attempt.userId !== userId) throw AppError.forbidden();
    if (attempt.status === 'SUBMITTED') {
      throw new AppError(
        ErrorCode.ASSESSMENT_ALREADY_SUBMITTED,
        409,
        'This assessment was already submitted.'
      );
    }
    if (attempt.status === 'IN_PROGRESS') {
      await this.repo.abandonAttempt(attemptId);
    }
  }

  /**
   * Accepts placement. ONE transaction: result choice, optional single-use
   * waiver, profile choice patch, the one-time 50 XP bonus, outbox event.
   * The bonus key is per-user (`onboarding:{userId}`) so retakes can never
   * re-grant it (ADR 0004/2).
   */
  async acceptPlacement(userId: string, dto: AcceptPlacementDto): Promise<AcceptPlacementResponse> {
    const result = await this.repo.getLatestResult(userId);
    if (!result) {
      throw new AppError(
        ErrorCode.ASSESSMENT_NOT_FOUND,
        404,
        'No submitted assessment found. Complete the assessment first.'
      );
    }
    if (result.placementChoice !== null) {
      throw new AppError(
        ErrorCode.PLACEMENT_ALREADY_ACCEPTED,
        409,
        'Placement was already accepted for this assessment.'
      );
    }
    const attempt = await this.repo.getAttempt(result.attemptId);
    if (!attempt) {
      throw new AppError(ErrorCode.ASSESSMENT_NOT_FOUND, 404, 'Assessment attempt not found.');
    }

    return this.transactions.run(async (tx) => {
      let waivedUpToModuleOrder: number | null = null;
      if (dto.choice === PlacementChoice.RECOMMENDED) {
        // Single-use per track (spec §7): never issue a second waiver.
        const existing = await this.repo.getWaiver(userId, attempt.trackId, tx);
        if (!existing) {
          waivedUpToModuleOrder = result.recommendedStartModuleOrder;
        }
      }
      await this.repo.acceptPlacementTx(tx, {
        resultId: result.id,
        choice: dto.choice,
        ...(waivedUpToModuleOrder !== null
          ? {
              waiver: {
                userId,
                trackId: attempt.trackId,
                waivedUpToModuleOrder,
              },
            }
          : {}),
      });
      await this.repo.updateProfileChoice(
        tx,
        userId,
        dto.choice === PlacementChoice.RECOMMENDED ? 'recommended' : 'from_beginning'
      );

      const placedAt = new Date().toISOString();
      const event: OnboardingPlacementAcceptedPayload = {
        userId,
        attemptId: result.attemptId,
        trackId: attempt.trackId,
        xpIdempotencyKey: `onboarding:${userId}`,
        placedAt,
      };
      const rewards = await this.gamification.grantOnboardingRewards(tx, event);
      await this.outbox.append(ONBOARDING_PLACEMENT_ACCEPTED, event, tx);

      this.logger.info('Placement accepted', {
        userId,
        choice: dto.choice,
        waivedUpToModuleOrder,
        xpAwarded: rewards.xpAwarded,
      });
      return {
        placementChoice: dto.choice,
        waivedUpToModuleOrder,
        rewards,
      };
    });
  }

  /** The caller's current knowledge profile (null when never assessed). */
  async getProfile(userId: string): Promise<ProfileRowView | null> {
    const profile = await this.repo.getProfile(userId);
    if (!profile) return null;
    return {
      versionId: profile.versionId,
      attemptId: profile.attemptId,
      topicLevels: profile.topicLevels,
      overallLevel: profile.overallLevel,
      computedAt: profile.computedAt,
    };
  }

  /** Full bank with answers/explanations — ADMIN review only. */
  async getBank() {
    return this.repo.getBank();
  }

  // --- validation ---------------------------------------------------------------

  /**
   * The answer set must cover every presented question exactly once
   * (spec §11: 11- or 13-answer submits, bad UUIDs, duplicates are tested).
   */
  private validateAnswerSet(dto: SubmitAssessmentDto, attempt: AttemptRow): void {
    const presented = new Set(attempt.questionIds);
    const seen = new Set<string>();
    for (const a of dto.answers) {
      if (seen.has(a.questionId)) {
        throw AppError.validationFailed([
          { field: 'answers', issue: `Duplicate answer for question ${a.questionId}.` },
        ]);
      }
      seen.add(a.questionId);
      if (!presented.has(a.questionId)) {
        throw AppError.validationFailed([
          { field: 'answers', issue: `Unknown question ${a.questionId} for this attempt.` },
        ]);
      }
    }
    for (const id of presented) {
      if (!seen.has(id)) {
        throw AppError.validationFailed([
          { field: 'answers', issue: `Missing answer for question ${id}.` },
        ]);
      }
    }
    // SKIPPED confidence with selections is contradictory — normalize the
    // check: a skip must carry no selections.
    for (const a of dto.answers) {
      if (a.confidence === AnswerConfidence.SKIPPED && a.selectedOptionIds.length > 0) {
        throw AppError.validationFailed([
          {
            field: 'answers',
            issue: `Question ${a.questionId}: skipped answers must have no selections.`,
          },
        ]);
      }
    }
  }
}

interface ProfileRowView {
  versionId: string;
  attemptId: string;
  topicLevels: unknown;
  overallLevel: number;
  computedAt: Date;
}

/** Fisher-Yates shuffle with crypto randomness (mirrors the quiz module). */
function shuffle<T>(input: T[]): T[] {
  const arr = [...input];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    const a = arr[i] as T;
    arr[i] = arr[j] as T;
    arr[j] = a;
  }
  return arr;
}

function orderAs<T extends { id: string }>(questions: T[], ids: string[]): T[] {
  const byId = new Map(questions.map((q) => [q.id, q]));
  const ordered: T[] = [];
  for (const id of ids) {
    const q = byId.get(id);
    if (q) ordered.push(q);
  }
  return ordered;
}

/** Strips everything the client must never see (spec §7: anti-gaming). */
function toClientView(q: BankQuestionRow, index: number): ClientQuestionView {
  return {
    id: q.id,
    text: q.text,
    kind: q.kind,
    order: index,
    options: q.options.map((o) => ({ id: o.id, text: o.text, order: o.order })),
  };
}
