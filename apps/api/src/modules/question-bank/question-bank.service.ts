import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DuelBankQuestionType, DuelBankSkill, DuelBankStatus, Prisma } from '@prisma/client';
import {
  CHART_SERIES_LENGTH,
  CHART_TEMPLATES,
  DUEL_BANK_TOPICS,
  QUESTION_BANK,
  type ChartTemplateKey,
} from '@candle/shared';
import { AppError } from '../../common/errors/app-error';
import { AppLogger } from '../../common/services/logger.service';
import { TransactionService } from '../../database/transaction.service';
import type { TxClient } from '../../database/tx-client';
import { buildPaginationMeta } from '../../common/utils/pagination';
import { SelectionService } from './selection.service';
import { generateVariant, validateVariant } from './template-engine';
import type { ChartAnnotation, ChartData, PublicChartData } from './chart-generator';
import type {
  CreateBankItemDto,
  GenerateTemplateDto,
  ListBankItemsQueryDto,
  NewBankItemVersionDto,
  ReviewBankItemDto,
  SelectBlueprintDto,
} from './dto/question-bank.dto';
import {
  QuestionBankRepository,
  type BankItemRow,
  type BankTemplateRow,
} from './question-bank.repository';

/**
 * Carried on every question-bank endpoint's OpenAPI docs
 * (blueprint §16 — the disclaimer lives in the product, not just docs).
 */
export const QUESTION_BANK_DISCLAIMER =
  'Educational purpose only — this is not investment advice. ' +
  'All questions are original Candle content. All companies, tickers, ' +
  'and numbers are fictional illustrations.';

export interface BankOptionView {
  id: string;
  text: string;
  order: number;
  /** CASE_CHOICE per-option score fraction (100 / 50 / 0); 0 for other types. */
  points: number;
  /** CASE_CHOICE one-line consequence shown under the action card. */
  consequence: string | null;
}

export interface BankItemAdminView {
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
  options: Array<BankOptionView & { isCorrect: boolean }>;
}

/** Public option view: text + consequence only. No isCorrect, no points. */
export interface PublicBankOptionView {
  id: string;
  text: string;
  order: number;
  /** CASE_CHOICE one-line consequence; null for other types. */
  consequence: string | null;
}

/** Public question view: NEVER carries isCorrect, points, the rubric,
 *  or the explanation. CASE_CHOICE carries `context` (the case numbers
 *  table) and each option's `consequence` — both are shown before
 *  answering, so they are public by design. CHART_CHOICE carries the
 *  `chart` WITHOUT its reveal-only `annotation` (the trend highlight
 *  arrives only at reveal). */
export interface PublicQuestionView {
  id: string;
  stem: string;
  options: PublicBankOptionView[];
  type: DuelBankQuestionType;
  topic: string;
  skill: DuelBankSkill;
  difficulty: number;
  /** CASE_CHOICE only: labelled case numbers, e.g. {"Monthly income": "₹45,000"}. */
  context?: Record<string, string | number> | null;
  /** CHART_CHOICE only: chart data WITHOUT the reveal-only annotation. */
  chart?: PublicChartData | null;
}

export interface CoverageCell {
  topic: string;
  difficulty: number;
  count: number;
}

export interface CoverageResponse {
  total: number;
  cells: CoverageCell[];
}

export interface GenerateResponse {
  templateId: string;
  templateKey: string;
  created: BankItemAdminView[];
  skipped: number;
}

interface ActorContext {
  actorId: string;
  ip?: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Maps a pilot correct-rate to a calibrated difficulty (docs/05 §2.5,
 * ADR 0005 §15). The bands follow the spec's bands exactly:
 *   correctRate >= 0.8 → difficulty 1–2 band
 *   0.5 – 0.8           → difficulty 3
 *   < 0.5               → difficulty 4–5 band
 * Within the outer bands the split is at 0.9 / 0.35: items almost
 * everyone gets right are difficulty 1, items almost no one gets
 * right are difficulty 5. Discrimination is NOT computed here: the
 * per-rating-band correct rates it needs do not exist yet (no duel
 * data), so it stays null — never faked.
 */
export function calibrateDifficulty(correctRate: number): number {
  if (correctRate >= 0.9) return 1;
  if (correctRate >= 0.8) return 2;
  if (correctRate >= 0.5) return 3;
  if (correctRate >= 0.35) return 4;
  return 5;
}

function shuffle<T>(rng: () => number, items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i] as T;
    arr[i] = arr[j] as T;
    arr[j] = tmp;
  }
  return arr;
}

/**
 * QuestionBankService — docs/05 §2 (Duels Step 1).
 *
 * - Admin CMS authoring + two-person review (DRAFT → REVIEW → PILOT →
 *   LIVE, RETIRED). Published versions are immutable: editing a LIVE
 *   item creates a new row (version + 1, status DRAFT).
 * - Pilot answers + calibration after >= 50 pilot answers.
 * - Template-variant generation (DRAFT items, reviewed like any item).
 * - Stratified-random selection over LIVE items only, with the 30-day /
 *   3-times exposure rule, per-topic cap, and skill diversity.
 * - Selection never returns a repeated or thin set silently: it throws
 *   QUESTION_BANK_INSUFFICIENT_COVERAGE (409) instead.
 */
@Injectable()
export class QuestionBankService {
  constructor(
    private readonly repo: QuestionBankRepository,
    private readonly selection: SelectionService,
    private readonly tx: TransactionService,
    private readonly logger: AppLogger
  ) {}

  // --- authoring + workflow (ADMIN) --------------------------------------------

  async createItem(dto: CreateBankItemDto, ctx: ActorContext): Promise<BankItemAdminView> {
    assertKnownTopic(dto.topic);
    validateOptions(
      dto.type,
      dto.options.map((o) => o.isCorrect)
    );
    if (dto.type === DuelBankQuestionType.CASE_CHOICE) {
      validateCaseChoice({
        stem: dto.stem,
        skill: dto.skill,
        difficulty: dto.difficulty,
        context: dto.context,
        rubric: dto.rubric,
        options: dto.options,
      });
    }
    if (dto.type === DuelBankQuestionType.CHART_CHOICE) {
      validateChartChoice({
        stem: dto.stem,
        skill: dto.skill,
        difficulty: dto.difficulty,
        explanation: dto.explanation,
        chart: dto.chart as unknown as ChartData | null | undefined,
        options: dto.options,
      });
    }
    const key = dto.key ?? `qb-${randomUUID()}`;
    return this.tx.run(async (t) => {
      if (await this.repo.findItemByKey(key, t)) {
        throw AppError.conflict(`A question-bank item with key "${key}" already exists.`);
      }
      const item = await this.repo.createItem(
        {
          key,
          topic: dto.topic,
          skill: dto.skill,
          type: dto.type,
          difficulty: dto.difficulty,
          language: dto.language,
          sourceLessonId: dto.sourceLessonId,
          stem: dto.stem,
          explanation: dto.explanation,
          context: dto.context,
          rubric: dto.rubric,
          chart: dto.chart as unknown as Prisma.InputJsonValue | undefined,
          templateId: dto.templateId,
          parameters: dto.parameters as unknown as Prisma.InputJsonValue | undefined,
          authorId: ctx.actorId,
          options: dto.options.map((o, i) => ({
            text: o.text,
            isCorrect: o.isCorrect,
            points: o.points ?? 0,
            consequence: o.consequence,
            order: o.order ?? i,
          })),
        },
        t
      );
      await this.audit(ctx, 'question-bank.item.create', item.id, undefined, item, t);
      this.logger.info('Question-bank item created', { actorId: ctx.actorId, itemId: item.id });
      return toAdminView(item);
    });
  }

  /** DRAFT → REVIEW. Any admin may submit; the two-person gate is review. */
  async submitReview(id: string, ctx: ActorContext): Promise<BankItemAdminView> {
    return this.tx.run(async (t) => {
      const item = await this.requireItem(id, t);
      assertTransition(item, [DuelBankStatus.DRAFT], 'submit for review');
      const after = await this.repo.updateItem(id, { status: DuelBankStatus.REVIEW }, t);
      await this.audit(ctx, 'question-bank.item.submit-review', id, item, after, t);
      return toAdminView(after);
    });
  }

  /**
   * REVIEW → PILOT on approve, REVIEW → DRAFT on reject. The reviewer
   * MUST differ from the author (two-person rule, ADR 0005 §15).
   */
  async review(id: string, dto: ReviewBankItemDto, ctx: ActorContext): Promise<BankItemAdminView> {
    return this.tx.run(async (t) => {
      const item = await this.requireItem(id, t);
      assertTransition(item, [DuelBankStatus.REVIEW], 'review');
      if (item.authorId !== null && item.authorId === ctx.actorId) {
        throw AppError.questionBankReviewerMustDiffer(
          'The reviewer must be a different person from the author.'
        );
      }
      const after = await this.repo.updateItem(
        id,
        {
          status: dto.decision === 'APPROVE' ? DuelBankStatus.PILOT : DuelBankStatus.DRAFT,
          reviewerId: ctx.actorId,
        },
        t
      );
      await this.audit(
        ctx,
        `question-bank.item.review.${dto.decision.toLowerCase()}`,
        id,
        item,
        after,
        t
      );
      return toAdminView(after);
    });
  }

  /** PILOT → LIVE only. Never direct DRAFT → LIVE (approve-then-publish). */
  async publish(id: string, ctx: ActorContext, now: Date = new Date()): Promise<BankItemAdminView> {
    return this.tx.run(async (t) => {
      const item = await this.requireItem(id, t);
      assertTransition(item, [DuelBankStatus.PILOT], 'publish');
      const after = await this.repo.updateItem(
        id,
        { status: DuelBankStatus.LIVE, publishedAt: now },
        t
      );
      await this.audit(ctx, 'question-bank.item.publish', id, item, after, t);
      this.logger.info('Question-bank item published', { actorId: ctx.actorId, itemId: id });
      return toAdminView(after);
    });
  }

  /** LIVE / PILOT → RETIRED. */
  async retire(id: string, ctx: ActorContext): Promise<BankItemAdminView> {
    return this.tx.run(async (t) => {
      const item = await this.requireItem(id, t);
      assertTransition(item, [DuelBankStatus.LIVE, DuelBankStatus.PILOT], 'retire');
      const after = await this.repo.updateItem(id, { status: DuelBankStatus.RETIRED }, t);
      await this.audit(ctx, 'question-bank.item.retire', id, item, after, t);
      return toAdminView(after);
    });
  }

  /**
   * Creates a NEW row (version + 1, status DRAFT) from any item — the
   * published-version immutability rule (docs/05 §2.2). The old row is
   * never edited in place. Key becomes "<key>-v<version>".
   */
  async newVersion(
    id: string,
    dto: NewBankItemVersionDto,
    ctx: ActorContext
  ): Promise<BankItemAdminView> {
    const effectiveType = dto.type;
    if (dto.options && effectiveType)
      validateOptions(
        effectiveType,
        dto.options.map((o) => o.isCorrect)
      );
    return this.tx.run(async (t) => {
      const item = await this.requireItem(id, t);
      if (dto.options && !effectiveType) {
        validateOptions(
          item.type,
          dto.options.map((o) => o.isCorrect)
        );
      }
      const mergedType = dto.type ?? item.type;
      if (mergedType === DuelBankQuestionType.CHART_CHOICE) {
        const mergedOptions = (dto.options ?? item.options).map((o) => ({
          text: o.text,
          isCorrect: o.isCorrect,
          points: (o as { points?: number }).points ?? 0,
        }));
        validateChartChoice({
          stem: dto.stem ?? item.stem,
          skill: dto.skill ?? item.skill,
          difficulty: dto.difficulty ?? item.difficulty,
          explanation: dto.explanation ?? item.explanation,
          chart: (dto.chart ?? (item.chart as ChartData | null)) as ChartData | null | undefined,
          options: mergedOptions,
        });
      }
      if (mergedType === DuelBankQuestionType.CASE_CHOICE) {
        const mergedOptions = (dto.options ?? item.options).map((o) => ({
          text: o.text,
          isCorrect: o.isCorrect,
          points: (o as { points?: number }).points ?? 0,
          consequence: (o as { consequence?: string | null }).consequence ?? undefined,
        }));
        validateCaseChoice({
          stem: dto.stem ?? item.stem,
          skill: dto.skill ?? item.skill,
          difficulty: dto.difficulty ?? item.difficulty,
          context: dto.context ?? (item.context as Record<string, string | number> | null),
          rubric: dto.rubric ?? item.rubric ?? undefined,
          options: mergedOptions,
        });
      }
      const version = item.version + 1;
      const key = `${item.key}-v${version}`;
      if (await this.repo.findItemByKey(key, t)) {
        throw AppError.conflict(`A question-bank item with key "${key}" already exists.`);
      }
      const options = (dto.options ?? item.options).map((o, i) => ({
        text: o.text,
        isCorrect: o.isCorrect,
        points: (o as { points?: number }).points ?? 0,
        consequence: (o as { consequence?: string | null }).consequence ?? undefined,
        order: o.order ?? i,
      }));
      const created = await this.repo.createItem(
        {
          key,
          topic: dto.topic ?? item.topic,
          skill: dto.skill ?? item.skill,
          type: dto.type ?? item.type,
          difficulty: dto.difficulty ?? item.difficulty,
          language: item.language,
          sourceLessonId: item.sourceLessonId ?? undefined,
          stem: dto.stem ?? item.stem,
          explanation: dto.explanation ?? item.explanation,
          context: (dto.context ?? (item.context as Prisma.InputJsonValue | null)) as
            Prisma.InputJsonValue | undefined,
          rubric: dto.rubric ?? item.rubric ?? undefined,
          chart: (dto.chart ?? (item.chart as Prisma.InputJsonValue | null)) as
            Prisma.InputJsonValue | undefined,
          version,
          templateId: item.templateId ?? undefined,
          parameters: item.parameters ?? undefined,
          authorId: ctx.actorId,
          options,
        },
        t
      );
      // A new version is a fresh draft: no reviewer, no pilot data.
      await this.audit(ctx, 'question-bank.item.new-version', created.id, item, created, t);
      return toAdminView(created);
    });
  }

  async getItem(id: string): Promise<BankItemAdminView> {
    return toAdminView(await this.requireItem(id));
  }

  async listItems(query: ListBankItemsQueryDto): Promise<{
    items: BankItemAdminView[];
    meta: ReturnType<typeof buildPaginationMeta>;
  }> {
    if (query.topic) assertKnownTopic(query.topic);
    const { items, total } = await this.repo.listItems({
      status: query.status,
      topic: query.topic,
      skill: query.skill,
      type: query.type,
      difficulty: query.difficulty,
      language: query.language,
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });
    return {
      items: items.map(toAdminView),
      meta: buildPaginationMeta(query.page, query.limit, total),
    };
  }

  /** Counts per (topic × difficulty) for LIVE items, zeros included. */
  async coverage(): Promise<CoverageResponse> {
    const counts = await this.repo.countLiveByTopicDifficulty();
    const byCell = new Map(counts.map((c) => [`${c.topic}:${c.difficulty}`, c.count]));
    const cells: CoverageCell[] = [];
    for (const topic of DUEL_BANK_TOPICS) {
      for (let difficulty = 1; difficulty <= 5; difficulty++) {
        cells.push({ topic, difficulty, count: byCell.get(`${topic}:${difficulty}`) ?? 0 });
      }
    }
    return { total: counts.reduce((sum, c) => sum + c.count, 0), cells };
  }

  // --- pilot + calibration --------------------------------------------------------

  /**
   * Records one pilot answer (called by future practice/bot duels).
   * Increments pilotAnswers/pilotCorrect and recomputes correctRate.
   * Pilot items are NEVER returned by the selection engine.
   */
  async recordPilotAnswer(itemId: string, correct: boolean): Promise<BankItemAdminView> {
    const item = await this.requireItem(itemId);
    if (item.status !== DuelBankStatus.PILOT) {
      throw AppError.questionBankInvalidTransition(
        `Pilot answers can only be recorded for PILOT items (current status: ${item.status}).`
      );
    }
    return toAdminView(await this.repo.incrementPilot(itemId, correct));
  }

  /**
   * Calibrates difficulty from pilot data (needs >= 50 pilot answers).
   * Discrimination stays null: full IRT calibration needs real duel
   * data (per-rating-band correct rates), which does not exist yet.
   */
  async calibrate(itemId: string): Promise<BankItemAdminView> {
    const item = await this.requireItem(itemId);
    if (item.pilotAnswers < QUESTION_BANK.PILOT_MIN_ANSWERS) {
      throw AppError.conflict(
        `Calibration needs at least ${QUESTION_BANK.PILOT_MIN_ANSWERS} pilot answers ` +
          `(this item has ${item.pilotAnswers}).`
      );
    }
    if (item.correctRate === null) {
      throw AppError.conflict('This item has no pilot correct-rate to calibrate from.');
    }
    const difficulty = calibrateDifficulty(item.correctRate);
    const after = await this.repo.updateItem(itemId, { difficulty });
    this.logger.info('Question-bank item calibrated', {
      itemId,
      correctRate: item.correctRate,
      difficulty,
    });
    return toAdminView(after);
  }

  // --- templates --------------------------------------------------------------------

  /**
   * Generates `count` DRAFT variants from a template (deterministic per
   * seed). Variants already generated for the same template+seed are
   * skipped by key, so re-running a seed never duplicates items.
   * Generated variants go through review like any item.
   */
  async generateFromTemplate(
    templateId: string,
    dto: GenerateTemplateDto,
    ctx: ActorContext
  ): Promise<GenerateResponse> {
    const template = await this.requireTemplate(templateId);
    const created: BankItemAdminView[] = [];
    let skipped = 0;
    await this.tx.run(async (t) => {
      for (let i = 0; i < dto.count; i++) {
        let variant;
        try {
          variant = generateVariant(template.key, dto.seed + i);
          validateVariant(variant);
        } catch (err) {
          throw AppError.validationFailed([
            {
              field: 'template',
              issue: err instanceof Error ? err.message : 'Template generation failed.',
            },
          ]);
        }
        const key = `qb-${template.key}-${dto.seed}-${i}`;
        if (await this.repo.findItemByKey(key, t)) {
          skipped += 1;
          continue;
        }
        const item = await this.repo.createItem(
          {
            key,
            topic: template.topic,
            skill: template.skill,
            type: DuelBankQuestionType.MCQ_4,
            // Author estimate for a fresh variant; pilot + calibration
            // set the real difficulty later (docs/05 §2.5).
            difficulty: 3,
            stem: variant.stem,
            explanation: variant.explanation,
            templateId: template.id,
            parameters: variant.parameters,
            authorId: ctx.actorId,
            options: variant.options.map((o, idx) => ({
              text: o.text,
              isCorrect: o.isCorrect,
              order: idx,
            })),
          },
          t
        );
        created.push(toAdminView(item));
      }
      await this.audit(
        ctx,
        'question-bank.template.generate',
        template.id,
        template,
        { created: created.length, skipped },
        t
      );
    });
    this.logger.info('Question-bank template variants generated', {
      actorId: ctx.actorId,
      templateId,
      created: created.length,
      skipped,
    });
    return { templateId: template.id, templateKey: template.key, created, skipped };
  }

  // --- selection + exposure ----------------------------------------------------------

  /**
   * Selects a duel set: LIVE items only, stratified by the requested
   * difficulty mix, per-topic cap, skill diversity, exposure exclusions
   * (seen in the last 30 days or seen >= 3 times, for ANY of the
   * users). Throws QUESTION_BANK_INSUFFICIENT_COVERAGE (409) when the
   * bank cannot fill the set even after nearest-difficulty fallback.
   * Returned items are PUBLIC views — never isCorrect or explanation.
   */
  async selectSet(
    userIds: string[],
    dto: SelectBlueprintDto,
    opts: { now?: Date; rng?: () => number; tx?: TxClient } = {}
  ): Promise<PublicQuestionView[]> {
    const now = opts.now ?? new Date();
    const rng = opts.rng ?? Math.random;
    assertValidBlueprint(dto);
    const tx = opts.tx;
    const [live, exposures] = await Promise.all([
      this.repo.listLiveItems({ topics: dto.topics, skills: dto.skills, types: dto.types }, tx),
      this.repo.listExposures(userIds, tx),
    ]);
    const cutoff = now.getTime() - QUESTION_BANK.EXPOSURE_WINDOW_DAYS * DAY_MS;
    const excluded = new Set<string>();
    for (const e of exposures) {
      if (e.seenCount >= QUESTION_BANK.EXPOSURE_MAX_SEEN || e.lastSeenAt.getTime() >= cutoff) {
        excluded.add(e.bankItemId);
      }
    }
    const pool = live.filter((item) => !excluded.has(item.id));
    let picked;
    try {
      picked = this.selection.select(
        pool.map((item) => ({
          id: item.id,
          topic: item.topic,
          skill: item.skill,
          difficulty: item.difficulty,
        })),
        {
          count: dto.count,
          difficultyMix: dto.difficultyMix,
          topics: dto.topics,
          skills: dto.skills,
          maxPerTopic: dto.maxPerTopic,
        },
        rng
      );
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('INSUFFICIENT_COVERAGE')) {
        throw AppError.questionBankInsufficientCoverage(
          err.message.replace('INSUFFICIENT_COVERAGE: ', '')
        );
      }
      throw err;
    }
    const byId = new Map(pool.map((item) => [item.id, item]));
    return picked.map((p) => {
      const item = byId.get(p.id);
      if (!item) throw new Error('Selection returned an unknown item.');
      return toPublicView(item, rng);
    });
  }

  /**
   * Selects a set for the caller and records exposure for the caller in
   * ONE transaction. Future live duels will call `selectSet` +
   * `recordExposure` on the service directly instead of this endpoint.
   */
  async selectAndRecordExposure(
    callerId: string,
    dto: SelectBlueprintDto,
    opts: { now?: Date; rng?: () => number } = {}
  ): Promise<{ items: PublicQuestionView[] }> {
    const now = opts.now ?? new Date();
    const userIds = dto.userIds && dto.userIds.length > 0 ? dto.userIds : [callerId];
    const items = await this.tx.run(async (t) => {
      const selected = await this.selectSet(userIds, dto, { now, rng: opts.rng, tx: t });
      await this.repo.recordExposures(
        callerId,
        selected.map((s) => s.id),
        now,
        t
      );
      return selected;
    });
    return { items };
  }

  /** Records that a user saw these items (future duel module seam). */
  async recordExposure(userId: string, itemIds: string[], now: Date = new Date()): Promise<void> {
    if (itemIds.length === 0) return;
    await this.repo.recordExposures(userId, itemIds, now);
  }

  /**
   * Bank items WITH answers, for server-side duel grading (ADR 0006/4).
   * Service-internal only — never exposed through the controller.
   * Returned in the requested order; throws NOT_FOUND when any id is
   * unknown (a duel set must never silently lose a question).
   */
  async getItemsForGrading(itemIds: string[], tx?: TxClient): Promise<BankItemRow[]> {
    const rows = await this.repo.findItemsByIds(itemIds, tx);
    const byId = new Map(rows.map((r) => [r.id, r]));
    const ordered: BankItemRow[] = [];
    for (const id of itemIds) {
      const row = byId.get(id);
      if (!row) throw AppError.notFound('A question in this duel no longer exists.');
      ordered.push(row);
    }
    return ordered;
  }

  // --- internals ------------------------------------------------------------------------

  private async requireItem(id: string, tx?: TxClient): Promise<BankItemRow> {
    const item = await this.repo.findItemById(id, tx);
    if (!item) throw AppError.notFound('Question-bank item not found.');
    return item;
  }

  private async requireTemplate(id: string, tx?: TxClient): Promise<BankTemplateRow> {
    const template = await this.repo.findTemplateById(id, tx);
    if (!template) throw AppError.notFound('Question-bank template not found.');
    return template;
  }

  private async audit(
    ctx: ActorContext,
    action: string,
    entityId: string,
    before: unknown,
    after: unknown,
    tx?: TxClient
  ): Promise<void> {
    await this.repo.appendAudit(
      { ...ctx, action, entityType: 'duel_bank_item', entityId, before, after },
      tx
    );
    this.logger.info('Question-bank admin action', {
      actorId: ctx.actorId,
      action,
      entityId,
    });
  }
}

/** MCQ_4 needs exactly 4 options with exactly 1 correct; TRUE_FALSE needs
 *  exactly 2 with exactly 1 correct; CASE_CHOICE needs 3–4 with exactly
 *  1 correct (the best action); CHART_CHOICE needs exactly 4 with exactly
 *  1 correct (one interpretation of the chart); other types need >= 2
 *  with >= 1 correct. */
export function validateOptions(type: DuelBankQuestionType, isCorrect: boolean[]): void {
  const correct = isCorrect.filter(Boolean).length;
  if (type === DuelBankQuestionType.MCQ_4) {
    if (isCorrect.length !== 4 || correct !== 1) {
      throw AppError.validationFailed([
        {
          field: 'options',
          issue: 'MCQ_4 questions need exactly 4 options with exactly 1 correct option.',
        },
      ]);
    }
    return;
  }
  if (type === DuelBankQuestionType.CHART_CHOICE) {
    if (isCorrect.length !== 4 || correct !== 1) {
      throw AppError.validationFailed([
        {
          field: 'options',
          issue:
            'CHART_CHOICE questions need exactly 4 options (interpretations) with exactly 1 correct option.',
        },
      ]);
    }
    return;
  }
  if (type === DuelBankQuestionType.TRUE_FALSE) {
    if (isCorrect.length !== 2 || correct !== 1) {
      throw AppError.validationFailed([
        {
          field: 'options',
          issue: 'TRUE_FALSE questions need exactly 2 options with exactly 1 correct option.',
        },
      ]);
    }
    return;
  }
  if (type === DuelBankQuestionType.CASE_CHOICE) {
    if (isCorrect.length < 3 || isCorrect.length > 4 || correct !== 1) {
      throw AppError.validationFailed([
        {
          field: 'options',
          issue:
            'CASE_CHOICE questions need 3–4 options with exactly 1 correct option (the best action).',
        },
      ]);
    }
    return;
  }
  if (isCorrect.length < 2 || correct < 1) {
    throw AppError.validationFailed([
      {
        field: 'options',
        issue: 'Questions need at least 2 options with at least 1 correct option.',
      },
    ]);
  }
}

/**
 * Real-company / real-ticker names. A CASE_CHOICE field may never pair a
 * buy/sell verb with one of these: that would be a buy/sell recommendation
 * for a real security (blueprint §16 — education, not advice; fictional
 * instruments only). Mentioning a real name without a trade verb (e.g. a
 * news example) is not a recommendation and is not rejected here.
 */
const REAL_SECURITY_NAMES = [
  'RELIANCE',
  'TCS',
  'INFOSYS',
  'INFY',
  'HDFC',
  'ICICI',
  'SBI',
  'WIPRO',
  'HCL',
  'ITC',
  'TATA',
  'ADANI',
  'AXIS',
  'KOTAK',
  'BAJAJ',
  'MARUTI',
  'NIFTY',
  'SENSEX',
  'NSE',
  'BSE',
  'ZERODHA',
  'GROWW',
  'HINDUNILVR',
  'HINDUSTAN UNILEVER',
  'BHARTI AIRTEL',
  'LARSEN',
  'L&T',
] as const;

const TRADE_VERB =
  /\b(buy|buys|buying|sell|sells|selling|short|purchase|purchases|invest in|investing in)\b/i;

function assertNoRealSecurityAdvice(field: string, text: string): void {
  // Whole-word match only: a substring match would false-positive on
  // ordinary words ("switching" contains "itc", "expenses" contains
  // "nse"). A real name must appear as its own word.
  const namesReal = REAL_SECURITY_NAMES.some((name) =>
    new RegExp(`(?<![A-Za-z])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z])`, 'i').test(
      text
    )
  );
  if (namesReal && TRADE_VERB.test(text)) {
    throw AppError.validationFailed([
      {
        field,
        issue:
          'Must not contain a buy/sell recommendation for a real security — fictional instruments only.',
      },
    ]);
  }
}

function countLines(text: string): number {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean).length;
}

function countSentences(text: string): number {
  return text
    .trim()
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean).length;
}

export interface CaseChoiceOptionInput {
  text: string;
  isCorrect: boolean;
  points?: number;
  consequence?: string | null;
}

export interface CaseChoiceInput {
  stem: string;
  skill: DuelBankSkill;
  difficulty: number;
  context?: Record<string, string | number> | null;
  rubric?: string | null;
  options: CaseChoiceOptionInput[];
}

/**
 * CASE_CHOICE domain validation (docs/08 §3.3) — everything the option
 * shape alone cannot express. Called by createItem and newVersion;
 * MCQ_4 / TRUE_FALSE validation is untouched by this function.
 *
 * - Stem: 3–5 short lines (the case: person, income, goal, constraint).
 * - Skill: JUDGEMENT, SCENARIO, or RISK_ASSESSMENT only (cases are
 *   judgement, not recall); difficulty 2–4 only in v1 (no 1 or 5).
 * - Context: a non-empty object with at least 2 labelled entries, and
 *   at least 2 entries whose value carries a number (numbers live in
 *   the table, never buried only in prose).
 * - Rubric: required, at least 2 lines/sentences.
 * - Options: exactly one 100 (the correct/best action), at most one 50
 *   (the tempting second-best), the rest 0; every option has a
 *   non-empty consequence; option texts are distinct.
 * - No field may carry a buy/sell recommendation for a real security.
 */
export function validateCaseChoice(input: CaseChoiceInput): void {
  const issues: Array<{ field: string; issue: string }> = [];
  const lines = countLines(input.stem);
  if (lines < 3 || lines > 5) {
    issues.push({
      field: 'stem',
      issue: `CASE_CHOICE stems need 3–5 short lines (the case: person, income, goal, constraint); got ${lines}.`,
    });
  }
  for (const line of input.stem
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)) {
    if (line.length > 160) {
      issues.push({
        field: 'stem',
        issue: 'Each stem line must be short (at most 160 characters).',
      });
      break;
    }
  }
  if (
    input.skill !== DuelBankSkill.JUDGEMENT &&
    input.skill !== DuelBankSkill.SCENARIO &&
    input.skill !== DuelBankSkill.RISK_ASSESSMENT
  ) {
    issues.push({
      field: 'skill',
      issue: 'CASE_CHOICE items use JUDGEMENT, SCENARIO, or RISK_ASSESSMENT only.',
    });
  }
  if (input.difficulty < 2 || input.difficulty > 4) {
    issues.push({
      field: 'difficulty',
      issue: 'CASE_CHOICE items use difficulty 2–4 in v1 (cases are judgement, not recall).',
    });
  }
  const context = input.context;
  if (!context || typeof context !== 'object' || Array.isArray(context)) {
    issues.push({
      field: 'context',
      issue: 'CASE_CHOICE needs a context object with labelled entries.',
    });
  } else {
    const entries = Object.entries(context).filter(
      ([k, v]) =>
        k.trim().length > 0 && v !== null && v !== undefined && String(v).trim().length > 0
    );
    if (entries.length < 2) {
      issues.push({
        field: 'context',
        issue: 'CASE_CHOICE context needs at least 2 labelled entries.',
      });
    }
    const withNumber = entries.filter(([, v]) => /\d/.test(String(v))).length;
    if (withNumber < 2) {
      issues.push({
        field: 'context',
        issue: 'CASE_CHOICE context needs at least 2 entries carrying a number.',
      });
    }
  }
  if (!input.rubric || input.rubric.trim().length === 0) {
    issues.push({ field: 'rubric', issue: 'CASE_CHOICE needs a rubric.' });
  } else if (Math.max(countLines(input.rubric), countSentences(input.rubric)) < 2) {
    issues.push({
      field: 'rubric',
      issue: 'CASE_CHOICE rubric needs at least 2 lines/sentences.',
    });
  }
  const points = input.options.map((o) => o.points ?? 0);
  if (points.filter((p) => p === 100).length !== 1) {
    issues.push({
      field: 'options',
      issue: 'CASE_CHOICE needs exactly one option with 100 points (the best action).',
    });
  }
  if (points.filter((p) => p === 50).length > 1) {
    issues.push({
      field: 'options',
      issue: 'CASE_CHOICE allows at most one option with 50 points (the second-best action).',
    });
  }
  for (const p of points) {
    if (p !== 0 && p !== 50 && p !== 100) {
      issues.push({
        field: 'options',
        issue: 'CASE_CHOICE option points must be 0, 50, or 100.',
      });
      break;
    }
  }
  input.options.forEach((o, i) => {
    if (o.isCorrect && (o.points ?? 0) !== 100) {
      issues.push({
        field: 'options',
        issue: `Option ${i + 1} is the correct (best) action, so it must carry 100 points.`,
      });
    }
    if (!o.consequence || o.consequence.trim().length === 0) {
      issues.push({
        field: 'options',
        issue: `Option ${i + 1} needs a non-empty consequence (one line under the action card).`,
      });
    }
  });
  const texts = input.options.map((o) => o.text.trim());
  if (new Set(texts).size !== texts.length) {
    issues.push({ field: 'options', issue: 'CASE_CHOICE option texts must be distinct.' });
  }
  if (issues.length > 0) throw AppError.validationFailed(issues);
  assertNoRealSecurityAdvice('stem', input.stem);
  if (input.rubric) assertNoRealSecurityAdvice('rubric', input.rubric);
  input.options.forEach((o) => {
    assertNoRealSecurityAdvice('options', o.text);
    if (o.consequence) assertNoRealSecurityAdvice('options', o.consequence);
  });
}

export interface ChartChoiceOptionInput {
  text: string;
  isCorrect: boolean;
  points?: number;
}

export interface ChartChoiceInput {
  stem: string;
  skill: DuelBankSkill;
  difficulty: number;
  explanation: string;
  chart?: ChartData | null;
  options: ChartChoiceOptionInput[];
}

/** Trends a template's annotation may carry (docs/08 §3.4). */
const CHART_TRENDS_BY_TEMPLATE: Record<ChartTemplateKey, Array<ChartAnnotation['trend']>> = {
  STEADY_RISE: ['rising'],
  STEADY_FALL: ['falling'],
  VOLATILE_FLAT: ['volatile', 'flat'],
  SHARP_FALL_RECOVERY: ['volatile'],
  SPIKE_THEN_FALL: ['volatile'],
};

/**
 * CHART_CHOICE domain validation (docs/08 §3.4) — everything the option
 * shape alone cannot express. Called by createItem and newVersion;
 * MCQ_4 / TRUE_FALSE / CASE_CHOICE validation is untouched by this
 * function.
 *
 * - Skill: CHART_READING only (charts are read, not recalled);
 *   difficulty 2–4 only in v1 (no 1 or 5).
 * - Chart: required, with a title, a fictional instrument, axis
 *   labels, exactly CHART_SERIES_LENGTH xLabels and series values —
 *   all finite, all positive — and a known template. The series must
 *   match the template's shape (a rise must end above its start, a
 *   recovery must trough mid-series and end above the trough, and so
 *   on — the generator's promises, pinned in chart-generator.spec.ts).
 * - Annotation (when present): trend must fit the template, zone
 *   indices in range, zoneStart <= zoneEnd.
 * - Explanation: 1–3 short simple sentences, showing how to read
 *   the chart (the same rule the seed spec enforces).
 * - Options: exactly 4 interpretations, exactly 1 correct, distinct
 *   texts, and NO per-option points — a wrong chart read is a wrong
 *   answer, no partial credit (docs/08 §3.4).
 * - No field may carry a buy/sell recommendation for a real security,
 *   and the instrument must be fictional: never a real name, never a
 *   bare ticker-like code (2–5 capital letters).
 */
export function validateChartChoice(input: ChartChoiceInput): void {
  const issues: Array<{ field: string; issue: string }> = [];
  if (input.skill !== DuelBankSkill.CHART_READING) {
    issues.push({
      field: 'skill',
      issue: 'CHART_CHOICE items use CHART_READING only.',
    });
  }
  if (input.difficulty < 2 || input.difficulty > 4) {
    issues.push({
      field: 'difficulty',
      issue: 'CHART_CHOICE items use difficulty 2–4 in v1 (charts are read, not recalled).',
    });
  }
  const sentences = countSentences(input.explanation ?? '');
  if (sentences < 1 || sentences > 3) {
    issues.push({
      field: 'explanation',
      issue: 'CHART_CHOICE explanations need 1–3 short simple sentences.',
    });
  }
  const chart = input.chart;
  if (!chart || typeof chart !== 'object' || Array.isArray(chart)) {
    issues.push({ field: 'chart', issue: 'CHART_CHOICE needs chart data.' });
  } else {
    if (!chart.title || chart.title.trim().length === 0) {
      issues.push({ field: 'chart.title', issue: 'CHART_CHOICE chart needs a title.' });
    } else if (chart.title.length > 120) {
      issues.push({ field: 'chart.title', issue: 'Chart title must be at most 120 characters.' });
    }
    if (!chart.instrument || chart.instrument.trim().length === 0) {
      issues.push({
        field: 'chart.instrument',
        issue: 'CHART_CHOICE chart needs a fictional instrument name.',
      });
    } else if (/^[A-Z]{2,5}$/.test(chart.instrument.trim())) {
      issues.push({
        field: 'chart.instrument',
        issue: 'Instrument must be a fictional name, not a bare ticker-like code.',
      });
    }
    if (!chart.xLabel || chart.xLabel.trim().length === 0) {
      issues.push({ field: 'chart.xLabel', issue: 'CHART_CHOICE chart needs an x-axis label.' });
    }
    if (!chart.yLabel || chart.yLabel.trim().length === 0) {
      issues.push({ field: 'chart.yLabel', issue: 'CHART_CHOICE chart needs a y-axis label.' });
    }
    if (!Array.isArray(chart.xLabels) || chart.xLabels.length !== CHART_SERIES_LENGTH) {
      issues.push({
        field: 'chart.xLabels',
        issue: `CHART_CHOICE chart needs exactly ${CHART_SERIES_LENGTH} xLabels.`,
      });
    } else if (chart.xLabels.some((l) => typeof l !== 'string' || l.trim().length === 0)) {
      issues.push({
        field: 'chart.xLabels',
        issue: 'Every xLabel must be a non-empty string.',
      });
    }
    if (!Array.isArray(chart.series) || chart.series.length !== CHART_SERIES_LENGTH) {
      issues.push({
        field: 'chart.series',
        issue: `CHART_CHOICE chart needs exactly ${CHART_SERIES_LENGTH} series values.`,
      });
    } else {
      for (const v of chart.series) {
        if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || v > 1_000_000) {
          issues.push({
            field: 'chart.series',
            issue: 'Every series value must be a finite positive number (at most 1,000,000).',
          });
          break;
        }
      }
      if (
        Array.isArray(chart.series) &&
        chart.series.length === CHART_SERIES_LENGTH &&
        chart.series.every((v) => typeof v === 'number' && Number.isFinite(v))
      ) {
        const series = chart.series;
        const first = series[0] as number;
        const last = series[CHART_SERIES_LENGTH - 1] as number;
        const min = Math.min(...series);
        const max = Math.max(...series);
        const templateIssue = (msg: string): void => {
          issues.push({ field: 'chart.series', issue: msg });
        };
        switch (chart.template) {
          case 'STEADY_RISE':
            if (last <= first) templateIssue('A STEADY_RISE chart must end above its start.');
            break;
          case 'STEADY_FALL':
            if (last >= first) templateIssue('A STEADY_FALL chart must end below its start.');
            break;
          case 'VOLATILE_FLAT':
            if (Math.abs(last - first) / first > 0.1) {
              templateIssue('A VOLATILE_FLAT chart must end within 10% of its start.');
            }
            break;
          case 'SHARP_FALL_RECOVERY': {
            const minIndex = series.indexOf(min);
            if (minIndex < 1 || minIndex > 3) {
              templateIssue('A SHARP_FALL_RECOVERY chart must trough mid-series.');
            }
            if (last <= min) {
              templateIssue('A SHARP_FALL_RECOVERY chart must end above its trough.');
            }
            if (last >= first) {
              templateIssue('A SHARP_FALL_RECOVERY chart must end below its start.');
            }
            break;
          }
          case 'SPIKE_THEN_FALL': {
            const maxIndex = series.indexOf(max);
            if (maxIndex < 1 || maxIndex > 4) {
              templateIssue('A SPIKE_THEN_FALL chart must peak mid-series.');
            }
            if (last >= first) {
              templateIssue('A SPIKE_THEN_FALL chart must end below its start.');
            }
            break;
          }
          default:
            issues.push({
              field: 'chart.template',
              issue: `Unknown chart template "${String(chart.template)}".`,
            });
        }
      }
    }
    if (!chart.template || !(CHART_TEMPLATES as readonly string[]).includes(chart.template)) {
      issues.push({
        field: 'chart.template',
        issue: `Chart template must be one of: ${CHART_TEMPLATES.join(', ')}.`,
      });
    }
    if (chart.annotation !== undefined && chart.annotation !== null) {
      const annotation = chart.annotation;
      const allowedTrends = chart.template ? (CHART_TRENDS_BY_TEMPLATE[chart.template] ?? []) : [];
      if (
        !['rising', 'falling', 'flat', 'volatile'].includes(annotation.trend) ||
        (allowedTrends.length > 0 && !allowedTrends.includes(annotation.trend))
      ) {
        issues.push({
          field: 'chart.annotation',
          issue: `Annotation trend "${annotation.trend}" does not fit template ${chart.template}.`,
        });
      }
      if (
        !Number.isInteger(annotation.zoneStart) ||
        !Number.isInteger(annotation.zoneEnd) ||
        annotation.zoneStart < 0 ||
        annotation.zoneEnd > CHART_SERIES_LENGTH - 1 ||
        annotation.zoneStart > annotation.zoneEnd
      ) {
        issues.push({
          field: 'chart.annotation',
          issue: `Annotation zone must be within 0..${CHART_SERIES_LENGTH - 1} with zoneStart <= zoneEnd.`,
        });
      }
    }
  }
  for (const p of input.options.map((o) => o.points ?? 0)) {
    if (p !== 0) {
      issues.push({
        field: 'options',
        issue:
          'CHART_CHOICE options carry no per-option points — a wrong chart read is a wrong answer.',
      });
      break;
    }
  }
  const texts = input.options.map((o) => o.text.trim());
  if (new Set(texts).size !== texts.length) {
    issues.push({ field: 'options', issue: 'CHART_CHOICE option texts must be distinct.' });
  }
  if (issues.length > 0) throw AppError.validationFailed(issues);
  assertNoRealSecurityAdvice('stem', input.stem);
  assertNoRealSecurityAdvice('explanation', input.explanation);
  if (chart && typeof chart === 'object' && !Array.isArray(chart)) {
    assertNoRealSecurityAdvice('chart.title', chart.title ?? '');
    assertNoRealSecurityAdvice('chart.instrument', chart.instrument ?? '');
  }
  input.options.forEach((o) => {
    assertNoRealSecurityAdvice('options', o.text);
  });
}

function assertKnownTopic(topic: string): void {
  if (!(DUEL_BANK_TOPICS as readonly string[]).includes(topic)) {
    throw AppError.validationFailed([{ field: 'topic', issue: `Unknown topic "${topic}".` }]);
  }
}

function assertTransition(item: BankItemRow, allowed: DuelBankStatus[], action: string): void {
  if (!allowed.includes(item.status)) {
    throw AppError.questionBankInvalidTransition(
      `Cannot ${action} an item with status ${item.status} ` +
        `(allowed from: ${allowed.join(', ')}).`
    );
  }
}

function assertValidBlueprint(dto: SelectBlueprintDto): void {
  if (!Number.isInteger(dto.count) || dto.count < 1 || dto.count > 20) {
    throw AppError.validationFailed([
      { field: 'count', issue: 'count must be an integer between 1 and 20.' },
    ]);
  }
  if (dto.topics) for (const t of dto.topics) assertKnownTopic(t);
  const entries = Object.entries(dto.difficultyMix ?? {});
  if (entries.length === 0) {
    throw AppError.validationFailed([
      { field: 'difficultyMix', issue: 'difficultyMix must list at least one difficulty.' },
    ]);
  }
  let sum = 0;
  for (const [k, v] of entries) {
    const d = Number(k);
    if (!Number.isInteger(d) || d < 1 || d > 5) {
      throw AppError.validationFailed([
        { field: 'difficultyMix', issue: `Difficulty "${k}" is not between 1 and 5.` },
      ]);
    }
    if (!Number.isInteger(v) || v < 0) {
      throw AppError.validationFailed([
        {
          field: 'difficultyMix',
          issue: `Count for difficulty ${d} must be a non-negative integer.`,
        },
      ]);
    }
    sum += v;
  }
  if (sum !== dto.count) {
    throw AppError.validationFailed([
      { field: 'difficultyMix', issue: `difficultyMix sums to ${sum} but count is ${dto.count}.` },
    ]);
  }
  if (dto.userIds && dto.userIds.length > 2) {
    throw AppError.validationFailed([
      { field: 'userIds', issue: 'At most 2 users (the two players of one duel).' },
    ]);
  }
}

function toAdminView(item: BankItemRow): BankItemAdminView {
  return {
    id: item.id,
    key: item.key,
    topic: item.topic,
    skill: item.skill,
    type: item.type,
    difficulty: item.difficulty,
    language: item.language,
    sourceLessonId: item.sourceLessonId,
    stem: item.stem,
    explanation: item.explanation,
    context: item.context ?? null,
    rubric: item.rubric ?? null,
    chart: item.chart ?? null,
    status: item.status,
    version: item.version,
    templateId: item.templateId,
    parameters: item.parameters,
    authorId: item.authorId,
    reviewerId: item.reviewerId,
    publishedAt: item.publishedAt,
    pilotAnswers: item.pilotAnswers,
    pilotCorrect: item.pilotCorrect,
    correctRate: item.correctRate,
    discrimination: item.discrimination,
    exposureCount: item.exposureCount,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    options: item.options.map((o) => ({
      id: o.id,
      text: o.text,
      order: o.order,
      isCorrect: o.isCorrect,
      points: o.points ?? 0,
      consequence: o.consequence ?? null,
    })),
  };
}

function toPublicView(item: BankItemRow, rng: () => number): PublicQuestionView {
  return {
    id: item.id,
    stem: item.stem,
    options: shuffle(rng, item.options).map((o) => ({
      id: o.id,
      text: o.text,
      order: o.order,
      consequence: o.consequence ?? null,
    })),
    type: item.type,
    topic: item.topic,
    skill: item.skill,
    difficulty: item.difficulty,
    // Context is public for CASE_CHOICE (the numbers table is shown
    // before answering). Points, isCorrect, rubric, and explanation
    // are never sent before reveal.
    ...(item.type === DuelBankQuestionType.CASE_CHOICE
      ? { context: (item.context as Record<string, string | number> | null) ?? null }
      : {}),
    // The chart is public for CHART_CHOICE (the player reads it to
    // answer) — WITHOUT the reveal-only annotation, which highlights
    // the trend and must arrive only at reveal.
    ...(item.type === DuelBankQuestionType.CHART_CHOICE
      ? { chart: publicChart(item.chart as ChartData | null) }
      : {}),
  };
}

/** Strips the reveal-only annotation from a stored chart (or null). */
export function publicChart(chart: ChartData | null | undefined): PublicChartData | null {
  if (!chart) return null;
  return {
    title: chart.title,
    instrument: chart.instrument,
    template: chart.template,
    xLabel: chart.xLabel,
    yLabel: chart.yLabel,
    xLabels: [...chart.xLabels],
    series: [...chart.series],
  };
}
