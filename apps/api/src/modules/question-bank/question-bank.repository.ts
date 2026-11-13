import { Injectable } from '@nestjs/common';
import { DuelBankQuestionType, DuelBankSkill, DuelBankStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import type { TxClient } from '../../database/tx-client';

/**
 * QuestionBankRepository — the ONLY file that touches Prisma for the
 * Question Bank (blueprint §4). Methods accept an optional transaction
 * client (ADR 0002/9). The service does all the math and rule checks;
 * the repository only persists.
 *
 * Audit: mutations are recorded in the SAME append-only `audit_log`
 * table the admin CMS uses (blueprint §9), via `appendAudit` here —
 * the AuditService itself is not exported by AdminModule, so the bank
 * writes the same row shape directly instead of inventing a second
 * audit system (ADR 0005 §15).
 */

export interface BankOptionRow {
  id: string;
  itemId: string;
  text: string;
  isCorrect: boolean;
  /** CASE_CHOICE per-option score fraction (100 / 50 / 0); 0 for other types. */
  points: number;
  /** CASE_CHOICE one-line consequence shown under the action card. */
  consequence: string | null;
  order: number;
}

export interface BankItemRow {
  id: string;
  key: string;
  topic: string;
  skill: DuelBankSkill;
  type: DuelBankQuestionType;
  difficulty: number;
  language: string;
  sourceLessonId: string | null;
  stem: string;
  explanation: string;
  /** CASE_CHOICE structured case numbers (labelled key/value pairs). */
  context: Prisma.JsonValue | null;
  /** CASE_CHOICE rubric (why the best action wins, line by line). */
  rubric: string | null;
  /** CHART_CHOICE structured chart data (title, instrument, template,
   *  axis labels, xLabels, series, reveal-only annotation). */
  chart: Prisma.JsonValue | null;
  status: DuelBankStatus;
  version: number;
  templateId: string | null;
  parameters: Prisma.JsonValue | null;
  authorId: string | null;
  reviewerId: string | null;
  publishedAt: Date | null;
  pilotAnswers: number;
  pilotCorrect: number;
  correctRate: number | null;
  discrimination: number | null;
  exposureCount: number;
  createdAt: Date;
  updatedAt: Date;
  options: BankOptionRow[];
}

export interface BankTemplateRow {
  id: string;
  key: string;
  topic: string;
  skill: DuelBankSkill;
  templateText: string;
  parameterSchema: Prisma.JsonValue;
  answerFormula: string | null;
  distractorRules: Prisma.JsonValue | null;
  status: DuelBankStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface ExposureRow {
  userId: string;
  bankItemId: string;
  lastSeenAt: Date;
  seenCount: number;
}

export interface CreateBankItemInput {
  key: string;
  topic: string;
  skill: DuelBankSkill;
  type: DuelBankQuestionType;
  difficulty: number;
  language?: string;
  sourceLessonId?: string;
  stem: string;
  explanation: string;
  context?: Prisma.InputJsonValue;
  rubric?: string;
  chart?: Prisma.InputJsonValue;
  status?: DuelBankStatus;
  /** New-version rows pass version + 1; defaults to 1. */
  version?: number;
  templateId?: string;
  parameters?: Prisma.InputJsonValue;
  authorId: string;
  options: Array<{
    text: string;
    isCorrect: boolean;
    points?: number;
    consequence?: string;
    order: number;
  }>;
}

export interface ListBankItemsFilter {
  status?: DuelBankStatus;
  topic?: string;
  skill?: DuelBankSkill;
  type?: DuelBankQuestionType;
  difficulty?: number;
  language?: string;
  skip: number;
  take: number;
}

export interface UpdateBankItemInput {
  status?: DuelBankStatus;
  reviewerId?: string | null;
  publishedAt?: Date | null;
  difficulty?: number;
}

const ITEM_WITH_OPTIONS = { options: { orderBy: { order: 'asc' } } } as const;

@Injectable()
export class QuestionBankRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: TxClient): TxClient {
    return tx ?? this.prisma;
  }

  // --- items -------------------------------------------------------------------

  async createItem(input: CreateBankItemInput, tx?: TxClient): Promise<BankItemRow> {
    return this.db(tx).duelBankItem.create({
      data: {
        key: input.key,
        topic: input.topic,
        skill: input.skill,
        type: input.type,
        difficulty: input.difficulty,
        language: input.language ?? 'en',
        sourceLessonId: input.sourceLessonId ?? null,
        stem: input.stem,
        explanation: input.explanation,
        context: input.context ?? Prisma.JsonNull,
        rubric: input.rubric ?? null,
        chart: input.chart ?? Prisma.JsonNull,
        status: input.status ?? DuelBankStatus.DRAFT,
        version: input.version ?? 1,
        templateId: input.templateId ?? null,
        parameters: input.parameters ?? Prisma.JsonNull,
        authorId: input.authorId,
        options: {
          create: input.options.map((o) => ({
            text: o.text,
            isCorrect: o.isCorrect,
            points: o.points ?? 0,
            consequence: o.consequence ?? null,
            order: o.order,
          })),
        },
      },
      include: ITEM_WITH_OPTIONS,
    });
  }

  async findItemById(id: string, tx?: TxClient): Promise<BankItemRow | null> {
    return this.db(tx).duelBankItem.findUnique({
      where: { id },
      include: ITEM_WITH_OPTIONS,
    });
  }

  async findItemByKey(key: string, tx?: TxClient): Promise<BankItemRow | null> {
    return this.db(tx).duelBankItem.findUnique({
      where: { key },
      include: ITEM_WITH_OPTIONS,
    });
  }

  /**
   * Items by id, WITH options (isCorrect + explanation) — the duels
   * module's grading seam (ADR 0006/4). Service-internal only: the
   * controller never exposes these rows, so correctness never leaves
   * the server before reveal.
   */
  async findItemsByIds(ids: string[], tx?: TxClient): Promise<BankItemRow[]> {
    if (ids.length === 0) return [];
    return this.db(tx).duelBankItem.findMany({
      where: { id: { in: ids } },
      include: ITEM_WITH_OPTIONS,
    });
  }

  async listItems(
    filter: ListBankItemsFilter,
    tx?: TxClient
  ): Promise<{ items: BankItemRow[]; total: number }> {
    const where = {
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.topic ? { topic: filter.topic } : {}),
      ...(filter.skill ? { skill: filter.skill } : {}),
      ...(filter.type ? { type: filter.type } : {}),
      ...(filter.difficulty !== undefined ? { difficulty: filter.difficulty } : {}),
      ...(filter.language ? { language: filter.language } : {}),
    };
    const db = this.db(tx);
    const [items, total] = await Promise.all([
      db.duelBankItem.findMany({
        where,
        include: ITEM_WITH_OPTIONS,
        orderBy: [{ createdAt: 'desc' }],
        skip: filter.skip,
        take: filter.take,
      }),
      db.duelBankItem.count({ where }),
    ]);
    return { items, total };
  }

  async updateItem(id: string, data: UpdateBankItemInput, tx?: TxClient): Promise<BankItemRow> {
    return this.db(tx).duelBankItem.update({
      where: { id },
      data,
      include: ITEM_WITH_OPTIONS,
    });
  }

  /** LIVE items only, optionally narrowed to the blueprint's axes. */
  async listLiveItems(
    filter: { topics?: string[]; skills?: DuelBankSkill[]; types?: DuelBankQuestionType[] },
    tx?: TxClient
  ): Promise<BankItemRow[]> {
    return this.db(tx).duelBankItem.findMany({
      where: {
        status: DuelBankStatus.LIVE,
        ...(filter.topics ? { topic: { in: filter.topics } } : {}),
        ...(filter.skills ? { skill: { in: filter.skills } } : {}),
        ...(filter.types ? { type: { in: filter.types } } : {}),
      },
      include: ITEM_WITH_OPTIONS,
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Counts per (topic, difficulty) for LIVE items — thin cells visible. */
  async countLiveByTopicDifficulty(
    tx?: TxClient
  ): Promise<Array<{ topic: string; difficulty: number; count: number }>> {
    const groups = await this.db(tx).duelBankItem.groupBy({
      by: ['topic', 'difficulty'],
      where: { status: DuelBankStatus.LIVE },
      _count: { _all: true },
    });
    return groups.map((g) => ({
      topic: g.topic,
      difficulty: g.difficulty,
      count: g._count._all,
    }));
  }

  /** Atomically increments pilot counters and recomputes correctRate. */
  async incrementPilot(id: string, correct: boolean, tx?: TxClient): Promise<BankItemRow> {
    const db = this.db(tx);
    const updated = await db.duelBankItem.update({
      where: { id },
      data: {
        pilotAnswers: { increment: 1 },
        pilotCorrect: { increment: correct ? 1 : 0 },
      },
      include: ITEM_WITH_OPTIONS,
    });
    const correctRate =
      updated.pilotAnswers > 0 ? updated.pilotCorrect / updated.pilotAnswers : null;
    return db.duelBankItem.update({
      where: { id },
      data: { correctRate },
      include: ITEM_WITH_OPTIONS,
    });
  }

  // --- templates -----------------------------------------------------------------

  async findTemplateById(id: string, tx?: TxClient): Promise<BankTemplateRow | null> {
    return this.db(tx).duelBankTemplate.findUnique({ where: { id } });
  }

  async findTemplateByKey(key: string, tx?: TxClient): Promise<BankTemplateRow | null> {
    return this.db(tx).duelBankTemplate.findUnique({ where: { key } });
  }

  // --- exposures -------------------------------------------------------------------

  async listExposures(userIds: string[], tx?: TxClient): Promise<ExposureRow[]> {
    if (userIds.length === 0) return [];
    return this.db(tx).userQuestionExposure.findMany({
      where: { userId: { in: userIds } },
    });
  }

  /**
   * Records that a user saw these items: upserts the exposure row
   * (seenCount + 1, lastSeenAt = now) and bumps each item's
   * exposureCount. Called by the select endpoint (for the caller) and
   * by the future duel module directly.
   */
  async recordExposures(
    userId: string,
    itemIds: string[],
    now: Date,
    tx?: TxClient
  ): Promise<void> {
    const db = this.db(tx);
    for (const bankItemId of itemIds) {
      await db.userQuestionExposure.upsert({
        where: { userId_bankItemId: { userId, bankItemId } },
        create: { userId, bankItemId, lastSeenAt: now, seenCount: 1 },
        update: { lastSeenAt: now, seenCount: { increment: 1 } },
      });
      await db.duelBankItem.update({
        where: { id: bankItemId },
        data: { exposureCount: { increment: 1 } },
      });
    }
  }

  // --- audit (same append-only table as the admin CMS) ------------------------------

  async appendAudit(
    input: {
      actorId: string;
      action: string;
      entityType: string;
      entityId: string;
      before?: unknown;
      after?: unknown;
      ip?: string;
    },
    tx?: TxClient
  ): Promise<void> {
    await this.db(tx).auditLog.create({
      data: {
        actorId: input.actorId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        before:
          input.before === undefined ? Prisma.JsonNull : (input.before as Prisma.InputJsonValue),
        after: input.after === undefined ? Prisma.JsonNull : (input.after as Prisma.InputJsonValue),
        ip: input.ip ?? null,
      },
    });
  }
}
