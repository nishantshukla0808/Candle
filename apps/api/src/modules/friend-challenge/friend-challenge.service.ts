import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { ChallengeStatus, DuelType } from '@prisma/client';
import { DUELS, RATING_DUEL_REMATCH_COOLDOWN_MINUTES } from '@candle/shared';
import { AppError } from '../../common/errors/app-error';
import { AppLogger } from '../../common/services/logger.service';
import { RedisService } from '../../common/services/redis.service';
import { DuelsRepository } from '../duels/duels.repository';
import { LiveDuelEngine } from '../duels/live-duel-engine.service';
import type { LiveDuelVariant } from '../duels/live-duel-variants';
import { RatingsService } from '../ratings/ratings.service';
import { SprintRepository } from '../trading-sprint/sprint.repository';
import { SprintEngine } from '../trading-sprint/sprint-engine.service';
import {
  expiresAtFrom,
  expiresInMs,
  inviteLinkFor,
  isLiveChallengeType,
  isTradingChallengeType,
  playPathFor,
  ratingKindFor,
  type ChallengeDuelType,
} from './challenge-rules';
import type { CreateChallengeDto } from './dto/challenge.dto';
import { FriendChallengeRepository, type ChallengeRow } from './friend-challenge.repository';

/**
 * Friend Challenge — Phase 12 (docs/17, ADR 0014).
 *
 * An invite-only START-MODE for the existing duel engines, not a
 * separate engine and not the friends system (doc 06 — no friend
 * requests, lists, or chat are built here). A player challenges one
 * specific opponent, by userId, to one of the six 1v1 duel types.
 * The invitee accepts and the duel starts immediately via the
 * existing engine — LiveDuelEngine.createLiveDuel for LIVE / BLITZ /
 * CASE / CHART, SprintEngine.createSprint / createCrisis for SPRINT /
 * CRISIS — bypassing matchmaking, because the pair is already chosen.
 * The duel then plays, settles, and rates exactly like a matchmade
 * duel of the same type: same timers, same scoring, same Rating path,
 * same rematch offer at the end.
 */

export const CHALLENGES_DISCLAIMER =
  'Educational purpose only — this is not investment advice. ' +
  'Friend Challenges are rated duels with virtual money only; there are no stakes, no wagering, and no real money.';

export interface ChallengeParticipantView {
  userId: string;
  displayName: string | null;
  /** Learning or Trading Rating at view time (docs/05 §3.3: the Rating range is shown before accepting). */
  rating: number;
}

export interface ChallengeView {
  id: string;
  duelType: ChallengeDuelType;
  /** A Friend Challenge is always rated (ADR 0014 §3) — no unrated toggle. */
  rated: true;
  ratingKind: 'LEARNING' | 'TRADING';
  creator: ChallengeParticipantView;
  invitee: ChallengeParticipantView;
  status: ChallengeStatus;
  inviteCode: string;
  /** The link the opponent opens: /duels/challenge?code={inviteCode}. */
  inviteLink: string;
  /** The Duel row created at accept; null until PLAYED. */
  duelId: string | null;
  /** Where to play after accept (the variant's play page — it resumes the active duel on load). */
  playUrl: string | null;
  createdAt: Date;
  expiresAt: Date;
  /** Milliseconds until expiry (negative once expired) — the countdown the UI shows. */
  expiresInMs: number;
  updatedAt: Date;
}

export interface AcceptChallengeResult {
  challenge: ChallengeView;
  duelId: string;
  playUrl: string;
}

const RATE_LIMIT_KEY_PREFIX = 'challenge:create:';

@Injectable()
export class FriendChallengeService {
  constructor(
    private readonly repo: FriendChallengeRepository,
    private readonly duelsRepo: DuelsRepository,
    private readonly sprintRepo: SprintRepository,
    private readonly ratings: RatingsService,
    private readonly liveEngine: LiveDuelEngine,
    private readonly sprintEngine: SprintEngine,
    private readonly redis: RedisService,
    private readonly logger: AppLogger
  ) {}

  // --- create ----------------------------------------------------------------------

  /**
   * Creates a PENDING challenge. Order of checks (each is a distinct
   * failure, so the caller knows what to fix): yourself → opponent
   * exists → rate limit (10/hour) → duplicate pending → either player
   * busy in a live duel. A declined/expired challenge never blocks a
   * new one — only PENDING or ACCEPTED does (docs/17 §5).
   */
  async createChallenge(
    creatorId: string,
    dto: CreateChallengeDto,
    now: Date = new Date()
  ): Promise<ChallengeView> {
    const duelType = dto.duelType as ChallengeDuelType;
    if (dto.opponentId === creatorId) {
      throw AppError.validationFailed([
        { field: 'opponentId', issue: 'You cannot challenge yourself.' },
      ]);
    }
    const opponent = await this.duelsRepo.findUserById(dto.opponentId);
    if (!opponent) throw AppError.notFound('Opponent not found.');
    await this.checkCreateRateLimit(creatorId, now);
    const blocking = await this.repo.findBlockingBetween(creatorId, dto.opponentId, duelType);
    if (blocking) {
      throw AppError.challengeAlreadyPending(
        'You already have a pending challenge with this player for this duel type.'
      );
    }
    await this.assertNeitherBusy(creatorId, dto.opponentId);
    const row = await this.repo.create({
      creatorId,
      inviteeId: dto.opponentId,
      duelType,
      inviteCode: randomBytes(8).toString('hex'),
      expiresAt: expiresAtFrom(now),
    });
    this.logger.info('Friend challenge created', {
      challengeId: row.id,
      creatorId,
      inviteeId: dto.opponentId,
      duelType,
    });
    return this.toView(row, now);
  }

  // --- reads -------------------------------------------------------------------------

  /** One challenge, for a participant only (creator or invitee). */
  async getChallenge(userId: string, id: string, now: Date = new Date()): Promise<ChallengeView> {
    const row = await this.repo.findById(id);
    if (!row) throw AppError.notFound('Challenge not found.');
    if (row.creatorId !== userId && row.inviteeId !== userId) throw AppError.forbidden();
    return this.toView(await this.settleStale(row, now), now);
  }

  /**
   * Open an invite link. The code is unguessable, but possession of
   * the link is NOT identity: only the invitee may see it, and anyone
   * else gets the same 404 as a bad code (no user enumeration, no
   * invite leak to a forwarded link).
   */
  async getByInviteCode(
    userId: string,
    code: string,
    now: Date = new Date()
  ): Promise<ChallengeView> {
    const row = await this.repo.findByInviteCode(code);
    if (!row || row.inviteeId !== userId) throw AppError.notFound('Challenge not found.');
    return this.toView(await this.settleStale(row, now), now);
  }

  /** My pending incoming challenges (I am the invitee), newest first. */
  async listIncoming(userId: string, now: Date = new Date()): Promise<ChallengeView[]> {
    const rows = await this.repo.listPendingIncoming(userId);
    const views: ChallengeView[] = [];
    for (const row of rows) views.push(await this.toView(await this.settleStale(row, now), now));
    return views.filter((v) => v.status === ChallengeStatus.PENDING);
  }

  /** My pending outgoing challenges (I am the creator), newest first. */
  async listOutgoing(userId: string, now: Date = new Date()): Promise<ChallengeView[]> {
    const rows = await this.repo.listPendingOutgoing(userId);
    const views: ChallengeView[] = [];
    for (const row of rows) views.push(await this.toView(await this.settleStale(row, now), now));
    return views.filter((v) => v.status === ChallengeStatus.PENDING);
  }

  // --- accept / decline ----------------------------------------------------------------

  /**
   * Accepts a challenge — invitee only — and starts the duel
   * immediately via the existing engine (no matchmaking queue).
   *
   * State machine (ADR 0014 §5, docs/17 §5): PENDING → ACCEPTED →
   * PLAYED, all inside this one call. ACCEPTED is a claim, not a
   * resting state: it is written, the duel is created, and the row
   * moves to PLAYED with the duelId. If duel creation fails, the
   * claim is reverted to PENDING and the error propagates — the
   * challenge is never left in ACCEPTED by a failed accept. A crash
   * between the claim and the duel is recovered lazily: settleStale
   * reverts an ACCEPTED row with no duelId after 5 minutes.
   *
   * Checks at accept (state may have changed since create): invitee
   * only, still PENDING, not expired, neither player busy in a live
   * duel, 5-minute rematch cooldown for the pair + type. The rated
   * caps (same pair max 3/day, max 10 rated events/user/day) are
   * enforced at SETTLEMENT by the Ratings service, exactly as for a
   * matchmade duel — a cap hit settles the played duel unrated with
   * the reason in plain words, rather than wasting the duel (ADR 0007 §8).
   */
  async acceptChallenge(
    userId: string,
    id: string,
    now: Date = new Date()
  ): Promise<AcceptChallengeResult> {
    const found = await this.repo.findById(id);
    if (!found) throw AppError.notFound('Challenge not found.');
    const row = await this.settleStale(found, now);
    if (row.inviteeId !== userId) throw AppError.forbidden();
    if (row.status === ChallengeStatus.EXPIRED) {
      throw AppError.challengeExpired('This challenge has expired. Ask for a new one to play.');
    }
    if (row.status !== ChallengeStatus.PENDING) {
      throw AppError.challengeNotPending('This challenge is no longer waiting for an answer.');
    }
    if (now.getTime() > row.expiresAt.getTime()) {
      await this.repo.update(row.id, { status: ChallengeStatus.EXPIRED });
      throw AppError.challengeExpired('This challenge has expired. Ask for a new one to play.');
    }
    await this.assertNeitherBusy(row.creatorId, row.inviteeId);
    await this.assertRematchCooldown(row.creatorId, row.inviteeId, row.duelType, now);
    // Claim it: a second accept racing this one now sees ACCEPTED, not PENDING.
    await this.repo.update(row.id, { status: ChallengeStatus.ACCEPTED });
    let duelId: string;
    try {
      const state = await this.startDuel(row.creatorId, row.inviteeId, row.duelType, now);
      duelId = state.duelId;
    } catch (err) {
      // Duel creation failed — revert the claim, never leave ACCEPTED behind.
      await this.repo.update(row.id, { status: ChallengeStatus.PENDING });
      throw err;
    }
    const played = await this.repo.update(row.id, {
      status: ChallengeStatus.PLAYED,
      duelId,
    });
    this.logger.info('Friend challenge accepted — duel started', {
      challengeId: row.id,
      duelId,
      duelType: row.duelType,
    });
    const playUrl = playPathFor(row.duelType as ChallengeDuelType);
    return { challenge: await this.toView(played, now), duelId, playUrl };
  }

  /** Declines a challenge — invitee only. A decline never counts toward any cap. */
  async declineChallenge(
    userId: string,
    id: string,
    now: Date = new Date()
  ): Promise<ChallengeView> {
    const found = await this.repo.findById(id);
    if (!found) throw AppError.notFound('Challenge not found.');
    const row = await this.settleStale(found, now);
    if (row.inviteeId !== userId) throw AppError.forbidden();
    if (row.status === ChallengeStatus.EXPIRED) {
      throw AppError.challengeExpired('This challenge has already expired.');
    }
    if (row.status !== ChallengeStatus.PENDING) {
      throw AppError.challengeNotPending('This challenge is no longer waiting for an answer.');
    }
    const declined = await this.repo.update(row.id, { status: ChallengeStatus.DECLINED });
    this.logger.info('Friend challenge declined', { challengeId: row.id, userId });
    return this.toView(declined, now);
  }

  // --- duel start (existing engines only — no new engine) ------------------------------

  /**
   * Starts the duel via the engine that already owns the type. The
   * creator is playerA, the invitee playerB; both Ratings are read
   * fresh here (not at create time — a Rating may have moved while
   * the invite waited). No matchmaking queue is touched.
   */
  private async startDuel(
    creatorId: string,
    inviteeId: string,
    duelType: DuelType,
    now: Date
  ): Promise<{ duelId: string }> {
    const type = duelType as ChallengeDuelType;
    const [creatorUser, inviteeUser, creatorRatings, inviteeRatings] = await Promise.all([
      this.duelsRepo.findUserById(creatorId),
      this.duelsRepo.findUserById(inviteeId),
      this.ratings.getUserRatings(creatorId),
      this.ratings.getUserRatings(inviteeId),
    ]);
    if (!creatorUser || !inviteeUser) throw AppError.notFound('Opponent not found.');
    if (isLiveChallengeType(type)) {
      const state = await this.liveEngine.createLiveDuel(
        {
          userId: creatorId,
          displayName: creatorUser.displayName ?? 'Player',
          rating: creatorRatings.learning.rating,
        },
        {
          userId: inviteeId,
          displayName: inviteeUser.displayName ?? 'Player',
          rating: inviteeRatings.learning.rating,
        },
        now,
        type as LiveDuelVariant
      );
      return { duelId: state.duelId };
    }
    if (isTradingChallengeType(type)) {
      const a = {
        userId: creatorId,
        displayName: creatorUser.displayName ?? 'Player',
        rating: creatorRatings.trading.rating,
      };
      const b = {
        userId: inviteeId,
        displayName: inviteeUser.displayName ?? 'Player',
        rating: inviteeRatings.trading.rating,
      };
      const state =
        type === 'CRISIS'
          ? await this.sprintEngine.createCrisis(a, b, now)
          : await this.sprintEngine.createSprint(a, b, now);
      return { duelId: state.duelId };
    }
    throw AppError.validationFailed([
      { field: 'duelType', issue: 'This duel type cannot be challenged.' },
    ]);
  }

  // --- guards ---------------------------------------------------------------------------

  /**
   * Rate limit: max 10 challenge creates per user per UTC hour
   * (ADR 0014 §6, doc 06 §4.6 allows 10 duel challenges per hour).
   * Redis counter per hour bucket; the key expires after the hour so
   * no cleanup job is needed.
   */
  private async checkCreateRateLimit(userId: string, now: Date): Promise<void> {
    const bucket = now.toISOString().slice(0, 13); // YYYY-MM-DDTHH (UTC)
    const key = `${RATE_LIMIT_KEY_PREFIX}${userId}:${bucket}`;
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, 3600);
    if (count > DUELS.CHALLENGE_CREATE_PER_HOUR) {
      throw AppError.rateLimited(
        `You can send at most ${DUELS.CHALLENGE_CREATE_PER_HOUR} challenges per hour. Try again later.`
      );
    }
  }

  /**
   * Neither player may be in a live duel right now — live question
   * duels (LIVE / BLITZ / CASE / CHART) or trading duels (SPRINT /
   * CRISIS). A player already playing cannot start another duel, and
   * cannot be challenged into one (docs/17 §8).
   */
  private async assertNeitherBusy(userAId: string, userBId: string): Promise<void> {
    for (const userId of [userAId, userBId]) {
      const live = await this.duelsRepo.findActiveLiveDuelForUser(userId);
      if (live) throw AppError.duelLiveAlreadyActive();
      const sprint = await this.sprintRepo.findActiveTradingDuelForUser(userId, DuelType.SPRINT);
      if (sprint) throw AppError.sprintAlreadyActive();
      const crisis = await this.sprintRepo.findActiveTradingDuelForUser(userId, DuelType.CRISIS);
      if (crisis) throw AppError.crisisAlreadyActive();
    }
  }

  /**
   * 5-minute rematch cooldown for the pair + duel type (docs/04 §5),
   * enforced at ACCEPT — not at settlement, where it would waste a
   * played duel. Same rule the rematch offer enforces; a challenge is
   * a rematch by another name when the pair just played.
   */
  private async assertRematchCooldown(
    userAId: string,
    userBId: string,
    duelType: DuelType,
    now: Date
  ): Promise<void> {
    const last = isLiveChallengeType(duelType as ChallengeDuelType)
      ? await this.duelsRepo.findLastLiveDuelBetween(userAId, userBId, duelType)
      : await this.sprintRepo.findLastTradingDuelBetween(userAId, userBId, duelType);
    const cooldownMs = RATING_DUEL_REMATCH_COOLDOWN_MINUTES * 60 * 1000;
    if (last?.finishedAt && now.getTime() - last.finishedAt.getTime() < cooldownMs) {
      throw AppError.ratingDuelCooldown(
        `Wait ${RATING_DUEL_REMATCH_COOLDOWN_MINUTES} minutes before a rematch against the same opponent.`
      );
    }
  }

  /**
   * Lazy lifecycle (no scheduler yet — same pattern as the Daily
   * settle-unpaired ADMIN endpoint): a PENDING challenge past its
   * expiry becomes EXPIRED on read, and an ACCEPTED challenge with
   * no duelId older than 5 minutes is reverted to PENDING (the
   * accept that claimed it crashed before creating the duel — ADR
   * 0014 §5). Every read path runs this first, so no caller ever
   * acts on a stale status.
   */
  private async settleStale(row: ChallengeRow, now: Date): Promise<ChallengeRow> {
    if (row.status === ChallengeStatus.PENDING && now.getTime() > row.expiresAt.getTime()) {
      return this.repo.update(row.id, { status: ChallengeStatus.EXPIRED });
    }
    if (
      row.status === ChallengeStatus.ACCEPTED &&
      !row.duelId &&
      now.getTime() - row.updatedAt.getTime() > DUELS.CHALLENGE_STALE_ACCEPTED_MINUTES * 60 * 1000
    ) {
      return this.repo.update(row.id, { status: ChallengeStatus.PENDING });
    }
    return row;
  }

  // --- views ------------------------------------------------------------------------------

  private async toView(row: ChallengeRow, now: Date): Promise<ChallengeView> {
    const type = row.duelType as ChallengeDuelType;
    const kind = ratingKindFor(type);
    const [creatorUser, inviteeUser, creatorRatings, inviteeRatings] = await Promise.all([
      this.duelsRepo.findUserById(row.creatorId),
      this.duelsRepo.findUserById(row.inviteeId),
      this.ratings.getUserRatings(row.creatorId),
      this.ratings.getUserRatings(row.inviteeId),
    ]);
    const ratingOf = (ratings: Awaited<ReturnType<RatingsService['getUserRatings']>>): number =>
      kind === 'LEARNING' ? ratings.learning.rating : ratings.trading.rating;
    return {
      id: row.id,
      duelType: type,
      rated: true,
      ratingKind: kind,
      creator: {
        userId: row.creatorId,
        displayName: creatorUser?.displayName ?? null,
        rating: ratingOf(creatorRatings),
      },
      invitee: {
        userId: row.inviteeId,
        displayName: inviteeUser?.displayName ?? null,
        rating: ratingOf(inviteeRatings),
      },
      status: row.status,
      inviteCode: row.inviteCode,
      inviteLink: inviteLinkFor(row.inviteCode),
      duelId: row.duelId,
      playUrl: row.duelId ? playPathFor(type) : null,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      expiresInMs: expiresInMs(row.expiresAt, now),
      updatedAt: row.updatedAt,
    };
  }
}
