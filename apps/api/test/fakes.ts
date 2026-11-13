/**
 * In-memory fakes for the Phase 1 e2e suite (ADR 0002/13).
 *
 * The API has no live Postgres/Redis in this environment, so every
 * Prisma-backed repository is replaced with a fake that implements the
 * same method surface against plain Maps. Services, guards,
 * interceptors, DTO validation, and the HTTP pipeline run for real.
 *
 * Fake classes are named `Fake*` to avoid colliding with the real class
 * tokens used in `overrideProvider(...)`.
 */
import { ContentStatus } from '@prisma/client';
import { randomUUID } from 'crypto';

// --- shared in-memory store ----------------------------------------------------

export class FakeDb {
  users = new Map<string, any>();
  emailTokens = new Map<string, any>();
  refreshTokens = new Map<string, any>();
  tracks = new Map<string, any>();
  modules = new Map<string, any>();
  lessons = new Map<string, any>();
  lessonVersions = new Map<string, any>();
  questions = new Map<string, any>();
  questionOptions = new Map<string, any>();
  quizAttempts = new Map<string, any>();
  attemptAnswers: any[] = [];
  lessonCompletions = new Map<string, any>(); // `${userId}:${lessonId}`
  completionsByKey = new Map<string, any>(); // idempotencyKey
  userLessonProgress = new Map<string, any>(); // `${userId}:${lessonId}`
  xpKeys = new Set<string>(); // `${userId}:${idempotencyKey}`
  xpLedger: any[] = [];
  userStats = new Map<string, any>();
  badges = new Map<string, any>(); // by slug
  badgesById = new Map<string, any>();
  userBadgeKeys = new Set<string>(); // `${userId}:${badgeId}`
  userBadgeRows: any[] = [];
  auditLogs: any[] = [];
  outbox: any[] = [];
  idempotency = new Map<string, any>(); // `${key}:${userId}` -> { response, expiresAt }
  // --- simulator (Phase 2) -------------------------------------------------------
  instruments = new Map<string, any>(); // by id
  portfolios = new Map<string, any>(); // by id
  portfoliosByUser = new Map<string, any>(); // userId -> portfolio
  holdings = new Map<string, any>(); // `${portfolioId}:${instrumentId}`
  orders = new Map<string, any>(); // by id
  ordersByKey = new Map<string, any>(); // idempotencyKey -> order
  // --- onboarding assessment (docs/03) -------------------------------------------
  assessmentVersions = new Map<string, any>(); // by id
  assessmentQuestions = new Map<string, any>(); // by id
  assessmentOptions = new Map<string, any>(); // by id
  assessmentAttempts = new Map<string, any>(); // by id
  assessmentAnswers: any[] = [];
  assessmentResults = new Map<string, any>(); // by id
  userKnowledgeProfiles = new Map<string, any>(); // userId -> profile
  placementWaivers = new Map<string, any>(); // `${userId}:${trackId}`
  // --- ratings (Phase 3, docs/04) --------------------------------------------------
  userRatings = new Map<string, any>(); // `${userId}:${kind}` -> rating row
  ratingHistory: any[] = []; // audit trail, insertion order (seq breaks createdAt ties)
  ratingHistorySeq = 0;
  // --- question bank (Phase 3, docs/05 §2) -------------------------------------------
  duelBankItems = new Map<string, any>(); // by id
  duelBankOptions = new Map<string, any>(); // by id
  duelBankTemplates = new Map<string, any>(); // by id
  userQuestionExposures = new Map<string, any>(); // `${userId}:${bankItemId}`
  // --- duels step 2 (Phase 4, docs/05 §1 + docs/07) --------------------------------
  duels = new Map<string, any>(); // by id
  duelAnswers: any[] = [];
  duelDailySets = new Map<string, any>(); // by IST date
  duelGameResults = new Map<string, any>(); // `${duelId}:${userId}`
  // --- friend challenge (Phase 12, docs/05 §1 P2 + docs/17) --------------------------
  challenges = new Map<string, any>(); // by id
  // --- paper trading sprint (Phase 9, docs/05 §1 T1 + docs/14) ----------------------
  sprintTrades: any[] = [];
  sprintResults = new Map<string, any>(); // `${duelId}:${userId}`
  // --- weekly portfolio battle (Phase 11, docs/05 §1 T3 + docs/16) -------------------
  weeklySeasons = new Map<string, any>(); // by id
  weeklyLeagues = new Map<string, any>(); // by id
  weeklyMemberships = new Map<string, any>(); // `${seasonId}:${userId}`
  weeklyTrades: any[] = [];
  weeklyResults = new Map<string, any>(); // `${seasonId}:${userId}`

  reset(): void {
    for (const v of Object.values(this)) {
      if (v instanceof Map || v instanceof Set) v.clear();
      else if (Array.isArray(v)) v.length = 0;
    }
  }
}

export function newUser(overrides: Record<string, any> = {}): any {
  return {
    id: randomUUID(),
    email: `user-${randomUUID()}@example.com`,
    passwordHash: 'hash',
    displayName: null,
    roles: ['LEARNER'],
    avatarKey: null,
    emailVerifiedAt: null,
    countryCode: null,
    countryCodeChangedAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

const sortedByOrder = <T extends { order: number }>(rows: T[]): T[] =>
  [...rows].sort((a, b) => a.order - b.order);

// --- AuthRepository ------------------------------------------------------------

export class FakeAuthRepository {
  constructor(private readonly db: FakeDb) {}

  async createUser(input: any): Promise<any> {
    const user = {
      id: randomUUID(),
      email: input.email,
      passwordHash: input.passwordHash,
      displayName: input.displayName ?? null,
      roles: input.roles,
      avatarKey: null,
      emailVerifiedAt: null,
      createdAt: new Date(),
    };
    this.db.users.set(user.id, user);
    return { ...user };
  }

  async findUserByEmail(email: string): Promise<any | null> {
    for (const u of this.db.users.values()) if (u.email === email) return { ...u };
    return null;
  }

  async findUserById(id: string): Promise<any | null> {
    const u = this.db.users.get(id);
    return u ? { ...u } : null;
  }

  async setEmailVerified(userId: string): Promise<void> {
    const u = this.db.users.get(userId);
    if (u) u.emailVerifiedAt = new Date();
  }

  async updatePassword(userId: string, passwordHash: string): Promise<void> {
    const u = this.db.users.get(userId);
    if (u) u.passwordHash = passwordHash;
  }

  async createEmailToken(input: {
    userId: string;
    type: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<void> {
    const tokenId = randomUUID();
    this.db.emailTokens.set(tokenId, { id: tokenId, usedAt: null, ...input });
  }

  async findValidEmailToken(tokenHash: string, type: string): Promise<any | null> {
    const now = new Date();
    for (const t of this.db.emailTokens.values()) {
      if (t.tokenHash === tokenHash && t.type === type && !t.usedAt && t.expiresAt > now) {
        const user = this.db.users.get(t.userId);
        return { ...t, user: user ? { ...user } : null };
      }
    }
    return null;
  }

  async markEmailTokenUsed(id: string): Promise<void> {
    const t = this.db.emailTokens.get(id);
    if (t) t.usedAt = new Date();
  }

  async deleteEmailTokens(userId: string, type: string): Promise<void> {
    for (const [id, t] of this.db.emailTokens) {
      if (t.userId === userId && t.type === type) this.db.emailTokens.delete(id);
    }
  }

  async createRefreshToken(input: {
    userId: string;
    familyId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<void> {
    const id = randomUUID();
    this.db.refreshTokens.set(id, {
      id,
      revokedAt: null,
      userAgent: null,
      ipAddress: null,
      ...input,
    });
  }

  async findRefreshTokenByHash(tokenHash: string): Promise<any | null> {
    for (const t of this.db.refreshTokens.values()) {
      if (t.tokenHash === tokenHash) {
        const user = this.db.users.get(t.userId);
        return { ...t, user: user ? { ...user } : null };
      }
    }
    return null;
  }

  async revokeRefreshToken(id: string): Promise<void> {
    const t = this.db.refreshTokens.get(id);
    if (t) t.revokedAt = new Date();
  }

  async revokeFamily(familyId: string): Promise<void> {
    for (const t of this.db.refreshTokens.values()) {
      if (t.familyId === familyId && !t.revokedAt) t.revokedAt = new Date();
    }
  }

  async revokeAllUserRefreshTokens(userId: string): Promise<void> {
    for (const t of this.db.refreshTokens.values()) {
      if (t.userId === userId && !t.revokedAt) t.revokedAt = new Date();
    }
  }
}

// --- UsersRepository -----------------------------------------------------------

const toPublic = (u: any) =>
  u
    ? { id: u.id, displayName: u.displayName, avatarKey: u.avatarKey, createdAt: u.createdAt }
    : null;
const toPrivate = (u: any) =>
  u
    ? {
        id: u.id,
        displayName: u.displayName,
        avatarKey: u.avatarKey,
        createdAt: u.createdAt,
        email: u.email,
        roles: u.roles,
        emailVerifiedAt: u.emailVerifiedAt,
        countryCode: u.countryCode ?? null,
        countryCodeChangedAt: u.countryCodeChangedAt ?? null,
      }
    : null;

export class FakeUsersRepository {
  constructor(private readonly db: FakeDb) {}

  async findPublicById(id: string): Promise<any | null> {
    return toPublic(this.db.users.get(id));
  }

  async findPrivateById(id: string): Promise<any | null> {
    return toPrivate(this.db.users.get(id));
  }

  async findById(id: string): Promise<any | null> {
    const u = this.db.users.get(id);
    return u ? { id: u.id, email: u.email } : null;
  }

  async findByEmail(email: string): Promise<any | null> {
    for (const u of this.db.users.values()) {
      if (u.email === email) return { id: u.id, email: u.email };
    }
    return null;
  }

  async updateProfile(
    id: string,
    data: {
      displayName?: string | null;
      countryCode?: string | null;
      countryCodeChangedAt?: Date | null;
    }
  ): Promise<any> {
    const u = this.db.users.get(id);
    if (!u) throw new Error('user not found');
    if (data.displayName !== undefined) u.displayName = data.displayName;
    if (data.countryCode !== undefined) u.countryCode = data.countryCode;
    if (data.countryCodeChangedAt !== undefined) u.countryCodeChangedAt = data.countryCodeChangedAt;
    return toPrivate(u);
  }

  async setAvatarKey(id: string, avatarKey: string | null): Promise<void> {
    const u = this.db.users.get(id);
    if (u) u.avatarKey = avatarKey;
  }
}

// --- LearningRepository --------------------------------------------------------

export class FakeLearningRepository {
  constructor(private readonly db: FakeDb) {}

  async getPublishedTrackTree(): Promise<any[]> {
    const tracks = sortedByOrder(
      [...this.db.tracks.values()].filter((t) => t.status === ContentStatus.PUBLISHED)
    );
    return tracks.map((t) => ({
      id: t.id,
      slug: t.slug,
      title: t.title,
      description: t.description,
      order: t.order,
      modules: sortedByOrder(
        [...this.db.modules.values()].filter(
          (m) => m.trackId === t.id && m.status === ContentStatus.PUBLISHED
        )
      ).map((m) => ({
        id: m.id,
        title: m.title,
        description: m.description,
        order: m.order,
        lessons: sortedByOrder(
          [...this.db.lessons.values()].filter((l) => l.moduleId === m.id)
        ).map((l) => {
          const published = sortedByOrder(
            [...this.db.lessonVersions.values()].filter(
              (v) => v.lessonId === l.id && v.status === ContentStatus.PUBLISHED
            )
          ).reverse()[0];
          return {
            id: l.id,
            title: l.title,
            order: l.order,
            published: published
              ? {
                  id: published.id,
                  version: published.version,
                  title: published.title,
                  questionCount: [...this.db.questions.values()].filter(
                    (q) => q.lessonVersionId === published.id
                  ).length,
                }
              : null,
          };
        }),
      })),
    }));
  }

  async getTrackLessonOrder(trackId: string): Promise<string[]> {
    const modules = sortedByOrder(
      [...this.db.modules.values()].filter((m) => m.trackId === trackId)
    );
    const ids: string[] = [];
    for (const m of modules) {
      for (const l of sortedByOrder(
        [...this.db.lessons.values()].filter((x) => x.moduleId === m.id)
      )) {
        ids.push(l.id);
      }
    }
    return ids;
  }

  async getLessonWithTrack(lessonId: string): Promise<any | null> {
    const lesson = this.db.lessons.get(lessonId);
    if (!lesson) return null;
    const module = this.db.modules.get(lesson.moduleId);
    const track = module ? this.db.tracks.get(module.trackId) : null;
    return { ...lesson, module: module ? { ...module, track } : null };
  }

  async getPublishedVersion(lessonId: string): Promise<any | null> {
    const published = sortedByOrder(
      [...this.db.lessonVersions.values()].filter(
        (v) => v.lessonId === lessonId && v.status === ContentStatus.PUBLISHED
      )
    ).reverse()[0];
    if (!published) return null;
    const questions = sortedByOrder(
      [...this.db.questions.values()].filter((q) => q.lessonVersionId === published.id)
    ).map((q) => ({
      ...q,
      options: sortedByOrder(
        [...this.db.questionOptions.values()].filter((o) => o.questionId === q.id)
      ),
    }));
    return { ...published, questions };
  }

  async findCompletion(userId: string, lessonId: string): Promise<any | null> {
    return this.db.lessonCompletions.get(`${userId}:${lessonId}`) ?? null;
  }

  async findCompletionByKey(idempotencyKey: string): Promise<any | null> {
    return this.db.completionsByKey.get(idempotencyKey) ?? null;
  }

  async createCompletion(data: {
    userId: string;
    lessonId: string;
    lessonVersionId: string;
    quizAttemptId?: string;
    idempotencyKey: string;
  }): Promise<any> {
    const row = { id: randomUUID(), completedAt: new Date(), ...data };
    this.db.lessonCompletions.set(`${data.userId}:${data.lessonId}`, row);
    this.db.completionsByKey.set(data.idempotencyKey, row);
    return row;
  }

  async upsertProgress(userId: string, lessonId: string, status: string): Promise<void> {
    this.db.userLessonProgress.set(`${userId}:${lessonId}`, {
      userId,
      lessonId,
      status,
      updatedAt: new Date(),
    });
  }

  async getCompletedLessonIds(userId: string): Promise<Set<string>> {
    const ids = new Set<string>();
    for (const c of this.db.lessonCompletions.values()) {
      if (c.userId === userId) ids.add(c.lessonId);
    }
    return ids;
  }

  async countCompletionsInTrack(userId: string, trackId: string): Promise<number> {
    let n = 0;
    for (const c of this.db.lessonCompletions.values()) {
      if (c.userId !== userId) continue;
      const lesson = this.db.lessons.get(c.lessonId);
      const module = lesson ? this.db.modules.get(lesson.moduleId) : null;
      if (module?.trackId === trackId) n += 1;
    }
    return n;
  }

  /** Module order of a lesson's module (ADR 0004: onboarding waiver consult). */
  async getLessonModuleOrder(lessonId: string, _tx?: unknown): Promise<number | null> {
    const lesson = this.db.lessons.get(lessonId);
    const module = lesson ? this.db.modules.get(lesson.moduleId) : null;
    return module ? module.order : null;
  }

  async countLessonsInTrack(trackId: string): Promise<number> {
    let n = 0;
    for (const l of this.db.lessons.values()) {
      const module = this.db.modules.get(l.moduleId);
      if (module?.trackId === trackId) n += 1;
    }
    return n;
  }
}
