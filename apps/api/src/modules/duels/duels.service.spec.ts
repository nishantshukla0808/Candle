import { randomUUID } from 'crypto';
import { DuelStatus, DuelType } from '@prisma/client';
import { AppError } from '../../common/errors/app-error';
import { DuelsService } from './duels.service';

/**
 * DuelsService unit tests — in-memory fake repository + stubbed
 * bank/ratings/gamification, real pure modules (scoring, bot, dates).
 * The HTTP pipeline (guards, DTOs, envelope) is covered by e2e.
 */

const NOW = new Date('2026-11-11T10:00:00.000Z'); // 15:30 IST, 2026-11-11

function makeItem(id: string, topic = 'stocks', difficulty = 3): any {
  return {
    id,
    topic,
    skill: 'RECALL',
    type: 'MCQ_4',
    difficulty,
    stem: `Stem ${id}`,
    explanation: `Why ${id}.`,
    options: [
      { id: `opt-${id}-c`, text: 'right', isCorrect: true, order: 0 },
      { id: `opt-${id}-w`, text: 'wrong', isCorrect: false, order: 1 },
    ],
  };
}

class FakeRepo {
  duels = new Map<string, any>();
  answers: any[] = [];
  sets = new Map<string, any>();
  results = new Map<string, any>(); // `${duelId}:${userId}`
  users = new Map<string, any>();

  async createDuel(input: any): Promise<any> {
    const row = {
      id: randomUUID(),
      status: DuelStatus.IN_PROGRESS,
      playerBId: null,
      pairedDuelId: null,
      dailyDate: input.dailyDate ?? null,
      dailySetId: input.dailySetId ?? null,
      startedAt: NOW,
      finishedAt: null,
      winnerId: null,
      botScore: null,
      botCorrect: null,
      botTotalTimeMs: null,
      createdAt: NOW,
      updatedAt: NOW,
      ...input,
    };
    this.duels.set(row.id, row);
    return { ...row };
  }

  async findDuelById(id: string): Promise<any | null> {
    const r = this.duels.get(id);
    return r ? { ...r } : null;
  }

  async updateDuel(id: string, data: any): Promise<any> {
    const r = this.duels.get(id);
    Object.assign(r, data, { updatedAt: NOW });
    return { ...r };
  }

  async findDailyDuelForUser(userId: string, dailyDate: string): Promise<any | null> {
    for (const d of this.duels.values()) {
      if (d.type === DuelType.DAILY && d.playerAId === userId && d.dailyDate === dailyDate) {
        return { ...d };
      }
    }
    return null;
  }

  async countBotStartedSince(userId: string, since: Date): Promise<number> {
    return [...this.duels.values()].filter(
      (d) => d.type === DuelType.BOT && d.playerAId === userId && d.startedAt >= since
    ).length;
  }

  async findWaitingDailyDuel(dailyDate: string, excludeDuelId: string): Promise<any | null> {
    const rows = [...this.duels.values()]
      .filter(
        (d) =>
          d.type === DuelType.DAILY &&
          d.dailyDate === dailyDate &&
          d.status === DuelStatus.WAITING_OPPONENT &&
          d.id !== excludeDuelId
      )
      .sort((a, b) => (a.finishedAt?.getTime() ?? 0) - (b.finishedAt?.getTime() ?? 0));
    return rows[0] ? { ...rows[0] } : null;
  }

  async listWaitingDailyDuels(dailyDate: string): Promise<any[]> {
    return [...this.duels.values()]
      .filter(
        (d) =>
          d.type === DuelType.DAILY &&
          d.dailyDate === dailyDate &&
          d.status === DuelStatus.WAITING_OPPONENT
      )
      .map((d) => ({ ...d }));
  }

  async listDuelsForUser(userId: string, skip: number, take: number): Promise<any[]> {
    return [...this.duels.values()]
      .filter((d) => d.playerAId === userId || d.playerBId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(skip, skip + take)
      .map((d) => ({ ...d }));
  }

  async countDuelsForUser(userId: string): Promise<number> {
    return [...this.duels.values()].filter((d) => d.playerAId === userId || d.playerBId === userId)
      .length;
  }

  async createAnswer(input: any): Promise<any> {
    const row = { id: randomUUID(), createdAt: NOW, ...input };
    this.answers.push(row);
    return { ...row };
  }

  async listAnswers(duelId: string, userId: string): Promise<any[]> {
    return this.answers
      .filter((a) => a.duelId === duelId && a.userId === userId)
      .sort((a, b) => a.order - b.order)
      .map((a) => ({ ...a }));
  }

  async findDailySetByDate(date: string): Promise<any | null> {
    const s = this.sets.get(date);
    return s ? { ...s } : null;
  }

  async createDailySet(input: any): Promise<any> {
    if (this.sets.has(input.date)) {
      throw AppError.conflict('Daily set already exists.');
    }
    const row = { id: randomUUID(), createdAt: NOW, ...input };
    this.sets.set(input.date, row);
    return { ...row };
  }

  async createGameResult(input: any): Promise<any> {
    const row = { id: randomUUID(), createdAt: NOW, ...input };
    this.results.set(`${input.duelId}:${input.userId}`, row);
    return { ...row };
  }

  async findGameResult(duelId: string, userId: string): Promise<any | null> {
    const r = this.results.get(`${duelId}:${userId}`);
    return r ? { ...r } : null;
  }

  async findUserById(id: string): Promise<any | null> {
    const u = this.users.get(id);
    return u ? { ...u } : null;
  }
}

function buildService(overrides: Record<string, unknown> = {}) {
  const repo = new FakeRepo();
  const items = new Map<string, any>();
  const bankItems = (ids: string[]) =>
    ids.map((id) => {
      if (!items.has(id)) items.set(id, makeItem(id));
      return items.get(id);
    });
  const bank = {
    selectCalls: 0,
    selectSet: jest.fn(async (_userIds: string[], blueprint: any) => {
      bank.selectCalls += 1;
      const ids =
        blueprint.count === 5
          ? ['d1', 'd2', 'd3', 'd4', 'd5']
          : ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7'];
      return ids.map((id) => {
        const item = bankItems([id])[0];
        return {
          id,
          stem: item.stem,
          options: item.options.map((o: any) => ({ id: o.id, text: o.text, order: o.order })),
          type: item.type,
          topic: item.topic,
          skill: item.skill,
          difficulty: item.difficulty,
        };
      });
    }),
    recordExposure: jest.fn(async () => undefined),
    getItemsForGrading: jest.fn(async (ids: string[]) => bankItems(ids)),
  };
  const ratings: any = {
    recordDuelCalls: [] as any[],
    recordDuelVsBotCalls: [] as any[],
    recordDuelBehavior: null as null | ((...args: any[]) => Promise<any>),
    recordDuel: jest.fn(async (callerId: string, dto: any, key: string) => {
      ratings.recordDuelCalls.push({ callerId, dto, key });
      if (ratings.recordDuelBehavior) return ratings.recordDuelBehavior(callerId, dto, key);
      const delta = dto.result === 'WIN' ? 16 : dto.result === 'LOSS' ? -16 : 0;
      return {
        eventId: key,
        kind: 'LEARNING',
        result: dto.result,
        me: {
          userId: callerId,
          ratingBefore: 1000,
          ratingAfter: 1000 + delta,
          delta,
          tier: 'Bronze',
          provisional: true,
          gamesPlayed: 1,
        },
        opponent: {
          userId: dto.opponentId,
          ratingBefore: 1000,
          ratingAfter: 1000 - delta,
          delta: -delta,
          tier: 'Bronze',
          provisional: true,
          gamesPlayed: 1,
        },
      };
    }),
    recordDuelVsBot: jest.fn(async (userId: string, result: string, key: string) => {
      ratings.recordDuelVsBotCalls.push({ userId, result, key });
      return {
        eventId: key,
        kind: 'LEARNING',
        result,
        me: {
          userId,
          ratingBefore: 1000,
          ratingAfter: 1016,
          delta: 16,
          tier: 'Bronze',
          provisional: true,
          gamesPlayed: 1,
        },
        botRating: 1000,
      };
    }),
    getDuelOutcome: jest.fn(async () => null),
    getUserRatings: jest.fn(async () => ({
      learning: { rating: 1000 },
      trading: { rating: 1000 },
    })),
  };
  const gamification = {
    grants: [] as any[],
    grantDuelRewards: jest.fn(async (_tx: unknown, event: any) => {
      gamification.grants.push(event);
      const xp = event.result === 'WIN' ? 20 : event.result === 'DRAW' ? 5 : 0;
      return {
        xpAwarded: xp,
        totalXp: 100 + xp,
        level: 2,
        levelUp: false,
        currentStreak: 3,
        longestStreak: 5,
        newBadges: [],
        applied: true,
      };
    }),
  };
  const tx = { run: jest.fn(async (fn: (t: unknown) => Promise<unknown>) => fn({})) };
  const logger = { info: jest.fn(), error: jest.fn() };
  const service = new DuelsService(
    repo as any,
    bank as any,
    ratings,
    gamification as any,
    tx as any,
    logger as any
  );
  Object.assign(service, overrides);
  return { service, repo, bank, ratings, gamification };
}

async function answerAll(
  service: DuelsService,
  userId: string,
  duelId: string,
  type: 'bot' | 'daily',
  correctCount: number,
  timeMs: number
): Promise<void> {
  const duel = await (service as any).repo.findDuelById(duelId);
  const ids = duel.questionIds as string[];
  for (let i = 0; i < ids.length; i++) {
    const qid = ids[i] as string;
    const correct = i < correctCount;
    const optionId = correct ? `opt-${qid}-c` : `opt-${qid}-w`;
    if (type === 'bot') {
      await service.answerBot(userId, duelId, { questionId: qid, optionId, timeMs });
    } else {
      await service.answerDaily(userId, duelId, { questionId: qid, optionId, timeMs });
    }
  }
}

describe('DuelsService', () => {
  it('starts a Bot Duel with public views only (no answers leak)', async () => {
    const { service } = buildService();
    const res = await service.startBot('u1', NOW);
    expect(res.questions).toHaveLength(7);
    expect(JSON.stringify(res)).not.toContain('isCorrect');
    expect(JSON.stringify(res)).not.toContain('Why q1');
    expect(res.opponent.name).toBe('Mira');
    expect(res.opponent.baseAccuracy).toBe(0.55); // rating 1000 band
  });

  it('caps Bot Duels at 10 per IST day', async () => {
    const { service } = buildService();
    for (let i = 0; i < 10; i++) await service.startBot('u1', NOW);
    await expect(service.startBot('u1', NOW)).rejects.toMatchObject({
      code: 'DUEL_BOT_DAILY_LIMIT',
    });
    // another user is unaffected
    await expect(service.startBot('u2', NOW)).resolves.toBeDefined();
  });

  it('rejects out-of-order, duplicate, and foreign-option answers', async () => {
    const { service } = buildService();
    const { duelId } = await service.startBot('u1', NOW);
    const duel = await (service as any).repo.findDuelById(duelId);
    const [q1, q2] = duel.questionIds as string[];
    await expect(
      service.answerBot('u1', duelId, {
        questionId: q2 as string,
        optionId: `opt-${q2}-c`,
        timeMs: 1000,
      })
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(
      service.answerBot('u1', duelId, {
        questionId: q1 as string,
        optionId: 'opt-other',
        timeMs: 1000,
      })
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    const ok = await service.answerBot('u1', duelId, {
      questionId: q1 as string,
      optionId: `opt-${q1}-c`,
      timeMs: 1000,
    });
    expect(ok.answeredCount).toBe(1);
    expect(ok.nextQuestionId).toBe(q2);
    await expect(
      service.answerBot('u1', duelId, {
        questionId: q1 as string,
        optionId: `opt-${q1}-c`,
        timeMs: 1000,
      })
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(
      service.answerBot('u2', duelId, {
        questionId: q2 as string,
        optionId: `opt-${q2}-c`,
        timeMs: 1000,
      })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('finishes a Bot Duel: scoring, no Rating change, XP once, replay is identical', async () => {
    const { service, gamification } = buildService();
    const { duelId } = await service.startBot('u1', NOW);
    await answerAll(service, 'u1', duelId, 'bot', 5, 5000);
    const res = await service.finishBot('u1', duelId, NOW);
    // 5 correct at 5000 ms: 100 + floor(50*(1-5000/15000)) = 133 each
    expect(res.score).toBe(5 * 133);
    expect(res.correct).toBe(5);
    expect(res.wrong).toBe(2);
    expect(res.skipped).toBe(0);
    expect(res.ratingBefore).toBeNull();
    expect(res.ratingDelta).toBeNull();
    expect(res.ratingReason).toBe('no Rating change — practice');
    expect(res.perQuestion).toHaveLength(7);
    expect(res.perQuestion[0]?.explanation).toBe('Why q1.');
    expect(gamification.grants).toHaveLength(1);
    const replay = await service.finishBot('u1', duelId, NOW);
    expect(replay).toEqual(res);
    expect(gamification.grants).toHaveLength(1);
  });

  it('finishing a Bot Duel with unanswered questions records skips', async () => {
    const { service } = buildService();
    const { duelId } = await service.startBot('u1', NOW);
    const duel = await (service as any).repo.findDuelById(duelId);
    const [q1] = duel.questionIds as string[];
    await service.answerBot('u1', duelId, {
      questionId: q1 as string,
      optionId: `opt-${q1}-c`,
      timeMs: 3000,
    });
    const res = await service.finishBot('u1', duelId, NOW);
    expect(res.skipped).toBe(6);
    expect(res.correct).toBe(1);
  });

  it('Daily Duel: same set for both players, second finish settles the pair, Rating once', async () => {
    const { service, ratings, repo } = buildService();
    repo.users.set('u1', { id: 'u1', displayName: 'Asha' });
    repo.users.set('u2', { id: 'u2', displayName: 'Ravi' });
    const s1 = await service.startDaily('u1', NOW);
    const s2 = await service.startDaily('u2', NOW);
    expect(s1.questions.map((q) => q.id)).toEqual(s2.questions.map((q) => q.id));
    await answerAll(service, 'u1', s1.duelId, 'daily', 5, 4000);
    const waiting = await service.finishDaily('u1', s1.duelId, NOW);
    expect(waiting).toMatchObject({ status: 'WAITING_OPPONENT' });
    await answerAll(service, 'u2', s2.duelId, 'daily', 5, 8000);
    const settled = await service.finishDaily('u2', s2.duelId, NOW);
    expect(settled).toMatchObject({ status: 'SETTLED' });
    // u1: 5 correct in 20000 ms total; u2: 5 correct in 40000 ms → u1 wins, u2 loses
    expect((settled as any).result).toBe('LOSS');
    expect((settled as any).ratingDelta).toBe(-16);
    expect((settled as any).opponent.name).toBe('Asha');
    expect(ratings.recordDuelCalls).toHaveLength(1);
    expect(ratings.recordDuelCalls[0].key).toBe(`duel:${s2.duelId}`);
    expect(ratings.recordDuelCalls[0].dto.result).toBe('LOSS'); // from u2's perspective
    const u1Result = await service.getResult('u1', s1.duelId);
    expect(u1Result).toMatchObject({ status: 'SETTLED', result: 'WIN', ratingDelta: 16 });
  });

  it('Daily Duel: a second start the same day is 409', async () => {
    const { service } = buildService();
    await service.startDaily('u1', NOW);
    await expect(service.startDaily('u1', NOW)).rejects.toMatchObject({
      code: 'DUEL_DAILY_ALREADY_PLAYED',
    });
  });

  it('Daily Duel: a Ratings cap failure fails settlement cleanly (nothing stored)', async () => {
    const { service, ratings, repo } = buildService();
    ratings.recordDuelBehavior = async () => {
      throw AppError.ratingDailyLimit('Rated events are capped at 10 per user per day.');
    };
    const s1 = await service.startDaily('u1', NOW);
    const s2 = await service.startDaily('u2', NOW);
    await answerAll(service, 'u1', s1.duelId, 'daily', 5, 4000);
    await service.finishDaily('u1', s1.duelId, NOW);
    await answerAll(service, 'u2', s2.duelId, 'daily', 4, 4000);
    await expect(service.finishDaily('u2', s2.duelId, NOW)).rejects.toMatchObject({
      code: 'RATING_DAILY_LIMIT',
    });
    expect(await repo.findGameResult(s1.duelId, 'u1')).toBeNull();
    expect(await repo.findGameResult(s2.duelId, 'u2')).toBeNull();
    const d2 = await repo.findDuelById(s2.duelId);
    expect(d2.status).toBe(DuelStatus.WAITING_OPPONENT);
  });

  it('Daily Duel: a duplicate rating is recovered from history, not double-applied', async () => {
    const { service, ratings } = buildService();
    let calls = 0;
    ratings.recordDuelBehavior = async (callerId: string, dto: any, key: string) => {
      calls += 1;
      if (calls === 1) throw AppError.ratingEventDuplicate('already recorded');
      return {
        eventId: key,
        kind: 'LEARNING',
        result: dto.result,
        me: {
          userId: callerId,
          ratingBefore: 1000,
          ratingAfter: 1016,
          delta: 16,
          tier: 'Bronze',
          provisional: true,
          gamesPlayed: 1,
        },
        opponent: {
          userId: dto.opponentId,
          ratingBefore: 1000,
          ratingAfter: 984,
          delta: -16,
          tier: 'Bronze',
          provisional: true,
          gamesPlayed: 1,
        },
      };
    };
    (ratings.getDuelOutcome as jest.Mock).mockResolvedValue({
      eventId: 'duel:x',
      me: {
        userId: 'u2',
        ratingBefore: 1000,
        ratingAfter: 984,
        delta: -16,
        tier: 'Bronze',
        provisional: true,
        gamesPlayed: 1,
      },
      opponent: {
        userId: 'u1',
        ratingBefore: 1000,
        ratingAfter: 1016,
        delta: 16,
        tier: 'Bronze',
        provisional: true,
        gamesPlayed: 1,
      },
    });
    const s1 = await service.startDaily('u1', NOW);
    const s2 = await service.startDaily('u2', NOW);
    await answerAll(service, 'u1', s1.duelId, 'daily', 5, 4000);
    await service.finishDaily('u1', s1.duelId, NOW);
    await answerAll(service, 'u2', s2.duelId, 'daily', 5, 8000);
    const settled = await service.finishDaily('u2', s2.duelId, NOW);
    expect(settled).toMatchObject({ status: 'SETTLED', result: 'LOSS', ratingDelta: -16 });
  });

  it('settleUnpaired pairs a lone Daily player against the bot at their Rating', async () => {
    const { service, ratings } = buildService();
    const s1 = await service.startDaily('u1', NOW);
    await answerAll(service, 'u1', s1.duelId, 'daily', 4, 4000);
    await service.finishDaily('u1', s1.duelId, NOW);
    const out = await service.settleUnpaired('admin', { date: '2026-11-11' }, NOW);
    expect(out.settled).toBe(1);
    expect(out.failed).toHaveLength(0);
    expect(ratings.recordDuelVsBotCalls).toHaveLength(1);
    expect(ratings.recordDuelVsBotCalls[0].key).toBe(`duel:${s1.duelId}`);
    const res = await service.getResult('u1', s1.duelId);
    expect(res).toMatchObject({ status: 'SETTLED' });
    expect((res as any).ratingDelta).toBe(16);
    expect((res as any).opponent.name).toBe('Mira');
  });

  it('getDailyToday generates the fixed set once (same ids on repeat reads)', async () => {
    const { service, bank } = buildService();
    const t1 = await service.getDailyToday('u1', NOW);
    const t2 = await service.getDailyToday('u2', NOW);
    expect(t1.date).toBe('2026-11-11');
    expect(t1.myDuel).toBeNull();
    expect(bank.selectCalls).toBe(1);
    expect(t2.myDuel).toBeNull();
  });
});
