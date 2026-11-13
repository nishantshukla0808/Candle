import { Injectable } from '@nestjs/common';
import { ContentStatus, ProgressStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import type { TxClient } from '../../database/tx-client';

/**
 * LearningRepository — the ONLY file that touches Prisma for learning
 * (blueprint §4). Methods accept an optional transaction client (ADR 0002/9).
 */

export interface PublishedVersionSummary {
  id: string;
  version: number;
  title: string;
  questionCount: number;
}

export interface LessonNode {
  id: string;
  title: string;
  order: number;
  published: PublishedVersionSummary | null;
}

export interface ModuleNode {
  id: string;
  title: string;
  description: string | null;
  order: number;
  lessons: LessonNode[];
}

export interface TrackNode {
  id: string;
  slug: string;
  title: string;
  description: string;
  order: number;
  modules: ModuleNode[];
}

@Injectable()
export class LearningRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: TxClient): TxClient {
    return tx ?? this.prisma;
  }

  /** Full published tree for the track browser. */
  async getPublishedTrackTree(tx?: TxClient): Promise<TrackNode[]> {
    const tracks = await this.db(tx).track.findMany({
      where: { status: ContentStatus.PUBLISHED },
      orderBy: { order: 'asc' },
      include: {
        modules: {
          where: { status: ContentStatus.PUBLISHED },
          orderBy: { order: 'asc' },
          include: {
            lessons: {
              orderBy: { order: 'asc' },
              include: {
                versions: {
                  where: { status: ContentStatus.PUBLISHED },
                  orderBy: { version: 'desc' },
                  take: 1,
                  include: { _count: { select: { questions: true } } },
                },
              },
            },
          },
        },
      },
    });
    return tracks.map((t) => ({
      id: t.id,
      slug: t.slug,
      title: t.title,
      description: t.description,
      order: t.order,
      modules: t.modules.map((m) => ({
        id: m.id,
        title: m.title,
        description: m.description,
        order: m.order,
        lessons: m.lessons.map((l) => ({
          id: l.id,
          title: l.title,
          order: l.order,
          published:
            l.versions.length > 0 && l.versions[0]
              ? {
                  id: l.versions[0].id,
                  version: l.versions[0].version,
                  title: l.versions[0].title,
                  questionCount: l.versions[0]._count.questions,
                }
              : null,
        })),
      })),
    }));
  }

  /** Ordered lesson ids across the whole track (module.order, lesson.order). */
  async getTrackLessonOrder(trackId: string, tx?: TxClient): Promise<string[]> {
    const lessons = await this.db(tx).lesson.findMany({
      where: { module: { trackId } },
      orderBy: [{ module: { order: 'asc' } }, { order: 'asc' }],
      select: { id: true },
    });
    return lessons.map((l) => l.id);
  }

  /** Module order for a lesson — placement waiver gate (ADR 0004/5). */
  async getLessonModuleOrder(lessonId: string, tx?: TxClient): Promise<number | null> {
    const lesson = await this.db(tx).lesson.findUnique({
      where: { id: lessonId },
      select: { module: { select: { order: true } } },
    });
    return lesson ? lesson.module.order : null;
  }

  async getLessonWithTrack(lessonId: string, tx?: TxClient) {
    return this.db(tx).lesson.findUnique({
      where: { id: lessonId },
      include: { module: { include: { track: true } } },
    });
  }

  /** Latest published version with questions + options (player / quiz start). */
  async getPublishedVersion(lessonId: string, tx?: TxClient) {
    return this.db(tx).lessonVersion.findFirst({
      where: { lessonId, status: ContentStatus.PUBLISHED },
      orderBy: { version: 'desc' },
      include: {
        questions: {
          orderBy: { order: 'asc' },
          include: { options: { orderBy: { order: 'asc' } } },
        },
      },
    });
  }

  async findCompletion(userId: string, lessonId: string, tx?: TxClient) {
    return this.db(tx).lessonCompletion.findUnique({
      where: { userId_lessonId: { userId, lessonId } },
    });
  }

  async findCompletionByKey(idempotencyKey: string, tx?: TxClient) {
    return this.db(tx).lessonCompletion.findUnique({ where: { idempotencyKey } });
  }

  async createCompletion(
    data: {
      userId: string;
      lessonId: string;
      lessonVersionId: string;
      quizAttemptId?: string;
      idempotencyKey: string;
    },
    tx?: TxClient
  ) {
    return this.db(tx).lessonCompletion.create({ data });
  }

  async upsertProgress(
    userId: string,
    lessonId: string,
    status: ProgressStatus,
    tx?: TxClient
  ): Promise<void> {
    await this.db(tx).userLessonProgress.upsert({
      where: { userId_lessonId: { userId, lessonId } },
      update: { status },
      create: { userId, lessonId, status },
    });
  }

  async getCompletedLessonIds(userId: string, tx?: TxClient): Promise<Set<string>> {
    const rows = await this.db(tx).lessonCompletion.findMany({
      where: { userId },
      select: { lessonId: true },
    });
    return new Set(rows.map((r) => r.lessonId));
  }

  async countCompletionsInTrack(userId: string, trackId: string, tx?: TxClient): Promise<number> {
    return this.db(tx).lessonCompletion.count({
      where: { userId, lesson: { module: { trackId } } },
    });
  }

  async countLessonsInTrack(trackId: string, tx?: TxClient): Promise<number> {
    return this.db(tx).lesson.count({ where: { module: { trackId } } });
  }
}
