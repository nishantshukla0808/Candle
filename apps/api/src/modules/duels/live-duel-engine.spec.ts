import { randomUUID } from 'crypto';
import { DuelStatus, DuelType } from '@prisma/client';
import { LiveDuelEngine, type LiveDuelEmitter } from './live-duel-engine.service';

/**
 * LiveDuelEngine — docs/05 §3.1/§3.2, docs/09 (Phase 5).
 * In-memory fakes for every collaborator; a recording emitter stands
 * in for the gateway. Timers are cleared after creation so each test
 * drives the flow by calling engine methods directly.
 */

const NOW = new Date('2026-11-12T10:00:00.000Z');
const T0 = NOW.getTime();

function makeItem(id: string, difficulty = 3, type = 'MCQ_4'): any {
  const options =
    type === 'TRUE_FALSE'
      ? [
          { id: `opt-${id}-c`, text: 'True', isCorrect: true, order: 0 },
          { id: `opt-${id}-w1`, text: 'False', isCorrect: false, order: 1 },
        ]
      : [
          { id: `opt-${id}-c`, text: 'right', isCorrect: true, order: 0 },
          { id: `opt-${id}-w1`, text: 'wrong 1', isCorrect: false, order: 1 },
          { id: `opt-${id}-w2`, text: 'wrong 2', isCorrect: false, order: 2 },
          { id: `opt-${id}-w3`, text: 'wrong 3', isCorrect: false, order: 3 },
        ];
  return {
    id,
    topic: 'stocks',
    skill: 'RECALL',
    type,
    difficulty,
    stem: `Stem ${id}`,
    explanation: `Why ${id}.`,
    options,
  };
}

const ITEMS = Array.from({ length: 10 }, (_, i) =>
  makeItem(
    `q${i + 1}`,
    [2, 2, 3, 3, 3, 4, 4, 2, 3, 3][i] as number,
    i >= 6 ? 'TRUE_FALSE' : 'MCQ_4'
  )
);
const PUBLIC_VIEWS = ITEMS.map((item) => ({
  id: item.id,
  stem: item.stem,
  options: item.options.map((o: any) => ({ id: o.id, text: o.text, order: o.order })),
  type: item.type,
  topic: item.topic,
  skill: item.skill,
  difficulty: item.difficulty,
}));

/**
 * Case Duel items (Phase 7): 5 cases, difficulties 2, 3, 3, 4, 4
 * (the CASE mix {2:1, 3:2, 4:2}). Each has 4 actions — best (100,
 * isCorrect), second-best (50), two 0-point actions — plus the rubric
 * and context the reveal and the renderer need.
 */
function makeCaseItem(id: string, difficulty: number): any {
  return {
    id,
    topic: 'budgeting',
    skill: 'JUDGEMENT',
    type: 'CASE_CHOICE',
    difficulty,
    stem: `Case ${id}`,
    explanation: `Why ${id}.`,
    context: { 'Monthly income': '₹45,000', Goal: '₹1,50,000 in 6 months' },
    rubric: `Best — the best action reaches the goal on time.\nSecond-best — falls short of the goal.\nWeak — leaves no fund at all.`,
    options: [
      {
        id: `opt-${id}-best`,
        text: 'best action',
        isCorrect: true,
        points: 100,
        consequence: 'Goal reached.',
        order: 0,
      },
      {
        id: `opt-${id}-second`,
        text: 'second-best action',
        isCorrect: false,
        points: 50,
        consequence: 'Goal half reached.',
        order: 1,
      },
      {
        id: `opt-${id}-zero-a`,
        text: 'weak action',
        isCorrect: false,
        points: 0,
        consequence: 'Goal missed.',
        order: 2,
      },
      {
        id: `opt-${id}-zero-b`,
        text: 'harmful action',
        isCorrect: false,
        points: 0,
        consequence: 'Money lost.',
        order: 3,
      },
    ],
  };
}
const CASE_ITEMS = [
  makeCaseItem('c1', 2),
  makeCaseItem('c2', 3),
  makeCaseItem('c3', 3),
  makeCaseItem('c4', 4),
  makeCaseItem('c5', 4),
];
const CASE_PUBLIC_VIEWS = CASE_ITEMS.map((item) => ({
  id: item.id,
  stem: item.stem,
  options: item.options.map((o: any) => ({
    id: o.id,
    text: o.text,
    order: o.order,
    consequence: o.consequence,
  })),
  type: item.type,
  topic: item.topic,
  skill: item.skill,
  difficulty: item.difficulty,
  context: item.context,
}));

/**
 * Chart Detective items (Phase 8): 5 charts, difficulties 2, 3, 3, 4, 4
 * (the CHART mix {2:1, 3:2, 4:2}). Each has 4 interpretations — one
 * correct reading — plus the chart (STEADY_RISE, series [100..124])
 * and the reveal-only annotation. The public view carries the chart
 * WITHOUT the annotation, exactly like the real public view.
 */
function makeChartItem(id: string, difficulty: number): any {
  return {
    id,
    topic: 'stocks',
    skill: 'CHART_READING',
    type: 'CHART_CHOICE',
    difficulty,
    stem: `What does the chart of ${id} show?`,
    explanation:
      'The line climbs in almost every month and ends clearly higher than January. A rising line means the price rose.',
    chart: {
      title: 'Meadow Foods — price over 6 months',
      instrument: 'Meadow Foods',
      template: 'STEADY_RISE',
      xLabel: 'Month',
      yLabel: 'Price (₹)',
      xLabels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
      series: [100, 104, 109, 113, 118, 124],
      annotation: { trend: 'rising', zoneStart: 0, zoneEnd: 5 },
    },
    options: [
      {
        id: `opt-${id}-c`,
        text: 'The price rose steadily over the six months.',
        isCorrect: true,
        order: 0,
      },
      {
        id: `opt-${id}-w1`,
        text: 'The price fell steadily over the six months.',
        isCorrect: false,
        order: 1,
      },
      {
        id: `opt-${id}-w2`,
        text: 'The price stayed flat all six months.',
        isCorrect: false,
        order: 2,
      },
      {
        id: `opt-${id}-w3`,
        text: 'The price rose, then fell below where it started.',
        isCorrect: false,
        order: 3,
      },
    ],
  };
}
const CHART_ITEMS = [
  makeChartItem('ch1', 2),
  makeChartItem('ch2', 3),
  makeChartItem('ch3', 3),
  makeChartItem('ch4', 4),
  makeChartItem('ch5', 4),
];
const CHART_PUBLIC_VIEWS = CHART_ITEMS.map((item) => ({
  id: item.id,
  stem: item.stem,
  options: item.options.map((o: any) => ({ id: o.id, text: o.text, order: o.order })),
  type: item.type,
  topic: item.topic,
  skill: item.skill,
  difficulty: item.difficulty,
  // The public chart carries everything EXCEPT the reveal-only annotation.
  chart: {
    title: item.chart.title,
    instrument: item.chart.instrument,
    template: item.chart.template,
    xLabel: item.chart.xLabel,
    yLabel: item.chart.yLabel,
    xLabels: [...item.chart.xLabels],
    series: [...item.chart.series],
  },
}));

class FakeRedis {
  store = new Map<string, string>();
  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }
  async set(key: string, value: string, _ttl?: number): Promise<'OK'> {
    this.store.set(key, value);
    return 'OK';
  }
  async del(key: string): Promise<number> {
    return this.store.delete(key) ? 1 : 0;
  }
}

class FakeRepo {
  duels = new Map<string, any>();
  answers: any[] = [];
  results: any[] = [];
  users = new Map<string, any>([
    ['user-a', { id: 'user-a', displayName: 'Asha' }],
    ['user-b', { id: 'user-b', displayName: 'Ravi' }],
  ]);

  async createDuel(input: any): Promise<any> {
    const row = {
      id: randomUUID(),
      status: DuelStatus.IN_PROGRESS,
      playerBId: input.playerBId ?? null,
      pairedDuelId: null,
      dailyDate: null,
      dailySetId: null,
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

  async findActiveLiveDuelForUser(userId: string): Promise<any | null> {
    for (const d of this.duels.values()) {
      if (
        (d.type === DuelType.LIVE ||
          d.type === DuelType.BLITZ ||
          d.type === DuelType.CASE ||
          d.type === DuelType.CHART) &&
        d.status === DuelStatus.IN_PROGRESS &&
        (d.playerAId === userId || d.playerBId === userId)
      ) {
        return { ...d };
      }
    }
    return null;
  }

  async findLastLiveDuelBetween(
    a: string,
    b: string,
    type: any = DuelType.LIVE
  ): Promise<any | null> {
    const rows = [...this.duels.values()]
      .filter(
        (d) =>
          d.type === type &&
          ((d.playerAId === a && d.playerBId === b) || (d.playerAId === b && d.playerBId === a))
      )
      .sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime());
    return rows[0] ? { ...rows[0] } : null;
  }

  async createAnswer(input: any): Promise<any> {
    const row = { id: randomUUID(), createdAt: NOW, ...input };
    this.answers.push(row);
    return { ...row };
  }

  async updateAnswerReason(
    duelId: string,
    userId: string,
    questionId: string,
    reason: string | null
  ): Promise<any> {
    const row = this.answers.find(
      (a) => a.duelId === duelId && a.userId === userId && a.questionId === questionId
    );
    if (!row) throw new Error('answer not found');
    row.reason = reason;
    return { ...row };
  }

  async listAnswers(duelId: string, userId: string): Promise<any[]> {
    return this.answers
      .filter((a) => a.duelId === duelId && a.userId === userId)
      .sort((x, y) => x.order - y.order)
      .map((a) => ({ ...a }));
  }

  async createGameResult(input: any): Promise<any> {
    const row = { id: randomUUID(), createdAt: NOW, ...input };
    this.results.push(row);
    return { ...row };
  }

  async findGameResult(duelId: string, userId: string): Promise<any | null> {
    const r = this.results.find((x) => x.duelId === duelId && x.userId === userId);
    return r ? { ...r } : null;
  }

  async findUserById(id: string): Promise<any | null> {
    return this.users.get(id) ?? null;
  }
}

class FakeBank {
  selectSetCalls: Array<{ userIds: string[]; blueprint: any }> = [];
  async selectSet(userIds: string[], blueprint?: any): Promise<any[]> {
    this.selectSetCalls.push({ userIds, blueprint });
    const count = blueprint?.count ?? 7;
    // A CASE_CHOICE blueprint selects from the case items, not the quiz pool.
    if (blueprint?.types?.includes('CASE_CHOICE')) {
      return CASE_PUBLIC_VIEWS.slice(0, count).map((v) => ({
        ...v,
        options: v.options.map((o: any) => ({ ...o })),
      }));
    }
    // A CHART_CHOICE blueprint selects from the chart items, not the quiz pool.
    if (blueprint?.types?.includes('CHART_CHOICE')) {
      return CHART_PUBLIC_VIEWS.slice(0, count).map((v) => ({
        ...v,
        options: v.options.map((o: any) => ({ ...o })),
        chart: { ...v.chart, xLabels: [...v.chart.xLabels], series: [...v.chart.series] },
      }));
    }
    return PUBLIC_VIEWS.slice(0, count).map((v) => ({
      ...v,
      options: v.options.map((o: any) => ({ ...o })),
    }));
  }
  async recordExposure(): Promise<void> {}
  async getItemsForGrading(itemIds: string[]): Promise<any[]> {
    return itemIds.map((id) => {
      const item =
        CHART_ITEMS.find((i) => i.id === id) ??
        CASE_ITEMS.find((i) => i.id === id) ??
        ITEMS.find((i) => i.id === id);
      if (!item) throw new Error(`unknown item ${id}`);
      return item;
    });
  }
}

class FakeRatings {
  recordDuelCalls: any[] = [];
  async getUserRatings(userId: string): Promise<any> {
    void userId;
    return { learning: { rating: 1000 } };
  }
  async recordDuel(callerId: string, dto: any, _key: string): Promise<any> {
    this.recordDuelCalls.push({ callerId, dto });
    return {
      me: {
        userId: callerId,
        ratingBefore: 1000,
        ratingAfter: 1020,
        delta: 20,
        tier: 'Bronze',
        provisional: true,
        gamesPlayed: 1,
      },
      opponent: {
        userId: dto.opponentId,
        ratingBefore: 1000,
        ratingAfter: 980,
        delta: -20,
        tier: 'Bronze',
        provisional: true,
        gamesPlayed: 1,
      },
    };
  }
  async recordDuelVsBot(userId: string, result: string, _key: string): Promise<any> {
    const delta = result === 'WIN' ? 20 : result === 'DRAW' ? 0 : -20;
    return {
      me: {
        userId,
        ratingBefore: 1000,
        ratingAfter: 1000 + delta,
        delta,
        tier: 'Bronze',
        provisional: true,
        gamesPlayed: 1,
      },
      botRating: 1000,
    };
  }
  async getDuelOutcome(): Promise<null> {
    return null;
  }
}

class FakeGamification {
  grants: any[] = [];
  async grantDuelRewards(_tx: any, event: any): Promise<any> {
    this.grants.push(event);
    return {
      xpAwarded: event.result === 'WIN' ? 20 : event.result === 'DRAW' ? 5 : 0,
      totalXp: 120,
      level: 2,
      levelUp: false,
      currentStreak: 3,
      newBadges: [],
    };
  }
}

class FakeTx {
  async run<T>(fn: (tx: any) => Promise<T>): Promise<T> {
    return fn({});
  }
}

class RecordingEmitter implements LiveDuelEmitter {
  events: Array<{ to: string; event: string; payload: any }> = [];
  toUser(userId: string, event: string, payload: unknown): void {
    this.events.push({ to: `user:${userId}`, event, payload });
  }
  toRoom(duelId: string, event: string, payload: unknown): void {
    this.events.push({ to: `room:${duelId}`, event, payload });
  }
  of(event: string): any[] {
    return this.events.filter((e) => e.event === event).map((e) => e.payload);
  }
}

const CONFIG: any = {
  LIVE_QUESTION_MS: 15_000,
  BLITZ_QUESTION_MS: 10_000,
  CASE_QUESTION_MS: 45_000,
  CASE_REASON_WINDOW_MS: 10_000,
  CHART_QUESTION_MS: 30_000,
  LIVE_COUNTDOWN_MS: 3000,
  LIVE_DISCONNECT_GRACE_MS: 15_000,
  LIVE_REVEAL_PAUSE_MS: 2000,
};
const logger = { info: jest.fn(), error: jest.fn(), warn: jest.fn() } as any;

function makeEngine() {
  const redis = new FakeRedis();
  const repo = new FakeRepo();
  const bank = new FakeBank();
  const ratings = new FakeRatings();
  const gamification = new FakeGamification();
  const emitter = new RecordingEmitter();
  const duelsService = {
    getResult: jest.fn(async (userId: string, duelId: string) => {
      const stored = await repo.findGameResult(duelId, userId);
      return {
        duelId,
        type: DuelType.LIVE,
        status: 'SETTLED',
        result: stored?.result ?? 'DRAW',
        score: stored?.score ?? 0,
        opponent: { name: 'Ravi', kind: 'HUMAN', score: 0, correct: 0 },
        correct: stored?.correct ?? 0,
        wrong: stored?.wrong ?? 0,
        skipped: stored?.skipped ?? 0,
        accuracy: stored?.accuracy ?? 0,
        avgTimeMs: stored?.avgTimeMs ?? null,
        fastestTimeMs: null,
        slowestTimeMs: null,
        bestStreak: stored?.bestStreak ?? 0,
        perTopic: stored?.perTopic ?? [],
        perQuestion: stored?.perQuestion ?? [],
        ratingBefore: stored?.ratingBefore ?? null,
        ratingAfter: stored?.ratingAfter ?? null,
        ratingDelta: stored?.ratingDelta ?? null,
        ratingReason: stored?.ratingReason ?? '',
        xp: { awarded: 0, totalXp: 0, level: 1, levelUp: false, currentStreak: 0, newBadges: [] },
        finishedAt: NOW,
      };
    }),
  };
  const engine = new LiveDuelEngine(
    redis as any,
    repo as any,
    bank as any,
    ratings as any,
    gamification as any,
    new FakeTx() as any,
    duelsService as any,
    logger,
    CONFIG
  );
  engine.bindEmitter(emitter);
  return { engine, redis, repo, bank, ratings, gamification, emitter };
}

const A = { userId: 'user-a', displayName: 'Asha', rating: 1000 };
const B = { userId: 'user-b', displayName: 'Ravi', rating: 1000 };

describe('LiveDuelEngine', () => {
  it('creates one set for both players (same ids, same order)', async () => {
    const { engine, bank } = makeEngine();
    const state = await engine.createLiveDuel(A, B, NOW);
    engine.clearTimers(state.duelId);
    expect(bank.selectSetCalls).toHaveLength(1);
    expect(bank.selectSetCalls[0]?.userIds).toEqual(['user-a', 'user-b']);
    expect(state.questions.map((q) => q.id)).toEqual(ITEMS.slice(0, 7).map((i) => i.id));
    expect(state.phase).toBe('COUNTDOWN');
    expect(state.playerA.userId).toBe('user-a');
    expect(state.playerB?.userId).toBe('user-b');
  });

  it('sends the question without answers and grades from the server clock', async () => {
    const { engine, emitter, repo } = makeEngine();
    const state = await engine.createLiveDuel(A, B, NOW);
    engine.clearTimers(state.duelId);
    await engine.startQuestion(state.duelId, 0, NOW);
    engine.clearTimers(state.duelId);
    const questions = emitter.of('live:question');
    expect(questions).toHaveLength(1);
    const q = questions[0];
    expect(q.question.id).toBe('q1');
    expect(JSON.stringify(q)).not.toContain('isCorrect');
    expect(JSON.stringify(q)).not.toContain('Why q1');
    expect(q.deadlineMs).toBe(T0 + 15_000);

    // Asha answers correctly after 4 s (server clock): 100 + floor(50*(1-4000/15000)) = 136.
    const res = await engine.answer('user-a', state.duelId, 'q1', 'opt-q1-c', new Date(T0 + 4000));
    expect(res.answeredCount).toBe(1);
    const stored = await repo.listAnswers(state.duelId, 'user-a');
    expect(stored[0]?.points).toBe(136);
    expect(stored[0]?.correct).toBe(true);
    expect(stored[0]?.timeMs).toBe(4000);
    // Correctness is NOT in the ack, and no reveal has been sent yet.
    expect(emitter.of('live:reveal')).toHaveLength(0);
    expect(emitter.of('live:score')).toHaveLength(1);
  });

  it('rejects a duplicate answer, a wrong question, and a late answer', async () => {
    const { engine } = makeEngine();
    const state = await engine.createLiveDuel(A, B, NOW);
    engine.clearTimers(state.duelId);
    await engine.startQuestion(state.duelId, 0, NOW);
    engine.clearTimers(state.duelId);
    await engine.answer('user-a', state.duelId, 'q1', 'opt-q1-c', new Date(T0 + 1000));
    await expect(
      engine.answer('user-a', state.duelId, 'q1', 'opt-q1-c', new Date(T0 + 2000))
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(
      engine.answer('user-b', state.duelId, 'q2', 'opt-q2-c', new Date(T0 + 2000))
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(
      engine.answer('user-b', state.duelId, 'q1', 'opt-q1-c', new Date(T0 + 15_001))
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    engine.clearTimers(state.duelId);
  });

  it('reveals after both players answer, with the correct option + explanation', async () => {
    const { engine, emitter } = makeEngine();
    const state = await engine.createLiveDuel(A, B, NOW);
    engine.clearTimers(state.duelId);
    await engine.startQuestion(state.duelId, 0, NOW);
    engine.clearTimers(state.duelId);
    await engine.answer('user-a', state.duelId, 'q1', 'opt-q1-c', new Date(T0 + 4000));
    await engine.answer('user-b', state.duelId, 'q1', 'opt-q1-w1', new Date(T0 + 6000));
    engine.clearTimers(state.duelId);
    const reveals = emitter.of('live:reveal');
    expect(reveals).toHaveLength(2); // one per player, personalised
    const mine = reveals.find((r: any) => r.myCorrect === true);
    expect(mine.correctOptionId).toBe('opt-q1-c');
    expect(mine.correctOptionText).toBe('right');
    expect(mine.explanation).toBe('Why q1.');
    expect(mine.myPoints).toBe(136);
    expect(mine.scores.playerA.score).toBe(136);
    expect(mine.scores.playerB.score).toBe(0);
  });

  it('settles once: Rating via the duel path, results + XP for both', async () => {
    const { engine, emitter, repo, ratings, gamification } = makeEngine();
    const state = await engine.createLiveDuel(A, B, NOW);
    engine.clearTimers(state.duelId);
    // Play all 7: Asha correct every time, Ravi wrong every time.
    for (let i = 0; i < 7; i++) {
      await engine.startQuestion(state.duelId, i, new Date(T0 + i * 20_000));
      engine.clearTimers(state.duelId);
      const qid = `q${i + 1}`;
      await engine.answer(
        'user-a',
        state.duelId,
        qid,
        `opt-${qid}-c`,
        new Date(T0 + i * 20_000 + 4000)
      );
      await engine.answer(
        'user-b',
        state.duelId,
        qid,
        `opt-${qid}-w1`,
        new Date(T0 + i * 20_000 + 6000)
      );
      engine.clearTimers(state.duelId);
    }
    const view = await engine.settleDuel(state.duelId, new Date(T0 + 200_000));
    expect(ratings.recordDuelCalls).toHaveLength(1);
    expect(ratings.recordDuelCalls[0].dto.idempotencyKey).toBe(`duel:${state.duelId}`);
    expect(repo.results).toHaveLength(2);
    const aResult = repo.results.find((r) => r.userId === 'user-a');
    expect(aResult.result).toBe('WIN');
    expect(aResult.correct).toBe(7);
    expect(aResult.ratingDelta).toBe(20);
    expect(aResult.ratingReason).toContain('You beat Ravi');
    expect(gamification.grants).toHaveLength(2);
    expect(emitter.of('live:finished')).toHaveLength(2);
    expect(view?.result).toBe('WIN');
    const duel = await repo.findDuelById(state.duelId);
    expect(duel.status).toBe(DuelStatus.SETTLED);
    expect(duel.winnerId).toBe('user-a');
    // Re-settling replays, never re-applies.
    await engine.settleDuel(state.duelId, new Date(T0 + 210_000));
    expect(ratings.recordDuelCalls).toHaveLength(1);
    expect(repo.results).toHaveLength(2);
  });

  it('forfeits a player who stays disconnected past the 15 s grace', async () => {
    const { engine, repo, ratings } = makeEngine();
    const state = await engine.createLiveDuel(A, B, NOW);
    engine.clearTimers(state.duelId);
    await engine.startQuestion(state.duelId, 0, NOW);
    engine.clearTimers(state.duelId);
    await engine.handleDisconnect('user-a', NOW);
    engine.clearTimers(state.duelId);
    const saved = await engine.getState(state.duelId);
    expect(saved?.playerA.disconnectedAtMs).toBe(T0);
    await engine.forfeitIfStillDisconnected(state.duelId, 'user-a');
    const duel = await repo.findDuelById(state.duelId);
    expect(duel.status).toBe(DuelStatus.SETTLED);
    expect(duel.winnerId).toBe('user-b');
    const aResult = repo.results.find((r) => r.userId === 'user-a');
    expect(aResult.result).toBe('LOSS');
    expect(ratings.recordDuelCalls).toHaveLength(1);
  });

  it('reconnect clears the grace, so no forfeit follows', async () => {
    const { engine, repo } = makeEngine();
    const state = await engine.createLiveDuel(A, B, NOW);
    engine.clearTimers(state.duelId);
    await engine.startQuestion(state.duelId, 0, NOW);
    engine.clearTimers(state.duelId);
    await engine.handleDisconnect('user-a', NOW);
    await engine.handleReconnect('user-a', new Date(T0 + 5000));
    engine.clearTimers(state.duelId);
    await engine.forfeitIfStillDisconnected(state.duelId, 'user-a');
    const duel = await repo.findDuelById(state.duelId);
    expect(duel.status).toBe(DuelStatus.IN_PROGRESS);
  });

  it('creates a rated bot duel and scores Mira from the seed', async () => {
    const { engine, emitter } = makeEngine();
    const state = await engine.createBotDuel(A, NOW);
    engine.clearTimers(state.duelId);
    expect(state.isBot).toBe(true);
    expect(state.playerB).toBeNull();
    expect(state.botAnswers).toHaveLength(7);
    await engine.startQuestion(state.duelId, 0, NOW);
    engine.clearTimers(state.duelId);
    await engine.botAnswer(state.duelId, 0);
    const scores = emitter.of('live:score');
    expect(scores.length).toBeGreaterThan(0);
    expect(scores[scores.length - 1].scores.playerB.userId).toBe('bot:mira');
  });

  it('denies a rematch inside the 5-minute cooldown', async () => {
    const { engine } = makeEngine();
    const state = await engine.createLiveDuel(A, B, NOW);
    engine.clearTimers(state.duelId);
    await engine.settleDuel(state.duelId, new Date(T0 + 100_000));
    const denied = await engine.rematch('user-a', state.duelId, new Date(T0 + 200_000));
    expect(denied.matched).toBe(false);
    expect(denied.reason).toBe('REMATCH_COOLDOWN');
    expect(denied.retryAfterMs).toBeGreaterThan(0);
  });

  it('rematches once both players ask after the cooldown', async () => {
    const { engine } = makeEngine();
    const state = await engine.createLiveDuel(A, B, NOW);
    engine.clearTimers(state.duelId);
    await engine.settleDuel(state.duelId, new Date(T0 + 100_000));
    const later = new Date(T0 + 500_000); // > 5 min after the 100 s finish
    const first = await engine.rematch('user-a', state.duelId, later);
    expect(first.matched).toBe(false);
    expect(first.reason).toBe('WAITING_OPPONENT');
    const second = await engine.rematch('user-b', state.duelId, later);
    expect(second.matched).toBe(true);
    expect(second.newDuelId).toBeTruthy();
    expect(second.newDuelId).not.toBe(state.duelId);
    engine.clearTimers(second.newDuelId ?? '');
  });

  // --- Myth vs Fact Blitz (L2, Phase 6) ------------------------------------------

  it('creates a Blitz duel: type BLITZ, 10 TRUE_FALSE questions, 10 s timer', async () => {
    const { engine, bank, repo, emitter } = makeEngine();
    const state = await engine.createLiveDuel(A, B, NOW, 'BLITZ');
    engine.clearTimers(state.duelId);
    expect(state.variant).toBe('BLITZ');
    expect(state.questions).toHaveLength(10);
    const duel = await repo.findDuelById(state.duelId);
    expect(duel.type).toBe(DuelType.BLITZ);
    // The selection blueprint is TRUE_FALSE-only, 10 questions.
    const blueprint = bank.selectSetCalls[0]?.blueprint;
    expect(blueprint.count).toBe(10);
    expect(blueprint.types).toEqual(['TRUE_FALSE']);
    expect(blueprint.difficultyMix).toEqual({ 2: 3, 3: 4, 4: 3 });
    // Matched payload names the variant, the 10-question count, and the 10 s limit.
    const matched = engine.matchedPayload(state, 'user-a');
    expect(matched.variant).toBe('BLITZ');
    expect(matched.questionCount).toBe(10);
    expect(matched.timeLimitMs).toBe(10_000);
    expect(matched.host.line).toContain('10 rapid true-or-false');
    // The question payload carries the 10 s deadline (not 15 s).
    await engine.startQuestion(state.duelId, 0, NOW);
    engine.clearTimers(state.duelId);
    const questions = emitter.of('live:question');
    expect(questions[0].deadlineMs).toBe(T0 + 10_000);
    expect(questions[0].timeLimitMs).toBe(10_000);
    expect(questions[0].total).toBe(10);
  });

  it('Blitz rejects an answer after the 10 s deadline (Speed Quiz allows 15 s)', async () => {
    const { engine } = makeEngine();
    const state = await engine.createLiveDuel(A, B, NOW, 'BLITZ');
    engine.clearTimers(state.duelId);
    await engine.startQuestion(state.duelId, 0, NOW);
    engine.clearTimers(state.duelId);
    await expect(
      engine.answer('user-a', state.duelId, 'q1', 'opt-q1-c', new Date(T0 + 10_001))
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    engine.clearTimers(state.duelId);
  });

  it('Blitz streak bonus: +10/+20/+30, reset on wrong, bestStreak stored', async () => {
    const { engine, repo } = makeEngine();
    const state = await engine.createLiveDuel(A, B, NOW, 'BLITZ');
    engine.clearTimers(state.duelId);
    // Asha: correct, correct, correct, wrong, then correct to the end
    // (streaks 1, 2, 3, reset, 1, 2, 3, 4, 5, 6). Ravi: wrong every time.
    // All answers at +1,000 ms: speed bonus 45 each → base 145.
    const ashaCorrect = [true, true, true, false, true, true, true, true, true, true];
    for (let i = 0; i < 10; i++) {
      await engine.startQuestion(state.duelId, i, new Date(T0 + i * 20_000));
      engine.clearTimers(state.duelId);
      const qid = `q${i + 1}`;
      await engine.answer(
        'user-a',
        state.duelId,
        qid,
        ashaCorrect[i] ? `opt-${qid}-c` : `opt-${qid}-w1`,
        new Date(T0 + i * 20_000 + 1000)
      );
      await engine.answer(
        'user-b',
        state.duelId,
        qid,
        `opt-${qid}-w1`,
        new Date(T0 + i * 20_000 + 2000)
      );
      engine.clearTimers(state.duelId);
    }
    const mid = await engine.getState(state.duelId);
    expect(mid?.playerA.streak).toBe(6);
    const answers = await repo.listAnswers(state.duelId, 'user-a');
    // q3 (streak 3): 145 + 10 = 155. q4 (wrong): 0. q7 (streak 3): 155.
    // q8 (streak 4): 165. q9 (streak 5): 175. q10 (streak 6): 175 (capped).
    expect(answers[2]?.points).toBe(155);
    expect(answers[3]?.points).toBe(0);
    expect(answers[6]?.points).toBe(155);
    expect(answers[7]?.points).toBe(165);
    expect(answers[8]?.points).toBe(175);
    expect(answers[9]?.points).toBe(175);
    await engine.settleDuel(state.duelId, new Date(T0 + 300_000));
    const aResult = repo.results.find((r) => r.userId === 'user-a');
    // 9 correct × 145 + bonuses (10 + 10 + 20 + 30 + 30) = 1405.
    expect(aResult.score).toBe(1405);
    expect(aResult.correct).toBe(9);
    expect(aResult.bestStreak).toBe(6);
    expect(aResult.result).toBe('WIN');
  });

  it('creates a rated Blitz bot duel on the 10 s timer', async () => {
    const { engine, repo } = makeEngine();
    const state = await engine.createBotDuel(A, NOW, 'BLITZ');
    engine.clearTimers(state.duelId);
    expect(state.variant).toBe('BLITZ');
    expect(state.isBot).toBe(true);
    expect(state.botAnswers).toHaveLength(10);
    expect(state.botAnswers?.every((a) => a.timeMs <= 9999)).toBe(true);
    const duel = await repo.findDuelById(state.duelId);
    expect(duel.type).toBe(DuelType.BLITZ);
  });

  it('Blitz rematch replays the same variant (not Speed Quiz)', async () => {
    const { engine, repo } = makeEngine();
    const state = await engine.createLiveDuel(A, B, NOW, 'BLITZ');
    engine.clearTimers(state.duelId);
    await engine.settleDuel(state.duelId, new Date(T0 + 100_000));
    const later = new Date(T0 + 500_000);
    await engine.rematch('user-a', state.duelId, later);
    const second = await engine.rematch('user-b', state.duelId, later);
    expect(second.matched).toBe(true);
    const fresh = await engine.getState(second.newDuelId as string);
    expect(fresh?.variant).toBe('BLITZ');
    expect(fresh?.questions).toHaveLength(10);
    const duel = await repo.findDuelById(second.newDuelId as string);
    expect(duel.type).toBe(DuelType.BLITZ);
    engine.clearTimers(second.newDuelId ?? '');
  });

  // --- Case Duel (L3, Phase 7, ADR 0009) ----------------------------------------

  it('creates a Case Duel: type CASE, 5 CASE_CHOICE cases, 45 s timer, Kabir hosts', async () => {
    const { engine, bank, repo, emitter } = makeEngine();
    const state = await engine.createLiveDuel(A, B, NOW, 'CASE');
    engine.clearTimers(state.duelId);
    expect(state.variant).toBe('CASE');
    expect(state.questions).toHaveLength(5);
    expect(state.questions.every((q) => q.type === 'CASE_CHOICE')).toBe(true);
    const duel = await repo.findDuelById(state.duelId);
    expect(duel.type).toBe(DuelType.CASE);
    // The selection blueprint is CASE_CHOICE-only, 5 cases, mix {2:1, 3:2, 4:2}.
    const blueprint = bank.selectSetCalls[0]?.blueprint;
    expect(blueprint.count).toBe(5);
    expect(blueprint.types).toEqual(['CASE_CHOICE']);
    expect(blueprint.difficultyMix).toEqual({ 2: 1, 3: 2, 4: 2 });
    expect(blueprint.maxPerTopic).toBe(2);
    // Matched payload: Kabir hosts, 5 cases, 45 s limit.
    const matched = engine.matchedPayload(state, 'user-a');
    expect(matched.variant).toBe('CASE');
    expect(matched.questionCount).toBe(5);
    expect(matched.timeLimitMs).toBe(45_000);
    expect(matched.host.name).toBe('Kabir');
    expect(matched.host.line).toContain('5 cases, 45 seconds each');
    // The question payload carries the 45 s deadline (not 15 s).
    await engine.startQuestion(state.duelId, 0, NOW);
    engine.clearTimers(state.duelId);
    const questions = emitter.of('live:question');
    expect(questions[0].deadlineMs).toBe(T0 + 45_000);
    expect(questions[0].timeLimitMs).toBe(45_000);
    expect(questions[0].total).toBe(5);
  });

  it('Case rejects an answer after the 45 s deadline', async () => {
    const { engine } = makeEngine();
    const state = await engine.createLiveDuel(A, B, NOW, 'CASE');
    engine.clearTimers(state.duelId);
    await engine.startQuestion(state.duelId, 0, NOW);
    engine.clearTimers(state.duelId);
    await expect(
      engine.answer('user-a', state.duelId, 'c1', 'opt-c1-best', new Date(T0 + 45_001))
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    engine.clearTimers(state.duelId);
  });

  it('Case scoring: second-best pays 50 + speed, best pays 100 + speed, harmful pays 0', async () => {
    const { engine, emitter, repo } = makeEngine();
    const state = await engine.createLiveDuel(A, B, NOW, 'CASE');
    engine.clearTimers(state.duelId);
    await engine.startQuestion(state.duelId, 0, NOW);
    engine.clearTimers(state.duelId);
    // Asha picks the second-best action at +1,000 ms: 50 + floor(20×(1−1000/45000)) = 69.
    await engine.answer('user-a', state.duelId, 'c1', 'opt-c1-second', new Date(T0 + 1000));
    // Ravi picks the best action at +2,000 ms: 100 + 19 = 119.
    await engine.answer('user-b', state.duelId, 'c1', 'opt-c1-best', new Date(T0 + 2000));
    engine.clearTimers(state.duelId);
    // Both answered — but NO reveal yet: the reason window is open.
    expect(emitter.of('live:reveal')).toHaveLength(0);
    expect(emitter.of('live:reason-window')).toHaveLength(1);
    // Asha submits her reason: still no reveal (Ravi has not).
    await engine.submitReason(
      'user-a',
      state.duelId,
      'c1',
      'Safest for my goal',
      new Date(T0 + 3000)
    );
    expect(emitter.of('live:reveal')).toHaveLength(0);
    // Ravi skips his reason (null): now both have submitted → reveal.
    await engine.submitReason('user-b', state.duelId, 'c1', null, new Date(T0 + 4000));
    engine.clearTimers(state.duelId);
    const reveals = emitter.of('live:reveal');
    expect(reveals).toHaveLength(2); // one per player, personalised
    const mineA = reveals.find((r: any) => r.myPoints === 69);
    const mineB = reveals.find((r: any) => r.myPoints === 119);
    expect(mineA).toBeDefined();
    expect(mineB).toBeDefined();
    // The reveal carries the rubric + the points breakdown in plain words.
    expect(mineA.rubric).toContain('Best — the best action reaches the goal on time.');
    expect(mineA.pointsBreakdown).toBe('Best action +100, your action +50 — second-best.');
    expect(mineB.pointsBreakdown).toBe('Best action +100, your action +100 — best action.');
    expect(mineA.optionPoints).toEqual(
      expect.arrayContaining([
        { optionId: 'opt-c1-best', text: 'best action', points: 100 },
        { optionId: 'opt-c1-second', text: 'second-best action', points: 50 },
      ])
    );
    expect(mineA.myReason).toBe('Safest for my goal');
    expect(mineB.myReason).toBeNull();
    // The reason is stored on the answer row (and never changes the points).
    const aAnswers = await repo.listAnswers(state.duelId, 'user-a');
    expect(aAnswers[0]?.points).toBe(69);
    expect(aAnswers[0]?.reason).toBe('Safest for my goal');
    const bAnswers = await repo.listAnswers(state.duelId, 'user-b');
    expect(bAnswers[0]?.points).toBe(119);
    expect(bAnswers[0]?.reason).toBeNull();
  });

  it('Case reason window: a reason before it opens, a duplicate, and a non-answer are rejected', async () => {
    const { engine } = makeEngine();
    const state = await engine.createLiveDuel(A, B, NOW, 'CASE');
    engine.clearTimers(state.duelId);
    await engine.startQuestion(state.duelId, 0, NOW);
    engine.clearTimers(state.duelId);
    // No one has answered yet — there is no reason window.
    await expect(
      engine.submitReason('user-a', state.duelId, 'c1', 'Safest for my goal', new Date(T0 + 1000))
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await engine.answer('user-a', state.duelId, 'c1', 'opt-c1-best', new Date(T0 + 1000));
    // Ravi has not answered, so the window is still closed.
    await expect(
      engine.submitReason('user-a', state.duelId, 'c1', 'Safest for my goal', new Date(T0 + 2000))
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    // The 45 s timer expires: the case closes for answers and the
    // reason window opens (no extension to the answer deadline).
    await engine.closeQuestionForAnswers(state.duelId, 0, new Date(T0 + 45_000));
    engine.clearTimers(state.duelId);
    const mid = await engine.getState(state.duelId);
    expect(mid?.reasonDeadlineMs).toBe(T0 + 45_000 + 10_000);
    // Ravi never answered: he has no reason to give.
    await expect(
      engine.submitReason('user-b', state.duelId, 'c1', 'Safest for my goal', new Date(T0 + 46_000))
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    // Asha submits: hers is the only reason needed (Ravi never
    // answered), so the case reveals at once — a second reason for
    // the same case is now too late, not a duplicate.
    await engine.submitReason(
      'user-a',
      state.duelId,
      'c1',
      'Safest for my goal',
      new Date(T0 + 46_000)
    );
    await expect(
      engine.submitReason('user-a', state.duelId, 'c1', 'Fits my budget', new Date(T0 + 47_000))
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    engine.clearTimers(state.duelId);
  });

  it('Case reason window: a duplicate reason while the window is still open is a conflict', async () => {
    const { engine, emitter } = makeEngine();
    const state = await engine.createLiveDuel(A, B, NOW, 'CASE');
    engine.clearTimers(state.duelId);
    await engine.startQuestion(state.duelId, 0, NOW);
    engine.clearTimers(state.duelId);
    await engine.answer('user-a', state.duelId, 'c1', 'opt-c1-best', new Date(T0 + 1000));
    await engine.answer('user-b', state.duelId, 'c1', 'opt-c1-best', new Date(T0 + 2000));
    engine.clearTimers(state.duelId);
    // Both answered, so the window is open — but it stays open until
    // BOTH have submitted, so Asha's second reason is a duplicate.
    await engine.submitReason(
      'user-a',
      state.duelId,
      'c1',
      'Safest for my goal',
      new Date(T0 + 3000)
    );
    expect(emitter.of('live:reveal')).toHaveLength(0);
    await expect(
      engine.submitReason('user-a', state.duelId, 'c1', 'Fits my budget', new Date(T0 + 4000))
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    // B submits: now both have submitted → reveal.
    await engine.submitReason('user-b', state.duelId, 'c1', null, new Date(T0 + 5000));
    engine.clearTimers(state.duelId);
    expect(emitter.of('live:reveal')).toHaveLength(2);
  });

  it('Case reason window expiry reveals with missing reasons left null (never a lost answer)', async () => {
    const { engine, emitter, repo } = makeEngine();
    const state = await engine.createLiveDuel(A, B, NOW, 'CASE');
    engine.clearTimers(state.duelId);
    await engine.startQuestion(state.duelId, 0, NOW);
    engine.clearTimers(state.duelId);
    await engine.answer('user-a', state.duelId, 'c1', 'opt-c1-best', new Date(T0 + 1000));
    await engine.answer('user-b', state.duelId, 'c1', 'opt-c1-second', new Date(T0 + 2000));
    engine.clearTimers(state.duelId);
    // Neither player submits a reason. The window timer would reveal
    // after 10 s — simulate it by revealing directly.
    expect(emitter.of('live:reveal')).toHaveLength(0);
    await engine.revealQuestion(state.duelId, 0);
    engine.clearTimers(state.duelId);
    expect(emitter.of('live:reveal')).toHaveLength(2);
    // Both answers are graded and stored; the missing reasons are null.
    const aAnswers = await repo.listAnswers(state.duelId, 'user-a');
    expect(aAnswers[0]?.points).toBe(119);
    expect(aAnswers[0]?.reason).toBeNull();
    const bAnswers = await repo.listAnswers(state.duelId, 'user-b');
    expect(bAnswers[0]?.points).toBe(69);
    expect(bAnswers[0]?.reason).toBeNull();
  });

  it('Case winner is decided on points: five second-best picks beat two best picks', async () => {
    const { engine, repo } = makeEngine();
    const state = await engine.createLiveDuel(A, B, NOW, 'CASE');
    engine.clearTimers(state.duelId);
    // Asha: second-best every case (5 × 69 = 345, 0 best actions).
    // Ravi: best twice, harmful three times (2 × 119 = 238, 2 best actions).
    for (let i = 0; i < 5; i++) {
      await engine.startQuestion(state.duelId, i, new Date(T0 + i * 60_000));
      engine.clearTimers(state.duelId);
      const qid = `c${i + 1}`;
      await engine.answer(
        'user-a',
        state.duelId,
        qid,
        `opt-${qid}-second`,
        new Date(T0 + i * 60_000 + 1000)
      );
      await engine.answer(
        'user-b',
        state.duelId,
        qid,
        i < 2 ? `opt-${qid}-best` : `opt-${qid}-zero-a`,
        new Date(T0 + i * 60_000 + 1000)
      );
      // Close the reason window immediately (both skip their reason).
      await engine.submitReason(
        'user-a',
        state.duelId,
        qid,
        null,
        new Date(T0 + i * 60_000 + 2000)
      );
      await engine.submitReason(
        'user-b',
        state.duelId,
        qid,
        null,
        new Date(T0 + i * 60_000 + 2000)
      );
      engine.clearTimers(state.duelId);
    }
    const view = await engine.settleDuel(state.duelId, new Date(T0 + 400_000));
    const aResult = repo.results.find((r) => r.userId === 'user-a');
    const bResult = repo.results.find((r) => r.userId === 'user-b');
    expect(aResult.score).toBe(345);
    expect(aResult.correct).toBe(0); // correct counts best actions only
    expect(bResult.score).toBe(238);
    expect(bResult.correct).toBe(2);
    // Fewer "correct" answers — but more points, so Asha wins.
    expect(aResult.result).toBe('WIN');
    expect(view?.result).toBe('WIN');
    const duel = await repo.findDuelById(state.duelId);
    expect(duel.winnerId).toBe('user-a');
  });

  it('creates a rated Case bot duel: Mira picks actions on the 45 s timer, no reason', async () => {
    const { engine, repo, emitter } = makeEngine();
    const state = await engine.createBotDuel(A, NOW, 'CASE');
    engine.clearTimers(state.duelId);
    expect(state.variant).toBe('CASE');
    expect(state.isBot).toBe(true);
    expect(state.botAnswers).toHaveLength(5);
    for (const a of state.botAnswers ?? []) {
      expect(a.timeMs).toBeGreaterThanOrEqual(5000);
      expect(a.timeMs).toBeLessThanOrEqual(44_999);
      expect(a.points).toBeGreaterThanOrEqual(0);
      expect(a.points).toBeLessThanOrEqual(120);
      expect(a.reason).toBeNull();
    }
    const duel = await repo.findDuelById(state.duelId);
    expect(duel.type).toBe(DuelType.CASE);
    // Play one case vs the bot: Mira's simulated time lands, the human
    // answers, the reason window opens (Mira needs no reason), the
    // human submits a reason, and the case reveals.
    await engine.startQuestion(state.duelId, 0, NOW);
    engine.clearTimers(state.duelId);
    await engine.botAnswer(state.duelId, 0);
    await engine.answer('user-a', state.duelId, 'c1', 'opt-c1-best', new Date(T0 + 1000));
    const mid = await engine.getState(state.duelId);
    expect(mid?.reasonDeadlineMs).not.toBeNull();
    expect(emitter.of('live:reveal')).toHaveLength(0);
    await engine.submitReason('user-a', state.duelId, 'c1', 'Fits my budget', new Date(T0 + 2000));
    engine.clearTimers(state.duelId);
    const reveals = emitter.of('live:reveal');
    expect(reveals).toHaveLength(1); // one player only, vs the bot
    expect(reveals[0].myPoints).toBe(119);
    expect(reveals[0].myReason).toBe('Fits my budget');
    expect(reveals[0].rubric).toContain('Best — the best action reaches the goal on time.');
  });

  it('Case rematch replays the same variant (not Speed Quiz)', async () => {
    const { engine, repo } = makeEngine();
    const state = await engine.createLiveDuel(A, B, NOW, 'CASE');
    engine.clearTimers(state.duelId);
    await engine.settleDuel(state.duelId, new Date(T0 + 100_000));
    const later = new Date(T0 + 500_000);
    await engine.rematch('user-a', state.duelId, later);
    const second = await engine.rematch('user-b', state.duelId, later);
    expect(second.matched).toBe(true);
    const fresh = await engine.getState(second.newDuelId as string);
    expect(fresh?.variant).toBe('CASE');
    expect(fresh?.questions).toHaveLength(5);
    const duel = await repo.findDuelById(second.newDuelId as string);
    expect(duel.type).toBe(DuelType.CASE);
    engine.clearTimers(second.newDuelId ?? '');
  });

  it('creates a Chart Duel: type CHART, 5 CHART_CHOICE charts, 30 s timer, Kabir hosts', async () => {
    const { engine, bank, repo, emitter } = makeEngine();
    const state = await engine.createLiveDuel(A, B, NOW, 'CHART');
    engine.clearTimers(state.duelId);
    expect(state.variant).toBe('CHART');
    expect(state.questions).toHaveLength(5);
    expect(state.questions.every((q) => q.type === 'CHART_CHOICE')).toBe(true);
    const duel = await repo.findDuelById(state.duelId);
    expect(duel.type).toBe(DuelType.CHART);
    // The selection blueprint is CHART_CHOICE-only, 5 charts, mix {2:1, 3:2, 4:2}.
    const blueprint = bank.selectSetCalls[0]?.blueprint;
    expect(blueprint.count).toBe(5);
    expect(blueprint.types).toEqual(['CHART_CHOICE']);
    expect(blueprint.difficultyMix).toEqual({ 2: 1, 3: 2, 4: 2 });
    expect(blueprint.maxPerTopic).toBe(2);
    // Matched payload: Kabir hosts, 5 charts, 30 s limit.
    const matched = engine.matchedPayload(state, 'user-a');
    expect(matched.variant).toBe('CHART');
    expect(matched.questionCount).toBe(5);
    expect(matched.timeLimitMs).toBe(30_000);
    expect(matched.host.name).toBe('Kabir');
    expect(matched.host.line).toContain('5 charts, 30 seconds each');
    // The question payload carries the 30 s deadline (not 15 s) and
    // the chart WITHOUT the annotation (reveal-only).
    await engine.startQuestion(state.duelId, 0, NOW);
    engine.clearTimers(state.duelId);
    const questions = emitter.of('live:question');
    expect(questions[0].deadlineMs).toBe(T0 + 30_000);
    expect(questions[0].timeLimitMs).toBe(30_000);
    expect(questions[0].total).toBe(5);
    expect(questions[0].question.type).toBe('CHART_CHOICE');
    expect(questions[0].question.chart.series).toEqual([100, 104, 109, 113, 118, 124]);
    expect(questions[0].question.chart).not.toHaveProperty('annotation');
    expect(JSON.stringify(questions[0])).not.toContain('annotation');
    expect(JSON.stringify(questions[0])).not.toContain('isCorrect');
  });

  it('Chart rejects an answer after the 30 s deadline', async () => {
    const { engine } = makeEngine();
    const state = await engine.createLiveDuel(A, B, NOW, 'CHART');
    engine.clearTimers(state.duelId);
    await engine.startQuestion(state.duelId, 0, NOW);
    engine.clearTimers(state.duelId);
    await expect(
      engine.answer('user-a', state.duelId, 'ch1', 'opt-ch1-c', new Date(T0 + 30_001))
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    engine.clearTimers(state.duelId);
  });

  it('Chart scoring: correct pays 100 + speed on the 30 s timer, wrong pays 0, reveal carries the annotation', async () => {
    const { engine, emitter, repo } = makeEngine();
    const state = await engine.createLiveDuel(A, B, NOW, 'CHART');
    engine.clearTimers(state.duelId);
    await engine.startQuestion(state.duelId, 0, NOW);
    engine.clearTimers(state.duelId);
    // Asha reads the chart right at +1,000 ms: 100 + floor(50×(1−1000/30000)) = 148.
    await engine.answer('user-a', state.duelId, 'ch1', 'opt-ch1-c', new Date(T0 + 1000));
    // Ravi reads it wrong at +2,000 ms: 0 (no partial credit).
    await engine.answer('user-b', state.duelId, 'ch1', 'opt-ch1-w1', new Date(T0 + 2000));
    engine.clearTimers(state.duelId);
    // Both answered — the chart reveals at once (no reason window for CHART).
    const reveals = emitter.of('live:reveal');
    expect(reveals).toHaveLength(2); // one per player, personalised
    const mineA = reveals.find((r: any) => r.myPoints === 148);
    const mineB = reveals.find((r: any) => r.myPoints === 0);
    expect(mineA).toBeDefined();
    expect(mineB).toBeDefined();
    // The reveal carries the annotation + the correct interpretation + the explanation.
    expect(mineA.annotation).toEqual({ trend: 'rising', zoneStart: 0, zoneEnd: 5 });
    expect(mineA.correctOptionId).toBe('opt-ch1-c');
    expect(mineA.correctOptionText).toBe('The price rose steadily over the six months.');
    expect(mineA.explanation).toContain('rising line');
    expect(mineA.myCorrect).toBe(true);
    expect(mineB.myCorrect).toBe(false);
    expect(mineB.annotation).toEqual({ trend: 'rising', zoneStart: 0, zoneEnd: 5 });
    const aAnswers = await repo.listAnswers(state.duelId, 'user-a');
    expect(aAnswers[0]?.points).toBe(148);
    const bAnswers = await repo.listAnswers(state.duelId, 'user-b');
    expect(bAnswers[0]?.points).toBe(0);
  });

  it('Chart winner is decided on correct count first, then total time', async () => {
    const { engine, repo } = makeEngine();
    const state = await engine.createLiveDuel(A, B, NOW, 'CHART');
    engine.clearTimers(state.duelId);
    // Asha: correct on the first 3 charts (3 × 148 = 444, slower).
    // Ravi: correct on the last 2 charts (2 × 149 = 298, faster).
    // More correct answers wins — even though Ravi was faster overall.
    for (let i = 0; i < 5; i++) {
      await engine.startQuestion(state.duelId, i, new Date(T0 + i * 60_000));
      engine.clearTimers(state.duelId);
      const qid = `ch${i + 1}`;
      await engine.answer(
        'user-a',
        state.duelId,
        qid,
        i < 3 ? `opt-${qid}-c` : `opt-${qid}-w1`,
        new Date(T0 + i * 60_000 + 1000)
      );
      await engine.answer(
        'user-b',
        state.duelId,
        qid,
        i < 3 ? `opt-${qid}-w1` : `opt-${qid}-c`,
        new Date(T0 + i * 60_000 + 500)
      );
      engine.clearTimers(state.duelId);
    }
    const view = await engine.settleDuel(state.duelId, new Date(T0 + 400_000));
    const aResult = repo.results.find((r) => r.userId === 'user-a');
    const bResult = repo.results.find((r) => r.userId === 'user-b');
    expect(aResult.score).toBe(444);
    expect(aResult.correct).toBe(3);
    expect(bResult.score).toBe(298);
    expect(bResult.correct).toBe(2);
    expect(aResult.result).toBe('WIN');
    expect(view?.result).toBe('WIN');
    const duel = await repo.findDuelById(state.duelId);
    expect(duel.winnerId).toBe('user-a');
    // The stored per-question stat carries the chart + annotation (result screen).
    expect(aResult.perQuestion[0].chart.series).toEqual([100, 104, 109, 113, 118, 124]);
    expect(aResult.perQuestion[0].chart).not.toHaveProperty('annotation');
    expect(aResult.perQuestion[0].annotation).toEqual({
      trend: 'rising',
      zoneStart: 0,
      zoneEnd: 5,
    });
  });

  it('creates a rated Chart bot duel: Mira reads charts on the 30 s timer', async () => {
    const { engine, repo, emitter } = makeEngine();
    const state = await engine.createBotDuel(A, NOW, 'CHART');
    engine.clearTimers(state.duelId);
    expect(state.variant).toBe('CHART');
    expect(state.isBot).toBe(true);
    expect(state.botAnswers).toHaveLength(5);
    for (const a of state.botAnswers ?? []) {
      expect(a.timeMs).toBeGreaterThanOrEqual(5000);
      expect(a.timeMs).toBeLessThanOrEqual(29_999);
      expect(a.points).toBeGreaterThanOrEqual(0);
      expect(a.points).toBeLessThanOrEqual(150);
      expect(a.optionId).toBeTruthy();
    }
    const duel = await repo.findDuelById(state.duelId);
    expect(duel.type).toBe(DuelType.CHART);
    // Play one chart vs the bot: Mira's simulated time lands, the human
    // answers, and the chart reveals at once (no reason window).
    await engine.startQuestion(state.duelId, 0, NOW);
    engine.clearTimers(state.duelId);
    await engine.botAnswer(state.duelId, 0);
    await engine.answer('user-a', state.duelId, 'ch1', 'opt-ch1-c', new Date(T0 + 1000));
    engine.clearTimers(state.duelId);
    const reveals = emitter.of('live:reveal');
    expect(reveals).toHaveLength(1); // one player only, vs the bot
    expect(reveals[0].myPoints).toBe(148);
    expect(reveals[0].annotation).toEqual({ trend: 'rising', zoneStart: 0, zoneEnd: 5 });
    expect(reveals[0].correctOptionId).toBe('opt-ch1-c');
  });

  it('Chart rematch replays the same variant (not Speed Quiz)', async () => {
    const { engine, repo } = makeEngine();
    const state = await engine.createLiveDuel(A, B, NOW, 'CHART');
    engine.clearTimers(state.duelId);
    await engine.settleDuel(state.duelId, new Date(T0 + 100_000));
    const later = new Date(T0 + 500_000);
    await engine.rematch('user-a', state.duelId, later);
    const second = await engine.rematch('user-b', state.duelId, later);
    expect(second.matched).toBe(true);
    const fresh = await engine.getState(second.newDuelId as string);
    expect(fresh?.variant).toBe('CHART');
    expect(fresh?.questions).toHaveLength(5);
    const duel = await repo.findDuelById(second.newDuelId as string);
    expect(duel.type).toBe(DuelType.CHART);
    engine.clearTimers(second.newDuelId ?? '');
  });
});
