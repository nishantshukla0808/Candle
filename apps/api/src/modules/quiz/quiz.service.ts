import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { ErrorCode, QUIZ_PASS_MARK } from '@candle/shared';
import { AppError } from '../../common/errors/app-error';
import { AppLogger } from '../../common/services/logger.service';
import type { QuizSubmittedPayload } from '../../common/events/event-bus';
import { OutboxRepository } from '../../common/events/outbox.repository';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { TransactionService } from '../../database/transaction.service';
import type { TxClient } from '../../database/tx-client';
import { GamificationService, type RewardSummary } from '../gamification/gamification.service';
import { LearningService } from '../learning/learning.service';
import { SubmitQuizDto } from './dto/quiz.dto';
import { QuizRepository, type AttemptRow, type QuestionWithOptions } from './quiz.repository';

export interface QuizQuestionView {
  id: string;
  text: string;
  kind: 'SINGLE' | 'MULTI';
  order: number;
  points: number;
  options: Array<{ id: string; text: string; order: number }>;
}

export interface AttemptView {
  attemptId: string;
  lessonId: string;
  questions: QuizQuestionView[];
}

export interface QuestionFeedback {
  questionId: string;
  correct: boolean;
  selectedOptionIds: string[];
  correctOptionIds: string[];
  explanation: string;
  pointsAwarded: number;
}

export interface SubmitResponse {
  attemptId: string;
  score: number;
  totalPoints: number;
  passed: boolean;
  feedback: QuestionFeedback[];
  rewards: RewardSummary;
}

/**
 * QuizService — question bank, attempts, grading (blueprint §17).
 *
 * - Attempts snapshot the question order (shuffled per attempt).
 * - Submit is idempotent via Idempotency-Key (ADR 0002/7).
 * - Grading: SINGLE = exactly the one correct option; MULTI = exact set
 *   match. Skipped questions score 0.
 * - Passing (>= 70%) is recorded; the lesson completion gate reads it via
 *   getPassedAttempt (the learning module's public port into quiz).
 */
@Injectable()
export class QuizService {
  constructor(
    private readonly repo: QuizRepository,
    private readonly outbox: OutboxRepository,
    private readonly idempotency: IdempotencyService,
    private readonly transactions: TransactionService,
    private readonly logger: AppLogger,
    @Inject(forwardRef(() => LearningService))
    private readonly learning: LearningService,
    @Inject(forwardRef(() => GamificationService))
    private readonly gamification: GamificationService
  ) {}

  /** Starts an attempt on the lesson's current published version. */
  async startAttempt(userId: string, lessonId: string): Promise<AttemptView> {
    const detail = await this.learning.getLesson(lessonId, userId);
    if (detail.locked) throw AppError.prerequisiteNotCompleted();
    const version = await this.learning.getPublishedVersionForQuiz(lessonId);
    if (!version) throw AppError.notFound('This lesson is not published yet.');
    const questions = await this.repo.getVersionQuestions(version.id);
    if (questions.length === 0) {
      throw new AppError(ErrorCode.CONFLICT, 409, 'This lesson has no quiz yet.');
    }
    const questionIds = shuffle(questions.map((q) => q.id));
    const attempt = await this.repo.createAttempt({
      userId,
      lessonVersionId: version.id,
      questionIds,
    });
    await this.learning.markInProgress(userId, lessonId);
    return {
      attemptId: attempt.id,
      lessonId,
      questions: orderAs(questions, questionIds).map(stripAnswers),
    };
  }

  /** Submits answers. ONE transaction: grading, answers, XP, outbox (ADR 0002/2). */
  async submitAttempt(
    userId: string,
    attemptId: string,
    dto: SubmitQuizDto,
    idempotencyKey: string | undefined
  ): Promise<SubmitResponse> {
    await this.idempotency.guard(idempotencyKey, userId);
    const key = idempotencyKey as string;

    const attempt = await this.repo.getAttempt(attemptId);
    if (!attempt) throw AppError.notFound('Quiz attempt not found.');
    if (attempt.userId !== userId) throw AppError.forbidden();
    if (attempt.submittedAt) {
      const stored = await this.idempotency.find(key, userId);
      if (stored !== null) {
        throw new AppError(ErrorCode.IDEMPOTENCY_REPLAY, 409, undefined, { original: stored });
      }
      throw new AppError(ErrorCode.CONFLICT, 409, 'This attempt was already submitted.');
    }

    const questions = await this.repo.getVersionQuestions(attempt.lessonVersionId);
    const lessonId = await this.repo.getLessonIdForVersion(attempt.lessonVersionId);
    if (!lessonId) throw AppError.notFound('Quiz attempt not found.');
    const graded = grade(dto, questions);
    const passed = graded.totalPoints > 0 && graded.score / graded.totalPoints >= QUIZ_PASS_MARK;

    return this.transactions.run(async (tx) => {
      const submitted = await this.repo.submitAttempt(
        attemptId,
        {
          score: graded.score,
          totalPoints: graded.totalPoints,
          passed,
          idempotencyKey: key,
          answers: graded.answers,
        },
        tx
      );

      const event: QuizSubmittedPayload = {
        userId,
        lessonId,
        lessonVersionId: attempt.lessonVersionId,
        attemptId,
        passed,
        score: graded.score,
        totalPoints: graded.totalPoints,
        xpIdempotencyKey: `quiz:${attemptId}`,
        submittedAt: (submitted.submittedAt as Date).toISOString(),
      };
      const rewards = await this.gamification.grantQuizRewards(tx, event);
      await this.outbox.append('quiz.submitted', event, tx);

      const response: SubmitResponse = {
        attemptId,
        score: graded.score,
        totalPoints: graded.totalPoints,
        passed,
        feedback: graded.feedback,
        rewards,
      };
      await this.idempotency.store(key, userId, response, tx);
      this.logger.info('Quiz submitted', { userId, attemptId, passed, score: graded.score });
      return response;
    });
  }

  /** The caller's own attempt (with feedback after submit). */
  async getAttempt(
    userId: string,
    attemptId: string
  ): Promise<AttemptView & { submitted: boolean }> {
    const attempt = await this.repo.getAttempt(attemptId);
    if (!attempt) throw AppError.notFound('Quiz attempt not found.');
    if (attempt.userId !== userId) throw AppError.forbidden();
    const lessonId = await this.repo.getLessonIdForVersion(attempt.lessonVersionId);
    if (!lessonId) throw AppError.notFound('Quiz attempt not found.');
    const questions = await this.repo.getVersionQuestions(attempt.lessonVersionId);
    return {
      attemptId: attempt.id,
      lessonId,
      questions: orderAs(questions, attempt.questionIds as string[]).map(stripAnswers),
      submitted: attempt.submittedAt !== null,
    };
  }

  /**
   * Latest passed attempt for a lesson version — the learning module's
   * completion gate (public service interface, blueprint §4).
   */
  getPassedAttempt(
    userId: string,
    lessonVersionId: string,
    tx?: TxClient
  ): Promise<AttemptRow | null> {
    return this.repo.getPassedAttempt(userId, lessonVersionId, tx);
  }
}

// --- grading (pure, unit-tested) --------------------------------------------------------

interface GradedAnswer {
  questionId: string;
  selectedOptionIds: string[];
  isCorrect: boolean;
  pointsAwarded: number;
}

interface GradeResult {
  score: number;
  totalPoints: number;
  answers: GradedAnswer[];
  feedback: QuestionFeedback[];
}

export function grade(dto: SubmitQuizDto, questions: QuestionWithOptions[]): GradeResult {
  let score = 0;
  let totalPoints = 0;
  const answers: GradedAnswer[] = [];
  const feedback: QuestionFeedback[] = [];

  for (const q of questions) {
    totalPoints += q.points;
    const correctIds = new Set(q.options.filter((o) => o.isCorrect).map((o) => o.id));
    const submitted = dto.answers.find((a) => a.questionId === q.id);
    const selected = submitted ? [...new Set(submitted.selectedOptionIds)] : [];
    const selectedSet = new Set(selected);
    const isCorrect =
      selected.length > 0 &&
      selectedSet.size === correctIds.size &&
      [...selectedSet].every((id) => correctIds.has(id));
    const pointsAwarded = isCorrect ? q.points : 0;
    score += pointsAwarded;
    answers.push({ questionId: q.id, selectedOptionIds: selected, isCorrect, pointsAwarded });
    feedback.push({
      questionId: q.id,
      correct: isCorrect,
      selectedOptionIds: selected,
      correctOptionIds: [...correctIds],
      explanation: q.explanation,
      pointsAwarded,
    });
  }

  // Answers referencing unknown question ids are ignored — the DTO
  // validation rejects malformed ids, and grading only scores known ones.
  return { score, totalPoints, answers, feedback };
}

/** Fisher-Yates shuffle with crypto randomness. */
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

function stripAnswers(q: QuestionWithOptions): QuizQuestionView {
  return {
    id: q.id,
    text: q.text,
    kind: q.kind,
    order: q.order,
    points: q.points,
    options: q.options.map((o) => ({ id: o.id, text: o.text, order: o.order })),
  };
}
