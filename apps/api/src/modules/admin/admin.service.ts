import { Injectable } from '@nestjs/common';
import { ContentStatus } from '@prisma/client';
import { ErrorCode } from '@candle/shared';
import { AppError } from '../../common/errors/app-error';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { TransactionService } from '../../database/transaction.service';
import type { TxClient } from '../../database/tx-client';
import { AdminRepository } from './admin.repository';
import { AuditService } from './audit.service';
import {
  CreateLessonDto,
  CreateModuleDto,
  CreateQuestionDto,
  CreateTrackDto,
  UpdateLessonDraftDto,
  UpdateModuleDto,
  UpdateQuestionDto,
  UpdateTrackDto,
} from './dto/admin.dto';

/**
 * AdminService — content management with versioning + audit (blueprint §17).
 *
 * - Tracks/modules: draft → published status flips.
 * - Lessons: published versions are IMMUTABLE. Edits go to the single
 *   DRAFT version per lesson (created on demand from the latest
 *   published version). Publishing freezes the draft.
 * - Questions belong to a version; they can only change on drafts.
 * - Every mutation writes an audit row in the same transaction.
 */

interface ActorContext {
  actorId: string;
  ip?: string;
}

@Injectable()
export class AdminService {
  constructor(
    private readonly repo: AdminRepository,
    private readonly audit: AuditService,
    private readonly tx: TransactionService
  ) {}

  // --- tracks ---------------------------------------------------------------------

  async createTrack(dto: CreateTrackDto, ctx: ActorContext) {
    return this.tx.run(async (t) => {
      const track = await this.repo.createTrack(
        {
          slug: dto.slug.toLowerCase(),
          title: dto.title,
          description: dto.description,
          order: dto.order ?? 0,
          createdById: ctx.actorId,
        },
        t
      );
      await this.audit.log(
        { ...ctx, action: 'track.create', entityType: 'track', entityId: track.id, after: track },
        t
      );
      return track;
    });
  }

  async updateTrack(id: string, dto: UpdateTrackDto, ctx: ActorContext) {
    return this.tx.run(async (t) => {
      const before = await this.repo.getTrack(id, t);
      if (!before) throw AppError.notFound('Track not found.');
      const after = await this.repo.updateTrack(id, dto, t);
      await this.audit.log(
        { ...ctx, action: 'track.update', entityType: 'track', entityId: id, before, after },
        t
      );
      return after;
    });
  }

  async publishTrack(id: string, ctx: ActorContext) {
    return this.tx.run(async (t) => {
      const before = await this.repo.getTrack(id, t);
      if (!before) throw AppError.notFound('Track not found.');
      const after = await this.repo.setTrackStatus(id, ContentStatus.PUBLISHED, t);
      await this.audit.log(
        { ...ctx, action: 'track.publish', entityType: 'track', entityId: id, before, after },
        t
      );
      return after;
    });
  }

  listTracks() {
    return this.repo.listAllTracks();
  }

  async getTrackTree(id: string) {
    const tree = await this.repo.getTrackTree(id);
    if (!tree) throw AppError.notFound('Track not found.');
    return tree;
  }

  // --- modules --------------------------------------------------------------------

  async createModule(dto: CreateModuleDto, ctx: ActorContext) {
    return this.tx.run(async (t) => {
      const mod = await this.repo.createModule(
        {
          trackId: dto.trackId,
          title: dto.title,
          description: dto.description,
          order: dto.order ?? 0,
        },
        t
      );
      await this.audit.log(
        { ...ctx, action: 'module.create', entityType: 'module', entityId: mod.id, after: mod },
        t
      );
      return mod;
    });
  }

  async updateModule(id: string, dto: UpdateModuleDto, ctx: ActorContext) {
    return this.tx.run(async (t) => {
      const before = await this.repo.getModule(id, t);
      if (!before) throw AppError.notFound('Module not found.');
      const after = await this.repo.updateModule(id, dto, t);
      await this.audit.log(
        { ...ctx, action: 'module.update', entityType: 'module', entityId: id, before, after },
        t
      );
      return after;
    });
  }

  async publishModule(id: string, ctx: ActorContext) {
    return this.tx.run(async (t) => {
      const before = await this.repo.getModule(id, t);
      if (!before) throw AppError.notFound('Module not found.');
      const after = await this.repo.setModuleStatus(id, ContentStatus.PUBLISHED, t);
      await this.audit.log(
        { ...ctx, action: 'module.publish', entityType: 'module', entityId: id, before, after },
        t
      );
      return after;
    });
  }

  // --- lessons ----------------------------------------------------------------------

  /** Creates the lesson family + its first DRAFT version. */
  async createLesson(dto: CreateLessonDto, ctx: ActorContext) {
    return this.tx.run(async (t) => {
      const lesson = await this.repo.createLesson(
        { moduleId: dto.moduleId, title: dto.title, order: dto.order ?? 0 },
        t
      );
      const version = await this.repo.createVersion(
        {
          lessonId: lesson.id,
          version: 1,
          title: dto.title,
          contentMarkdown: '',
          status: ContentStatus.DRAFT,
          createdById: ctx.actorId,
        },
        t
      );
      await this.audit.log(
        {
          ...ctx,
          action: 'lesson.create',
          entityType: 'lesson',
          entityId: lesson.id,
          after: { lesson, version },
        },
        t
      );
      return { lesson, draftVersion: version };
    });
  }

  /**
   * Edits the DRAFT version, creating it from the latest published
   * version when none exists (ADR 0002/4).
   */
  async updateDraft(lessonId: string, dto: UpdateLessonDraftDto, ctx: ActorContext) {
    return this.tx.run(async (t) => {
      const lesson = await this.repo.getLesson(lessonId, t);
      if (!lesson) throw AppError.notFound('Lesson not found.');
      const draft = await this.ensureDraft(lessonId, ctx.actorId, t);
      const before = { ...draft };
      const after = await this.repo.updateDraft(
        draft.id,
        {
          ...(dto.title !== undefined ? { title: dto.title } : {}),
          ...(dto.contentMarkdown !== undefined ? { contentMarkdown: dto.contentMarkdown } : {}),
        },
        t
      );
      await this.audit.log(
        {
          ...ctx,
          action: 'lesson.draft.update',
          entityType: 'lesson_version',
          entityId: draft.id,
          before,
          after,
        },
        t
      );
      return after;
    });
  }

  async getDraft(lessonId: string, actorId: string) {
    const lesson = await this.repo.getLesson(lessonId);
    if (!lesson) throw AppError.notFound('Lesson not found.');
    return this.tx.run(async (t) => this.ensureDraft(lessonId, actorId, t));
  }

  /** Publishes the draft version — it becomes immutable (ADR 0002/4). */
  async publishLesson(lessonId: string, ctx: ActorContext) {
    return this.tx.run(async (t) => {
      const lesson = await this.repo.getLesson(lessonId, t);
      if (!lesson) throw AppError.notFound('Lesson not found.');
      const draft = await this.repo.getDraftVersion(lessonId, t);
      if (!draft) {
        throw new AppError(ErrorCode.CONFLICT, 409, 'Nothing to publish: no draft version.');
      }
      if (!draft.contentMarkdown.trim()) {
        throw new AppError(ErrorCode.CONFLICT, 409, 'Cannot publish an empty lesson.');
      }
      const published = await this.repo.publishVersion(draft.id, t);
      await this.audit.log(
        {
          ...ctx,
          action: 'lesson.publish',
          entityType: 'lesson_version',
          entityId: draft.id,
          before: draft,
          after: published,
        },
        t
      );
      return published;
    });
  }

  listVersions(lessonId: string) {
    return this.repo.listVersions(lessonId);
  }

  /** Questions on the lesson's draft version (for the editor). */
  async listDraftQuestions(lessonId: string, actorId: string) {
    return this.tx.run(async (t) => {
      const draft = await this.ensureDraft(lessonId, actorId, t);
      return this.repo.listQuestionsByVersion(draft.id, t);
    });
  }

  // --- questions (draft versions only) --------------------------------------------------------

  async createQuestion(lessonId: string, dto: CreateQuestionDto, ctx: ActorContext) {
    validateOptions(
      dto.kind,
      dto.options.map((o) => o.isCorrect)
    );
    return this.tx.run(async (t) => {
      const lesson = await this.repo.getLesson(lessonId, t);
      if (!lesson) throw AppError.notFound('Lesson not found.');
      const draft = await this.ensureDraft(lessonId, ctx.actorId, t);
      const question = await this.repo.createQuestion(
        draft.id,
        {
          text: dto.text,
          explanation: dto.explanation,
          kind: dto.kind,
          order: dto.order ?? 0,
          points: dto.points ?? 10,
          options: dto.options.map((o, i) => ({
            text: o.text,
            isCorrect: o.isCorrect,
            order: o.order ?? i,
          })),
        },
        t
      );
      await this.audit.log(
        {
          ...ctx,
          action: 'question.create',
          entityType: 'question',
          entityId: question.id,
          after: question,
        },
        t
      );
      return question;
    });
  }

  async updateQuestion(questionId: string, dto: UpdateQuestionDto, ctx: ActorContext) {
    if (dto.options) {
      const current = await this.repo.getQuestion(questionId);
      if (!current) throw AppError.notFound('Question not found.');
      validateOptions(
        current.kind,
        dto.options.map((o) => o.isCorrect)
      );
    }
    return this.tx.run(async (t) => {
      const before = await this.repo.getQuestion(questionId, t);
      if (!before) throw AppError.notFound('Question not found.');
      assertDraftVersion(before.lessonVersion);
      const after = await this.repo.updateQuestion(
        questionId,
        {
          ...(dto.text !== undefined ? { text: dto.text } : {}),
          ...(dto.explanation !== undefined ? { explanation: dto.explanation } : {}),
          ...(dto.order !== undefined ? { order: dto.order } : {}),
          ...(dto.points !== undefined ? { points: dto.points } : {}),
          ...(dto.options
            ? {
                options: dto.options.map((o, i) => ({
                  text: o.text,
                  isCorrect: o.isCorrect,
                  order: o.order ?? i,
                })),
              }
            : {}),
        },
        t
      );
      await this.audit.log(
        {
          ...ctx,
          action: 'question.update',
          entityType: 'question',
          entityId: questionId,
          before,
          after,
        },
        t
      );
      return after;
    });
  }

  async deleteQuestion(questionId: string, ctx: ActorContext): Promise<{ deleted: true }> {
    return this.tx.run(async (t) => {
      const before = await this.repo.getQuestion(questionId, t);
      if (!before) throw AppError.notFound('Question not found.');
      assertDraftVersion(before.lessonVersion);
      await this.repo.deleteQuestion(questionId, t);
      await this.audit.log(
        {
          ...ctx,
          action: 'question.delete',
          entityType: 'question',
          entityId: questionId,
          before,
        },
        t
      );
      return { deleted: true as const };
    });
  }

  // --- audit -------------------------------------------------------------------------

  listAudit(query: PaginationDto) {
    return this.repo.listAudit(query.page, query.limit);
  }

  // --- internals ------------------------------------------------------------------------

  /**
   * Returns the lesson's DRAFT version, creating it from the latest
   * published version (or blank) when none exists.
   */
  private async ensureDraft(lessonId: string, actorId: string, t?: TxClient) {
    const existing = await this.repo.getDraftVersion(lessonId, t);
    if (existing) return existing;
    const latest = await this.repo.getLatestPublished(lessonId, t);
    const version = (await this.repo.getMaxVersion(lessonId, t)) + 1;
    const lesson = await this.repo.getLesson(lessonId, t);
    const created = await this.repo.createVersion(
      {
        lessonId,
        version,
        title: latest?.title ?? lesson?.title ?? 'Untitled',
        contentMarkdown: latest?.contentMarkdown ?? '',
        status: ContentStatus.DRAFT,
        createdById: actorId,
      },
      t
    );
    if (latest) {
      const questions = await this.repo.listQuestionsByVersion(latest.id, t);
      for (const q of questions) {
        await this.repo.createQuestion(
          created.id,
          {
            text: q.text,
            explanation: q.explanation,
            kind: q.kind,
            order: q.order,
            points: q.points,
            options: q.options.map((o) => ({
              text: o.text,
              isCorrect: o.isCorrect,
              order: o.order,
            })),
          },
          t
        );
      }
    }
    return created;
  }
}

/** Published versions are immutable — only drafts change (ADR 0002/4). */
function assertDraftVersion(version: { status: ContentStatus } | null | undefined): void {
  if (!version || version.status !== ContentStatus.DRAFT) {
    throw new AppError(
      ErrorCode.CONFLICT,
      409,
      'Published content is immutable. Edit the draft version instead.'
    );
  }
}

/** SINGLE needs exactly one correct option; MULTI needs at least one. */
function validateOptions(kind: 'SINGLE' | 'MULTI', isCorrect: boolean[]): void {
  const correct = isCorrect.filter(Boolean).length;
  if (kind === 'SINGLE' && correct !== 1) {
    throw AppError.validationFailed([
      { field: 'options', issue: 'Single-choice questions need exactly one correct option.' },
    ]);
  }
  if (kind === 'MULTI' && correct < 1) {
    throw AppError.validationFailed([
      { field: 'options', issue: 'Multiple-choice questions need at least one correct option.' },
    ]);
  }
}
