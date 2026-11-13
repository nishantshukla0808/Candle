import { Injectable } from '@nestjs/common';
import { DuelType } from '@prisma/client';
import { DUELS } from '@candle/shared';
import { AppError } from '../../common/errors/app-error';
import { AppLogger } from '../../common/services/logger.service';
import { RedisService } from '../../common/services/redis.service';
import { LiveDuelEngine } from '../duels/live-duel-engine.service';
import { SprintRepository } from '../trading-sprint/sprint.repository';
import {
  crisisQueueEntryKey,
  crisisQueueKey,
  sprintBotOfferDue,
  sprintWindowForWait,
} from '../trading-sprint/sprint-state';

/**
 * Crisis matchmaking — docs/05 §3.3, docs/15 §6 (Phase 10).
 *
 * The mirror of SprintMatchmakingService, on the crisis keyspace:
 * one Redis sorted set (`crisis:queue`), member = user id, score =
 * TRADING Rating; one per-user entry key (`crisis:queue-entry:{userId}`,
 * JSON) carrying the rating + join time. The queue is Redis only —
 * never a Postgres table. A user holds at most ONE crisis queue entry.
 *
 * Separation is structural: the queue key is `crisis:queue` and the
 * sweep only ever pairs crisis waiters — a crisis waiter is never
 * matched into a sprint or a learning duel, and a sprint waiter is
 * never matched into a crisis (proven in e2e). The windows are the
 * same as the sprint's (±50 → ±100 → ±200 → ±400 on the Trading
 * Rating), the bot offer is the same (Mira, after 30 s), and the
 * 5-second sweep pairs waiters whose windows overlap (earliest first,
 * nearest Rating wins; stale members skipped).
 *
 * Queue-level rules only (anti-farming lives at settlement, in
 * Ratings): one queue entry per user, no queueing while a crisis
 * duel, a sprint, or a live quiz duel is active.
 */

export interface CrisisQueueEntry {
  userId: string;
  /** Trading Rating at queue time. */
  rating: number;
  joinedAtMs: number;
}

export interface CrisisQueueStatus {
  queued: boolean;
  userId: string;
  rating: number | null;
  joinedAtMs: number | null;
  waitedMs: number;
  /** Current Trading Rating window (±) for this wait. */
  ratingWindow: number;
  /** True once 30 s have passed with no human match (bot offer due). */
  botOfferDue: boolean;
}

export interface CrisisMatchCandidate {
  opponentId: string;
  opponentRating: number;
  waitedMs: number;
  ratingWindow: number;
}

@Injectable()
export class CrisisMatchmakingService {
  constructor(
    private readonly redis: RedisService,
    private readonly repo: SprintRepository,
    private readonly liveEngine: LiveDuelEngine,
    private readonly logger: AppLogger
  ) {}

  /** Join the crisis queue. Throws when already queued or in a duel. */
  async enqueue(
    userId: string,
    rating: number,
    now: Date = new Date()
  ): Promise<CrisisQueueStatus> {
    const existing = await this.redis.get(crisisQueueEntryKey(userId));
    if (existing) {
      throw AppError.crisisAlreadyQueued();
    }
    const activeCrisis = await this.repo.findActiveTradingDuelForUser(userId, DuelType.CRISIS);
    if (activeCrisis) {
      throw AppError.crisisAlreadyActive();
    }
    // One trading duel at a time: a player mid-sprint cannot queue for
    // a crisis either (and vice versa — the sprint matchmaking checks
    // its own type only, so this side carries the cross-check; the
    // sprint side is the known one-directional gap, ADR 0011 §8.5,
    // extended to crisis in ADR 0012 §8.4).
    const activeSprint = await this.repo.findActiveTradingDuelForUser(userId, DuelType.SPRINT);
    if (activeSprint) {
      throw AppError.sprintAlreadyActive();
    }
    const activeLive = await this.liveEngine.activeDuelSummary(userId).catch(() => null);
    if (activeLive) {
      throw AppError.duelLiveAlreadyActive();
    }
    const entry: CrisisQueueEntry = { userId, rating, joinedAtMs: now.getTime() };
    await this.redis.zadd(crisisQueueKey(), rating, userId);
    await this.redis.set(
      crisisQueueEntryKey(userId),
      JSON.stringify(entry),
      DUELS.CRISIS_QUEUE_TTL_SEC
    );
    this.logger.info('Crisis queued', { userId, rating });
    return this.statusOf(entry, now.getTime());
  }

  /** Leave the queue cleanly (cancel). Idempotent: leaving when not queued is a no-op. */
  async dequeue(userId: string): Promise<void> {
    await this.redis.zrem(crisisQueueKey(), userId);
    await this.redis.del(crisisQueueEntryKey(userId));
  }

  /** Current queue status for a user (never throws for a non-queued user). */
  async status(userId: string, now: Date = new Date()): Promise<CrisisQueueStatus> {
    const raw = await this.redis.get(crisisQueueEntryKey(userId));
    if (!raw) {
      return {
        queued: false,
        userId,
        rating: null,
        joinedAtMs: null,
        waitedMs: 0,
        ratingWindow: sprintWindowForWait(0),
        botOfferDue: false,
      };
    }
    const entry = JSON.parse(raw) as CrisisQueueEntry;
    return this.statusOf(entry, now.getTime());
  }

  /**
   * Find the best opponent in the caller's current window, or null.
   * The caller stays queued when no match is found.
   */
  async findOpponent(userId: string, now: Date = new Date()): Promise<CrisisMatchCandidate | null> {
    const raw = await this.redis.get(crisisQueueEntryKey(userId));
    if (!raw) return null;
    const entry = JSON.parse(raw) as CrisisQueueEntry;
    const waitedMs = now.getTime() - entry.joinedAtMs;
    const window = sprintWindowForWait(waitedMs);
    const members = await this.redis.zrangebyscore(
      crisisQueueKey(),
      entry.rating - window,
      entry.rating + window
    );
    // zrangebyscore returns [member, score, member, score, ...], lowest first.
    const candidates: Array<{ id: string; rating: number }> = [];
    for (let i = 0; i < members.length; i += 2) {
      const id = members[i] as string;
      const score = Number(members[i + 1]);
      if (id && id !== userId) candidates.push({ id, rating: score });
    }
    if (candidates.length === 0) return null;
    // Nearest Rating wins; ties break by earliest join (entry lookup).
    let best: { id: string; rating: number; joinedAtMs: number } | null = null;
    for (const c of candidates) {
      const otherRaw = await this.redis.get(crisisQueueEntryKey(c.id));
      if (!otherRaw) continue; // stale member — entry expired, skip
      const other = JSON.parse(otherRaw) as CrisisQueueEntry;
      const dist = Math.abs(c.rating - entry.rating);
      if (
        !best ||
        dist < Math.abs(best.rating - entry.rating) ||
        (dist === Math.abs(best.rating - entry.rating) && other.joinedAtMs < best.joinedAtMs)
      ) {
        best = { id: c.id, rating: c.rating, joinedAtMs: other.joinedAtMs };
      }
    }
    if (!best) return null;
    return {
      opponentId: best.id,
      opponentRating: best.rating,
      waitedMs,
      ratingWindow: window,
    };
  }

  private statusOf(entry: CrisisQueueEntry, nowMs: number): CrisisQueueStatus {
    const waitedMs = Math.max(0, nowMs - entry.joinedAtMs);
    return {
      queued: true,
      userId: entry.userId,
      rating: entry.rating,
      joinedAtMs: entry.joinedAtMs,
      waitedMs,
      ratingWindow: sprintWindowForWait(waitedMs),
      botOfferDue: sprintBotOfferDue(waitedMs),
    };
  }

  /**
   * Pair every waiter whose window reaches another waiter. Earliest
   * joiner first; nearest Rating in their window wins. Returns the
   * pairs; the caller removes both players from the queue and creates
   * the crisis duels. Pure pairing over Redis reads — no duel is created here.
   */
  async sweep(): Promise<Array<{ a: CrisisQueueEntry; b: CrisisQueueEntry }>> {
    const members = await this.redis.zrangebyscore(
      crisisQueueKey(),
      Number.NEGATIVE_INFINITY,
      Number.POSITIVE_INFINITY
    );
    const entries: CrisisQueueEntry[] = [];
    for (let i = 0; i < members.length; i += 2) {
      const id = members[i] as string;
      if (!id) continue;
      const raw = await this.redis.get(crisisQueueEntryKey(id));
      if (!raw) continue; // stale member — entry expired
      entries.push(JSON.parse(raw) as CrisisQueueEntry);
    }
    entries.sort((x, y) => x.joinedAtMs - y.joinedAtMs);
    const used = new Set<string>();
    const pairs: Array<{ a: CrisisQueueEntry; b: CrisisQueueEntry }> = [];
    const nowMs = Date.now();
    for (const entry of entries) {
      if (used.has(entry.userId)) continue;
      const window = sprintWindowForWait(nowMs - entry.joinedAtMs);
      let best: CrisisQueueEntry | null = null;
      for (const other of entries) {
        if (other.userId === entry.userId || used.has(other.userId)) continue;
        const dist = Math.abs(other.rating - entry.rating);
        if (dist > window) continue;
        if (
          !best ||
          dist < Math.abs(best.rating - entry.rating) ||
          (dist === Math.abs(best.rating - entry.rating) && other.joinedAtMs < best.joinedAtMs)
        ) {
          best = other;
        }
      }
      if (best) {
        used.add(entry.userId);
        used.add(best.userId);
        pairs.push({ a: entry, b: best });
      }
    }
    return pairs;
  }
}
