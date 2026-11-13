import { ChallengeStatus, DuelType } from '@prisma/client';
import { ErrorCode } from '@candle/shared';
import { AppError } from '../../common/errors/app-error';
import { FriendChallengeService } from './friend-challenge.service';
import type { ChallengeRow } from './friend-challenge.repository';

/**
 * FriendChallengeService — Phase 12 (docs/17, ADR 0014).
 * In-memory fakes for every collaborator; no Nest testing module,
 * no Prisma, no Redis. The engines are recording stubs: accept must
 * call createLiveDuel / createSprint / createCrisis with the creator
 * as playerA and the invitee as playerB.
 */

const NOW = new Date('2026-11-13T10:00:00.000Z');
const CREATOR = '11111111-1111-4111-8111-111111111111';
const INVITEE = '22222222-2222-4222-8222-222222222222';
const THIRD = '33333333-3333-4333-8333-333333333333';

function errCode(p: Promise<unknown>): Promise<ErrorCode | 'NO_ERROR'> {
  return p.then(
    () => 'NO_ERROR' as const,
    (e: unknown) => (e instanceof AppError ? e.code : 'NO_ERROR')
  );
}

function makeRepo() {
  const rows = new Map<string, ChallengeRow>();
  let seq = 0;
  return {
    rows,
    async create(input: {
      creatorId: string;
      inviteeId: string;
      duelType: DuelType;
      inviteCode: string;
      expiresAt: Date;
    }): Promise<ChallengeRow> {
      seq += 1;
      const row: ChallengeRow = {
        id: `challenge-${seq}`,
        status: ChallengeStatus.PENDING,
        duelId: null,
        createdAt: new Date(NOW),
        updatedAt: new Date(NOW),
        ...input,
      };
      rows.set(row.id, row);
      return { ...row };
    },
    async findById(id: string): Promise<ChallengeRow | null> {
      const r = rows.get(id);
      return r ? { ...r } : null;
    },
    async findByInviteCode(code: string): Promise<ChallengeRow | null> {
      for (const r of rows.values()) if (r.inviteCode === code) return { ...r };
      return null;
    },
    async findBlockingBetween(
      a: string,
      b: string,
      duelType: DuelType
    ): Promise<ChallengeRow | null> {
      for (const r of rows.values()) {
        if (
          r.duelType === duelType &&
          (r.status === ChallengeStatus.PENDING || r.status === ChallengeStatus.ACCEPTED) &&
          ((r.creatorId === a && r.inviteeId === b) || (r.creatorId === b && r.inviteeId === a))
        ) {
          return { ...r };
        }
      }
      return null;
    },
    async listPendingIncoming(userId: string): Promise<ChallengeRow[]> {
      return [...rows.values()]
        .filter((r) => r.inviteeId === userId && r.status === ChallengeStatus.PENDING)
        .map((r) => ({ ...r }));
    },
    async listPendingOutgoing(userId: string): Promise<ChallengeRow[]> {
      return [...rows.values()]
        .filter((r) => r.creatorId === userId && r.status === ChallengeStatus.PENDING)
        .map((r) => ({ ...r }));
    },
    async update(
      id: string,
      data: { status?: ChallengeStatus; duelId?: string | null }
    ): Promise<ChallengeRow> {
      const r = rows.get(id);
      if (!r) throw new Error('challenge not found');
      Object.assign(r, data, { updatedAt: new Date(NOW) });
      return { ...r };
    },
  };
}

function makeWorld() {
  const repo = makeRepo();
  const users = new Map<string, { id: string; displayName: string | null }>([
    [CREATOR, { id: CREATOR, displayName: 'Creator' }],
    [INVITEE, { id: INVITEE, displayName: 'Invitee' }],
    [THIRD, { id: THIRD, displayName: 'Third' }],
  ]);
  const ratings = new Map<string, number>([
    [CREATOR, 1200],
    [INVITEE, 1100],
    [THIRD, 1000],
  ]);
  const activeLive = new Set<string>();
  const activeTrading = new Map<string, DuelType>();
  const lastDuel = new Map<string, { finishedAt: Date | null }>();
  const redisCounts = new Map<string, number>();
  const liveCalls: Array<{ a: string; b: string; variant: string }> = [];
  const sprintCalls: Array<{ a: string; b: string; kind: string }> = [];
  let duelSeq = 0;
  let liveShouldFail = false;

  const duelsRepo = {
    async findUserById(id: string) {
      const u = users.get(id);
      return u ? { ...u } : null;
    },
    async findActiveLiveDuelForUser(userId: string) {
      return activeLive.has(userId) ? { id: 'active-live' } : null;
    },
    async findLastLiveDuelBetween(a: string, b: string, _type: DuelType) {
      return lastDuel.get(`${a}:${b}`) ?? lastDuel.get(`${b}:${a}`) ?? null;
    },
  };
  const sprintRepo = {
    async findUserById(id: string) {
      const u = users.get(id);
      return u ? { ...u } : null;
    },
    async findActiveTradingDuelForUser(userId: string, type: DuelType) {
      return activeTrading.get(userId) === type ? { id: 'active-trading' } : null;
    },
    async findLastTradingDuelBetween(a: string, b: string, _type: DuelType) {
      return lastDuel.get(`${a}:${b}`) ?? lastDuel.get(`${b}:${a}`) ?? null;
    },
  };
  const ratingsService = {
    async getUserRatings(userId: string) {
      const rating = ratings.get(userId) ?? 1000;
      return {
        userId,
        learning: { rating },
        trading: { rating },
      } as never;
    },
  };
  const liveEngine = {
    async createLiveDuel(a: any, b: any, _now: Date, variant: string) {
      if (liveShouldFail) throw new Error('engine boom');
      duelSeq += 1;
      liveCalls.push({ a: a.userId, b: b.userId, variant });
      return { duelId: `duel-${duelSeq}` };
    },
  };
  const sprintEngine = {
    async createSprint(a: any, b: any) {
      duelSeq += 1;
      sprintCalls.push({ a: a.userId, b: b.userId, kind: 'SPRINT' });
      return { duelId: `duel-${duelSeq}` };
    },
    async createCrisis(a: any, b: any) {
      duelSeq += 1;
      sprintCalls.push({ a: a.userId, b: b.userId, kind: 'CRISIS' });
      return { duelId: `duel-${duelSeq}` };
    },
  };
  const redis = {
    async incr(key: string) {
      const n = (redisCounts.get(key) ?? 0) + 1;
      redisCounts.set(key, n);
      return n;
    },
    async expire(_key: string, _sec: number) {
      return 1;
    },
  };
  const logger = { info(): void {}, error(): void {}, warn(): void {} };
  const service = new FriendChallengeService(
    repo as never,
    duelsRepo as never,
    sprintRepo as never,
    ratingsService as never,
    liveEngine as never,
    sprintEngine as never,
    redis as never,
    logger as never
  );
  return {
    service,
    repo,
    users,
    activeLive,
    activeTrading,
    lastDuel,
    liveCalls,
    sprintCalls,
    failLive() {
      liveShouldFail = true;
    },
  };
}

describe('FriendChallengeService', () => {
  it('create: PENDING, 24 h expiry, 16-hex invite code, both Ratings shown', async () => {
    const w = makeWorld();
    const view = await w.service.createChallenge(
      CREATOR,
      { opponentId: INVITEE, duelType: 'LIVE' },
      NOW
    );
    expect(view.status).toBe(ChallengeStatus.PENDING);
    expect(view.duelType).toBe('LIVE');
    expect(view.rated).toBe(true);
    expect(view.ratingKind).toBe('LEARNING');
    expect(view.creator).toEqual({ userId: CREATOR, displayName: 'Creator', rating: 1200 });
    expect(view.invitee).toEqual({ userId: INVITEE, displayName: 'Invitee', rating: 1100 });
    expect(view.expiresAt.toISOString()).toBe('2026-11-14T10:00:00.000Z');
    expect(view.expiresInMs).toBe(24 * 60 * 60 * 1000);
    expect(view.inviteCode).toMatch(/^[0-9a-f]{16}$/);
    expect(view.inviteLink).toBe(`/duels/challenge?code=${view.inviteCode}`);
    expect(view.duelId).toBeNull();
    expect(view.playUrl).toBeNull();
  });

  it('create: trading challenge shows the Trading Rating kind', async () => {
    const w = makeWorld();
    const view = await w.service.createChallenge(
      CREATOR,
      { opponentId: INVITEE, duelType: 'SPRINT' },
      NOW
    );
    expect(view.ratingKind).toBe('TRADING');
  });

  it('create: challenging yourself is a validation error', async () => {
    const w = makeWorld();
    expect(
      await errCode(
        w.service.createChallenge(CREATOR, { opponentId: CREATOR, duelType: 'LIVE' }, NOW)
      )
    ).toBe(ErrorCode.VALIDATION_FAILED);
  });

  it('create: unknown opponent is 404', async () => {
    const w = makeWorld();
    expect(
      await errCode(
        w.service.createChallenge(
          CREATOR,
          { opponentId: '99999999-9999-4999-8999-999999999999', duelType: 'LIVE' },
          NOW
        )
      )
    ).toBe(ErrorCode.NOT_FOUND);
  });

  it('create: a second pending challenge for the same pair + type is 409, in either direction', async () => {
    const w = makeWorld();
    await w.service.createChallenge(CREATOR, { opponentId: INVITEE, duelType: 'LIVE' }, NOW);
    expect(
      await errCode(
        w.service.createChallenge(CREATOR, { opponentId: INVITEE, duelType: 'LIVE' }, NOW)
      )
    ).toBe(ErrorCode.CHALLENGE_ALREADY_PENDING);
    expect(
      await errCode(
        w.service.createChallenge(INVITEE, { opponentId: CREATOR, duelType: 'LIVE' }, NOW)
      )
    ).toBe(ErrorCode.CHALLENGE_ALREADY_PENDING);
    // A different duel type for the same pair is fine.
    const other = await w.service.createChallenge(
      CREATOR,
      { opponentId: INVITEE, duelType: 'BLITZ' },
      NOW
    );
    expect(other.status).toBe(ChallengeStatus.PENDING);
  });

  it('create: a declined challenge does not block a fresh one', async () => {
    const w = makeWorld();
    const first = await w.service.createChallenge(
      CREATOR,
      { opponentId: INVITEE, duelType: 'LIVE' },
      NOW
    );
    await w.service.declineChallenge(INVITEE, first.id, NOW);
    const second = await w.service.createChallenge(
      CREATOR,
      { opponentId: INVITEE, duelType: 'LIVE' },
      NOW
    );
    expect(second.status).toBe(ChallengeStatus.PENDING);
  });

  it('create: a player already in a live duel cannot create or be challenged', async () => {
    const w = makeWorld();
    w.activeLive.add(CREATOR);
    expect(
      await errCode(
        w.service.createChallenge(CREATOR, { opponentId: INVITEE, duelType: 'LIVE' }, NOW)
      )
    ).toBe(ErrorCode.DUEL_LIVE_ALREADY_ACTIVE);
    w.activeLive.delete(CREATOR);
    w.activeLive.add(INVITEE);
    expect(
      await errCode(
        w.service.createChallenge(CREATOR, { opponentId: INVITEE, duelType: 'LIVE' }, NOW)
      )
    ).toBe(ErrorCode.DUEL_LIVE_ALREADY_ACTIVE);
  });

  it('create: a player already in a sprint cannot be challenged', async () => {
    const w = makeWorld();
    w.activeTrading.set(INVITEE, DuelType.SPRINT);
    expect(
      await errCode(
        w.service.createChallenge(CREATOR, { opponentId: INVITEE, duelType: 'SPRINT' }, NOW)
      )
    ).toBe(ErrorCode.SPRINT_ALREADY_ACTIVE);
  });

  it('create: 10 per hour allowed, the 11th is rate-limited', async () => {
    const w = makeWorld();
    for (let i = 0; i < 10; i++) {
      const opponent = i % 2 === 0 ? INVITEE : THIRD;
      const type = i % 2 === 0 ? 'LIVE' : 'BLITZ';
      // Each pair+type only once (duplicate rule) — decline each first so the next is allowed.
      const view = await w.service.createChallenge(
        CREATOR,
        { opponentId: opponent, duelType: type },
        NOW
      );
      await w.service.declineChallenge(opponent, view.id, NOW);
    }
    expect(
      await errCode(
        w.service.createChallenge(CREATOR, { opponentId: INVITEE, duelType: 'CASE' }, NOW)
      )
    ).toBe(ErrorCode.RATE_LIMITED);
  });

  it('accept: live challenge starts a live duel at once, creator is playerA, PLAYED with duelId', async () => {
    const w = makeWorld();
    const created = await w.service.createChallenge(
      CREATOR,
      { opponentId: INVITEE, duelType: 'CASE' },
      NOW
    );
    const res = await w.service.acceptChallenge(INVITEE, created.id, NOW);
    expect(res.duelId).toBe('duel-1');
    expect(res.playUrl).toBe('/duels/case');
    expect(res.challenge.status).toBe(ChallengeStatus.PLAYED);
    expect(res.challenge.duelId).toBe('duel-1');
    expect(res.challenge.playUrl).toBe('/duels/case');
    expect(w.liveCalls).toEqual([{ a: CREATOR, b: INVITEE, variant: 'CASE' }]);
  });

  it('accept: SPRINT uses createSprint, CRISIS uses createCrisis', async () => {
    const w = makeWorld();
    const s = await w.service.createChallenge(
      CREATOR,
      { opponentId: INVITEE, duelType: 'SPRINT' },
      NOW
    );
    const sRes = await w.service.acceptChallenge(INVITEE, s.id, NOW);
    expect(sRes.playUrl).toBe('/duels/sprint');
    const c = await w.service.createChallenge(
      CREATOR,
      { opponentId: INVITEE, duelType: 'CRISIS' },
      NOW
    );
    const cRes = await w.service.acceptChallenge(INVITEE, c.id, NOW);
    expect(cRes.playUrl).toBe('/duels/crisis');
    expect(w.sprintCalls).toEqual([
      { a: CREATOR, b: INVITEE, kind: 'SPRINT' },
      { a: CREATOR, b: INVITEE, kind: 'CRISIS' },
    ]);
  });

  it('accept: anyone except the invitee is forbidden (including the creator)', async () => {
    const w = makeWorld();
    const created = await w.service.createChallenge(
      CREATOR,
      { opponentId: INVITEE, duelType: 'LIVE' },
      NOW
    );
    expect(await errCode(w.service.acceptChallenge(CREATOR, created.id, NOW))).toBe(
      ErrorCode.FORBIDDEN
    );
    expect(await errCode(w.service.acceptChallenge(THIRD, created.id, NOW))).toBe(
      ErrorCode.FORBIDDEN
    );
  });

  it('accept: an expired invite cannot be accepted and reads as EXPIRED', async () => {
    const w = makeWorld();
    const created = await w.service.createChallenge(
      CREATOR,
      { opponentId: INVITEE, duelType: 'LIVE' },
      NOW
    );
    const late = new Date('2026-11-14T10:00:01.000Z');
    expect(await errCode(w.service.acceptChallenge(INVITEE, created.id, late))).toBe(
      ErrorCode.CHALLENGE_EXPIRED
    );
    const row = await w.repo.findById(created.id);
    expect(row?.status).toBe(ChallengeStatus.EXPIRED);
  });

  it('accept: a declined challenge cannot be accepted', async () => {
    const w = makeWorld();
    const created = await w.service.createChallenge(
      CREATOR,
      { opponentId: INVITEE, duelType: 'LIVE' },
      NOW
    );
    await w.service.declineChallenge(INVITEE, created.id, NOW);
    expect(await errCode(w.service.acceptChallenge(INVITEE, created.id, NOW))).toBe(
      ErrorCode.CHALLENGE_NOT_PENDING
    );
  });

  it('accept: a second accept of a PLAYED challenge is not pending', async () => {
    const w = makeWorld();
    const created = await w.service.createChallenge(
      CREATOR,
      { opponentId: INVITEE, duelType: 'LIVE' },
      NOW
    );
    await w.service.acceptChallenge(INVITEE, created.id, NOW);
    expect(await errCode(w.service.acceptChallenge(INVITEE, created.id, NOW))).toBe(
      ErrorCode.CHALLENGE_NOT_PENDING
    );
  });

  it('accept: when duel creation fails the claim reverts to PENDING (never stuck in ACCEPTED)', async () => {
    const w = makeWorld();
    const created = await w.service.createChallenge(
      CREATOR,
      { opponentId: INVITEE, duelType: 'LIVE' },
      NOW
    );
    w.failLive();
    await expect(w.service.acceptChallenge(INVITEE, created.id, NOW)).rejects.toThrow(
      'engine boom'
    );
    const row = await w.repo.findById(created.id);
    expect(row?.status).toBe(ChallengeStatus.PENDING);
    expect(row?.duelId).toBeNull();
  });

  it('accept: a busy invitee at accept time is 409 and the challenge stays PENDING', async () => {
    const w = makeWorld();
    const created = await w.service.createChallenge(
      CREATOR,
      { opponentId: INVITEE, duelType: 'LIVE' },
      NOW
    );
    w.activeLive.add(INVITEE);
    expect(await errCode(w.service.acceptChallenge(INVITEE, created.id, NOW))).toBe(
      ErrorCode.DUEL_LIVE_ALREADY_ACTIVE
    );
    const row = await w.repo.findById(created.id);
    expect(row?.status).toBe(ChallengeStatus.PENDING);
  });

  it('accept: the 5-minute rematch cooldown blocks an immediate re-challenge accept', async () => {
    const w = makeWorld();
    const created = await w.service.createChallenge(
      CREATOR,
      { opponentId: INVITEE, duelType: 'LIVE' },
      NOW
    );
    w.lastDuel.set(`${CREATOR}:${INVITEE}`, { finishedAt: new Date(NOW.getTime() - 60 * 1000) });
    expect(await errCode(w.service.acceptChallenge(INVITEE, created.id, NOW))).toBe(
      ErrorCode.RATING_DUEL_COOLDOWN
    );
    // Six minutes later the same accept goes through.
    w.lastDuel.set(`${CREATOR}:${INVITEE}`, {
      finishedAt: new Date(NOW.getTime() - 6 * 60 * 1000),
    });
    const res = await w.service.acceptChallenge(INVITEE, created.id, NOW);
    expect(res.challenge.status).toBe(ChallengeStatus.PLAYED);
  });

  it('decline: invitee only, closes the challenge, never counts toward caps', async () => {
    const w = makeWorld();
    const created = await w.service.createChallenge(
      CREATOR,
      { opponentId: INVITEE, duelType: 'LIVE' },
      NOW
    );
    expect(await errCode(w.service.declineChallenge(CREATOR, created.id, NOW))).toBe(
      ErrorCode.FORBIDDEN
    );
    const declined = await w.service.declineChallenge(INVITEE, created.id, NOW);
    expect(declined.status).toBe(ChallengeStatus.DECLINED);
  });

  it('decline: an expired invite reports expired, not declined', async () => {
    const w = makeWorld();
    const created = await w.service.createChallenge(
      CREATOR,
      { opponentId: INVITEE, duelType: 'LIVE' },
      NOW
    );
    const late = new Date('2026-11-15T10:00:00.000Z');
    expect(await errCode(w.service.declineChallenge(INVITEE, created.id, late))).toBe(
      ErrorCode.CHALLENGE_EXPIRED
    );
  });

  it('invite code: the invitee opens it; anyone else (or a bad code) gets 404', async () => {
    const w = makeWorld();
    const created = await w.service.createChallenge(
      CREATOR,
      { opponentId: INVITEE, duelType: 'LIVE' },
      NOW
    );
    const opened = await w.service.getByInviteCode(INVITEE, created.inviteCode, NOW);
    expect(opened.id).toBe(created.id);
    expect(await errCode(w.service.getByInviteCode(CREATOR, created.inviteCode, NOW))).toBe(
      ErrorCode.NOT_FOUND
    );
    expect(await errCode(w.service.getByInviteCode(INVITEE, '0000000000000000', NOW))).toBe(
      ErrorCode.NOT_FOUND
    );
  });

  it('get: a non-participant is forbidden; a participant sees it', async () => {
    const w = makeWorld();
    const created = await w.service.createChallenge(
      CREATOR,
      { opponentId: INVITEE, duelType: 'LIVE' },
      NOW
    );
    expect(await errCode(w.service.getChallenge(THIRD, created.id, NOW))).toBe(ErrorCode.FORBIDDEN);
    const seen = await w.service.getChallenge(CREATOR, created.id, NOW);
    expect(seen.id).toBe(created.id);
  });

  it('lists: pending only — expired invites flip to EXPIRED and drop out', async () => {
    const w = makeWorld();
    const a = await w.service.createChallenge(
      CREATOR,
      { opponentId: INVITEE, duelType: 'LIVE' },
      NOW
    );
    await w.service.createChallenge(CREATOR, { opponentId: INVITEE, duelType: 'BLITZ' }, NOW);
    const late = new Date('2026-11-14T10:00:01.000Z');
    const incoming = await w.service.listIncoming(INVITEE, late);
    expect(incoming).toHaveLength(0);
    const outgoing = await w.service.listOutgoing(CREATOR, late);
    expect(outgoing).toHaveLength(0);
    expect((await w.repo.findById(a.id))?.status).toBe(ChallengeStatus.EXPIRED);
  });

  it('stale ACCEPTED: a claim with no duel older than 5 minutes reverts to PENDING on read', async () => {
    const w = makeWorld();
    const created = await w.service.createChallenge(
      CREATOR,
      { opponentId: INVITEE, duelType: 'LIVE' },
      NOW
    );
    // Simulate a crash between the claim and the duel creation.
    await w.repo.update(created.id, { status: ChallengeStatus.ACCEPTED });
    const stored = w.repo.rows.get(created.id) as ChallengeRow;
    stored.updatedAt = new Date(NOW.getTime() - 6 * 60 * 1000);
    const seen = await w.service.getChallenge(CREATOR, created.id, NOW);
    expect(seen.status).toBe(ChallengeStatus.PENDING);
    // And it can be accepted again afterwards.
    const res = await w.service.acceptChallenge(INVITEE, created.id, NOW);
    expect(res.challenge.status).toBe(ChallengeStatus.PLAYED);
  });
});
