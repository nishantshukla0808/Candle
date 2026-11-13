import { randomUUID } from 'crypto';
import { DuelBankQuestionType, DuelBankSkill, DuelBankStatus } from '@prisma/client';
import { ErrorCode } from '@candle/shared';
import type { AppLogger } from '../../common/services/logger.service';
import type { TransactionService } from '../../database/transaction.service';
import {
  QuestionBankService,
  calibrateDifficulty,
  type BankItemAdminView,
} from './question-bank.service';
import { SelectionService } from './selection.service';
import { seededRng } from './template-engine';
import { generateChart } from './chart-generator';
import type { BankItemRow, CreateBankItemInput } from './question-bank.repository';

/**
 * Service spec — QuestionBankService against an in-memory fake
 * repository (same port-boundary pattern as the ratings service spec).
 * Workflow, two-person review, calibration, generation, and selection
 * are exercised without a live database.
 */

const NOW = new Date('2026-11-11T10:00:00.000Z');
const ADMIN_A = '11111111-1111-4111-8111-111111111111';
const ADMIN_B = '22222222-2222-4222-8222-222222222222';
const USER_A = '33333333-3333-4333-8333-333333333333';
const USER_B = '44444444-4444-4444-8444-444444444444';

const MCQ = [
  { text: 'correct', isCorrect: true },
  { text: 'wrong-1', isCorrect: false },
  { text: 'wrong-2', isCorrect: false },
  { text: 'wrong-3', isCorrect: false },
];

class FakeQuestionBankRepo {
  items = new Map<string, BankItemRow>();
  templates = new Map<string, any>();
  exposures = new Map<
    string,
    { userId: string; bankItemId: string; lastSeenAt: Date; seenCount: number }
  >();
  audits: any[] = [];

  seedTemplate(id: string, key: string): void {
    this.templates.set(id, {
      id,
      key,
      topic: key === 'tpl-compounding' ? 'compounding' : 'budgeting',
      skill: DuelBankSkill.CALCULATION,
      templateText: 'template',
      parameterSchema: {},
      answerFormula: null,
      distractorRules: null,
      status: DuelBankStatus.DRAFT,
      createdAt: new Date(NOW),
      updatedAt: new Date(NOW),
    });
  }

  async createItem(input: CreateBankItemInput): Promise<BankItemRow> {
    const row: BankItemRow = {
      id: randomUUID(),
      key: input.key,
      topic: input.topic,
      skill: input.skill,
      type: input.type,
      difficulty: input.difficulty,
      language: input.language ?? 'en',
      sourceLessonId: input.sourceLessonId ?? null,
      stem: input.stem,
      explanation: input.explanation,
      context: (input as { context?: unknown }).context ?? null,
      rubric: (input as { rubric?: string }).rubric ?? null,
      chart: (input as { chart?: unknown }).chart ?? null,
      status: input.status ?? DuelBankStatus.DRAFT,
      version: input.version ?? 1,
      templateId: input.templateId ?? null,
      parameters: (input.parameters as never) ?? null,
      authorId: input.authorId,
      reviewerId: null,
      publishedAt: null,
      pilotAnswers: 0,
      pilotCorrect: 0,
      correctRate: null,
      discrimination: null,
      exposureCount: 0,
      createdAt: new Date(NOW),
      updatedAt: new Date(NOW),
      options: input.options.map((o) => ({
        id: randomUUID(),
        itemId: '',
        ...o,
        points: (o as { points?: number }).points ?? 0,
        consequence: (o as { consequence?: string }).consequence ?? null,
      })),
    };
    for (const o of row.options) o.itemId = row.id;
    this.items.set(row.id, row);
    return { ...row, options: row.options.map((o) => ({ ...o })) };
  }

  async findItemById(id: string): Promise<BankItemRow | null> {
    const r = this.items.get(id);
    return r ? { ...r, options: r.options.map((o) => ({ ...o })) } : null;
  }

  async findItemByKey(key: string): Promise<BankItemRow | null> {
    for (const r of this.items.values()) {
      if (r.key === key) return { ...r, options: r.options.map((o) => ({ ...o })) };
    }
    return null;
  }

  async listItems(filter: any): Promise<{ items: BankItemRow[]; total: number }> {
    const all = [...this.items.values()].filter(
      (r) =>
        (!filter.status || r.status === filter.status) &&
        (!filter.topic || r.topic === filter.topic) &&
        (!filter.skill || r.skill === filter.skill) &&
        (!filter.type || r.type === filter.type) &&
        (filter.difficulty === undefined || r.difficulty === filter.difficulty)
    );
    return {
      total: all.length,
      items: all.slice(filter.skip, filter.skip + filter.take).map((r) => ({
        ...r,
        options: r.options.map((o) => ({ ...o })),
      })),
    };
  }

  async updateItem(id: string, data: any): Promise<BankItemRow> {
    const r = this.items.get(id);
    if (!r) throw new Error('item not found');
    Object.assign(r, data, { updatedAt: new Date(NOW) });
    return { ...r, options: r.options.map((o) => ({ ...o })) };
  }

  async listLiveItems(filter: any): Promise<BankItemRow[]> {
    return [...this.items.values()]
      .filter(
        (r) =>
          r.status === DuelBankStatus.LIVE &&
          (!filter.topics || filter.topics.includes(r.topic)) &&
          (!filter.skills || filter.skills.includes(r.skill)) &&
          (!filter.types || filter.types.includes(r.type))
      )
      .map((r) => ({ ...r, options: r.options.map((o) => ({ ...o })) }));
  }

  async countLiveByTopicDifficulty(): Promise<any[]> {
    const counts = new Map<string, number>();
    for (const r of this.items.values()) {
      if (r.status !== DuelBankStatus.LIVE) continue;
      const k = `${r.topic}:${r.difficulty}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return [...counts.entries()].map(([k, count]) => {
      const [topic, difficulty] = k.split(':');
      return { topic: topic as string, difficulty: Number(difficulty), count };
    });
  }

  async incrementPilot(id: string, correct: boolean): Promise<BankItemRow> {
    const r = this.items.get(id);
    if (!r) throw new Error('item not found');
    r.pilotAnswers += 1;
    if (correct) r.pilotCorrect += 1;
    r.correctRate = r.pilotAnswers > 0 ? r.pilotCorrect / r.pilotAnswers : null;
    return { ...r, options: r.options.map((o) => ({ ...o })) };
  }

  async findTemplateById(id: string): Promise<any | null> {
    return this.templates.get(id) ?? null;
  }

  async findTemplateByKey(key: string): Promise<any | null> {
    for (const t of this.templates.values()) if (t.key === key) return t;
    return null;
  }

  async listExposures(userIds: string[]): Promise<any[]> {
    return [...this.exposures.values()].filter((e) => userIds.includes(e.userId));
  }

  async recordExposures(userId: string, itemIds: string[], now: Date): Promise<void> {
    for (const bankItemId of itemIds) {
      const key = `${userId}:${bankItemId}`;
      const existing = this.exposures.get(key);
      if (existing) {
        existing.lastSeenAt = now;
        existing.seenCount += 1;
      } else {
        this.exposures.set(key, { userId, bankItemId, lastSeenAt: now, seenCount: 1 });
      }
      const item = this.items.get(bankItemId);
      if (item) item.exposureCount += 1;
    }
  }

  async appendAudit(input: any): Promise<void> {
    this.audits.push(input);
  }
}

const fakeLogger = { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() };
const fakeTx = { run: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn({}) };

function setup(): { service: QuestionBankService; repo: FakeQuestionBankRepo } {
  const repo = new FakeQuestionBankRepo();
  const service = new QuestionBankService(
    repo as never,
    new SelectionService(),
    fakeTx as unknown as TransactionService,
    fakeLogger as unknown as AppLogger
  );
  return { service, repo };
}

function createDto(overrides: Record<string, unknown> = {}): any {
  return {
    topic: 'budgeting',
    skill: DuelBankSkill.RECALL,
    type: DuelBankQuestionType.MCQ_4,
    difficulty: 2,
    stem: 'What is a budget?',
    explanation: 'A budget is a plan for how to use income.',
    options: MCQ,
    ...overrides,
  };
}

async function seedLive(
  repo: FakeQuestionBankRepo,
  spec: Array<{ topic: string; skill: DuelBankSkill; difficulty: number; count: number }>
): Promise<BankItemRow[]> {
  const rows: BankItemRow[] = [];
  let n = 0;
  for (const s of spec) {
    for (let i = 0; i < s.count; i++) {
      n += 1;
      const row = await repo.createItem({
        key: `seed-${n}`,
        topic: s.topic,
        skill: s.skill,
        type: DuelBankQuestionType.MCQ_4,
        difficulty: s.difficulty,
        stem: `Stem ${n}?`,
        explanation: `Because ${n}.`,
        authorId: ADMIN_A,
        options: MCQ.map((o, idx) => ({ ...o, order: idx })),
      });
      await repo.updateItem(row.id, { status: DuelBankStatus.LIVE, publishedAt: new Date(NOW) });
      rows.push(row);
    }
  }
  return rows;
}

describe('calibrateDifficulty (docs/05 §2.5)', () => {
  it('maps the spec bands: >=0.8 → 1–2, 0.5–0.8 → 3, <0.5 → 4–5', () => {
    expect(calibrateDifficulty(0.95)).toBe(1);
    expect(calibrateDifficulty(0.85)).toBe(2);
    expect(calibrateDifficulty(0.8)).toBe(2);
    expect(calibrateDifficulty(0.65)).toBe(3);
    expect(calibrateDifficulty(0.5)).toBe(3);
    expect(calibrateDifficulty(0.4)).toBe(4);
    expect(calibrateDifficulty(0.35)).toBe(4);
    expect(calibrateDifficulty(0.1)).toBe(5);
  });
});

describe('QuestionBankService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createItem', () => {
    it('creates a DRAFT item with the caller as author', async () => {
      const { service } = setup();
      const item = await service.createItem(createDto({ key: 'qb-900' }), {
        actorId: ADMIN_A,
      });
      expect(item.status).toBe(DuelBankStatus.DRAFT);
      expect(item.authorId).toBe(ADMIN_A);
      expect(item.key).toBe('qb-900');
      expect(item.options).toHaveLength(4);
    });

    it('generates a key when none is given', async () => {
      const { service } = setup();
      const item = await service.createItem(createDto(), { actorId: ADMIN_A });
      expect(item.key).toMatch(/^qb-/);
    });

    it('rejects an unknown topic', async () => {
      const { service } = setup();
      await expect(
        service.createItem(createDto({ topic: 'astrology' }), { actorId: ADMIN_A })
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED, status: 400 });
    });

    it('rejects MCQ_4 with the wrong option shape', async () => {
      const { service } = setup();
      await expect(
        service.createItem(
          createDto({
            options: [
              { text: 'a', isCorrect: true },
              { text: 'b', isCorrect: true },
              { text: 'c', isCorrect: false },
            ],
          }),
          { actorId: ADMIN_A }
        )
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED, status: 400 });
    });

    it('rejects a duplicate key', async () => {
      const { service } = setup();
      await service.createItem(createDto({ key: 'qb-dup' }), { actorId: ADMIN_A });
      await expect(
        service.createItem(createDto({ key: 'qb-dup' }), { actorId: ADMIN_A })
      ).rejects.toMatchObject({ code: ErrorCode.CONFLICT, status: 409 });
    });
  });

  describe('workflow (two-person review)', () => {
    async function toReview(service: QuestionBankService): Promise<BankItemAdminView> {
      const item = await service.createItem(createDto(), { actorId: ADMIN_A });
      return service.submitReview(item.id, { actorId: ADMIN_A });
    }

    it('runs DRAFT → REVIEW → PILOT → LIVE', async () => {
      const { service } = setup();
      const created = await service.createItem(createDto(), { actorId: ADMIN_A });
      const inReview = await service.submitReview(created.id, { actorId: ADMIN_A });
      expect(inReview.status).toBe(DuelBankStatus.REVIEW);
      const pilot = await service.review(created.id, { decision: 'APPROVE' }, { actorId: ADMIN_B });
      expect(pilot.status).toBe(DuelBankStatus.PILOT);
      expect(pilot.reviewerId).toBe(ADMIN_B);
      const live = await service.publish(created.id, { actorId: ADMIN_B });
      expect(live.status).toBe(DuelBankStatus.LIVE);
      expect(live.publishedAt).not.toBeNull();
    });

    it('reject sends REVIEW → DRAFT', async () => {
      const { service } = setup();
      const item = await toReview(service);
      const back = await service.review(item.id, { decision: 'REJECT' }, { actorId: ADMIN_B });
      expect(back.status).toBe(DuelBankStatus.DRAFT);
    });

    it('the author cannot approve their own item (403, two-person rule)', async () => {
      const { service } = setup();
      const item = await toReview(service);
      await expect(
        service.review(item.id, { decision: 'APPROVE' }, { actorId: ADMIN_A })
      ).rejects.toMatchObject({
        code: ErrorCode.QUESTION_BANK_REVIEWER_MUST_DIFFER,
        status: 403,
      });
    });

    it('publish from DRAFT is an invalid transition (409), never direct DRAFT → LIVE', async () => {
      const { service } = setup();
      const item = await service.createItem(createDto(), { actorId: ADMIN_A });
      await expect(service.publish(item.id, { actorId: ADMIN_B })).rejects.toMatchObject({
        code: ErrorCode.QUESTION_BANK_INVALID_TRANSITION,
        status: 409,
      });
    });

    it('review from DRAFT is an invalid transition (409)', async () => {
      const { service } = setup();
      const item = await service.createItem(createDto(), { actorId: ADMIN_A });
      await expect(
        service.review(item.id, { decision: 'APPROVE' }, { actorId: ADMIN_B })
      ).rejects.toMatchObject({
        code: ErrorCode.QUESTION_BANK_INVALID_TRANSITION,
        status: 409,
      });
    });

    it('retire works from LIVE but not from DRAFT', async () => {
      const { service, repo } = setup();
      const [live] = await seedLive(repo, [
        { topic: 'budgeting', skill: DuelBankSkill.RECALL, difficulty: 1, count: 1 },
      ]);
      const retired = await service.retire((live as BankItemRow).id, { actorId: ADMIN_B });
      expect(retired.status).toBe(DuelBankStatus.RETIRED);
      const draft = await service.createItem(createDto(), { actorId: ADMIN_A });
      await expect(service.retire(draft.id, { actorId: ADMIN_B })).rejects.toMatchObject({
        code: ErrorCode.QUESTION_BANK_INVALID_TRANSITION,
        status: 409,
      });
    });

    it('new-version creates a DRAFT v2 row and leaves the LIVE row untouched', async () => {
      const { service, repo } = setup();
      const [live] = await seedLive(repo, [
        { topic: 'budgeting', skill: DuelBankSkill.RECALL, difficulty: 1, count: 1 },
      ]);
      const liveRow = live as BankItemRow;
      const v2 = await service.newVersion(
        liveRow.id,
        { stem: 'What is a budget, exactly?' },
        { actorId: ADMIN_B }
      );
      expect(v2.version).toBe(2);
      expect(v2.status).toBe(DuelBankStatus.DRAFT);
      expect(v2.key).toBe(`${liveRow.key}-v2`);
      expect(v2.stem).toBe('What is a budget, exactly?');
      expect(v2.authorId).toBe(ADMIN_B);
      const old = await repo.findItemById(liveRow.id);
      expect(old?.status).toBe(DuelBankStatus.LIVE);
      expect(old?.stem).toBe(liveRow.stem);
    });
  });

  describe('CASE_CHOICE validation (docs/08 §3.3)', () => {
    function caseDto(overrides: Record<string, unknown> = {}): any {
      return {
        topic: 'budgeting',
        skill: DuelBankSkill.JUDGEMENT,
        type: DuelBankQuestionType.CASE_CHOICE,
        difficulty: 3,
        stem: 'Asha earns ₹45,000 a month and spends ₹25,000.\nShe has ₹20,000 saved.\nShe wants a ₹1,50,000 emergency fund in 6 months.',
        explanation:
          'Saving a fixed amount each month in a separate account reaches the goal on time.',
        context: {
          'Monthly income': '₹45,000',
          'Saved so far': '₹20,000',
          Goal: '₹1,50,000 in 6 months',
        },
        rubric:
          'Best — saving ₹22,000 a month reaches the goal on time.\nSecond-best — saving less falls short.\nWeak — waiting leaves no fund at all.',
        options: [
          {
            text: 'Save ₹22,000 a month in a separate account',
            isCorrect: true,
            points: 100,
            consequence: 'Fund is ready in 6 months.',
          },
          {
            text: 'Save ₹15,000 a month and use a card for surprises',
            isCorrect: false,
            points: 50,
            consequence: 'Fund falls short.',
          },
          {
            text: 'Wait for a bonus, then save everything at once',
            isCorrect: false,
            points: 0,
            consequence: 'No fund for 6 months.',
          },
        ],
        ...overrides,
      };
    }

    it('creates a CASE item with context, rubric, points, and consequences stored', async () => {
      const { service } = setup();
      const item = await service.createItem(caseDto({ key: 'qb-case-1' }), { actorId: ADMIN_A });
      expect(item.type).toBe(DuelBankQuestionType.CASE_CHOICE);
      expect(item.context).toEqual({
        'Monthly income': '₹45,000',
        'Saved so far': '₹20,000',
        Goal: '₹1,50,000 in 6 months',
      });
      expect(item.rubric).toContain('Best —');
      expect(item.options.map((o) => o.points)).toEqual([100, 50, 0]);
      expect(item.options.map((o) => o.consequence)).toEqual([
        'Fund is ready in 6 months.',
        'Fund falls short.',
        'No fund for 6 months.',
      ]);
    });

    it('rejects CASE with fewer than 3 options', async () => {
      const { service } = setup();
      await expect(
        service.createItem(
          caseDto({
            options: [
              { text: 'a', isCorrect: true, points: 100, consequence: 'c1' },
              { text: 'b', isCorrect: false, points: 0, consequence: 'c2' },
            ],
          }),
          { actorId: ADMIN_A }
        )
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED, status: 400 });
    });

    it('rejects CASE without exactly one 100-point option', async () => {
      const { service } = setup();
      const twoHundreds = caseDto();
      twoHundreds.options[1].points = 100;
      await expect(service.createItem(twoHundreds, { actorId: ADMIN_A })).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_FAILED,
        status: 400,
      });
      const noHundred = caseDto();
      noHundred.options[0].points = 50;
      await expect(service.createItem(noHundred, { actorId: ADMIN_A })).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_FAILED,
        status: 400,
      });
    });

    it('rejects CASE with two 50-point options, and with a non-100 correct option', async () => {
      const { service } = setup();
      const twoFifties = caseDto();
      twoFifties.options.push({
        text: 'A fourth action',
        isCorrect: false,
        points: 50,
        consequence: 'Also tempting.',
      });
      await expect(service.createItem(twoFifties, { actorId: ADMIN_A })).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_FAILED,
        status: 400,
      });
      const wrongPoints = caseDto();
      wrongPoints.options[0].points = 0;
      wrongPoints.options[1].points = 100;
      await expect(service.createItem(wrongPoints, { actorId: ADMIN_A })).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_FAILED,
        status: 400,
      });
    });

    it('rejects CASE when an option has no consequence', async () => {
      const { service } = setup();
      const dto = caseDto();
      delete dto.options[2].consequence;
      await expect(service.createItem(dto, { actorId: ADMIN_A })).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_FAILED,
        status: 400,
      });
    });

    it('rejects CASE with a missing or one-line rubric', async () => {
      const { service } = setup();
      await expect(
        service.createItem(caseDto({ rubric: undefined }), { actorId: ADMIN_A })
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED, status: 400 });
      await expect(
        service.createItem(caseDto({ rubric: 'Best — this one wins.' }), { actorId: ADMIN_A })
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED, status: 400 });
    });

    it('rejects CASE with too little context, and with context carrying no numbers', async () => {
      const { service } = setup();
      await expect(
        service.createItem(caseDto({ context: { 'Monthly income': '₹45,000' } }), {
          actorId: ADMIN_A,
        })
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED, status: 400 });
      await expect(
        service.createItem(caseDto({ context: { Goal: 'emergency fund', Deadline: 'soon' } }), {
          actorId: ADMIN_A,
        })
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED, status: 400 });
    });

    it('rejects CASE with a 2-line stem, a RECALL skill, and difficulty 1', async () => {
      const { service } = setup();
      await expect(
        service.createItem(caseDto({ stem: 'Line one.\nLine two.' }), { actorId: ADMIN_A })
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED, status: 400 });
      await expect(
        service.createItem(caseDto({ skill: DuelBankSkill.RECALL }), { actorId: ADMIN_A })
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED, status: 400 });
      await expect(
        service.createItem(caseDto({ difficulty: 1 }), { actorId: ADMIN_A })
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED, status: 400 });
    });

    it('rejects a buy/sell recommendation for a real security', async () => {
      const { service } = setup();
      const dto = caseDto();
      dto.options[0].text = 'Buy shares of Reliance today';
      await expect(service.createItem(dto, { actorId: ADMIN_A })).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_FAILED,
        status: 400,
      });
      const dto2 = caseDto();
      dto2.rubric = 'Best — sell TCS now.\nSecond-best — wait.\nWeak — do nothing.';
      await expect(service.createItem(dto2, { actorId: ADMIN_A })).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_FAILED,
        status: 400,
      });
    });

    it('does not false-positive on ordinary words ("switching" holds "itc", "expenses" holds "nse")', async () => {
      const { service } = setup();
      const dto = caseDto();
      dto.rubric =
        'Best — staying put wins.\nSecond-best — switching funds still buys high.\nWeak — doing nothing.';
      dto.options[1].text = 'Switch funds and keep buying monthly';
      const item = await service.createItem(dto, { actorId: ADMIN_A });
      expect(item.type).toBe(DuelBankQuestionType.CASE_CHOICE);
    });

    it('public view of a CASE item carries context + consequences, never points/rubric', async () => {
      const { service, repo } = setup();
      const created = await service.createItem(caseDto({ key: 'qb-case-live' }), {
        actorId: ADMIN_A,
      });
      await repo.updateItem(created.id, { status: DuelBankStatus.LIVE });
      const items = await service.selectSet(
        [USER_A],
        { count: 1, difficultyMix: { 3: 1 }, types: [DuelBankQuestionType.CASE_CHOICE] },
        { rng: seededRng(9), now: NOW }
      );
      expect(items).toHaveLength(1);
      const q = items[0] as any;
      expect(q.type).toBe('CASE_CHOICE');
      expect(q.context).toEqual({
        'Monthly income': '₹45,000',
        'Saved so far': '₹20,000',
        Goal: '₹1,50,000 in 6 months',
      });
      expect(q.options).toHaveLength(3);
      expect(q.options.every((o: any) => typeof o.consequence === 'string')).toBe(true);
      expect(q).not.toHaveProperty('rubric');
      expect(q).not.toHaveProperty('explanation');
      expect(q.options.every((o: any) => !('points' in o))).toBe(true);
      expect(q.options.every((o: any) => !('isCorrect' in o))).toBe(true);
    });

    it('new-version of a CASE item carries context, rubric, and points forward', async () => {
      const { service, repo } = setup();
      const created = await service.createItem(caseDto({ key: 'qb-case-v' }), {
        actorId: ADMIN_A,
      });
      await repo.updateItem(created.id, { status: DuelBankStatus.LIVE });
      const v2 = await service.newVersion(
        created.id,
        {
          stem: 'Asha earns ₹45,000 a month and spends ₹25,000.\nShe has ₹30,000 saved.\nShe wants a ₹1,50,000 emergency fund in 6 months.',
        },
        { actorId: ADMIN_B }
      );
      expect(v2.version).toBe(2);
      expect(v2.context).toEqual({
        'Monthly income': '₹45,000',
        'Saved so far': '₹20,000',
        Goal: '₹1,50,000 in 6 months',
      });
      expect(v2.rubric).toContain('Best —');
      expect(v2.options.map((o) => o.points)).toEqual([100, 50, 0]);
    });
  });

  describe('CHART_CHOICE validation (docs/08 §3.4)', () => {
    function chartDto(overrides: Record<string, unknown> = {}): any {
      return {
        topic: 'stocks',
        skill: DuelBankSkill.CHART_READING,
        type: DuelBankQuestionType.CHART_CHOICE,
        difficulty: 3,
        stem: 'Look at the price chart of Meadow Foods, a fictional snack company, from January to June. What does the chart show?',
        explanation:
          'The line climbs in almost every month and ends clearly higher than January. A rising line means the price rose.',
        chart: generateChart('qb-chart-test', 'STEADY_RISE', 'Meadow Foods'),
        options: [
          { text: 'The price rose steadily over the six months.', isCorrect: true },
          { text: 'The price fell steadily over the six months.', isCorrect: false },
          { text: 'The price stayed flat all six months.', isCorrect: false },
          { text: 'The price rose, then fell below where it started.', isCorrect: false },
        ],
        ...overrides,
      };
    }

    it('creates a CHART item with the chart stored (series + annotation)', async () => {
      const { service } = setup();
      const item = await service.createItem(chartDto({ key: 'qb-chart-1' }), {
        actorId: ADMIN_A,
      });
      expect(item.type).toBe(DuelBankQuestionType.CHART_CHOICE);
      const chart = item.chart as any;
      expect(chart.instrument).toBe('Meadow Foods');
      expect(chart.template).toBe('STEADY_RISE');
      expect(chart.series).toHaveLength(6);
      expect(chart.xLabels).toHaveLength(6);
      expect(chart.annotation).toEqual({ trend: 'rising', zoneStart: 0, zoneEnd: 5 });
    });

    it('rejects CHART with 3 options, and with 2 correct options', async () => {
      const { service } = setup();
      await expect(
        service.createItem(
          chartDto({
            options: [
              { text: 'a', isCorrect: true },
              { text: 'b', isCorrect: false },
              { text: 'c', isCorrect: false },
            ],
          }),
          { actorId: ADMIN_A }
        )
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED, status: 400 });
      const twoCorrect = chartDto();
      twoCorrect.options[1].isCorrect = true;
      await expect(service.createItem(twoCorrect, { actorId: ADMIN_A })).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_FAILED,
        status: 400,
      });
    });

    it('rejects CHART with a missing chart, a 5-point series, and mismatched labels', async () => {
      const { service } = setup();
      await expect(
        service.createItem(chartDto({ chart: undefined }), { actorId: ADMIN_A })
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED, status: 400 });
      const short = chartDto();
      short.chart.series = short.chart.series.slice(0, 5);
      await expect(service.createItem(short, { actorId: ADMIN_A })).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_FAILED,
        status: 400,
      });
      const badLabels = chartDto();
      badLabels.chart.xLabels = badLabels.chart.xLabels.slice(0, 5);
      await expect(service.createItem(badLabels, { actorId: ADMIN_A })).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_FAILED,
        status: 400,
      });
      const notFinite = chartDto();
      notFinite.chart.series = [...notFinite.chart.series.slice(0, 5), Number.NaN];
      await expect(service.createItem(notFinite, { actorId: ADMIN_A })).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_FAILED,
        status: 400,
      });
    });

    it('rejects CHART whose series breaks its template shape', async () => {
      const { service } = setup();
      // STEADY_RISE must end above its start — a falling series is not one.
      const falling = chartDto();
      falling.chart.series = [120, 115, 110, 105, 100, 95];
      await expect(service.createItem(falling, { actorId: ADMIN_A })).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_FAILED,
        status: 400,
      });
      // An unknown template is not a chart at all.
      const unknown = chartDto();
      unknown.chart.template = 'NOT_A_TEMPLATE';
      await expect(service.createItem(unknown, { actorId: ADMIN_A })).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_FAILED,
        status: 400,
      });
    });

    it('rejects CHART with a RECALL skill, difficulty 1, and a 4-sentence explanation', async () => {
      const { service } = setup();
      await expect(
        service.createItem(chartDto({ skill: DuelBankSkill.RECALL }), { actorId: ADMIN_A })
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED, status: 400 });
      await expect(
        service.createItem(chartDto({ difficulty: 1 }), { actorId: ADMIN_A })
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED, status: 400 });
      await expect(
        service.createItem(
          chartDto({
            explanation: 'First sentence. Second sentence. Third sentence. Fourth sentence.',
          }),
          { actorId: ADMIN_A }
        )
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED, status: 400 });
    });

    it('rejects CHART with per-option points (no partial credit for a wrong read)', async () => {
      const { service } = setup();
      const dto = chartDto();
      dto.options[0].points = 100;
      await expect(service.createItem(dto, { actorId: ADMIN_A })).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_FAILED,
        status: 400,
      });
    });

    it('rejects a ticker-like instrument and a buy tip for a real security', async () => {
      const { service } = setup();
      const ticker = chartDto();
      ticker.chart.instrument = 'TCS';
      await expect(service.createItem(ticker, { actorId: ADMIN_A })).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_FAILED,
        status: 400,
      });
      const tip = chartDto();
      tip.options[0].text = 'Buy shares of Reliance today';
      await expect(service.createItem(tip, { actorId: ADMIN_A })).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_FAILED,
        status: 400,
      });
    });

    it('public view of a CHART item carries the chart WITHOUT the annotation, never answers', async () => {
      const { service, repo } = setup();
      const created = await service.createItem(chartDto({ key: 'qb-chart-live' }), {
        actorId: ADMIN_A,
      });
      await repo.updateItem(created.id, { status: DuelBankStatus.LIVE });
      const items = await service.selectSet(
        [USER_A],
        { count: 1, difficultyMix: { 3: 1 }, types: [DuelBankQuestionType.CHART_CHOICE] },
        { rng: seededRng(9), now: NOW }
      );
      expect(items).toHaveLength(1);
      const q = items[0] as any;
      expect(q.type).toBe('CHART_CHOICE');
      expect(q.chart.instrument).toBe('Meadow Foods');
      expect(q.chart.template).toBe('STEADY_RISE');
      expect(q.chart.series).toHaveLength(6);
      expect(q.chart.xLabels).toHaveLength(6);
      expect(q.chart).not.toHaveProperty('annotation');
      expect(q).not.toHaveProperty('explanation');
      expect(q.options).toHaveLength(4);
      expect(q.options.every((o: any) => !('isCorrect' in o))).toBe(true);
      expect(q.options.every((o: any) => !('points' in o))).toBe(true);
    });

    it('new-version of a CHART item carries the chart forward', async () => {
      const { service, repo } = setup();
      const created = await service.createItem(chartDto({ key: 'qb-chart-v' }), {
        actorId: ADMIN_A,
      });
      await repo.updateItem(created.id, { status: DuelBankStatus.LIVE });
      const v2 = await service.newVersion(
        created.id,
        {
          stem: 'Look at the price chart of Meadow Foods, a fictional snack company, from January to June. What does it show now?',
        },
        { actorId: ADMIN_B }
      );
      expect(v2.version).toBe(2);
      const chart = v2.chart as any;
      expect(chart.instrument).toBe('Meadow Foods');
      expect(chart.template).toBe('STEADY_RISE');
      expect(chart.series).toHaveLength(6);
    });
  });

  describe('pilot + calibration', () => {
    it('recordPilotAnswer increments counters and recomputes correctRate', async () => {
      const { service, repo } = setup();
      const [pilot] = await seedLive(repo, [
        { topic: 'budgeting', skill: DuelBankSkill.RECALL, difficulty: 1, count: 1 },
      ]);
      const pilotRow = pilot as BankItemRow;
      await repo.updateItem(pilotRow.id, { status: DuelBankStatus.PILOT });
      await service.recordPilotAnswer(pilotRow.id, true);
      await service.recordPilotAnswer(pilotRow.id, false);
      const after = await service.recordPilotAnswer(pilotRow.id, true);
      expect(after.pilotAnswers).toBe(3);
      expect(after.pilotCorrect).toBe(2);
      expect(after.correctRate).toBeCloseTo(2 / 3, 10);
    });

    it('recordPilotAnswer refuses non-PILOT items', async () => {
      const { service } = setup();
      const item = await service.createItem(createDto(), { actorId: ADMIN_A });
      await expect(service.recordPilotAnswer(item.id, true)).rejects.toMatchObject({
        code: ErrorCode.QUESTION_BANK_INVALID_TRANSITION,
        status: 409,
      });
    });

    it('calibrate refuses items with fewer than 50 pilot answers', async () => {
      const { service, repo } = setup();
      const [pilot] = await seedLive(repo, [
        { topic: 'budgeting', skill: DuelBankSkill.RECALL, difficulty: 1, count: 1 },
      ]);
      const row = pilot as BankItemRow;
      await repo.updateItem(row.id, { status: DuelBankStatus.PILOT });
      await expect(service.calibrate(row.id)).rejects.toMatchObject({
        code: ErrorCode.CONFLICT,
        status: 409,
      });
    });

    it('calibrate sets difficulty from correctRate and leaves discrimination null', async () => {
      const { service, repo } = setup();
      const [pilot] = await seedLive(repo, [
        { topic: 'budgeting', skill: DuelBankSkill.RECALL, difficulty: 3, count: 1 },
      ]);
      const row = pilot as BankItemRow;
      await repo.updateItem(row.id, {
        status: DuelBankStatus.PILOT,
        pilotAnswers: 60,
        pilotCorrect: 51,
        correctRate: 0.85,
      });
      const calibrated = await service.calibrate(row.id);
      expect(calibrated.difficulty).toBe(2);
      expect(calibrated.discrimination).toBeNull();
      expect(calibrated.correctRate).toBeCloseTo(0.85, 10);
    });
  });

  describe('generateFromTemplate', () => {
    it('creates DRAFT variants linked to the template', async () => {
      const { service, repo } = setup();
      repo.seedTemplate('tpl-1', 'tpl-compounding');
      const res = await service.generateFromTemplate(
        'tpl-1',
        { count: 3, seed: 11 },
        { actorId: ADMIN_A }
      );
      expect(res.created).toHaveLength(3);
      expect(res.skipped).toBe(0);
      expect(res.templateKey).toBe('tpl-compounding');
      for (const item of res.created) {
        expect(item.status).toBe(DuelBankStatus.DRAFT);
        expect(item.templateId).toBe('tpl-1');
        expect(item.parameters).toBeTruthy();
        expect(item.options.filter((o) => o.isCorrect)).toHaveLength(1);
      }
    });

    it('re-running the same seed skips already-generated variants', async () => {
      const { service, repo } = setup();
      repo.seedTemplate('tpl-1', 'tpl-budgeting-503020');
      await service.generateFromTemplate('tpl-1', { count: 2, seed: 5 }, { actorId: ADMIN_A });
      const again = await service.generateFromTemplate(
        'tpl-1',
        { count: 2, seed: 5 },
        { actorId: ADMIN_A }
      );
      expect(again.created).toHaveLength(0);
      expect(again.skipped).toBe(2);
    });

    it('unknown template is 404', async () => {
      const { service } = setup();
      await expect(
        service.generateFromTemplate('nope', { count: 1, seed: 1 }, { actorId: ADMIN_A })
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND, status: 404 });
    });
  });

  describe('selectSet', () => {
    it('returns public views only — never isCorrect or explanation', async () => {
      const { service, repo } = setup();
      await seedLive(repo, [
        { topic: 'budgeting', skill: DuelBankSkill.RECALL, difficulty: 1, count: 4 },
        { topic: 'stocks', skill: DuelBankSkill.CALCULATION, difficulty: 2, count: 4 },
        { topic: 'risk', skill: DuelBankSkill.JUDGEMENT, difficulty: 3, count: 4 },
      ]);
      const items = await service.selectSet(
        [USER_A],
        { count: 3, difficultyMix: { 1: 1, 2: 1, 3: 1 } },
        { rng: seededRng(1), now: NOW }
      );
      expect(items).toHaveLength(3);
      for (const q of items) {
        expect(q).not.toHaveProperty('isCorrect');
        expect(q).not.toHaveProperty('explanation');
        expect(q.options.every((o) => !('isCorrect' in o))).toBe(true);
        expect(q.options).toHaveLength(4);
      }
    });

    it('excludes items seen in the last 30 days or seen 3+ times', async () => {
      const { service, repo } = setup();
      const rows = await seedLive(repo, [
        { topic: 'budgeting', skill: DuelBankSkill.RECALL, difficulty: 1, count: 4 },
        { topic: 'stocks', skill: DuelBankSkill.CALCULATION, difficulty: 2, count: 4 },
        { topic: 'risk', skill: DuelBankSkill.JUDGEMENT, difficulty: 3, count: 4 },
      ]);
      // User A saw the first budgeting item yesterday and the second 3 times.
      const b1 = rows[0];
      const b2 = rows[1];
      if (!b1 || !b2) throw new Error('seed failed');
      await repo.recordExposures(USER_A, [b1.id], new Date(NOW.getTime() - 1 * 86400000));
      for (let i = 0; i < 3; i++) {
        await repo.recordExposures(USER_A, [b2.id], new Date(NOW.getTime() - 60 * 86400000));
      }
      const items = await service.selectSet(
        [USER_A],
        { count: 3, difficultyMix: { 1: 1, 2: 1, 3: 1 } },
        { rng: seededRng(2), now: NOW }
      );
      const ids = items.map((i) => i.id);
      expect(ids).not.toContain(b1.id);
      expect(ids).not.toContain(b2.id);
    });

    it('excludes items the OPPONENT saw, and never repeats within a set', async () => {
      const { service, repo } = setup();
      const rows = await seedLive(repo, [
        { topic: 'budgeting', skill: DuelBankSkill.RECALL, difficulty: 1, count: 3 },
        { topic: 'stocks', skill: DuelBankSkill.CALCULATION, difficulty: 1, count: 3 },
        { topic: 'risk', skill: DuelBankSkill.JUDGEMENT, difficulty: 1, count: 3 },
        { topic: 'markets', skill: DuelBankSkill.SCENARIO, difficulty: 1, count: 3 },
      ]);
      const seen = rows[0];
      if (!seen) throw new Error('seed failed');
      await repo.recordExposures(USER_B, [seen.id], NOW);
      const items = await service.selectSet(
        [USER_A, USER_B],
        { count: 4, difficultyMix: { 1: 4 } },
        { rng: seededRng(3), now: NOW }
      );
      expect(items).toHaveLength(4);
      expect(new Set(items.map((i) => i.id)).size).toBe(4);
      expect(items.map((i) => i.id)).not.toContain(seen.id);
    });

    it('throws insufficient coverage (409) when the bank cannot fill the set', async () => {
      const { service, repo } = setup();
      await seedLive(repo, [
        { topic: 'budgeting', skill: DuelBankSkill.RECALL, difficulty: 1, count: 2 },
      ]);
      await expect(
        service.selectSet(
          [USER_A],
          { count: 5, difficultyMix: { 1: 5 } },
          { rng: seededRng(4), now: NOW }
        )
      ).rejects.toMatchObject({
        code: ErrorCode.QUESTION_BANK_INSUFFICIENT_COVERAGE,
        status: 409,
      });
    });

    it('selectAndRecordExposure records exposure for the caller, so a second selection differs', async () => {
      const { service, repo } = setup();
      await seedLive(repo, [
        { topic: 'budgeting', skill: DuelBankSkill.RECALL, difficulty: 1, count: 4 },
        { topic: 'stocks', skill: DuelBankSkill.CALCULATION, difficulty: 1, count: 4 },
        { topic: 'risk', skill: DuelBankSkill.JUDGEMENT, difficulty: 1, count: 4 },
        { topic: 'markets', skill: DuelBankSkill.SCENARIO, difficulty: 1, count: 4 },
      ]);
      const first = await service.selectAndRecordExposure(
        USER_A,
        { count: 4, difficultyMix: { 1: 4 } },
        { rng: seededRng(5), now: NOW }
      );
      const second = await service.selectAndRecordExposure(
        USER_A,
        { count: 4, difficultyMix: { 1: 4 } },
        { rng: seededRng(6), now: NOW }
      );
      const firstIds = new Set(first.items.map((i) => i.id));
      expect(second.items.every((i) => !firstIds.has(i.id))).toBe(true);
      const exposures = await repo.listExposures([USER_A]);
      expect(exposures).toHaveLength(8);
    });

    it('coverage reports LIVE counts per topic × difficulty, zeros included', async () => {
      const { service, repo } = setup();
      await seedLive(repo, [
        { topic: 'budgeting', skill: DuelBankSkill.RECALL, difficulty: 1, count: 2 },
      ]);
      const coverage = await service.coverage();
      expect(coverage.total).toBe(2);
      expect(coverage.cells).toHaveLength(50);
      expect(coverage.cells.find((c) => c.topic === 'budgeting' && c.difficulty === 1)?.count).toBe(
        2
      );
      expect(coverage.cells.find((c) => c.topic === 'stocks' && c.difficulty === 5)?.count).toBe(0);
    });
  });
});
