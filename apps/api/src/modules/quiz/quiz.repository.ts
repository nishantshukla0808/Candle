import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import type { TxClient } from '../../database/tx-client';

/**
 * QuizRepository — the ONLY file that touches Prisma for quiz
 * (blueprint §4). Methods accept an optional transaction client (ADR 0002/9).
 */

export interface QuestionWithOptions {
  id: string;
  text: string;
  explanation: string;
  kind: 'SINGLE' | 'MULTI';
  order: number;
  points: number;
  options: Array<{ id: string; text: string; order: number; isCorrect: boolean }>;
}

export interface AttemptRow {
  id: string;
  userId: string;
  lessonVersionId: string;
  questionIds: unknown;
  submittedAt: Date | null;
  score: number | null;
  totalPoints: number | null;
  passed: boolean | null;
}

@Injectable()
export class QuizRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: TxClient): TxClient {
    return tx ?? this.prisma;
  }

  async getVersionQuestions(versionId: string, tx?: TxClient): Promise<QuestionWithOptions[]> {
    const rows = await this.db(tx).question.findMany({
      where: { lessonVersionId: versionId },
      orderBy: { order: 'asc' },
      include: { options: { orderBy: { order: 'asc' } } },
    });
    return rows.map((q) => ({
      id: q.id,
      text: q.text,
      explanation: q.explanation,
      kind: q.kind,
      order: q.order,
      points: q.points,
      options: q.options.map((o) => ({
        id: o.id,
        text: o.text,
        order: o.order,
        isCorrect: o.isCorrect,
      })),
    }));
  }

  async createAttempt(
    data: { userId: string; lessonVersionId: string; questionIds: string[] },
    tx?: TxClient
  ): Promise<AttemptRow> {
    const row = await this.db(tx).quizAttempt.create({
      data: {
        userId: data.userId,
        lessonVersionId: data.lessonVersionId,
        questionIds: data.questionIds,
      },
    });
    return toAttemptRow(row);
  }

  async getAttempt(attemptId: string, tx?: TxClient): Promise<AttemptRow | null> {
    const row = await this.db(tx).quizAttempt.findUnique({ where: { id: attemptId } });
    return row ? toAttemptRow(row) : null;
  }

  async getPassedAttempt(
    userId: string,
    lessonVersionId: string,
    tx?: TxClient
  ): Promise<AttemptRow | null> {
    const row = await this.db(tx).quizAttempt.findFirst({
      where: { userId, lessonVersionId, passed: true },
      orderBy: { submittedAt: 'desc' },
    });
    return row ? toAttemptRow(row) : null;
  }

  /** Resolves the lesson family id for a version (for event payloads). */
  async getLessonIdForVersion(versionId: string, tx?: TxClient): Promise<string | null> {
    const row = await this.db(tx).lessonVersion.findUnique({
      where: { id: versionId },
      select: { lessonId: true },
    });
    return row?.lessonId ?? null;
  }

  async submitAttempt(
    attemptId: string,
    data: {
      score: number;
      totalPoints: number;
      passed: boolean;
      idempotencyKey: string;
      answers: Array<{
        questionId: string;
        selectedOptionIds: string[];
        isCorrect: boolean;
        pointsAwarded: number;
      }>;
    },
    tx?: TxClient
  ): Promise<AttemptRow> {
    const client = this.db(tx);
    const row = await client.quizAttempt.update({
      where: { id: attemptId },
      data: {
        submittedAt: new Date(),
        score: data.score,
        totalPoints: data.totalPoints,
        passed: data.passed,
        idempotencyKey: data.idempotencyKey,
      },
    });
    await client.attemptAnswer.createMany({
      data: data.answers.map((a) => ({
        attemptId,
        questionId: a.questionId,
        selectedOptionIds: a.selectedOptionIds,
        isCorrect: a.isCorrect,
        pointsAwarded: a.pointsAwarded,
      })),
    });
    return toAttemptRow(row);
  }
}

type QuizAttemptPayload = Prisma.QuizAttemptGetPayload<Record<string, never>>;

function toAttemptRow(row: QuizAttemptPayload): AttemptRow {
  return {
    id: row.id,
    userId: row.userId,
    lessonVersionId: row.lessonVersionId,
    questionIds: row.questionIds,
    submittedAt: row.submittedAt,
    score: row.score,
    totalPoints: row.totalPoints,
    passed: row.passed,
  };
}
