import { Injectable } from '@nestjs/common';
import { DUELS } from '@candle/shared';
import { AppError } from '../../common/errors/app-error';
import { AppLogger } from '../../common/services/logger.service';
import { RedisService } from '../../common/services/redis.service';
import { DuelsRepository } from './duels.repository';
import { botOfferDue, liveQueueEntryKey, liveQueueKey, windowForWait } from './live-duel-state';
import type { LiveDuelVariant } from './live-duel-variants';

/**
 * Live matchmaking — docs/05 §3.3, docs/09 (Phase 5), Phase 6 (Blitz),
 * Phase 7 (Case Duel, ADR 0009), Phase 8 (Chart Detective, ADR 0010).
 *
 * The queue is a Redis sorted set per variant (`live:queue:LIVE`,
 * `live:queue:BLITZ`, `live:queue:CASE`, `live:queue:CHART`), member = user id, score =
 * Learning Rating. One queue per variant: a Speed Quiz waiter is
 * never matched into a Blitz, Case, or Chart duel, and vice versa. A per-user
 * entry key (`live:queue-entry:{userId}`, JSON) carries the rating +
 * join time + variant, so the window can be computed from the wait
 * and a stale member can be recognised. The queue is Redis only —
 * never a Postgres table. A user holds at most ONE queue entry (any variant).
 *
 * Matching window widens with wait time: ±50 (0–5 s) → ±100 (5–15 s) →
 * ±200 (15–30 s) → ±400 (30+ s). The nearest Rating in the window wins;
 * ties break by earliest join. After 30 s with no human match the
 * caller is offered the Mira bot instead of waiting (docs/05 §3.3).
 *
 * Anti-farming (docs/04 §5, enforced at settlement by Ratings): same
 * pair max 3 rated duels/day, max 10 rated events/user/day, 5-minute
 * rematch cooldown. This service enforces the queue-level rules only:
 * one queue entry per user, and no queueing while a live duel is active.
 */

export interface QueueEntry {
  userId: string;
  rating: number;
  joinedAtMs: number;
  /** Which queue this entry sits in (LIVE, BLITZ, CASE, or CHART). */
  variant: LiveDuelVariant;
}

export interface QueueStatus {
  queued: boolean;
  userId: string;
  rating: number | null;
  joinedAtMs: number | null;
  /** Which queue the user is in; null when not queued. */
  variant: LiveDuelVariant | null;
  waitedMs: number;
  /** Current Rating window (±) for this wait. */
  ratingWindow: number;
  /** True once 30 s have passed with no human match (bot offer due). */
  botOfferDue: boolean;
}

export interface MatchCandidate {
  opponentId: string;
  opponentRating: number;
  waitedMs: number;
  ratingWindow: number;
  variant: LiveDuelVariant;
}

@Injectable()
export class LiveMatchmakingService {
  constructor(
    private readonly redis: RedisService,
    private readonly repo: DuelsRepository,
    private readonly logger: AppLogger
  ) {}

  /** Join the live queue. Throws when already queued or in a live duel. */
  async enqueue(
    userId: string,
    rating: number,
    now: Date = new Date(),
    variant: LiveDuelVariant = 'LIVE'
  ): Promise<QueueStatus> {
    const existing = await this.redis.get(liveQueueEntryKey(userId));
    if (existing) {
      throw AppError.duelAlreadyQueued();
    }
    const active = await this.repo.findActiveLiveDuelForUser(userId);
    if (active) {
      throw AppError.duelLiveAlreadyActive();
    }
    const entry: QueueEntry = { userId, rating, joinedAtMs: now.getTime(), variant };
    await this.redis.zadd(liveQueueKey(variant), rating, userId);
    await this.redis.set(
      liveQueueEntryKey(userId),
      JSON.stringify(entry),
      DUELS.LIVE_QUEUE_TTL_SEC
    );
    this.logger.info('Live duel queued', { userId, rating, variant });
    return this.statusOf(entry, now.getTime());
  }

  /** Leave the queue cleanly (cancel). Idempotent: leaving when not queued is a no-op. */
  async dequeue(userId: string): Promise<void> {
    const raw = await this.redis.get(liveQueueEntryKey(userId));
    const variant: LiveDuelVariant = raw
      ? ((JSON.parse(raw) as QueueEntry).variant ?? 'LIVE')
      : 'LIVE';
    await this.redis.zrem(liveQueueKey(variant), userId);
    // Belt-and-braces: a stale member in another queue (entry lost
    // mid-write) must not linger and match later.
    for (const other of ['LIVE', 'BLITZ', 'CASE', 'CHART'] as const) {
      if (other !== variant) await this.redis.zrem(liveQueueKey(other), userId);
    }
    await this.redis.del(liveQueueEntryKey(userId));
  }

  /** Current queue status for a user (never throws for a non-queued user). */
  async status(userId: string, now: Date = new Date()): Promise<QueueStatus> {
    const raw = await this.redis.get(liveQueueEntryKey(userId));
    if (!raw) {
      return {
        queued: false,
        userId,
        rating: null,
        joinedAtMs: null,
        variant: null,
        waitedMs: 0,
        ratingWindow: windowForWait(0),
        botOfferDue: false,
      };
    }
    const entry = JSON.parse(raw) as QueueEntry;
    return this.statusOf(entry, now.getTime());
  }

  /**
   * Find the best opponent in the caller's current window, or null.
   * The caller stays queued when no match is found. Only the caller's
   * own variant queue is searched — a LIVE waiter never sees a BLITZ
   * waiter. Callers remove both players from the queue only after a
   * duel is created.
   */
  async findOpponent(userId: string, now: Date = new Date()): Promise<MatchCandidate | null> {
    const raw = await this.redis.get(liveQueueEntryKey(userId));
    if (!raw) return null;
    const entry = JSON.parse(raw) as QueueEntry;
    const variant = entry.variant ?? 'LIVE';
    const waitedMs = now.getTime() - entry.joinedAtMs;
    const window = windowForWait(waitedMs);
    const members = await this.redis.zrangebyscore(
      liveQueueKey(variant),
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
      const otherRaw = await this.redis.get(liveQueueEntryKey(c.id));
      if (!otherRaw) continue; // stale member — entry expired, skip
      const other = JSON.parse(otherRaw) as QueueEntry;
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
      variant,
    };
  }

  private statusOf(entry: QueueEntry, nowMs: number): QueueStatus {
    const waitedMs = Math.max(0, nowMs - entry.joinedAtMs);
    return {
      queued: true,
      userId: entry.userId,
      rating: entry.rating,
      joinedAtMs: entry.joinedAtMs,
      variant: entry.variant ?? 'LIVE',
      waitedMs,
      ratingWindow: windowForWait(waitedMs),
      botOfferDue: botOfferDue(waitedMs),
    };
  }

  /**
   * Pair every waiter whose window reaches another waiter. Earliest
   * joiner first; nearest Rating in their window wins. Returns the
   * pairs (each with its variant); the caller removes both players
   * from the queue and creates the duels. Pairing is per variant —
   * the sweep reads each variant's queue separately, so a LIVE waiter
   * and a BLITZ waiter can never be paired. Pure pairing over Redis
   * reads — no duel is created here.
   */
  async sweep(): Promise<Array<{ a: QueueEntry; b: QueueEntry; variant: LiveDuelVariant }>> {
    const pairs: Array<{ a: QueueEntry; b: QueueEntry; variant: LiveDuelVariant }> = [];
    for (const variant of ['LIVE', 'BLITZ', 'CASE', 'CHART'] as const) {
      pairs.push(...(await this.sweepVariant(variant)));
    }
    return pairs;
  }

  private async sweepVariant(
    variant: LiveDuelVariant
  ): Promise<Array<{ a: QueueEntry; b: QueueEntry; variant: LiveDuelVariant }>> {
    const members = await this.redis.zrangebyscore(
      liveQueueKey(variant),
      Number.NEGATIVE_INFINITY,
      Number.POSITIVE_INFINITY
    );
    const entries: QueueEntry[] = [];
    for (let i = 0; i < members.length; i += 2) {
      const id = members[i] as string;
      if (!id) continue;
      const raw = await this.redis.get(liveQueueEntryKey(id));
      if (!raw) continue; // stale member — entry expired
      const entry = JSON.parse(raw) as QueueEntry;
      if ((entry.variant ?? 'LIVE') !== variant) continue; // wrong queue — stale member
      entries.push(entry);
    }
    entries.sort((x, y) => x.joinedAtMs - y.joinedAtMs);
    const used = new Set<string>();
    const pairs: Array<{ a: QueueEntry; b: QueueEntry; variant: LiveDuelVariant }> = [];
    const nowMs = Date.now();
    for (const entry of entries) {
      if (used.has(entry.userId)) continue;
      const window = windowForWait(nowMs - entry.joinedAtMs);
      let best: QueueEntry | null = null;
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
        pairs.push({ a: entry, b: best, variant });
      }
    }
    return pairs;
  }
}
