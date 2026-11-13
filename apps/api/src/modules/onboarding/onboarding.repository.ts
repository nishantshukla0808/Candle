import { Injectable } from '@nestjs/common';
import {
  AnswerConfidence,
  AssessmentAttemptStatus,
  PlacementChoice,
  PlacementKind,
  Prisma,
  QuestionKind,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import type { TxClient } from '../../database/tx-client';

/**
 * OnboardingRepository — the ONLY file that touches Prisma for the
 * onboarding module (blueprint §4). Methods accept an optional transaction
 * client (ADR 0002/9).
 *
 * The bank (versions/questions/options) is seeded, never written at
 * runtime. Answers, attempts, results, profiles, and waivers are the
 * runtime writes — all inside service-orchestrated transactions.
 */

export interface BankQuestionRow {
  id: string;
  topicKey: string;
  difficulty: number;
  kind: QuestionKind;
  text: string;
  order: number;
  options: Array<{ id: string; text: string; order: number }>;
}

export interface BankQuestionWithAnswers extends BankQuestionRow {
  explanation: string;
  options: Array<{ id: string; text: string; order: number; isCorrect: boolean }>;
}

export interface AssessmentVersionRow {
  id: string;
  version: number;
  trackId: string;
}

export interface AttemptRow {
  id: string;
  userId: string;
  versionId: string;
  trackId: string;
  questionIds: string[];
  status: AssessmentAttemptStatus;
  startedAt: Date;
  submittedAt: Date | null;
  idempotencyKey: string | null;
}

export interface ResultRow {
  id: string;
  attemptId: string;
  userId: string;
  topicLevels: Prisma.JsonValue;
  overallLevel: number;
  placementKind: PlacementKind;
  recommendedStartModuleOrder: number;
  placementChoice: PlacementChoice | null;
  placedAt: Date | null;
}

export interface ProfileRow {
  userId: string;
  versionId: string;
  attemptId: string;
  topicLevels: Prisma.JsonValue;
  overallLevel: number;
  computedAt: Date;
}

export interface SubmitAnswerInput {
  questionId: string;
  selectedOptionIds: string[];
  confidence: AnswerConfidence;
  isCorrect: boolean;
  pointsAwarded: number;
}

const questionOrder = { orderBy: { order: 'asc' } } as const;

@Injectable()
export class OnboardingRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Latest published bank version for a track slug, with questions (no answers). */
  async getPublishedVersion(
    trackSlug: string
  ): Promise<(AssessmentVersionRow & { questions: BankQuestionRow[] }) | null> {
    const track = await this.prisma.track.findUnique({ where: { slug: trackSlug } });
    if (!track) return null;
    const version = await this.prisma.assessmentVersion.findFirst({
      where: { trackId: track.id, status: 'PUBLISHED' },
      orderBy: { version: 'desc' },
      include: {
        questions: {
          ...questionOrder,
          include: { options: { ...questionOrder } },
        },
      },
    });
    if (!version) return null;
    return {
      id: version.id,
      version: version.version,
      trackId: version.trackId,
      questions: version.questions.map((q) => ({
        id: q.id,
        topicKey: q.topicKey,
        difficulty: q.difficulty,
        kind: q.kind,
        text: q.text,
        order: q.order,
        options: q.options.map((o) => ({ id: o.id, text: o.text, order: o.order })),
      })),
    };
  }

  /** Version metadata (number, track) — for the profile contract. */
  async getVersion(versionId: string): Promise<AssessmentVersionRow | null> {
    const v = await this.prisma.assessmentVersion.findUnique({
      where: { id: versionId },
    });
    return v ? { id: v.id, version: v.version, trackId: v.trackId } : null;
  }

  /** Full bank (with answers/explanations) — ADMIN read only. */
  async getBank(): Promise<Array<AssessmentVersionRow & { questions: BankQuestionWithAnswers[] }>> {
    const versions = await this.prisma.assessmentVersion.findMany({
      orderBy: { version: 'desc' },
      include: {
        questions: {
          ...questionOrder,
          include: { options: { ...questionOrder } },
        },
      },
    });
    return versions.map((v) => ({
      id: v.id,
      version: v.version,
      trackId: v.trackId,
      questions: v.questions.map((q) => ({
        id: q.id,
        topicKey: q.topicKey,
        difficulty: q.difficulty,
        kind: q.kind,
        text: q.text,
        explanation: q.explanation,
        order: q.order,
        options: q.options.map((o) => ({
          id: o.id,
          text: o.text,
          order: o.order,
          isCorrect: o.isCorrect,
        })),
      })),
    }));
  }

  /** Questions with correct flags — grading only, never served to clients. */
  async getVersionQuestionsForGrading(
    versionId: string
  ): Promise<Array<BankQuestionWithAnswers & { correctOptionIds: string[] }>> {
    const questions = await this.prisma.assessmentQuestion.findMany({
      where: { versionId },
      ...questionOrder,
      include: { options: { ...questionOrder } },
    });
    return questions.map((q) => ({
      id: q.id,
      topicKey: q.topicKey,
      difficulty: q.difficulty,
      kind: q.kind,
      text: q.text,
      explanation: q.explanation,
      order: q.order,
      options: q.options.map((o) => ({
        id: o.id,
        text: o.text,
        order: o.order,
        isCorrect: o.isCorrect,
      })),
      correctOptionIds: q.options.filter((o) => o.isCorrect).map((o) => o.id),
    }));
  }

  async createAttempt(data: {
    userId: string;
    versionId: string;
    questionIds: string[];
  }): Promise<AttemptRow> {
    const row = await this.prisma.assessmentAttempt.create({
      data: {
        userId: data.userId,
        versionId: data.versionId,
        questionIds: data.questionIds,
      },
      include: { version: true },
    });
    return this.toAttemptRow(row);
  }

  async getAttempt(attemptId: string): Promise<AttemptRow | null> {
    const row = await this.prisma.assessmentAttempt.findUnique({
      where: { id: attemptId },
      include: { version: true },
    });
    return row ? this.toAttemptRow(row) : null;
  }

  /** Most recent IN_PROGRESS attempt started after `since` (resume window). */
  async findResumableAttempt(
    userId: string,
    versionId: string,
    since: Date
  ): Promise<AttemptRow | null> {
    const row = await this.prisma.assessmentAttempt.findFirst({
      where: {
        userId,
        versionId,
        status: 'IN_PROGRESS',
        startedAt: { gt: since },
      },
      orderBy: { startedAt: 'desc' },
      include: { version: true },
    });
    return row ? this.toAttemptRow(row) : null;
  }

  async countSubmittedAttempts(userId: string, versionId: string): Promise<number> {
    return this.prisma.assessmentAttempt.count({
      where: { userId, versionId, status: 'SUBMITTED' },
    });
  }

  /** Latest submitted attempt — drives the retake cooldown. */
  async latestSubmittedAttempt(userId: string, versionId: string): Promise<AttemptRow | null> {
    const row = await this.prisma.assessmentAttempt.findFirst({
      where: { userId, versionId, status: 'SUBMITTED' },
      orderBy: { submittedAt: 'desc' },
      include: { version: true },
    });
    return row ? this.toAttemptRow(row) : null;
  }

  /**
   * The submit transaction's writes: attempt → answers → result → profile.
   * All-or-nothing; called inside the service's transaction (spec §6).
   */
  async submitAttemptTx(
    tx: TxClient,
    data: {
      attemptId: string;
      idempotencyKey: string;
      answers: SubmitAnswerInput[];
      topicLevels: Prisma.InputJsonValue;
      overallLevel: number;
      placementKind: PlacementKind;
      recommendedStartModuleOrder: number;
      userId: string;
      versionId: string;
    }
  ): Promise<{ submittedAt: Date; resultId: string }> {
    const submitted = await tx.assessmentAttempt.update({
      where: { id: data.attemptId },
      data: {
        status: 'SUBMITTED',
        submittedAt: new Date(),
        idempotencyKey: data.idempotencyKey,
      },
    });
    await tx.assessmentAnswer.createMany({
      data: data.answers.map((a) => ({
        attemptId: data.attemptId,
        questionId: a.questionId,
        selectedOptionIds: a.selectedOptionIds,
        confidence: a.confidence,
        isCorrect: a.isCorrect,
        pointsAwarded: a.pointsAwarded,
      })),
    });
    const result = await tx.assessmentResult.create({
      data: {
        attemptId: data.attemptId,
        userId: data.userId,
        topicLevels: data.topicLevels,
        overallLevel: data.overallLevel,
        placementKind: data.placementKind,
        recommendedStartModuleOrder: data.recommendedStartModuleOrder,
      },
    });
    // The durable knowledge profile — rewritten on each official attempt.
    await tx.userKnowledgeProfile.upsert({
      where: { userId: data.userId },
      create: {
        userId: data.userId,
        versionId: data.versionId,
        attemptId: data.attemptId,
        topicLevels: data.topicLevels,
        overallLevel: data.overallLevel,
      },
      update: {
        versionId: data.versionId,
        attemptId: data.attemptId,
        topicLevels: data.topicLevels,
        overallLevel: data.overallLevel,
      },
    });
    return { submittedAt: submitted.submittedAt as Date, resultId: result.id };
  }

  /** Latest submitted result — the official one (spec §7: latest counts). */
  async getLatestResult(userId: string): Promise<ResultRow | null> {
    const row = await this.prisma.assessmentResult.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return row ? this.toResultRow(row) : null;
  }

  /**
   * Placement accept transaction: result choice (+ optional waiver).
   * The waiver's (userId, trackId) PK makes double-accepts impossible.
   */
  async acceptPlacementTx(
    tx: TxClient,
    data: {
      resultId: string;
      choice: PlacementChoice;
      waiver?: { userId: string; trackId: string; waivedUpToModuleOrder: number };
    }
  ): Promise<void> {
    await tx.assessmentResult.update({
      where: { id: data.resultId },
      data: { placementChoice: data.choice, placedAt: new Date() },
    });
    if (data.waiver) {
      await tx.placementWaiver.create({ data: data.waiver });
    }
  }

  /**
   * Patches the stored profile's placement.userChoice on accept (spec §5.4).
   * The profile is recomputed on submit; the choice is filled in on accept.
   */
  async updateProfileChoice(
    tx: TxClient,
    userId: string,
    choice: 'recommended' | 'from_beginning'
  ): Promise<void> {
    const profile = await tx.userKnowledgeProfile.findUnique({ where: { userId } });
    if (!profile) return;
    const levels =
      profile.topicLevels !== null &&
      typeof profile.topicLevels === 'object' &&
      !Array.isArray(profile.topicLevels)
        ? (profile.topicLevels as Record<string, unknown>)
        : {};
    const placement =
      levels['placement'] !== null &&
      typeof levels['placement'] === 'object' &&
      !Array.isArray(levels['placement'])
        ? (levels['placement'] as Record<string, unknown>)
        : {};
    await tx.userKnowledgeProfile.update({
      where: { userId },
      data: {
        topicLevels: { ...levels, placement: { ...placement, userChoice: choice } },
      },
    });
  }

  /** The learning module's prerequisite gate reads this (ADR 0004/5). */
  async getWaiver(
    userId: string,
    trackId: string,
    tx?: TxClient
  ): Promise<{ waivedUpToModuleOrder: number } | null> {
    const db = tx ?? this.prisma;
    const row = await db.placementWaiver.findUnique({
      where: { userId_trackId: { userId, trackId } },
    });
    return row ? { waivedUpToModuleOrder: row.waivedUpToModuleOrder } : null;
  }

  async abandonAttempt(attemptId: string): Promise<void> {
    await this.prisma.assessmentAttempt.update({
      where: { id: attemptId },
      data: { status: 'ABANDONED' },
    });
  }

  async getProfile(userId: string): Promise<ProfileRow | null> {
    const row = await this.prisma.userKnowledgeProfile.findUnique({
      where: { userId },
    });
    if (!row) return null;
    return {
      userId: row.userId,
      versionId: row.versionId,
      attemptId: row.attemptId,
      topicLevels: row.topicLevels,
      overallLevel: row.overallLevel,
      computedAt: row.computedAt,
    };
  }

  private toAttemptRow(row: {
    id: string;
    userId: string;
    versionId: string;
    questionIds: Prisma.JsonValue;
    status: AssessmentAttemptStatus;
    startedAt: Date;
    submittedAt: Date | null;
    idempotencyKey: string | null;
    version: { trackId: string };
  }): AttemptRow {
    return {
      id: row.id,
      userId: row.userId,
      versionId: row.versionId,
      trackId: row.version.trackId,
      questionIds: row.questionIds as string[],
      status: row.status,
      startedAt: row.startedAt,
      submittedAt: row.submittedAt,
      idempotencyKey: row.idempotencyKey,
    };
  }

  private toResultRow(row: {
    id: string;
    attemptId: string;
    userId: string;
    topicLevels: Prisma.JsonValue;
    overallLevel: number;
    placementKind: PlacementKind;
    recommendedStartModuleOrder: number;
    placementChoice: PlacementChoice | null;
    placedAt: Date | null;
  }): ResultRow {
    return { ...row };
  }
}
