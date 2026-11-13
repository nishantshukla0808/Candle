import { Injectable } from '@nestjs/common';
import { ContentStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import type { TxClient } from '../../database/tx-client';

/**
 * AdminRepository — the ONLY file that touches Prisma for admin CMS
 * (blueprint §4). Methods accept an optional transaction client (ADR 0002/9).
 *
 * Versioning rule (ADR 0002/4): published lesson versions are immutable.
 * Edits go to the single DRAFT version per lesson, created on demand from
 * the latest published version.
 */

export interface VersionRow {
  id: string;
  lessonId: string;
  version: number;
  title: string;
  contentMarkdown: string;
  status: ContentStatus;
  publishedAt: Date | null;
}

@Injectable()
export class AdminRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: TxClient): TxClient {
    return tx ?? this.prisma;
  }

  // --- tracks --------------------------------------------------------------------

  createTrack(
    data: { slug: string; title: string; description: string; order: number; createdById?: string },
    tx?: TxClient
  ) {
    return this.db(tx).track.create({ data });
  }

  updateTrack(
    id: string,
    data: { title?: string; description?: string; order?: number },
    tx?: TxClient
  ) {
    return this.db(tx).track.update({ where: { id }, data });
  }

  getTrack(id: string, tx?: TxClient) {
    return this.db(tx).track.findUnique({ where: { id } });
  }

  listAllTracks(tx?: TxClient) {
    return this.db(tx).track.findMany({ orderBy: { order: 'asc' } });
  }

  /** Full content tree for the admin UI (all statuses). */
  async getTrackTree(id: string, tx?: TxClient) {
    const track = await this.db(tx).track.findUnique({
      where: { id },
      include: {
        modules: {
          orderBy: { order: 'asc' },
          include: {
            lessons: {
              orderBy: { order: 'asc' },
              include: {
                versions: {
                  orderBy: { version: 'desc' },
                  take: 1,
                  select: { id: true, version: true, status: true },
                },
              },
            },
          },
        },
      },
    });
    if (!track) return null;
    return {
      ...track,
      modules: track.modules.map((m) => ({
        ...m,
        lessons: m.lessons.map((l) => ({
          id: l.id,
          title: l.title,
          order: l.order,
          latestVersion: l.versions[0] ?? null,
        })),
      })),
    };
  }

  setTrackStatus(id: string, status: ContentStatus, tx?: TxClient) {
    return this.db(tx).track.update({ where: { id }, data: { status } });
  }

  // --- modules ---------------------------------------------------------------------

  createModule(
    data: { trackId: string; title: string; description?: string; order: number },
    tx?: TxClient
  ) {
    return this.db(tx).learningModule.create({ data });
  }

  updateModule(
    id: string,
    data: { title?: string; description?: string; order?: number },
    tx?: TxClient
  ) {
    return this.db(tx).learningModule.update({ where: { id }, data });
  }

  getModule(id: string, tx?: TxClient) {
    return this.db(tx).learningModule.findUnique({ where: { id } });
  }

  setModuleStatus(id: string, status: ContentStatus, tx?: TxClient) {
    return this.db(tx).learningModule.update({ where: { id }, data: { status } });
  }

  // --- lessons (families) ---------------------------------------------------------------

  createLesson(data: { moduleId: string; title: string; order: number }, tx?: TxClient) {
    return this.db(tx).lesson.create({ data });
  }

  getLesson(id: string, tx?: TxClient) {
    return this.db(tx).lesson.findUnique({ where: { id } });
  }

  // --- versions ----------------------------------------------------------------------

  createVersion(
    data: {
      lessonId: string;
      version: number;
      title: string;
      contentMarkdown: string;
      status: ContentStatus;
      createdById?: string;
    },
    tx?: TxClient
  ): Promise<VersionRow> {
    return this.db(tx).lessonVersion.create({ data });
  }

  getDraftVersion(lessonId: string, tx?: TxClient): Promise<VersionRow | null> {
    return this.db(tx).lessonVersion.findFirst({
      where: { lessonId, status: ContentStatus.DRAFT },
      orderBy: { version: 'desc' },
    });
  }

  getLatestPublished(lessonId: string, tx?: TxClient): Promise<VersionRow | null> {
    return this.db(tx).lessonVersion.findFirst({
      where: { lessonId, status: ContentStatus.PUBLISHED },
      orderBy: { version: 'desc' },
    });
  }

  async getMaxVersion(lessonId: string, tx?: TxClient): Promise<number> {
    const row = await this.db(tx).lessonVersion.findFirst({
      where: { lessonId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    return row?.version ?? 0;
  }

  updateDraft(
    versionId: string,
    data: { title?: string; contentMarkdown?: string },
    tx?: TxClient
  ): Promise<VersionRow> {
    return this.db(tx).lessonVersion.update({ where: { id: versionId }, data });
  }

  publishVersion(versionId: string, tx?: TxClient): Promise<VersionRow> {
    return this.db(tx).lessonVersion.update({
      where: { id: versionId },
      data: { status: ContentStatus.PUBLISHED, publishedAt: new Date() },
    });
  }

  listVersions(lessonId: string, tx?: TxClient): Promise<VersionRow[]> {
    return this.db(tx).lessonVersion.findMany({
      where: { lessonId },
      orderBy: { version: 'desc' },
    });
  }

  // --- questions -----------------------------------------------------------------------

  async createQuestion(
    versionId: string,
    data: {
      text: string;
      explanation: string;
      kind: 'SINGLE' | 'MULTI';
      order: number;
      points: number;
      options: Array<{ text: string; isCorrect: boolean; order: number }>;
    },
    tx?: TxClient
  ) {
    const client = this.db(tx);
    return client.question.create({
      data: {
        lessonVersionId: versionId,
        text: data.text,
        explanation: data.explanation,
        kind: data.kind,
        order: data.order,
        points: data.points,
        options: {
          create: data.options.map((o) => ({
            text: o.text,
            isCorrect: o.isCorrect,
            order: o.order,
          })),
        },
      },
      include: { options: { orderBy: { order: 'asc' } } },
    });
  }

  getQuestion(id: string, tx?: TxClient) {
    return this.db(tx).question.findUnique({
      where: { id },
      include: {
        options: { orderBy: { order: 'asc' } },
        lessonVersion: { select: { id: true, status: true, lessonId: true } },
      },
    });
  }

  listQuestionsByVersion(versionId: string, tx?: TxClient) {
    return this.db(tx).question.findMany({
      where: { lessonVersionId: versionId },
      orderBy: { order: 'asc' },
      include: { options: { orderBy: { order: 'asc' } } },
    });
  }

  async updateQuestion(
    id: string,
    data: {
      text?: string;
      explanation?: string;
      order?: number;
      points?: number;
      options?: Array<{ text: string; isCorrect: boolean; order: number }>;
    },
    tx?: TxClient
  ) {
    const client = this.db(tx);
    const updated = await client.question.update({
      where: { id },
      data: {
        ...(data.text !== undefined ? { text: data.text } : {}),
        ...(data.explanation !== undefined ? { explanation: data.explanation } : {}),
        ...(data.order !== undefined ? { order: data.order } : {}),
        ...(data.points !== undefined ? { points: data.points } : {}),
      },
    });
    if (data.options) {
      await client.questionOption.deleteMany({ where: { questionId: id } });
      await client.questionOption.createMany({
        data: data.options.map((o) => ({
          questionId: id,
          text: o.text,
          isCorrect: o.isCorrect,
          order: o.order,
        })),
      });
    }
    return updated;
  }

  async deleteQuestion(id: string, tx?: TxClient): Promise<void> {
    const client = this.db(tx);
    await client.questionOption.deleteMany({ where: { questionId: id } });
    await client.question.delete({ where: { id } });
  }

  // --- audit log (append-only) ------------------------------------------------------------

  appendAudit(
    data: {
      actorId: string;
      action: string;
      entityType: string;
      entityId: string;
      before?: unknown;
      after?: unknown;
      ip?: string;
    },
    tx?: TxClient
  ) {
    return this.db(tx).auditLog.create({
      data: {
        actorId: data.actorId,
        action: data.action,
        entityType: data.entityType,
        entityId: data.entityId,
        before: data.before ?? undefined,
        after: data.after ?? undefined,
        ip: data.ip,
      },
    });
  }

  async listAudit(page: number, limit: number, tx?: TxClient) {
    const client = this.db(tx);
    const [total, items] = await Promise.all([
      client.auditLog.count(),
      client.auditLog.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    return { total, items };
  }
}
