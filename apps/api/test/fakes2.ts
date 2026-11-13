/**
 * Fakes, part 2 — quiz, gamification, admin, outbox, idempotency
 * repositories plus TransactionService, RedisService, StorageService.
 */
import { ContentStatus, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdirSync, writeFileSync } from 'fs';
import type { Readable } from 'stream';
import { FakeDb, newUser } from './fakes';

const sortedByOrder = <T extends { order: number }>(rows: T[]): T[] =>
  [...rows].sort((a, b) => a.order - b.order);

// --- QuizRepository ------------------------------------------------------------

export class FakeQuizRepository {
  constructor(private readonly db: FakeDb) {}

  async getVersionQuestions(versionId: string): Promise<any[]> {
    return sortedByOrder(
      [...this.db.questions.values()].filter((q) => q.lessonVersionId === versionId)
    ).map((q) => ({
      id: q.id,
      text: q.text,
      explanation: q.explanation,
      kind: q.kind,
      order: q.order,
      points: q.points,
      options: sortedByOrder(
        [...this.db.questionOptions.values()].filter((o) => o.questionId === q.id)
      ).map((o) => ({ id: o.id, text: o.text, order: o.order, isCorrect: o.isCorrect })),
    }));
  }

  async createAttempt(data: {
    userId: string;
    lessonVersionId: string;
    questionIds: string[];
  }): Promise<any> {
    const row = {
      id: randomUUID(),
      userId: data.userId,
      lessonVersionId: data.lessonVersionId,
      questionIds: data.questionIds,
      submittedAt: null,
      score: null,
      totalPoints: null,
      passed: null,
      idempotencyKey: null,
      createdAt: new Date(),
    };
    this.db.quizAttempts.set(row.id, row);
    return { ...row };
  }

  async getAttempt(attemptId: string): Promise<any | null> {
    const r = this.db.quizAttempts.get(attemptId);
    return r ? { ...r } : null;
  }

  async getPassedAttempt(userId: string, lessonVersionId: string): Promise<any | null> {
    const rows = [...this.db.quizAttempts.values()]
      .filter((a) => a.userId === userId && a.lessonVersionId === lessonVersionId && a.passed)
      .sort((a, b) => b.submittedAt.getTime() - a.submittedAt.getTime());
    return rows[0] ? { ...rows[0] } : null;
  }

  async getLessonIdForVersion(versionId: string): Promise<string | null> {
    return this.db.lessonVersions.get(versionId)?.lessonId ?? null;
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
    }
  ): Promise<any> {
    const row = this.db.quizAttempts.get(attemptId);
    if (!row) throw new Error('attempt not found');
    Object.assign(row, {
      submittedAt: new Date(),
      score: data.score,
      totalPoints: data.totalPoints,
      passed: data.passed,
      idempotencyKey: data.idempotencyKey,
    });
    for (const a of data.answers) {
      this.db.attemptAnswers.push({ id: randomUUID(), attemptId, ...a });
    }
    return { ...row };
  }
}

// --- GamificationRepository ----------------------------------------------------

export class FakeGamificationRepository {
  constructor(private readonly db: FakeDb) {}

  async appendXp(
    userId: string,
    amount: number,
    reason: string,
    idempotencyKey: string
  ): Promise<boolean> {
    const k = `${userId}:${idempotencyKey}`;
    if (this.db.xpKeys.has(k)) return false;
    this.db.xpKeys.add(k);
    this.db.xpLedger.push({
      id: randomUUID(),
      userId,
      amount,
      reason,
      idempotencyKey,
      createdAt: new Date(),
    });
    return true;
  }

  async getOrCreateStats(userId: string): Promise<any> {
    let s = this.db.userStats.get(userId);
    if (!s) {
      s = {
        userId,
        totalXp: 0,
        level: 1,
        currentStreak: 0,
        longestStreak: 0,
        lastActivityDate: null,
      };
      this.db.userStats.set(userId, s);
    }
    return { ...s };
  }

  async saveStats(stats: any): Promise<any> {
    this.db.userStats.set(stats.userId, { ...stats });
    return { ...stats };
  }

  async ensureBadge(def: { slug: string; name: string; description: string }): Promise<any> {
    let b = this.db.badges.get(def.slug);
    if (!b) {
      b = { id: randomUUID(), ...def };
      this.db.badges.set(def.slug, b);
      this.db.badgesById.set(b.id, b);
    } else {
      b.name = def.name;
      b.description = def.description;
    }
    return { ...b };
  }

  async awardBadge(userId: string, badgeId: string): Promise<boolean> {
    const k = `${userId}:${badgeId}`;
    if (this.db.userBadgeKeys.has(k)) return false;
    this.db.userBadgeKeys.add(k);
    this.db.userBadgeRows.push({ userId, badgeId, awardedAt: new Date() });
    return true;
  }

  async getUserBadges(userId: string): Promise<any[]> {
    return this.db.userBadgeRows
      .filter((r) => r.userId === userId)
      .sort((a, b) => a.awardedAt.getTime() - b.awardedAt.getTime())
      .map((r) => {
        const b = this.db.badgesById.get(r.badgeId);
        return {
          id: b.id,
          slug: b.slug,
          name: b.name,
          description: b.description,
          awardedAt: r.awardedAt,
        };
      });
  }

  async countUserBadges(userId: string): Promise<number> {
    return this.db.userBadgeRows.filter((r) => r.userId === userId).length;
  }
}

// --- AdminRepository -----------------------------------------------------------

export class FakeAdminRepository {
  constructor(private readonly db: FakeDb) {}

  async createTrack(data: any): Promise<any> {
    const row = { id: randomUUID(), status: ContentStatus.DRAFT, ...data };
    this.db.tracks.set(row.id, row);
    return { ...row };
  }

  async updateTrack(id: string, data: any): Promise<any> {
    const t = this.db.tracks.get(id);
    if (!t) throw Object.assign(new Error('not found'), { code: 'P2025' });
    Object.assign(t, data);
    return { ...t };
  }

  async getTrack(id: string): Promise<any | null> {
    const t = this.db.tracks.get(id);
    return t ? { ...t } : null;
  }

  async listAllTracks(): Promise<any[]> {
    return sortedByOrder([...this.db.tracks.values()]).map((t) => ({ ...t }));
  }

  async getTrackTree(id: string): Promise<any | null> {
    const t = this.db.tracks.get(id);
    if (!t) return null;
    return {
      ...t,
      modules: sortedByOrder([...this.db.modules.values()].filter((m) => m.trackId === id)).map(
        (m) => ({
          ...m,
          lessons: sortedByOrder(
            [...this.db.lessons.values()].filter((l) => l.moduleId === m.id)
          ).map((l) => {
            const latest = sortedByOrder(
              [...this.db.lessonVersions.values()].filter((v) => v.lessonId === l.id)
            ).reverse()[0];
            return {
              id: l.id,
              title: l.title,
              order: l.order,
              latestVersion: latest
                ? { id: latest.id, version: latest.version, status: latest.status }
                : null,
            };
          }),
        })
      ),
    };
  }

  async setTrackStatus(id: string, status: ContentStatus): Promise<any> {
    const t = this.db.tracks.get(id);
    if (!t) throw Object.assign(new Error('not found'), { code: 'P2025' });
    t.status = status;
    return { ...t };
  }

  async createModule(data: any): Promise<any> {
    const row = { id: randomUUID(), status: ContentStatus.DRAFT, description: null, ...data };
    this.db.modules.set(row.id, row);
    return { ...row };
  }

  async updateModule(id: string, data: any): Promise<any> {
    const m = this.db.modules.get(id);
    if (!m) throw Object.assign(new Error('not found'), { code: 'P2025' });
    Object.assign(m, data);
    return { ...m };
  }

  async getModule(id: string): Promise<any | null> {
    const m = this.db.modules.get(id);
    return m ? { ...m } : null;
  }

  async setModuleStatus(id: string, status: ContentStatus): Promise<any> {
    const m = this.db.modules.get(id);
    if (!m) throw Object.assign(new Error('not found'), { code: 'P2025' });
    m.status = status;
    return { ...m };
  }

  async createLesson(data: any): Promise<any> {
    const row = { id: randomUUID(), ...data };
    this.db.lessons.set(row.id, row);
    return { ...row };
  }

  async getLesson(id: string): Promise<any | null> {
    const l = this.db.lessons.get(id);
    return l ? { ...l } : null;
  }

  async createVersion(data: any): Promise<any> {
    const row = { id: randomUUID(), publishedAt: null, ...data };
    this.db.lessonVersions.set(row.id, row);
    return { ...row };
  }

  async getDraftVersion(lessonId: string): Promise<any | null> {
    const rows = sortedByOrder(
      [...this.db.lessonVersions.values()].filter(
        (v) => v.lessonId === lessonId && v.status === ContentStatus.DRAFT
      )
    ).reverse();
    return rows[0] ? { ...rows[0] } : null;
  }

  async getLatestPublished(lessonId: string): Promise<any | null> {
    const rows = sortedByOrder(
      [...this.db.lessonVersions.values()].filter(
        (v) => v.lessonId === lessonId && v.status === ContentStatus.PUBLISHED
      )
    ).reverse();
    return rows[0] ? { ...rows[0] } : null;
  }

  async getMaxVersion(lessonId: string): Promise<number> {
    let max = 0;
    for (const v of this.db.lessonVersions.values()) {
      if (v.lessonId === lessonId && v.version > max) max = v.version;
    }
    return max;
  }

  async updateDraft(versionId: string, data: any): Promise<any> {
    const v = this.db.lessonVersions.get(versionId);
    if (!v) throw Object.assign(new Error('not found'), { code: 'P2025' });
    Object.assign(v, data);
    return { ...v };
  }

  async publishVersion(versionId: string): Promise<any> {
    const v = this.db.lessonVersions.get(versionId);
    if (!v) throw Object.assign(new Error('not found'), { code: 'P2025' });
    v.status = ContentStatus.PUBLISHED;
    v.publishedAt = new Date();
    return { ...v };
  }

  async listVersions(lessonId: string): Promise<any[]> {
    return sortedByOrder(
      [...this.db.lessonVersions.values()].filter((v) => v.lessonId === lessonId)
    )
      .reverse()
      .map((v) => ({ ...v }));
  }

  async createQuestion(versionId: string, data: any): Promise<any> {
    const q = {
      id: randomUUID(),
      lessonVersionId: versionId,
      text: data.text,
      explanation: data.explanation,
      kind: data.kind,
      order: data.order,
      points: data.points,
    };
    this.db.questions.set(q.id, q);
    const options = data.options.map((o: any) => {
      const opt = {
        id: randomUUID(),
        questionId: q.id,
        text: o.text,
        isCorrect: o.isCorrect,
        order: o.order,
      };
      this.db.questionOptions.set(opt.id, opt);
      return { ...opt };
    });
    return { ...q, options: sortedByOrder(options) };
  }

  async getQuestion(id: string): Promise<any | null> {
    const q = this.db.questions.get(id);
    if (!q) return null;
    const v = this.db.lessonVersions.get(q.lessonVersionId);
    return {
      ...q,
      options: sortedByOrder(
        [...this.db.questionOptions.values()].filter((o) => o.questionId === id)
      ).map((o) => ({ ...o })),
      lessonVersion: v ? { id: v.id, status: v.status, lessonId: v.lessonId } : null,
    };
  }

  async listQuestionsByVersion(versionId: string): Promise<any[]> {
    return sortedByOrder(
      [...this.db.questions.values()].filter((q) => q.lessonVersionId === versionId)
    ).map((q) => ({
      ...q,
      options: sortedByOrder(
        [...this.db.questionOptions.values()].filter((o) => o.questionId === q.id)
      ).map((o) => ({ ...o })),
    }));
  }

  async updateQuestion(id: string, data: any): Promise<any> {
    const q = this.db.questions.get(id);
    if (!q) throw Object.assign(new Error('not found'), { code: 'P2025' });
    for (const k of ['text', 'explanation', 'order', 'points']) {
      if (data[k] !== undefined) q[k] = data[k];
    }
    if (data.options) {
      for (const [oid, o] of [...this.db.questionOptions]) {
        if (o.questionId === id) this.db.questionOptions.delete(oid);
      }
      for (const o of data.options) {
        const opt = {
          id: randomUUID(),
          questionId: id,
          text: o.text,
          isCorrect: o.isCorrect,
          order: o.order,
        };
        this.db.questionOptions.set(opt.id, opt);
      }
    }
    return { ...q };
  }

  async deleteQuestion(id: string): Promise<void> {
    for (const [oid, o] of [...this.db.questionOptions]) {
      if (o.questionId === id) this.db.questionOptions.delete(oid);
    }
    this.db.questions.delete(id);
  }

  async appendAudit(data: {
    actorId: string;
    action: string;
    entityType: string;
    entityId: string;
    before?: unknown;
    after?: unknown;
    ip?: string;
  }): Promise<any> {
    const row = {
      id: randomUUID(),
      createdAt: new Date(),
      before: data.before ?? null,
      after: data.after ?? null,
      ip: data.ip ?? null,
      ...data,
    };
    this.db.auditLogs.push(row);
    return { ...row };
  }

  async listAudit(page: number, limit: number): Promise<{ total: number; items: any[] }> {
    const items = [...this.db.auditLogs]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice((page - 1) * limit, page * limit)
      .map((r) => ({ ...r }));
    return { total: this.db.auditLogs.length, items };
  }
}

// --- OutboxRepository ----------------------------------------------------------

export class FakeOutboxRepository {
  constructor(private readonly db: FakeDb) {}

  async append(type: string, payload: unknown): Promise<void> {
    this.db.outbox.push({
      id: randomUUID(),
      type,
      payload,
      attempts: 0,
      processedAt: null,
      createdAt: new Date(),
    });
  }

  async claimPending(limit: number): Promise<any[]> {
    const rows = this.db.outbox
      .filter((r) => !r.processedAt)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .slice(0, limit);
    for (const r of rows) r.attempts += 1;
    return rows.map((r) => ({ id: r.id, type: r.type, payload: r.payload, attempts: r.attempts }));
  }

  async markProcessed(id: string): Promise<void> {
    const r = this.db.outbox.find((x) => x.id === id);
    if (r) r.processedAt = new Date();
  }
}

// --- IdempotencyRepository -----------------------------------------------------

export class FakeIdempotencyRepository {
  constructor(private readonly db: FakeDb) {}

  async find(key: string, userId: string): Promise<unknown | null> {
    const row = this.db.idempotency.get(`${key}:${userId}`);
    if (!row) return null;
    if (row.expiresAt.getTime() < Date.now()) return null;
    return row.response;
  }

  async store(key: string, userId: string, response: unknown, ttlSeconds: number): Promise<void> {
    this.db.idempotency.set(`${key}:${userId}`, {
      response,
      expiresAt: new Date(Date.now() + ttlSeconds * 1000),
    });
  }
}

// --- TransactionService --------------------------------------------------------

export class FakeTransactionService {
  async run<T>(fn: (tx: any) => Promise<T>): Promise<T> {
    return fn({});
  }
}

// --- RedisService --------------------------------------------------------------

export class FakeRedisService {
  private readonly store = new Map<string, { value: string; n: number }>();
  private readonly zsets = new Map<string, Map<string, number>>();

  async onModuleInit(): Promise<void> {}
  async onModuleDestroy(): Promise<void> {}
  async ping(): Promise<boolean> {
    return true;
  }
  async incr(key: string): Promise<number> {
    const e = this.store.get(key) ?? { value: '0', n: 0 };
    e.n += 1;
    e.value = String(e.n);
    this.store.set(key, e);
    return e.n;
  }
  async expire(_key: string, _seconds: number): Promise<number> {
    return 1;
  }
  async get(key: string): Promise<string | null> {
    return this.store.get(key)?.value ?? null;
  }
  async set(key: string, value: string): Promise<'OK'> {
    this.store.set(key, { value, n: Number(value) || 0 });
    return 'OK';
  }
  async del(key: string): Promise<number> {
    return this.store.delete(key) ? 1 : 0;
  }
  isReady(): boolean {
    return true;
  }

  // --- sorted sets (ratings leaderboards, docs/04 §7) ---------------------------

  private sorted(key: string): Array<[string, number]> {
    const m = this.zsets.get(key);
    if (!m) return [];
    // Highest score first; ties break reverse-lexicographically (Redis order).
    return [...m.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? 1 : -1));
  }

  async zadd(key: string, score: number, member: string): Promise<number> {
    let m = this.zsets.get(key);
    if (!m) {
      m = new Map();
      this.zsets.set(key, m);
    }
    m.set(member, score);
    return 1;
  }

  async zrevrange(key: string, start: number, stop: number): Promise<string[]> {
    const out: string[] = [];
    for (const [member, score] of this.sorted(key).slice(start, stop + 1)) {
      out.push(member, String(score));
    }
    return out;
  }

  async zrevrank(key: string, member: string): Promise<number | null> {
    const idx = this.sorted(key).findIndex(([m]) => m === member);
    return idx === -1 ? null : idx;
  }

  async zcard(key: string): Promise<number> {
    return this.zsets.get(key)?.size ?? 0;
  }

  async zrem(key: string, member: string): Promise<number> {
    return this.zsets.get(key)?.delete(member) ? 1 : 0;
  }

  async zrangebyscore(key: string, min: number, max: number): Promise<string[]> {
    const out: string[] = [];
    const rows = [...(this.zsets.get(key)?.entries() ?? [])]
      .filter(([, score]) => score >= min && score <= max)
      .sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1));
    for (const [member, score] of rows) out.push(member, String(score));
    return out;
  }

  async zscore(key: string, member: string): Promise<number | null> {
    return this.zsets.get(key)?.get(member) ?? null;
  }

  // --- hashes (live duel state, docs/09) ---------------------------------------

  private readonly hashes = new Map<string, Map<string, string>>();

  async hset(key: string, field: string, value: string): Promise<number> {
    let m = this.hashes.get(key);
    if (!m) {
      m = new Map();
      this.hashes.set(key, m);
    }
    const isNew = m.has(field) ? 0 : 1;
    m.set(field, value);
    return isNew;
  }

  async hget(key: string, field: string): Promise<string | null> {
    return this.hashes.get(key)?.get(field) ?? null;
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    return Object.fromEntries(this.hashes.get(key)?.entries() ?? []);
  }

  async hdel(key: string, field: string): Promise<number> {
    return this.hashes.get(key)?.delete(field) ? 1 : 0;
  }

  async setnx(key: string, value: string, _ttlSeconds: number): Promise<boolean> {
    if (this.store.has(key)) return false;
    this.store.set(key, { value, n: Number(value) || 0 });
    return true;
  }
}

// --- StorageService ------------------------------------------------------------

export class FakeStorageService {
  private readonly dir = join(tmpdir(), 'candle-e2e-avatars');

  async save(stream: Readable, _policy: unknown): Promise<{ key: string }> {
    mkdirSync(this.dir, { recursive: true });
    const key = `fake/${randomUUID()}`;
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    writeFileSync(join(this.dir, key.replace('/', '_')), Buffer.concat(chunks));
    return { key };
  }

  async delete(_key: string): Promise<void> {}

  resolveLocalPath(key: string): string {
    return join(this.dir, key.replace('/', '_'));
  }
}

export { newUser };

// --- DuelsRepository (Phase 4 Step 2, docs/05 §1 + docs/07) -------------------------

export class FakeDuelsRepository {
  constructor(private readonly db: FakeDb) {}

  async createDuel(input: any, _tx?: unknown): Promise<any> {
    const row = {
      id: randomUUID(),
      status: 'IN_PROGRESS',
      playerBId: null,
      pairedDuelId: null,
      dailyDate: input.dailyDate ?? null,
      dailySetId: input.dailySetId ?? null,
      startedAt: new Date(),
      finishedAt: null,
      winnerId: null,
      botScore: null,
      botCorrect: null,
      botTotalTimeMs: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...input,
    };
    this.db.duels.set(row.id, row);
    return { ...row };
  }

  async findDuelById(id: string, _tx?: unknown): Promise<any | null> {
    const r = this.db.duels.get(id);
    return r ? { ...r } : null;
  }

  async updateDuel(id: string, data: any, _tx?: unknown): Promise<any> {
    const r = this.db.duels.get(id);
    if (!r) throw new Error('duel not found');
    Object.assign(r, data, { updatedAt: new Date() });
    return { ...r };
  }

  async findActiveLiveDuelForUser(userId: string): Promise<any | null> {
    const rows = [...this.db.duels.values()]
      .filter(
        (d: any) =>
          (d.type === 'LIVE' || d.type === 'BLITZ' || d.type === 'CASE' || d.type === 'CHART') &&
          d.status === 'IN_PROGRESS' &&
          (d.playerAId === userId || d.playerBId === userId)
      )
      .sort((a: any, b: any) => b.createdAt.getTime() - a.createdAt.getTime());
    return rows[0] ? { ...rows[0] } : null;
  }

  async findLastLiveDuelBetween(
    userAId: string,
    userBId: string,
    type = 'LIVE'
  ): Promise<any | null> {
    const rows = [...this.db.duels.values()]
      .filter(
        (d: any) =>
          d.type === type &&
          ((d.playerAId === userAId && d.playerBId === userBId) ||
            (d.playerAId === userBId && d.playerBId === userAId))
      )
      .sort((a: any, b: any) => b.createdAt.getTime() - a.createdAt.getTime());
    return rows[0] ? { ...rows[0] } : null;
  }

  async findDailyDuelForUser(userId: string, dailyDate: string): Promise<any | null> {
    for (const d of this.db.duels.values()) {
      if (d.type === 'DAILY' && d.playerAId === userId && d.dailyDate === dailyDate) {
        return { ...d };
      }
    }
    return null;
  }

  async countBotStartedSince(userId: string, since: Date): Promise<number> {
    return [...this.db.duels.values()].filter(
      (d) => d.type === 'BOT' && d.playerAId === userId && d.startedAt >= since
    ).length;
  }

  async findWaitingDailyDuel(dailyDate: string, excludeDuelId: string): Promise<any | null> {
    const rows = [...this.db.duels.values()]
      .filter(
        (d) =>
          d.type === 'DAILY' &&
          d.dailyDate === dailyDate &&
          d.status === 'WAITING_OPPONENT' &&
          d.id !== excludeDuelId
      )
      .sort((a, b) => (a.finishedAt?.getTime() ?? 0) - (b.finishedAt?.getTime() ?? 0));
    return rows[0] ? { ...rows[0] } : null;
  }

  async listWaitingDailyDuels(dailyDate: string): Promise<any[]> {
    return [...this.db.duels.values()]
      .filter(
        (d) => d.type === 'DAILY' && d.dailyDate === dailyDate && d.status === 'WAITING_OPPONENT'
      )
      .sort((a, b) => (a.finishedAt?.getTime() ?? 0) - (b.finishedAt?.getTime() ?? 0))
      .map((d) => ({ ...d }));
  }

  async listDuelsForUser(userId: string, skip: number, take: number): Promise<any[]> {
    return [...this.db.duels.values()]
      .filter((d) => d.playerAId === userId || d.playerBId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(skip, skip + take)
      .map((d) => ({ ...d }));
  }

  async countDuelsForUser(userId: string): Promise<number> {
    return [...this.db.duels.values()].filter(
      (d) => d.playerAId === userId || d.playerBId === userId
    ).length;
  }

  async createAnswer(input: any, _tx?: unknown): Promise<any> {
    const row = { id: randomUUID(), createdAt: new Date(), ...input };
    this.db.duelAnswers.push(row);
    return { ...row };
  }

  async updateAnswerReason(
    duelId: string,
    userId: string,
    questionId: string,
    reason: string | null,
    _tx?: unknown
  ): Promise<any> {
    const row = this.db.duelAnswers.find(
      (a: any) => a.duelId === duelId && a.userId === userId && a.questionId === questionId
    );
    if (!row) throw new Error('duel answer not found');
    row.reason = reason;
    return { ...row };
  }

  async listAnswers(duelId: string, userId: string, _tx?: unknown): Promise<any[]> {
    return this.db.duelAnswers
      .filter((a) => a.duelId === duelId && a.userId === userId)
      .sort((a, b) => a.order - b.order)
      .map((a) => ({ ...a }));
  }

  async findDailySetByDate(date: string, _tx?: unknown): Promise<any | null> {
    const s = this.db.duelDailySets.get(date);
    return s ? { ...s } : null;
  }

  async createDailySet(input: any, _tx?: unknown): Promise<any> {
    if (this.db.duelDailySets.has(input.date)) {
      throw Object.assign(new Error('unique constraint'), { code: 'P2002' });
    }
    const row = { id: randomUUID(), createdAt: new Date(), ...input };
    this.db.duelDailySets.set(input.date, row);
    return { ...row };
  }

  async createGameResult(input: any, _tx?: unknown): Promise<any> {
    const row = { id: randomUUID(), createdAt: new Date(), ...input };
    this.db.duelGameResults.set(`${input.duelId}:${input.userId}`, row);
    return { ...row };
  }

  async findGameResult(duelId: string, userId: string, _tx?: unknown): Promise<any | null> {
    const r = this.db.duelGameResults.get(`${duelId}:${userId}`);
    return r ? { ...r } : null;
  }

  async findUserById(id: string): Promise<any | null> {
    const u = this.db.users.get(id);
    return u ? { id: u.id, displayName: u.displayName ?? null } : null;
  }
}

// --- FriendChallengeRepository (Phase 12, docs/17) --------------------------------
// One row per invite in db.challenges; the duel itself is a normal Duel
// row created by the live/trading engine at accept.

export class FakeFriendChallengeRepository {
  constructor(private readonly db: FakeDb) {}

  async create(input: any, _tx?: unknown): Promise<any> {
    const row = {
      id: randomUUID(),
      status: 'PENDING',
      duelId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...input,
    };
    this.db.challenges.set(row.id, row);
    return { ...row };
  }

  async findById(id: string, _tx?: unknown): Promise<any | null> {
    const r = this.db.challenges.get(id);
    return r ? { ...r } : null;
  }

  async findByInviteCode(code: string, _tx?: unknown): Promise<any | null> {
    for (const r of this.db.challenges.values()) {
      if (r.inviteCode === code) return { ...r };
    }
    return null;
  }

  async findBlockingBetween(
    userAId: string,
    userBId: string,
    duelType: string,
    _tx?: unknown
  ): Promise<any | null> {
    for (const r of this.db.challenges.values()) {
      if (
        r.duelType === duelType &&
        (r.status === 'PENDING' || r.status === 'ACCEPTED') &&
        ((r.creatorId === userAId && r.inviteeId === userBId) ||
          (r.creatorId === userBId && r.inviteeId === userAId))
      ) {
        return { ...r };
      }
    }
    return null;
  }

  async listPendingIncoming(userId: string, _tx?: unknown): Promise<any[]> {
    return [...this.db.challenges.values()]
      .filter((r) => r.inviteeId === userId && r.status === 'PENDING')
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((r) => ({ ...r }));
  }

  async listPendingOutgoing(userId: string, _tx?: unknown): Promise<any[]> {
    return [...this.db.challenges.values()]
      .filter((r) => r.creatorId === userId && r.status === 'PENDING')
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((r) => ({ ...r }));
  }

  async update(id: string, data: any, _tx?: unknown): Promise<any> {
    const r = this.db.challenges.get(id);
    if (!r) throw new Error('challenge not found');
    Object.assign(r, data, { updatedAt: new Date() });
    return { ...r };
  }
}

// --- SprintRepository (Phase 9, docs/14) -------------------------------------------
// Duel rows live in the same db.duels map as FakeDuelsRepository (one Duel
// table in Prisma); trades + results have their own stores.

export class FakeSprintRepository {
  constructor(private readonly db: FakeDb) {}

  async createDuel(input: any, _tx?: unknown): Promise<any> {
    const row = {
      id: randomUUID(),
      type: 'SPRINT',
      status: 'IN_PROGRESS',
      playerBId: null,
      questionIds: [],
      seed: input.seed,
      startedAt: new Date(),
      finishedAt: null,
      winnerId: null,
      botScore: null,
      botCorrect: null,
      botTotalTimeMs: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...input,
    };
    this.db.duels.set(row.id, row);
    return { ...row };
  }

  async findDuelById(id: string, _tx?: unknown): Promise<any | null> {
    const r = this.db.duels.get(id);
    return r ? { ...r } : null;
  }

  async updateDuel(id: string, data: any, _tx?: unknown): Promise<any> {
    const r = this.db.duels.get(id);
    if (!r) throw new Error('sprint not found');
    Object.assign(r, data, { updatedAt: new Date() });
    return { ...r };
  }

  async findActiveSprintForUser(userId: string, _tx?: unknown): Promise<any | null> {
    return this.findActiveTradingDuelForUser(userId, 'SPRINT', _tx);
  }

  /** Phase 10 (docs/15): the type-aware lookup the crisis flow uses. */
  async findActiveTradingDuelForUser(
    userId: string,
    type: string,
    _tx?: unknown
  ): Promise<any | null> {
    const rows = [...this.db.duels.values()]
      .filter(
        (d: any) =>
          d.type === type &&
          d.status === 'IN_PROGRESS' &&
          (d.playerAId === userId || d.playerBId === userId)
      )
      .sort((a: any, b: any) => b.createdAt.getTime() - a.createdAt.getTime());
    return rows[0] ? { ...rows[0] } : null;
  }

  async findLastSprintBetween(
    userAId: string,
    userBId: string,
    _tx?: unknown
  ): Promise<any | null> {
    return this.findLastTradingDuelBetween(userAId, userBId, 'SPRINT', _tx);
  }

  /** Phase 10 (docs/15): the type-aware lookup the crisis rematch uses. */
  async findLastTradingDuelBetween(
    userAId: string,
    userBId: string,
    type: string,
    _tx?: unknown
  ): Promise<any | null> {
    const rows = [...this.db.duels.values()]
      .filter(
        (d: any) =>
          d.type === type &&
          ((d.playerAId === userAId && d.playerBId === userBId) ||
            (d.playerAId === userBId && d.playerBId === userAId))
      )
      .sort((a: any, b: any) => b.createdAt.getTime() - a.createdAt.getTime());
    return rows[0] ? { ...rows[0] } : null;
  }

  async createTrade(input: any, _tx?: unknown): Promise<any> {
    const row = { id: randomUUID(), createdAt: new Date(), ...input };
    this.db.sprintTrades.push(row);
    return { ...row };
  }

  async listTrades(duelId: string, userId: string, _tx?: unknown): Promise<any[]> {
    return this.db.sprintTrades
      .filter((t) => t.duelId === duelId && t.userId === userId)
      .sort((a, b) => a.executedAt.getTime() - b.executedAt.getTime())
      .map((t) => ({ ...t }));
  }

  async createResult(input: any, _tx?: unknown): Promise<any> {
    const row = { id: randomUUID(), createdAt: new Date(), ...input };
    this.db.sprintResults.set(`${input.duelId}:${input.userId}`, row);
    return { ...row };
  }

  async findResult(duelId: string, userId: string, _tx?: unknown): Promise<any | null> {
    const r = this.db.sprintResults.get(`${duelId}:${userId}`);
    return r ? { ...r } : null;
  }

  async listResultsForUser(
    userId: string,
    skip: number,
    take: number,
    _tx?: unknown
  ): Promise<any[]> {
    return [...this.db.sprintResults.values()]
      .filter((r) => r.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(skip, skip + take)
      .map((r) => ({ ...r }));
  }

  async countResultsForUser(userId: string, _tx?: unknown): Promise<number> {
    return [...this.db.sprintResults.values()].filter((r) => r.userId === userId).length;
  }

  /** Phase 10 (docs/15): history filtered to one trading-duel type. */
  async listResultsForUserByType(
    userId: string,
    type: string,
    skip: number,
    take: number,
    _tx?: unknown
  ): Promise<any[]> {
    return [...this.db.sprintResults.values()]
      .filter((r) => r.userId === userId && this.db.duels.get(r.duelId)?.type === type)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(skip, skip + take)
      .map((r) => ({ ...r }));
  }

  /** Phase 10 (docs/15): count filtered to one trading-duel type. */
  async countResultsForUserByType(userId: string, type: string, _tx?: unknown): Promise<number> {
    return [...this.db.sprintResults.values()].filter(
      (r) => r.userId === userId && this.db.duels.get(r.duelId)?.type === type
    ).length;
  }

  async findUserById(id: string): Promise<any | null> {
    const u = this.db.users.get(id);
    return u ? { id: u.id, displayName: u.displayName ?? null } : null;
  }
}

// --- WeeklyRepository (Phase 11, docs/05 §1 T3 + docs/16) ------------------------

export class FakeWeeklyRepository {
  constructor(private readonly db: FakeDb) {}

  async createSeason(input: any, _tx?: unknown): Promise<any> {
    const row = {
      id: randomUUID(),
      status: 'OPEN',
      startedAt: null,
      endsAt: null,
      indexReturnPct: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...input,
    };
    this.db.weeklySeasons.set(row.id, row);
    return { ...row };
  }

  async findSeasonById(id: string, _tx?: unknown): Promise<any | null> {
    const r = this.db.weeklySeasons.get(id);
    return r ? { ...r } : null;
  }

  async findSeasonByWeekStart(weekStart: string, _tx?: unknown): Promise<any | null> {
    const r = [...this.db.weeklySeasons.values()].find((s) => s.weekStart === weekStart);
    return r ? { ...r } : null;
  }

  async listSeasons(_tx?: unknown): Promise<any[]> {
    return [...this.db.weeklySeasons.values()]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((r) => ({ ...r }));
  }

  async updateSeason(id: string, data: any, _tx?: unknown): Promise<any> {
    const r = this.db.weeklySeasons.get(id);
    Object.assign(r, data, { updatedAt: new Date() });
    return { ...r };
  }

  async countLeaguesForSeason(seasonId: string, _tx?: unknown): Promise<number> {
    return [...this.db.weeklyLeagues.values()].filter((l) => l.seasonId === seasonId).length;
  }

  async countMembershipsForSeason(seasonId: string, _tx?: unknown): Promise<number> {
    return [...this.db.weeklyMemberships.values()].filter((m) => m.seasonId === seasonId).length;
  }

  async createLeague(input: any, _tx?: unknown): Promise<any> {
    const row = { id: randomUUID(), createdAt: new Date(), ...input };
    this.db.weeklyLeagues.set(row.id, row);
    return { ...row };
  }

  async listLeaguesForSeason(seasonId: string, _tx?: unknown): Promise<any[]> {
    return [...this.db.weeklyLeagues.values()]
      .filter((l) => l.seasonId === seasonId)
      .sort((a, b) => a.leagueNumber - b.leagueNumber)
      .map((r) => ({ ...r }));
  }

  async createMembership(input: any, _tx?: unknown): Promise<any> {
    const row = {
      id: randomUUID(),
      leagueId: null,
      tier: 1,
      carried: false,
      joinedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      ...input,
    };
    this.db.weeklyMemberships.set(`${row.seasonId}:${row.userId}`, row);
    return { ...row };
  }

  async findMembership(seasonId: string, userId: string, _tx?: unknown): Promise<any | null> {
    const r = this.db.weeklyMemberships.get(`${seasonId}:${userId}`);
    return r ? { ...r } : null;
  }

  async listMembershipsForSeason(seasonId: string, _tx?: unknown): Promise<any[]> {
    return [...this.db.weeklyMemberships.values()]
      .filter((m) => m.seasonId === seasonId)
      .sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime())
      .map((r) => ({ ...r }));
  }

  async listMembershipsForLeague(leagueId: string, _tx?: unknown): Promise<any[]> {
    return [...this.db.weeklyMemberships.values()]
      .filter((m) => m.leagueId === leagueId)
      .sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime())
      .map((r) => ({ ...r }));
  }

  async listCarriedMemberships(seasonId: string, _tx?: unknown): Promise<any[]> {
    return [...this.db.weeklyMemberships.values()]
      .filter((m) => m.seasonId === seasonId && m.carried)
      .map((r) => ({ ...r }));
  }

  async updateMembership(id: string, data: any, _tx?: unknown): Promise<any> {
    const r = [...this.db.weeklyMemberships.values()].find((m) => m.id === id);
    Object.assign(r, data, { updatedAt: new Date() });
    return { ...r };
  }

  async findLatestResultForUser(userId: string, _tx?: unknown): Promise<any | null> {
    const rows = [...this.db.weeklyResults.values()]
      .filter((r) => r.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return rows[0] ? { ...rows[0] } : null;
  }

  async createTrade(input: any, _tx?: unknown): Promise<any> {
    const row = { id: randomUUID(), ...input };
    this.db.weeklyTrades.push(row);
    return { ...row };
  }

  async findTradeByClientOrderId(
    seasonId: string,
    userId: string,
    clientOrderId: string,
    _tx?: unknown
  ): Promise<any | null> {
    const r = this.db.weeklyTrades.find(
      (t) => t.seasonId === seasonId && t.userId === userId && t.clientOrderId === clientOrderId
    );
    return r ? { ...r } : null;
  }

  async listTradesForSeasonUser(seasonId: string, userId: string, _tx?: unknown): Promise<any[]> {
    return this.db.weeklyTrades
      .filter((t) => t.seasonId === seasonId && t.userId === userId)
      .sort((a, b) => a.executedAt.getTime() - b.executedAt.getTime())
      .map((r) => ({ ...r }));
  }

  async countTradesForSeasonUser(seasonId: string, userId: string, _tx?: unknown): Promise<number> {
    return this.db.weeklyTrades.filter((t) => t.seasonId === seasonId && t.userId === userId)
      .length;
  }

  async createResult(input: any, _tx?: unknown): Promise<any> {
    const row = { id: randomUUID(), createdAt: new Date(), ...input };
    this.db.weeklyResults.set(`${input.seasonId}:${input.userId}`, row);
    return { ...row };
  }

  async findResult(seasonId: string, userId: string, _tx?: unknown): Promise<any | null> {
    const r = this.db.weeklyResults.get(`${seasonId}:${userId}`);
    return r ? { ...r } : null;
  }

  async listResultsForLeague(leagueId: string, _tx?: unknown): Promise<any[]> {
    return [...this.db.weeklyResults.values()]
      .filter((r) => r.leagueId === leagueId)
      .sort((a, b) => a.rank - b.rank)
      .map((r) => ({ ...r }));
  }

  async listResultsForUser(
    userId: string,
    skip: number,
    take: number,
    _tx?: unknown
  ): Promise<any[]> {
    return [...this.db.weeklyResults.values()]
      .filter((r) => r.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(skip, skip + take)
      .map((r) => ({ ...r }));
  }

  async countResultsForUser(userId: string, _tx?: unknown): Promise<number> {
    return [...this.db.weeklyResults.values()].filter((r) => r.userId === userId).length;
  }

  async findUserById(id: string): Promise<any | null> {
    const u = this.db.users.get(id);
    return u ? { id: u.id, displayName: u.displayName ?? null } : null;
  }
}

// --- SimulatorRepository (Phase 2, ADR 0003) -------------------------------------

export class FakeSimulatorRepository {
  constructor(private readonly db: FakeDb) {}

  async listActiveInstruments(): Promise<any[]> {
    return [...this.db.instruments.values()].filter((i) => i.active);
  }

  async findInstrumentById(id: string): Promise<any | null> {
    return this.db.instruments.get(id) ?? null;
  }

  async getOrCreatePortfolio(userId: string, startingCash: Prisma.Decimal): Promise<any> {
    let p = this.db.portfoliosByUser.get(userId);
    if (!p) {
      p = { id: randomUUID(), userId, cash: new Prisma.Decimal(startingCash) };
      this.db.portfolios.set(p.id, p);
      this.db.portfoliosByUser.set(userId, p);
    }
    return { ...p, cash: new Prisma.Decimal(p.cash) };
  }

  async updateCash(portfolioId: string, cash: Prisma.Decimal): Promise<void> {
    const p = this.db.portfolios.get(portfolioId);
    p.cash = new Prisma.Decimal(cash);
  }

  async listHoldings(portfolioId: string): Promise<any[]> {
    return [...this.db.holdings.values()]
      .filter((h) => h.portfolioId === portfolioId)
      .map((h) => ({
        ...h,
        quantity: new Prisma.Decimal(h.quantity),
        avgCost: new Prisma.Decimal(h.avgCost),
      }));
  }

  async findHolding(portfolioId: string, instrumentId: string): Promise<any | null> {
    const h = this.db.holdings.get(`${portfolioId}:${instrumentId}`);
    return h
      ? { ...h, quantity: new Prisma.Decimal(h.quantity), avgCost: new Prisma.Decimal(h.avgCost) }
      : null;
  }

  async upsertHolding(
    portfolioId: string,
    instrumentId: string,
    quantity: Prisma.Decimal,
    avgCost: Prisma.Decimal
  ): Promise<void> {
    this.db.holdings.set(`${portfolioId}:${instrumentId}`, {
      portfolioId,
      instrumentId,
      quantity: new Prisma.Decimal(quantity),
      avgCost: new Prisma.Decimal(avgCost),
    });
  }

  async deleteHolding(portfolioId: string, instrumentId: string): Promise<void> {
    this.db.holdings.delete(`${portfolioId}:${instrumentId}`);
  }

  async createOrder(input: {
    portfolioId: string;
    instrumentId: string;
    side: string;
    quantity: Prisma.Decimal;
    price: Prisma.Decimal;
    totalValue: Prisma.Decimal;
    idempotencyKey: string;
  }): Promise<any> {
    const order = { id: randomUUID(), createdAt: new Date(), ...input };
    this.db.orders.set(order.id, order);
    this.db.ordersByKey.set(input.idempotencyKey, order);
    return { ...order };
  }

  async findOrderByIdempotencyKey(key: string): Promise<any | null> {
    return this.db.ordersByKey.get(key) ?? null;
  }

  async listOrders(portfolioId: string, skip: number, take: number): Promise<any[]> {
    return [...this.db.orders.values()]
      .filter((o) => o.portfolioId === portfolioId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(skip, skip + take)
      .map((o) => ({ ...o }));
  }

  async countOrders(portfolioId: string): Promise<number> {
    return [...this.db.orders.values()].filter((o) => o.portfolioId === portfolioId).length;
  }
}

// --- OnboardingRepository (docs/03) ----------------------------------------------

export class FakeOnboardingRepository {
  constructor(private readonly db: FakeDb) {}

  private versionQuestions(versionId: string, withAnswers: boolean): any[] {
    return sortedByOrder(
      [...this.db.assessmentQuestions.values()].filter((q) => q.versionId === versionId)
    ).map((q) => ({
      id: q.id,
      topicKey: q.topicKey,
      difficulty: q.difficulty,
      kind: q.kind,
      text: q.text,
      ...(withAnswers ? { explanation: q.explanation } : {}),
      order: q.order,
      options: sortedByOrder(
        [...this.db.assessmentOptions.values()].filter((o) => o.questionId === q.id)
      ).map((o) =>
        withAnswers
          ? { id: o.id, text: o.text, order: o.order, isCorrect: o.isCorrect }
          : { id: o.id, text: o.text, order: o.order }
      ),
    }));
  }

  private toAttemptRow(row: any): any {
    const version = this.db.assessmentVersions.get(row.versionId);
    return { ...row, trackId: version.trackId, questionIds: [...row.questionIds] };
  }

  async getPublishedVersion(trackSlug: string): Promise<any | null> {
    const track = [...this.db.tracks.values()].find((t) => t.slug === trackSlug);
    if (!track) return null;
    const version = [...this.db.assessmentVersions.values()]
      .filter((v) => v.trackId === track.id && v.status === ContentStatus.PUBLISHED)
      .sort((a, b) => b.version - a.version)[0];
    if (!version) return null;
    return {
      id: version.id,
      version: version.version,
      trackId: version.trackId,
      questions: this.versionQuestions(version.id, false),
    };
  }

  async getBank(): Promise<any[]> {
    return [...this.db.assessmentVersions.values()]
      .sort((a, b) => b.version - a.version)
      .map((v) => ({
        id: v.id,
        version: v.version,
        trackId: v.trackId,
        questions: this.versionQuestions(v.id, true),
      }));
  }

  async getVersionQuestionsForGrading(versionId: string): Promise<any[]> {
    return this.versionQuestions(versionId, true).map((q) => ({
      ...q,
      correctOptionIds: q.options.filter((o: any) => o.isCorrect).map((o: any) => o.id),
    }));
  }

  async getVersion(versionId: string): Promise<any | null> {
    const v = this.db.assessmentVersions.get(versionId);
    return v ? { id: v.id, version: v.version, trackId: v.trackId } : null;
  }

  async createAttempt(data: {
    userId: string;
    versionId: string;
    questionIds: string[];
  }): Promise<any> {
    const row = {
      id: randomUUID(),
      userId: data.userId,
      versionId: data.versionId,
      questionIds: [...data.questionIds],
      status: 'IN_PROGRESS',
      startedAt: new Date(),
      submittedAt: null,
      idempotencyKey: null,
    };
    this.db.assessmentAttempts.set(row.id, row);
    return this.toAttemptRow(row);
  }

  async getAttempt(attemptId: string): Promise<any | null> {
    const row = this.db.assessmentAttempts.get(attemptId);
    return row ? this.toAttemptRow(row) : null;
  }

  async findResumableAttempt(userId: string, versionId: string, since: Date): Promise<any | null> {
    const rows = [...this.db.assessmentAttempts.values()]
      .filter(
        (r) =>
          r.userId === userId &&
          r.versionId === versionId &&
          r.status === 'IN_PROGRESS' &&
          r.startedAt > since
      )
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
    return rows[0] ? this.toAttemptRow(rows[0]) : null;
  }

  async countSubmittedAttempts(userId: string, versionId: string): Promise<number> {
    return [...this.db.assessmentAttempts.values()].filter(
      (r) => r.userId === userId && r.versionId === versionId && r.status === 'SUBMITTED'
    ).length;
  }

  async latestSubmittedAttempt(userId: string, versionId: string): Promise<any | null> {
    const rows = [...this.db.assessmentAttempts.values()]
      .filter((r) => r.userId === userId && r.versionId === versionId && r.status === 'SUBMITTED')
      .sort((a, b) => (b.submittedAt?.getTime() ?? 0) - (a.submittedAt?.getTime() ?? 0));
    return rows[0] ? this.toAttemptRow(rows[0]) : null;
  }

  async submitAttemptTx(tx: any, data: any): Promise<{ submittedAt: Date; resultId: string }> {
    const attempt = this.db.assessmentAttempts.get(data.attemptId);
    attempt.status = 'SUBMITTED';
    attempt.submittedAt = new Date();
    attempt.idempotencyKey = data.idempotencyKey;
    for (const a of data.answers) {
      this.db.assessmentAnswers.push({ id: randomUUID(), attemptId: data.attemptId, ...a });
    }
    const result = {
      id: randomUUID(),
      attemptId: data.attemptId,
      userId: data.userId,
      topicLevels: data.topicLevels,
      overallLevel: data.overallLevel,
      placementKind: data.placementKind,
      recommendedStartModuleOrder: data.recommendedStartModuleOrder,
      placementChoice: null,
      placedAt: null,
      createdAt: new Date(),
    };
    this.db.assessmentResults.set(result.id, result);
    this.db.userKnowledgeProfiles.set(data.userId, {
      userId: data.userId,
      versionId: data.versionId,
      attemptId: data.attemptId,
      topicLevels: data.topicLevels,
      overallLevel: data.overallLevel,
      computedAt: new Date(),
    });
    return { submittedAt: attempt.submittedAt, resultId: result.id };
  }

  async getLatestResult(userId: string): Promise<any | null> {
    const rows = [...this.db.assessmentResults.values()]
      .filter((r) => r.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return rows[0] ?? null;
  }

  async acceptPlacementTx(
    tx: any,
    data: { resultId: string; choice: string; waiver?: any }
  ): Promise<void> {
    const result = this.db.assessmentResults.get(data.resultId);
    result.placementChoice = data.choice;
    result.placedAt = new Date();
    if (data.waiver) {
      this.db.placementWaivers.set(`${data.waiver.userId}:${data.waiver.trackId}`, {
        ...data.waiver,
        createdAt: new Date(),
      });
    }
  }

  async updateProfileChoice(tx: any, userId: string, choice: string): Promise<void> {
    const profile = this.db.userKnowledgeProfiles.get(userId);
    if (!profile) return;
    profile.topicLevels = {
      ...profile.topicLevels,
      placement: { ...profile.topicLevels.placement, userChoice: choice },
    };
  }

  async getWaiver(userId: string, trackId: string, _tx?: any): Promise<any | null> {
    const w = this.db.placementWaivers.get(`${userId}:${trackId}`);
    return w ? { waivedUpToModuleOrder: w.waivedUpToModuleOrder } : null;
  }

  async abandonAttempt(attemptId: string): Promise<void> {
    const row = this.db.assessmentAttempts.get(attemptId);
    if (row) row.status = 'ABANDONED';
  }

  async getProfile(userId: string): Promise<any | null> {
    return this.db.userKnowledgeProfiles.get(userId) ?? null;
  }
}

// --- RatingsRepository (Phase 3, docs/04) ------------------------------------------

export class FakeRatingsRepository {
  constructor(private readonly db: FakeDb) {}

  async findUserById(id: string): Promise<any | null> {
    const u = this.db.users.get(id);
    return u
      ? { id: u.id, displayName: u.displayName ?? null, countryCode: u.countryCode ?? null }
      : null;
  }

  async findUsersByIds(ids: string[]): Promise<any[]> {
    return ids
      .map((id) => this.db.users.get(id))
      .filter(Boolean)
      .map((u) => ({
        id: u.id,
        displayName: u.displayName ?? null,
        countryCode: u.countryCode ?? null,
      }));
  }

  async findRating(userId: string, kind: string): Promise<any | null> {
    const r = this.db.userRatings.get(`${userId}:${kind}`);
    return r ? { ...r } : null;
  }

  async findRatingsByUserIds(kind: string, userIds: string[]): Promise<any[]> {
    return userIds
      .map((id) => this.db.userRatings.get(`${id}:${kind}`))
      .filter(Boolean)
      .map((r) => ({ ...r }));
  }

  async listAllRatings(kind?: string): Promise<any[]> {
    return [...this.db.userRatings.values()]
      .filter((r) => !kind || r.kind === kind)
      .map((r) => ({ ...r }));
  }

  async getOrCreateRating(
    userId: string,
    kind: string,
    season: string,
    countryCode: string | null
  ): Promise<any> {
    const key = `${userId}:${kind}`;
    let row = this.db.userRatings.get(key);
    if (!row) {
      row = {
        userId,
        kind,
        rating: 1000,
        gamesPlayed: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        provisional: true,
        lastRatedAt: null,
        season,
        countryCode,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.db.userRatings.set(key, row);
    }
    return { ...row };
  }

  async saveRating(userId: string, kind: string, data: any): Promise<any> {
    const row = this.db.userRatings.get(`${userId}:${kind}`);
    if (!row) throw new Error('rating not found');
    Object.assign(row, data, { updatedAt: new Date() });
    return { ...row };
  }

  async updateCountryForUser(userId: string, countryCode: string | null): Promise<void> {
    for (const r of this.db.userRatings.values()) {
      if (r.userId === userId) r.countryCode = countryCode;
    }
  }

  async createHistory(input: any): Promise<any> {
    const row = {
      id: randomUUID(),
      createdAt: new Date(),
      seq: ++this.db.ratingHistorySeq,
      ...input,
      opponentId: input.opponentId ?? null,
      opponentRating: input.opponentRating ?? null,
      weekStart: input.weekStart ?? null,
    };
    this.db.ratingHistory.push(row);
    return { ...row };
  }

  async findHistoryByEventId(userId: string, eventId: string): Promise<any | null> {
    return this.db.ratingHistory.find((h) => h.userId === userId && h.eventId === eventId) ?? null;
  }

  async findTradingWeek(userId: string, weekStart: Date): Promise<any | null> {
    return (
      this.db.ratingHistory.find(
        (h) =>
          h.userId === userId &&
          h.kind === 'TRADING' &&
          h.source === 'TRADING_WEEK' &&
          h.weekStart?.getTime() === weekStart.getTime()
      ) ?? null
    );
  }

  async listHistory(
    userId: string,
    kind: string | undefined,
    skip: number,
    take: number
  ): Promise<any[]> {
    return this.db.ratingHistory
      .filter((h) => h.userId === userId && (!kind || h.kind === kind))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.seq - a.seq)
      .slice(skip, skip + take)
      .map((h) => ({ ...h }));
  }

  async countHistory(userId: string, kind: string | undefined): Promise<number> {
    return this.db.ratingHistory.filter((h) => h.userId === userId && (!kind || h.kind === kind))
      .length;
  }

  async countEventsSince(userId: string, since: Date): Promise<number> {
    return this.db.ratingHistory.filter((h) => h.userId === userId && h.createdAt >= since).length;
  }

  async countPairDuelsSince(userId: string, opponentId: string, since: Date): Promise<number> {
    return this.db.ratingHistory.filter(
      (h) =>
        h.kind === 'LEARNING' &&
        h.source === 'DUEL' &&
        h.createdAt >= since &&
        ((h.userId === userId && h.opponentId === opponentId) ||
          (h.userId === opponentId && h.opponentId === userId))
    ).length;
  }

  async lastPairDuel(userId: string, opponentId: string): Promise<any | null> {
    const rows = this.db.ratingHistory
      .filter(
        (h) =>
          h.kind === 'LEARNING' &&
          h.source === 'DUEL' &&
          ((h.userId === userId && h.opponentId === opponentId) ||
            (h.userId === opponentId && h.opponentId === userId))
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.seq - a.seq);
    return rows[0] ? { ...rows[0] } : null;
  }

  /** Phase 9 (ADR 0011 §6): TRADING-only pair counters, so learning duels never consume sprint caps. */
  async countPairTradingDuelsSince(
    userId: string,
    opponentId: string,
    since: Date
  ): Promise<number> {
    return this.db.ratingHistory.filter(
      (h) =>
        h.kind === 'TRADING' &&
        h.source === 'DUEL' &&
        h.createdAt >= since &&
        ((h.userId === userId && h.opponentId === opponentId) ||
          (h.userId === opponentId && h.opponentId === userId))
    ).length;
  }

  async lastPairTradingDuel(userId: string, opponentId: string): Promise<any | null> {
    const rows = this.db.ratingHistory
      .filter(
        (h) =>
          h.kind === 'TRADING' &&
          h.source === 'DUEL' &&
          ((h.userId === userId && h.opponentId === opponentId) ||
            (h.userId === opponentId && h.opponentId === userId))
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.seq - a.seq);
    return rows[0] ? { ...rows[0] } : null;
  }
}

// --- QuestionBankRepository (Phase 3, docs/05 §2) ----------------------------------

export class FakeQuestionBankRepository {
  constructor(private readonly db: FakeDb) {}

  private withOptions(row: any): any {
    return {
      ...row,
      options: [...this.db.duelBankOptions.values()]
        .filter((o) => o.itemId === row.id)
        .sort((a, b) => a.order - b.order)
        .map((o) => ({ ...o })),
    };
  }

  async createItem(input: any, _tx?: unknown): Promise<any> {
    const row = {
      id: randomUUID(),
      language: 'en',
      sourceLessonId: null,
      status: input.status ?? 'DRAFT',
      version: input.version ?? 1,
      templateId: input.templateId ?? null,
      parameters: input.parameters ?? null,
      authorId: input.authorId,
      reviewerId: null,
      publishedAt: null,
      pilotAnswers: 0,
      pilotCorrect: 0,
      correctRate: null,
      discrimination: null,
      exposureCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...input,
    };
    this.db.duelBankItems.set(row.id, row);
    const options = input.options.map((o: any, i: number) => {
      const opt = {
        id: randomUUID(),
        itemId: row.id,
        text: o.text,
        isCorrect: o.isCorrect,
        points: o.points ?? 0,
        consequence: o.consequence ?? null,
        order: o.order ?? i,
      };
      this.db.duelBankOptions.set(opt.id, opt);
      return { ...opt };
    });
    return { ...row, options };
  }

  async findItemById(id: string, _tx?: unknown): Promise<any | null> {
    const r = this.db.duelBankItems.get(id);
    return r ? this.withOptions(r) : null;
  }

  async findItemByKey(key: string, _tx?: unknown): Promise<any | null> {
    for (const r of this.db.duelBankItems.values()) {
      if (r.key === key) return this.withOptions(r);
    }
    return null;
  }

  /** Items by id, WITH answers — the duels module's grading seam (ADR 0006/4). */
  async findItemsByIds(ids: string[], _tx?: unknown): Promise<any[]> {
    return ids
      .map((id) => this.db.duelBankItems.get(id))
      .filter(Boolean)
      .map((r) => this.withOptions(r));
  }

  async listItems(filter: any, _tx?: unknown): Promise<{ items: any[]; total: number }> {
    const all = [...this.db.duelBankItems.values()].filter(
      (r) =>
        (!filter.status || r.status === filter.status) &&
        (!filter.topic || r.topic === filter.topic) &&
        (!filter.skill || r.skill === filter.skill) &&
        (!filter.type || r.type === filter.type) &&
        (filter.difficulty === undefined || r.difficulty === filter.difficulty) &&
        (!filter.language || r.language === filter.language)
    );
    return {
      total: all.length,
      items: all
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(filter.skip, filter.skip + filter.take)
        .map((r) => this.withOptions(r)),
    };
  }

  async updateItem(id: string, data: any, _tx?: unknown): Promise<any> {
    const r = this.db.duelBankItems.get(id);
    if (!r) throw new Error('item not found');
    Object.assign(r, data, { updatedAt: new Date() });
    return this.withOptions(r);
  }

  async listLiveItems(filter: any, _tx?: unknown): Promise<any[]> {
    return [...this.db.duelBankItems.values()]
      .filter(
        (r) =>
          r.status === 'LIVE' &&
          (!filter.topics || filter.topics.includes(r.topic)) &&
          (!filter.skills || filter.skills.includes(r.skill)) &&
          (!filter.types || filter.types.includes(r.type))
      )
      .map((r) => this.withOptions(r));
  }

  async countLiveByTopicDifficulty(_tx?: unknown): Promise<any[]> {
    const counts = new Map<string, number>();
    for (const r of this.db.duelBankItems.values()) {
      if (r.status !== 'LIVE') continue;
      const k = `${r.topic}:${r.difficulty}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return [...counts.entries()].map(([k, count]) => {
      const [topic, difficulty] = k.split(':');
      return { topic, difficulty: Number(difficulty), count };
    });
  }

  async incrementPilot(id: string, correct: boolean, _tx?: unknown): Promise<any> {
    const r = this.db.duelBankItems.get(id);
    if (!r) throw new Error('item not found');
    r.pilotAnswers += 1;
    if (correct) r.pilotCorrect += 1;
    r.correctRate = r.pilotAnswers > 0 ? r.pilotCorrect / r.pilotAnswers : null;
    return this.withOptions(r);
  }

  async findTemplateById(id: string, _tx?: unknown): Promise<any | null> {
    const t = this.db.duelBankTemplates.get(id);
    return t ? { ...t } : null;
  }

  async findTemplateByKey(key: string, _tx?: unknown): Promise<any | null> {
    for (const t of this.db.duelBankTemplates.values()) {
      if (t.key === key) return { ...t };
    }
    return null;
  }

  async listExposures(userIds: string[], _tx?: unknown): Promise<any[]> {
    return [...this.db.userQuestionExposures.values()]
      .filter((e) => userIds.includes(e.userId))
      .map((e) => ({ ...e }));
  }

  async recordExposures(
    userId: string,
    itemIds: string[],
    now: Date,
    _tx?: unknown
  ): Promise<void> {
    for (const bankItemId of itemIds) {
      const key = `${userId}:${bankItemId}`;
      const existing = this.db.userQuestionExposures.get(key);
      if (existing) {
        existing.lastSeenAt = now;
        existing.seenCount += 1;
      } else {
        this.db.userQuestionExposures.set(key, {
          userId,
          bankItemId,
          lastSeenAt: now,
          seenCount: 1,
        });
      }
      const item = this.db.duelBankItems.get(bankItemId);
      if (item) item.exposureCount += 1;
    }
  }

  async appendAudit(data: {
    actorId: string;
    action: string;
    entityType: string;
    entityId: string;
    before?: unknown;
    after?: unknown;
    ip?: string;
  }): Promise<void> {
    this.db.auditLogs.push({
      id: randomUUID(),
      createdAt: new Date(),
      before: data.before ?? null,
      after: data.after ?? null,
      ip: data.ip ?? null,
      ...data,
    });
  }
}
