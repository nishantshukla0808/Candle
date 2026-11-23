import { Injectable } from '@nestjs/common';
import { DuelType, ProfileVisibility } from '@prisma/client';
import {
  PROFILE_DUEL_HISTORY_PER_TYPE,
  SIM_SHOWCASE_LABEL,
  SIM_SHOWCASE_SNAPSHOT_TIMEZONE,
} from '@candle/shared';
import { AppError } from '../../common/errors/app-error';
import { AppLogger } from '../../common/services/logger.service';
import { dateInTimezone } from '../../common/utils/timezone-date';
import { RatingsService } from '../ratings/ratings.service';
import { SimulatorService } from '../simulator/simulator.service';
import { validateBio } from './bio-validation';
import { careerTitleFor, joinedMonthYear } from './career-title';
import { displayNameCooldown, validateDisplayName } from './display-name';
import type { UpdateMyProfileDto, UpdatePrivacyDto } from './dto/profiles.dto';
import {
  GameHistoryRow,
  PrivacyRow,
  ProfilesRepository,
  ProfileUserRow,
  SprintHistoryRow,
  WeeklyHistoryRow,
} from './profiles.repository';

/**
 * ProfilesService — docs/06 §1, docs/18, ADR 0015.
 *
 * Profiles EXTEND the users module; they do not replace it. The
 * public profile (GET /users/:id) is privacy-filtered server-side —
 * the frontend never decides what to show. If a toggle is OFF the API
 * returns null for that section, never an empty list.
 *
 * Visibility (ADR 0015 §1):
 * - PUBLIC: anyone, including logged-out visitors.
 * - FRIENDS: behaves as PRIVATE until the friends phase lands — no
 *   friend list exists to check against, so fail closed.
 * - PRIVATE: only the owner. Others see "This profile is private."
 *
 * Duel history: last 5 games per duel type only, rated duels only,
 * read from the existing result rows — never duplicated, never a new
 * history table (ADR 0015 §4).
 *
 * Simulator showcase: ON by default (decision 3), a once-per-day
 * snapshot (never a live feed), symbols only, labelled virtual money.
 */

export interface LearningDuelHistoryItem {
  duelId: string;
  type: DuelType;
  date: Date;
  opponent: { id: string | null; displayName: string };
  result: 'WIN' | 'DRAW' | 'LOSS';
  myScore: number;
  opponentScore: number | null;
  correct: number;
  total: number;
  accuracy: number;
  ratingDelta: number | null;
}

export interface TradingDuelHistoryItem {
  duelId: string;
  type: DuelType;
  date: Date;
  opponent: { id: string | null; displayName: string };
  result: 'WIN' | 'DRAW' | 'LOSS';
  myReturnPct: number;
  myRiskScore: number;
  opponentRiskScore: number;
  opponentEquity: string | null;
  tradeCount: number;
  ratingDelta: number | null;
}

export interface WeeklyDuelHistoryItem {
  seasonId: string;
  weekStart: string;
  date: Date;
  rank: number;
  leagueSize: number;
  tier: number;
  nextTier: number;
  result: 'WIN' | 'DRAW' | 'LOSS';
  returnPct: number;
  tradeCount: number;
  ratingDelta: number | null;
  ratingResult: string | null;
}

export interface DuelHistoryView {
  LIVE: LearningDuelHistoryItem[];
  BLITZ: LearningDuelHistoryItem[];
  CASE: LearningDuelHistoryItem[];
  CHART: LearningDuelHistoryItem[];
  DAILY: LearningDuelHistoryItem[];
  SPRINT: TradingDuelHistoryItem[];
  CRISIS: TradingDuelHistoryItem[];
  WEEKLY: WeeklyDuelHistoryItem[];
}

export interface RatingsSection {
  learning: {
    rating: number;
    displayRating: number;
    tier: string;
    provisional: boolean;
    gamesPlayed: number;
    wins: number;
    draws: number;
    losses: number;
  };
  trading: {
    rating: number;
    displayRating: number;
    tier: string;
    provisional: boolean;
    gamesPlayed: number;
    wins: number;
    draws: number;
    losses: number;
  };
  candleRating: number;
  candleDisplayRating: number;
  candleTier: string;
}

export interface RankSection {
  learning: {
    globalRank: number | null;
    globalPercentile: number | null;
    countryRank: number | null;
    countryPercentile: number | null;
  };
  trading: {
    globalRank: number | null;
    globalPercentile: number | null;
    countryRank: number | null;
    countryPercentile: number | null;
  };
}

export interface LearningProgressSection {
  tracks: Array<{
    trackId: string;
    slug: string;
    title: string;
    completedLessons: number;
    totalLessons: number;
  }>;
  /** First track not yet finished (by track order), or null. */
  currentTrack: { slug: string; title: string } | null;
}

export interface BadgeSectionItem {
  id: string;
  slug: string;
  name: string;
  description: string;
  awardedAt: Date;
}

export type SimulatorShowcaseView =
  | {
      status: 'ACTIVE';
      totalEquity: string;
      returnPct: number;
      topHoldings: Array<{ symbol: string; marketValue: string }>;
      label: string;
      /** Asia/Kolkata date the snapshot was computed for. */
      asOf: string;
    }
  | { status: 'NO_ACTIVITY'; message: string };

export interface OwnerProfileView {
  id: string;
  displayName: string | null;
  avatarKey: string | null;
  avatarUrl: string | null;
  bio: string | null;
  countryCode: string | null;
  careerTitle: string;
  level: number;
  totalXp: number;
  currentStreak: number;
  longestStreak: number;
  joinedMonth: string;
  email: string;
  emailVerified: boolean;
  roles: string[];
  visibility: ProfileVisibility;
  privacy: PrivacyRow;
  ratings: RatingsSection;
  rank: RankSection;
  learningProgress: LearningProgressSection;
  duelHistory: DuelHistoryView;
  simulatorShowcase: SimulatorShowcaseView;
  badges: BadgeSectionItem[];
  /** Friends do not exist yet (Phase 13 scope): always empty for the owner. */
  friendsList: [];
  /** No presence system yet (arrives with friends/chat): always null. */
  onlineStatus: null;
}

export interface PublicProfileView {
  id: string;
  displayName: string | null;
  avatarKey: string | null;
  avatarUrl: string | null;
  bio: string | null;
  countryCode: string | null;
  careerTitle: string | null;
  level: number | null;
  joinedMonth: string;
  /** True when a non-owner asked for a PRIVATE (or FRIENDS) profile. */
  isPrivate: boolean;
  message?: string;
  ratings: RatingsSection | null;
  rank: RankSection | null;
  learningProgress: LearningProgressSection | null;
  duelHistory: DuelHistoryView | null;
  simulatorShowcase: SimulatorShowcaseView | null;
  badges: BadgeSectionItem[] | null;
  friendsList: [] | null;
  onlineStatus: null;
}

const LEARNING_DUEL_TYPES: DuelType[] = ['LIVE', 'BLITZ', 'CASE', 'CHART', 'DAILY'];
const TRADING_DUEL_TYPES: DuelType[] = ['SPRINT', 'CRISIS'];
const BOT_DISPLAY_NAME = 'Mira';

@Injectable()
export class ProfilesService {
  constructor(
    private readonly repo: ProfilesRepository,
    private readonly ratings: RatingsService,
    private readonly simulator: SimulatorService,
    private readonly logger: AppLogger
  ) {}

  // --- owner profile -------------------------------------------------------------

  /** GET /users/me — everything. Only the owner can call it. */
  async getMyProfile(userId: string): Promise<OwnerProfileView> {
    const user = await this.loadVisibleUser(userId);
    const [privacy, overview, stats, badges, tracks, history, showcase] = await Promise.all([
      this.repo.getOrCreatePrivacy(userId),
      this.ratings.getUserRatings(userId),
      this.repo.findStats(userId),
      this.repo.listBadges(userId),
      this.repo.listTrackProgress(userId),
      this.buildDuelHistory(userId),
      this.buildShowcase(userId),
    ]);
    return {
      id: user.id,
      displayName: user.displayName,
      avatarKey: user.avatarKey,
      avatarUrl: user.avatarKey ? '/api/v1/users/me/avatar' : null,
      bio: user.bio,
      countryCode: user.countryCode,
      careerTitle: careerTitleFor(overview.candleDisplayRating),
      level: stats?.level ?? 1,
      totalXp: stats?.totalXp ?? 0,
      currentStreak: stats?.currentStreak ?? 0,
      longestStreak: stats?.longestStreak ?? 0,
      joinedMonth: joinedMonthYear(user.createdAt),
      email: user.email,
      emailVerified: user.emailVerifiedAt !== null,
      roles: user.roles,
      visibility: user.profileVisibility,
      privacy,
      ratings: toRatingsSection(overview),
      rank: toRankSection(overview),
      learningProgress: toLearningProgress(tracks),
      duelHistory: history,
      simulatorShowcase: showcase,
      badges,
      friendsList: [],
      onlineStatus: null,
    };
  }

  /** PATCH /users/me — display name + bio only. Country is locked
   * (decision 4): the DTO has no country field, so @Strict rejects
   * it at the boundary with VALIDATION_FAILED. */
  async updateMyProfile(userId: string, dto: UpdateMyProfileDto): Promise<OwnerProfileView> {
    const user = await this.loadVisibleUser(userId);
    const data: {
      displayName?: string | null;
      bio?: string | null;
      displayNameChangedAt?: Date | null;
    } = {};
    if (dto.displayName !== undefined) {
      const issues = validateDisplayName(dto.displayName);
      if (issues.length > 0) {
        throw AppError.validationFailed(issues.map((issue) => ({ field: 'displayName', issue })));
      }
      const cooldown = displayNameCooldown(user.displayNameChangedAt);
      if (!cooldown.allowed) {
        throw AppError.profileDisplayNameCooldown(
          `Display name can only be changed once every 30 days. ` +
            `You can change it again in ${cooldown.daysRemaining} day(s).`
        );
      }
      data.displayName = dto.displayName.trim();
      data.displayNameChangedAt = new Date();
    }
    if (dto.bio !== undefined) {
      const issues = validateBio(dto.bio);
      if (issues.length > 0) {
        throw AppError.validationFailed(issues.map((issue) => ({ field: 'bio', issue })));
      }
      data.bio = dto.bio.trim() === '' ? null : dto.bio.trim();
    }
    if (Object.keys(data).length > 0) {
      await this.repo.updateProfileFields(userId, data);
      this.logger.info('Profile updated', { userId, fields: Object.keys(data) });
    }
    return this.getMyProfile(userId);
  }

  /** PATCH /users/me/privacy — the main switch + the granular toggles. */
  async updatePrivacy(
    userId: string,
    dto: UpdatePrivacyDto
  ): Promise<{ visibility: ProfileVisibility; privacy: PrivacyRow }> {
    await this.loadVisibleUser(userId);
    let visibility: ProfileVisibility | undefined;
    if (dto.visibility !== undefined) {
      visibility = dto.visibility;
      await this.repo.updateProfileFields(userId, { profileVisibility: visibility });
    }
    const patch: Record<string, boolean> = {};
    for (const key of [
      'showRatings',
      'showRank',
      'showLearningProgress',
      'showDuelHistory',
      'showSimulatorShowcase',
      'showBadges',
      'showFriendsList',
      'allowFriendRequests',
      'allowChallengesFromStrangers',
      'showOnlineStatus',
    ] as const) {
      if (dto[key] !== undefined) patch[key] = dto[key];
    }
    const privacy = await this.repo.updatePrivacy(userId, patch);
    const current = await this.repo.findProfileUser(userId);
    return { visibility: current?.profileVisibility ?? visibility ?? 'PUBLIC', privacy };
  }

  // --- public profile --------------------------------------------------------------

  /**
   * GET /users/:id — privacy-filtered server-side. `viewerId` is null
   * for logged-out visitors (the route is @Public with opportunistic
   * auth, so a valid token still attaches the viewer).
   */
  async getPublicProfile(viewerId: string | null, targetId: string): Promise<PublicProfileView> {
    const user = await this.loadVisibleUser(targetId);
    const isOwner = viewerId !== null && viewerId === targetId;
    if (isOwner) {
      // The owner always sees their own profile in full on /:id — the
      // public shape, without the /me-only fields (email, roles, the
      // privacy toggles themselves). GET /users/me is the only place
      // those appear.
      const mine = await this.getMyProfile(targetId);
      return {
        id: mine.id,
        displayName: mine.displayName,
        avatarKey: mine.avatarKey,
        avatarUrl: mine.avatarUrl,
        bio: mine.bio,
        countryCode: mine.countryCode,
        careerTitle: mine.careerTitle,
        level: mine.level,
        joinedMonth: mine.joinedMonth,
        isPrivate: false,
        ratings: mine.ratings,
        rank: mine.rank,
        learningProgress: mine.learningProgress,
        duelHistory: mine.duelHistory,
        simulatorShowcase: mine.simulatorShowcase,
        badges: mine.badges,
        friendsList: mine.friendsList,
        onlineStatus: mine.onlineStatus,
      };
    }
    const base = {
      id: user.id,
      displayName: user.displayName,
      avatarKey: user.avatarKey,
      avatarUrl: user.avatarKey ? `/api/v1/users/${user.id}/avatar` : null,
      bio: user.bio,
      countryCode: user.countryCode,
      careerTitle: null as string | null,
      level: null as number | null,
      joinedMonth: joinedMonthYear(user.createdAt),
    };
    if (user.profileVisibility !== 'PUBLIC') {
      // FRIENDS behaves as PRIVATE until the friends phase lands
      // (ADR 0015 §1): nobody can see it yet, including the would-be
      // friends list — fail closed, never fail open.
      return {
        ...base,
        isPrivate: true,
        message: 'This profile is private.',
        ratings: null,
        rank: null,
        learningProgress: null,
        duelHistory: null,
        simulatorShowcase: null,
        badges: null,
        friendsList: null,
        onlineStatus: null,
      };
    }
    const privacy = await this.repo.getOrCreatePrivacy(targetId);
    const [overview, stats, badges, tracks, history, showcase] = await Promise.all([
      this.ratings.getUserRatings(targetId),
      this.repo.findStats(targetId),
      privacy.showBadges ? this.repo.listBadges(targetId) : Promise.resolve(null),
      privacy.showLearningProgress ? this.repo.listTrackProgress(targetId) : Promise.resolve(null),
      privacy.showDuelHistory ? this.buildDuelHistory(targetId) : Promise.resolve(null),
      privacy.showSimulatorShowcase ? this.buildShowcase(targetId) : Promise.resolve(null),
    ]);
    return {
      ...base,
      careerTitle: careerTitleFor(overview.candleDisplayRating),
      level: stats?.level ?? 1,
      isPrivate: false,
      ratings: privacy.showRatings ? toRatingsSection(overview) : null,
      rank: privacy.showRank ? toRankSection(overview) : null,
      learningProgress: tracks ? toLearningProgress(tracks) : null,
      duelHistory: history,
      simulatorShowcase: showcase,
      badges,
      friendsList: privacy.showFriendsList ? [] : null,
      onlineStatus: null,
    };
  }

  /** GET /users/:id/duels — last 5 per type, privacy-gated. */
  async getDuelHistory(
    viewerId: string | null,
    targetId: string
  ): Promise<{ userId: string; duelHistory: DuelHistoryView | null }> {
    const user = await this.loadVisibleUser(targetId);
    const isOwner = viewerId !== null && viewerId === targetId;
    if (isOwner) return { userId: targetId, duelHistory: await this.buildDuelHistory(targetId) };
    if (user.profileVisibility !== 'PUBLIC') return { userId: targetId, duelHistory: null };
    const privacy = await this.repo.getOrCreatePrivacy(targetId);
    if (!privacy.showDuelHistory) return { userId: targetId, duelHistory: null };
    return { userId: targetId, duelHistory: await this.buildDuelHistory(targetId) };
  }

  /** GET /users/:id/ratings — ratings + rank, privacy-gated. */
  async getRatingsView(
    viewerId: string | null,
    targetId: string
  ): Promise<{
    userId: string;
    ratings: RatingsSection | null;
    rank: RankSection | null;
    careerTitle: string | null;
  }> {
    const user = await this.loadVisibleUser(targetId);
    const isOwner = viewerId !== null && viewerId === targetId;
    if (isOwner) {
      const overview = await this.ratings.getUserRatings(targetId);
      return {
        userId: targetId,
        ratings: toRatingsSection(overview),
        rank: toRankSection(overview),
        careerTitle: careerTitleFor(overview.candleDisplayRating),
      };
    }
    if (user.profileVisibility !== 'PUBLIC') {
      return { userId: targetId, ratings: null, rank: null, careerTitle: null };
    }
    const privacy = await this.repo.getOrCreatePrivacy(targetId);
    if (!privacy.showRatings && !privacy.showRank) {
      return { userId: targetId, ratings: null, rank: null, careerTitle: null };
    }
    const overview = await this.ratings.getUserRatings(targetId);
    return {
      userId: targetId,
      ratings: privacy.showRatings ? toRatingsSection(overview) : null,
      rank: privacy.showRank ? toRankSection(overview) : null,
      careerTitle: privacy.showRatings ? careerTitleFor(overview.candleDisplayRating) : null,
    };
  }

  /** Export support: the user's own XP ledger + simulator orders. */
  async getExportLedger(userId: string): Promise<{
    xpLedger: Array<{ id: string; amount: number; reason: string; createdAt: Date }>;
    simulatorOrders: Array<{
      id: string;
      symbol: string;
      side: string;
      quantity: string;
      price: string;
      totalValue: string;
      executedAt: Date;
    }>;
  }> {
    await this.loadVisibleUser(userId);
    const [xpLedger, simulatorOrders] = await Promise.all([
      this.repo.listXpLedger(userId, 1000),
      this.repo.listSimOrders(userId, 1000),
    ]);
    return { xpLedger, simulatorOrders };
  }

  // --- internals ---------------------------------------------------------------------

  /**
   * A deactivated account's profile is hidden (docs/06 §2.6): it reads
   * as "not found" to everyone, including the owner while a
   * pre-deactivation access token is still alive (max 15 min).
   */
  private async loadVisibleUser(userId: string): Promise<ProfileUserRow> {
    const user = await this.repo.findProfileUser(userId);
    if (!user || user.deletedAt) throw AppError.notFound('User not found.');
    return user;
  }

  /** Last 5 rated games per duel type (docs/06 §10 extra rule). */
  private async buildDuelHistory(userId: string): Promise<DuelHistoryView> {
    const [learning, trading, weekly] = await Promise.all([
      Promise.all(
        LEARNING_DUEL_TYPES.map((type) =>
          this.repo.listRecentGameResults(userId, type, PROFILE_DUEL_HISTORY_PER_TYPE)
        )
      ),
      Promise.all(
        TRADING_DUEL_TYPES.map((type) =>
          this.repo.listRecentSprintResults(userId, type, PROFILE_DUEL_HISTORY_PER_TYPE)
        )
      ),
      this.repo.listRecentWeeklyResults(userId, PROFILE_DUEL_HISTORY_PER_TYPE),
    ]);

    // Opponent names, batched: one lookup for every opponent id in the
    // history (bot duels have no human opponent — they show as Mira).
    const opponentIds = new Set<string>();
    for (const rows of learning) {
      for (const r of rows) {
        const other = opponentIdOf(r.duel, userId);
        if (other) opponentIds.add(other);
      }
    }
    for (const rows of trading) {
      for (const r of rows) {
        const other = opponentIdOf(r.duel, userId);
        if (other) opponentIds.add(other);
      }
    }
    const names = new Map(
      (await this.repo.findDisplayNames([...opponentIds])).map((u) => [u.id, u.displayName])
    );
    const opponentOf = (duel: {
      playerAId: string;
      playerBId: string | null;
    }): { id: string | null; displayName: string } => {
      const other = opponentIdOf(duel, userId);
      if (!other) return { id: null, displayName: BOT_DISPLAY_NAME };
      return { id: other, displayName: names.get(other) ?? 'Deleted user' };
    };

    // Opponent scores for learning duels: the paired result row.
    const pairedScores = new Map<string, number>();
    const pairedLookups: Array<Promise<void>> = [];
    for (const rows of learning) {
      for (const r of rows) {
        const other = opponentIdOf(r.duel, userId);
        if (!other) continue;
        pairedLookups.push(
          this.repo.findGameResult(r.duelId, other).then((paired) => {
            if (paired) pairedScores.set(r.duelId, paired.score);
          })
        );
      }
    }
    await Promise.all(pairedLookups);

    const view = {} as DuelHistoryView;
    LEARNING_DUEL_TYPES.forEach((type, i) => {
      view[type as 'LIVE' | 'BLITZ' | 'CASE' | 'CHART' | 'DAILY'] = (learning[i] ?? []).map((r) =>
        toLearningItem(r, opponentOf(r.duel), pairedScores.get(r.duelId) ?? null)
      );
    });
    TRADING_DUEL_TYPES.forEach((type, i) => {
      view[type as 'SPRINT' | 'CRISIS'] = (trading[i] ?? []).map((r) =>
        toTradingItem(r, opponentOf(r.duel))
      );
    });
    view.WEEKLY = weekly.map(toWeeklyItem);
    return view;
  }

  /**
   * Simulator showcase (docs/06 §1.8, ADR 0015 §4): a once-per-day
   * snapshot. A fresh snapshot is computed only when today's
   * (Asia/Kolkata) snapshot does not exist yet; otherwise the stored
   * row is returned — the showcase never follows live prices.
   */
  private async buildShowcase(userId: string): Promise<SimulatorShowcaseView> {
    const today = dateInTimezone(new Date(), SIM_SHOWCASE_SNAPSHOT_TIMEZONE);
    const existing = await this.repo.findShowcaseSnapshot(userId);
    if (existing && existing.computedDate === today) {
      return {
        status: 'ACTIVE',
        totalEquity: existing.totalEquity,
        returnPct: existing.returnPct,
        topHoldings: (existing.topHoldings as Array<{ symbol: string; marketValue: string }>) ?? [],
        label: SIM_SHOWCASE_LABEL,
        asOf: existing.computedDate,
      };
    }
    const valuation = await this.simulator.peekPortfolioValuation(userId);
    if (!valuation) {
      return { status: 'NO_ACTIVITY', message: 'No simulator activity yet' };
    }
    const saved = await this.repo.upsertShowcaseSnapshot(userId, {
      totalEquity: valuation.totalEquity,
      returnPct: valuation.returnPct,
      topHoldings: valuation.topHoldings,
      computedDate: today,
    });
    return {
      status: 'ACTIVE',
      totalEquity: saved.totalEquity,
      returnPct: saved.returnPct,
      topHoldings: (saved.topHoldings as Array<{ symbol: string; marketValue: string }>) ?? [],
      label: SIM_SHOWCASE_LABEL,
      asOf: saved.computedDate,
    };
  }
}

function opponentIdOf(
  duel: { playerAId: string; playerBId: string | null },
  userId: string
): string | null {
  if (duel.playerAId === userId) return duel.playerBId;
  return duel.playerAId;
}

function toLearningItem(
  r: GameHistoryRow,
  opponent: { id: string | null; displayName: string },
  opponentScore: number | null
): LearningDuelHistoryItem {
  return {
    duelId: r.duelId,
    type: r.duel.type,
    date: r.createdAt,
    opponent,
    result: r.result,
    myScore: r.score,
    opponentScore,
    correct: r.correct,
    total: r.correct + r.wrong + r.skipped,
    accuracy: r.accuracy,
    ratingDelta: r.ratingDelta,
  };
}

function toTradingItem(
  r: SprintHistoryRow,
  opponent: { id: string | null; displayName: string }
): TradingDuelHistoryItem {
  return {
    duelId: r.duelId,
    type: r.duel.type,
    date: r.createdAt,
    opponent,
    result: r.result,
    myReturnPct: r.returnPct,
    myRiskScore: r.riskAdjustedScore,
    opponentRiskScore: r.opponentRiskScore,
    opponentEquity: r.opponentEquity ? r.opponentEquity.toFixed(2) : null,
    tradeCount: r.tradeCount,
    ratingDelta: r.ratingDelta,
  };
}

function toWeeklyItem(r: WeeklyHistoryRow): WeeklyDuelHistoryItem {
  return {
    seasonId: r.seasonId,
    weekStart: r.weekStart,
    date: r.createdAt,
    rank: r.rank,
    leagueSize: r.leagueSize,
    tier: r.tier,
    nextTier: r.nextTier,
    result: r.result,
    returnPct: r.returnPct,
    tradeCount: r.tradeCount,
    ratingDelta: r.ratingDelta,
    ratingResult: r.ratingResult,
  };
}

function toRatingsSection(overview: {
  learning: {
    rating: number;
    displayRating: number;
    tier: string;
    provisional: boolean;
    gamesPlayed: number;
    wins: number;
    draws: number;
    losses: number;
  };
  trading: {
    rating: number;
    displayRating: number;
    tier: string;
    provisional: boolean;
    gamesPlayed: number;
    wins: number;
    draws: number;
    losses: number;
  };
  candleRating: number;
  candleDisplayRating: number;
  candleTier: string;
}): RatingsSection {
  return {
    learning: {
      rating: overview.learning.rating,
      displayRating: overview.learning.displayRating,
      tier: overview.learning.tier,
      provisional: overview.learning.provisional,
      gamesPlayed: overview.learning.gamesPlayed,
      wins: overview.learning.wins,
      draws: overview.learning.draws,
      losses: overview.learning.losses,
    },
    trading: {
      rating: overview.trading.rating,
      displayRating: overview.trading.displayRating,
      tier: overview.trading.tier,
      provisional: overview.trading.provisional,
      gamesPlayed: overview.trading.gamesPlayed,
      wins: overview.trading.wins,
      draws: overview.trading.draws,
      losses: overview.trading.losses,
    },
    candleRating: overview.candleRating,
    candleDisplayRating: overview.candleDisplayRating,
    candleTier: overview.candleTier,
  };
}

function toRankSection(overview: {
  learning: {
    globalRank: number | null;
    globalPercentile: number | null;
    countryRank: number | null;
    countryPercentile: number | null;
  };
  trading: {
    globalRank: number | null;
    globalPercentile: number | null;
    countryRank: number | null;
    countryPercentile: number | null;
  };
}): RankSection {
  return {
    learning: {
      globalRank: overview.learning.globalRank,
      globalPercentile: overview.learning.globalPercentile,
      countryRank: overview.learning.countryRank,
      countryPercentile: overview.learning.countryPercentile,
    },
    trading: {
      globalRank: overview.trading.globalRank,
      globalPercentile: overview.trading.globalPercentile,
      countryRank: overview.trading.countryRank,
      countryPercentile: overview.trading.countryPercentile,
    },
  };
}

function toLearningProgress(
  tracks: Array<{
    trackId: string;
    slug: string;
    title: string;
    completedLessons: number;
    totalLessons: number;
  }>
): LearningProgressSection {
  const current = tracks.find((t) => t.completedLessons < t.totalLessons) ?? null;
  return {
    tracks,
    currentTrack: current ? { slug: current.slug, title: current.title } : null,
  };
}
