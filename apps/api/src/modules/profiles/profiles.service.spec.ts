import { ErrorCode } from '@candle/shared';
import { DuelType, ProfileVisibility } from '@prisma/client';
import { AppError } from '../../common/errors/app-error';
import type { AppLogger } from '../../common/services/logger.service';
import { dateInTimezone } from '../../common/utils/timezone-date';
import type { RatingsService } from '../ratings/ratings.service';
import type { SimulatorService } from '../simulator/simulator.service';
import { ProfilesService } from './profiles.service';
import type { PrivacyRow, ProfileUserRow } from './profiles.repository';

/**
 * ProfilesService spec — service against in-memory fakes (same
 * port-boundary pattern as the other service specs). Covers the
 * visibility rules (public / private / FRIENDS-as-private, granular
 * toggles returning null), the display-name cooldown, bio rejection,
 * last-5-per-type history, and the showcase snapshot rule.
 */

const OWNER = '11111111-1111-4111-8111-111111111111';
const STRANGER = '22222222-2222-4222-8222-222222222222';
const OPPONENT = '33333333-3333-4333-8333-333333333333';

function profileUser(overrides: Partial<ProfileUserRow> = {}): ProfileUserRow {
  return {
    id: OWNER,
    displayName: 'Nishu',
    avatarKey: null,
    bio: 'Learning money.',
    countryCode: 'IN',
    profileVisibility: ProfileVisibility.PUBLIC,
    displayNameChangedAt: null,
    email: 'nishu@example.com',
    roles: ['USER'],
    emailVerifiedAt: new Date('2026-11-01T00:00:00.000Z'),
    createdAt: new Date('2026-11-01T10:00:00.000Z'),
    deletedAt: null,
    deletionRequestedAt: null,
    deletionScheduledAt: null,
    ...overrides,
  };
}

function privacy(overrides: Partial<PrivacyRow> = {}): PrivacyRow {
  return {
    userId: OWNER,
    showRatings: true,
    showRank: true,
    showLearningProgress: true,
    showDuelHistory: true,
    showSimulatorShowcase: true,
    showBadges: true,
    showFriendsList: true,
    allowFriendRequests: true,
    allowChallengesFromStrangers: true,
    showOnlineStatus: true,
    ...overrides,
  };
}

class FakeProfilesRepo {
  users = new Map<string, ProfileUserRow>();
  privacyRows = new Map<string, PrivacyRow>();
  gameResults: any[] = [];
  sprintResults: any[] = [];
  weeklyResults: any[] = [];
  stats: any = {
    userId: OWNER,
    totalXp: 190,
    level: 2,
    currentStreak: 3,
    longestStreak: 5,
    lastActivityDate: '2026-11-12',
  };
  badges: any[] = [
    {
      id: 'b1',
      slug: 'first-lesson',
      name: 'First Lesson',
      description: 'd',
      awardedAt: new Date(),
    },
  ];
  tracks: any[] = [
    {
      trackId: 't1',
      slug: 'foundations',
      title: 'Foundations',
      completedLessons: 1,
      totalLessons: 3,
    },
  ];
  snapshots = new Map<string, any>();

  async findProfileUser(id: string): Promise<ProfileUserRow | null> {
    return this.users.get(id) ?? null;
  }

  async updateProfileFields(id: string, data: any): Promise<ProfileUserRow> {
    const u = this.users.get(id);
    if (!u) throw new Error('user not found');
    Object.assign(u, data);
    return { ...u };
  }

  async getOrCreatePrivacy(userId: string): Promise<PrivacyRow> {
    let row = this.privacyRows.get(userId);
    if (!row) {
      row = privacy({ userId });
      this.privacyRows.set(userId, row);
    }
    return { ...row };
  }

  async updatePrivacy(userId: string, patch: any): Promise<PrivacyRow> {
    const row = await this.getOrCreatePrivacy(userId);
    Object.assign(row, patch);
    this.privacyRows.set(userId, row);
    return { ...row };
  }

  async listRecentGameResults(userId: string, type: DuelType, take: number): Promise<any[]> {
    return this.gameResults
      .filter((r) => r.userId === userId && r.duel.type === type && r.ratingBefore !== null)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, take);
  }

  async findGameResult(duelId: string, userId: string): Promise<any | null> {
    return this.gameResults.find((r) => r.duelId === duelId && r.userId === userId) ?? null;
  }

  async listRecentSprintResults(userId: string, type: DuelType, take: number): Promise<any[]> {
    return this.sprintResults
      .filter((r) => r.userId === userId && r.duel.type === type && r.ratingDelta !== null)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, take);
  }

  async listRecentWeeklyResults(userId: string, take: number): Promise<any[]> {
    return this.weeklyResults
      .filter((r) => r.userId === userId && r.ratingDelta !== null)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, take);
  }

  async findDisplayNames(
    ids: string[]
  ): Promise<Array<{ id: string; displayName: string | null }>> {
    return ids.map((id) => ({
      id,
      displayName: this.users.get(id)?.displayName ?? null,
    }));
  }

  async findStats(): Promise<any> {
    return { ...this.stats };
  }

  async listBadges(): Promise<any[]> {
    return [...this.badges];
  }

  async listXpLedger(): Promise<any[]> {
    return [];
  }

  async listTrackProgress(): Promise<any[]> {
    return [...this.tracks];
  }

  async listSimOrders(): Promise<any[]> {
    return [];
  }

  async findShowcaseSnapshot(userId: string): Promise<any | null> {
    return this.snapshots.get(userId) ?? null;
  }

  async upsertShowcaseSnapshot(userId: string, data: any): Promise<any> {
    const row = { userId, ...data, computedAt: new Date() };
    this.snapshots.set(userId, row);
    return row;
  }
}

function overview(candleDisplayRating = 1224) {
  const side = (rating: number) => ({
    rating,
    displayRating: Math.round(rating),
    tier: 'Silver',
    provisional: true,
    gamesPlayed: 4,
    wins: 3,
    draws: 0,
    losses: 1,
    lastRatedAt: null,
    season: '2026-Q4',
    countryCode: 'IN',
    globalRank: 12,
    globalPercentile: 88,
    countryRank: 3,
    countryPercentile: 95,
  });
  return {
    userId: OWNER,
    displayName: 'Nishu',
    countryCode: 'IN',
    learning: side(1200),
    trading: side(1248),
    candleRating: 1224,
    candleDisplayRating,
    candleTier: 'Silver',
  };
}

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as AppLogger;

function buildService(opts: { peek?: any; peekCalls?: { n: number } } = {}) {
  const repo = new FakeProfilesRepo();
  const ratings = { getUserRatings: jest.fn(async () => overview()) } as unknown as RatingsService;
  const peekCalls = opts.peekCalls ?? { n: 0 };
  const simulator = {
    peekPortfolioValuation: jest.fn(async () => {
      peekCalls.n += 1;
      return opts.peek ?? null;
    }),
  } as unknown as SimulatorService;
  const service = new ProfilesService(repo as any, ratings, simulator, logger);
  return { service, repo, ratings, simulator, peekCalls };
}

function seedGameResult(repo: FakeProfilesRepo, n: number, type: DuelType, rated = true) {
  const duelId = `duel-${type}-${n}`;
  repo.gameResults.push({
    id: `gr-${type}-${n}`,
    duelId,
    userId: OWNER,
    result: 'WIN',
    score: 500 + n,
    correct: 5,
    wrong: 1,
    skipped: 1,
    accuracy: 0.71,
    ratingBefore: rated ? 1200 : null,
    ratingAfter: rated ? 1224 : null,
    ratingDelta: rated ? 24 : null,
    createdAt: new Date(Date.UTC(2026, 10, n, 10, 0, 0)),
    duel: { id: duelId, type, playerAId: OWNER, playerBId: OPPONENT, winnerId: OWNER },
  });
}

describe('ProfilesService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('owner profile sees everything, with the career title from Candle Rating', async () => {
    const { service, repo } = buildService();
    repo.users.set(OWNER, profileUser());
    const me = await service.getMyProfile(OWNER);
    expect(me.email).toBe('nishu@example.com');
    expect(me.careerTitle).toBe('Analyst'); // Candle 1224 -> Analyst
    expect(me.level).toBe(2);
    expect(me.joinedMonth).toBe('Nov 2026');
    expect(me.visibility).toBe('PUBLIC');
    expect(me.ratings.candleDisplayRating).toBe(1224);
    expect(me.rank.learning.globalRank).toBe(12);
    expect(me.learningProgress.tracks).toHaveLength(1);
    expect(me.badges).toHaveLength(1);
    expect(me.friendsList).toEqual([]);
    expect(me.onlineStatus).toBeNull();
  });

  it('public profile hides a section when its toggle is OFF (null, never empty)', async () => {
    const { service, repo } = buildService();
    repo.users.set(OWNER, profileUser());
    repo.users.set(
      STRANGER,
      profileUser({ id: STRANGER, displayName: 'Stranger', email: 's@example.com' })
    );
    repo.privacyRows.set(OWNER, privacy({ showRatings: false, showDuelHistory: false }));
    const pub = await service.getPublicProfile(STRANGER, OWNER);
    expect(pub.isPrivate).toBe(false);
    expect(pub.ratings).toBeNull();
    expect(pub.duelHistory).toBeNull();
    expect(pub.rank).not.toBeNull(); // showRank still ON
    expect('email' in pub).toBe(false); // no email on a public profile
    expect(pub.careerTitle).toBe('Analyst');
  });

  it('PRIVATE and FRIENDS profiles read as private to strangers (FRIENDS = PRIVATE until friends land)', async () => {
    const { service, repo } = buildService();
    repo.users.set(
      STRANGER,
      profileUser({ id: STRANGER, displayName: 'Stranger', email: 's@example.com' })
    );
    for (const visibility of [ProfileVisibility.PRIVATE, ProfileVisibility.FRIENDS]) {
      repo.users.set(OWNER, profileUser({ profileVisibility: visibility }));
      const pub = await service.getPublicProfile(STRANGER, OWNER);
      expect(pub.isPrivate).toBe(true);
      expect(pub.message).toBe('This profile is private.');
      expect(pub.ratings).toBeNull();
      expect(pub.duelHistory).toBeNull();
      expect(pub.badges).toBeNull();
      expect(pub.careerTitle).toBeNull();
    }
  });

  it('logged-out visitors can read a PUBLIC profile', async () => {
    const { service, repo } = buildService();
    repo.users.set(OWNER, profileUser());
    const pub = await service.getPublicProfile(null, OWNER);
    expect(pub.isPrivate).toBe(false);
    expect(pub.displayName).toBe('Nishu');
  });

  it('deactivated profiles are not found, even for the owner', async () => {
    const { service, repo } = buildService();
    repo.users.set(OWNER, profileUser({ deletedAt: new Date() }));
    await expect(service.getMyProfile(OWNER)).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
    });
  });

  it('display-name change inside 30 days is a 409 with days remaining', async () => {
    const { service, repo } = buildService();
    const now = new Date();
    repo.users.set(
      OWNER,
      profileUser({ displayNameChangedAt: new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000) })
    );
    await expect(service.updateMyProfile(OWNER, { displayName: 'Nishu2' })).rejects.toMatchObject({
      code: ErrorCode.PROFILE_DISPLAY_NAME_COOLDOWN,
    });
    try {
      await service.updateMyProfile(OWNER, { displayName: 'Nishu2' });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).message).toMatch(/1 day/);
    }
  });

  it('bio with a link is rejected with a per-field error', async () => {
    const { service, repo } = buildService();
    repo.users.set(OWNER, profileUser());
    await expect(
      service.updateMyProfile(OWNER, { bio: 'See my blog at example.com' })
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
  });

  it('valid profile update saves + stamps the display-name change', async () => {
    const { service, repo } = buildService();
    repo.users.set(OWNER, profileUser());
    const me = await service.updateMyProfile(OWNER, { displayName: 'Nishu2', bio: 'New bio.' });
    expect(me.displayName).toBe('Nishu2');
    expect(me.bio).toBe('New bio.');
    expect(repo.users.get(OWNER)?.displayNameChangedAt).not.toBeNull();
  });

  it('duel history keeps only the last 5 rated games per type, newest first', async () => {
    const { service, repo } = buildService();
    repo.users.set(OWNER, profileUser());
    repo.users.set(
      OPPONENT,
      profileUser({ id: OPPONENT, displayName: 'Ravi', email: 'r@example.com' })
    );
    for (let n = 1; n <= 7; n++) seedGameResult(repo, n, 'LIVE');
    seedGameResult(repo, 1, 'BLITZ');
    seedGameResult(repo, 99, 'LIVE', false); // unrated BOT-style row: excluded
    const { duelHistory } = await service.getDuelHistory(OWNER, OWNER);
    expect(duelHistory).not.toBeNull();
    expect(duelHistory?.LIVE).toHaveLength(5);
    expect(duelHistory?.LIVE[0]?.myScore).toBe(507); // newest first
    expect(duelHistory?.LIVE[4]?.myScore).toBe(503);
    expect(duelHistory?.BLITZ).toHaveLength(1);
    expect(duelHistory?.LIVE[0]?.opponent.displayName).toBe('Ravi');
    expect(duelHistory?.DAILY).toHaveLength(0);
    expect(duelHistory?.WEEKLY).toHaveLength(0);
  });

  it('showcase: no portfolio -> "No simulator activity yet"; snapshot reused the same day', async () => {
    const peekCalls = { n: 0 };
    const { service, repo } = buildService({
      peek: {
        totalEquity: '104320.50',
        returnPct: 4.32,
        topHoldings: [{ symbol: 'NVLT', marketValue: '5000.00' }],
      },
      peekCalls,
    });
    repo.users.set(OWNER, profileUser());
    // No portfolio: peek returns null only when the fake is told to.
    (service as any).simulator.peekPortfolioValuation = jest.fn(async () => null);
    const me1 = await service.getMyProfile(OWNER);
    expect(me1.simulatorShowcase).toEqual({
      status: 'NO_ACTIVITY',
      message: 'No simulator activity yet',
    });

    // Portfolio exists: first read computes + stores the snapshot…
    (service as any).simulator.peekPortfolioValuation = jest.fn(async () => {
      peekCalls.n += 1;
      return {
        totalEquity: '104320.50',
        returnPct: 4.32,
        topHoldings: [{ symbol: 'NVLT', marketValue: '5000.00' }],
      };
    });
    const me2 = await service.getMyProfile(OWNER);
    expect(me2.simulatorShowcase).toMatchObject({
      status: 'ACTIVE',
      totalEquity: '104320.50',
      label: expect.stringContaining('Virtual money only'),
    });
    expect(peekCalls.n).toBe(1);
    // …second read the same day reuses the snapshot (peek not called again).
    await service.getMyProfile(OWNER);
    expect(peekCalls.n).toBe(1);
    // A snapshot from another day is stale: recompute.
    const snap = repo.snapshots.get(OWNER);
    snap.computedDate = '2020-01-01';
    await service.getMyProfile(OWNER);
    expect(peekCalls.n).toBe(2);
  });

  it('showcase snapshot date is today in Asia/Kolkata', async () => {
    const { service, repo } = buildService({
      peek: { totalEquity: '100000.00', returnPct: 0, topHoldings: [] },
    });
    repo.users.set(OWNER, profileUser());
    const me = await service.getMyProfile(OWNER);
    expect(me.simulatorShowcase).toMatchObject({ status: 'ACTIVE' });
    if (me.simulatorShowcase.status === 'ACTIVE') {
      expect(me.simulatorShowcase.asOf).toBe(dateInTimezone(new Date(), 'Asia/Kolkata'));
    }
  });
});
