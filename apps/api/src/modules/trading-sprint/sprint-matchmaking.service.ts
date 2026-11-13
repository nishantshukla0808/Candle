import { Injectable } from '@nestjs/common';
import { DUELS } from '@candle/shared';
import { AppError } from '../../common/errors/app-error';
import { AppLogger } from '../../common/services/logger.service';
import { RedisService } from '../../common/services/redis.service';
import { LiveDuelEngine } from '../duels/live-duel-engine.service';
import { SprintRepository } from './sprint.repository';
import {
  sprintBotOfferDue,
  sprintQueueEntryKey,
  sprintQueueKey,
  sprintWindowForWait,
} from './sprint-state';

/**
 * Sprint matchmaking — docs/05 §3.3, docs/14 §6 (Phase 9).
 *
 * The queue is ONE Redis sorted set (`sprint:queue`), member = user id,
 * score = TRADING Rating. One queue only: a sprint waiter is never
 * matched into a learning duel, and vice versa — the queues live in
 * different keyspaces (`sprint:*` vs `live:*`), so separation is
 * structural, not a filter. A per-user entry key
 * (`sprint:queue-entry:{userId}`, JSON) carries the rating + join time,
 * so the window can be computed from the wait and a stale member can
 * be recognised. The queue is Redis only — never a Postgres table.
 * A user holds at most ONE sprint queue entry.
 *
 * Matching window widens with wait time: ±50 (0–5 s) → ±100 (5–15 s) →
 * ±200 (15–30 s) → ±400 (30+ s). The nearest Trading Rating in the
 * window wins; ties break by earliest join. After 30 s with no human
 * match the caller is offered the Mira bot instead of waiting
 * (docs/05 §3.3).
 *
 * Anti-farming (docs/04 §5, enforced at settlement by Ratings): same
 * pair max 3 rated sprints/day, max 10 rated events/user/day,
 * 5-minute rematch cooldown. This service enforces the queue-level
 * rules only: one queue entry per user, no queueing while a sprint or
 * a live duel is active.
 */

export interface SprintQueueEntry {
  userId: string;
  /** Trading Rating at queue time. */
  rating: number;
  joinedAtMs: number;
}

export interface SprintQueueStatus {
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

export interface SprintMatchCandidate {
  opponentId: string;
  opponentRating: number;
  waitedMs: number;
  ratingWindow: number;
}

@Injectable()
export class SprintMatchmakingService {
  constructor(
    private readonly redis: RedisService,
    private readonly repo: SprintRepository,
    private readonly liveEngine: LiveDuelEngine,
    private readonly logger: AppLogger
  ) {}

  /** Join the sprint queue. Throws when already queued or in a duel. */
  async enqueue(
    userId: string,
    rating: number,
    now: Date = new Date()
  ): Promise<SprintQueueStatus> {
    const existing = await this.redis.get(sprintQueueEntryKey(userId));
    if (existing) {
      throw AppError.sprintAlreadyQueued();
    }
    const activeSprint = await this.repo.findActiveSprintForUser(userId);
    if (activeSprint) {
      throw AppError.sprintAlreadyActive();
    }
    // One live duel at a time, across duel families: a player mid-quiz
    // cannot queue for a sprint (the reverse — joining a quiz queue
    // mid-sprint — is a known gap, ADR 0011 §8.5).
    const activeLive = await this.liveEngine.activeDuelSummary(userId).catch(() => null);
    if (activeLive) {
      throw AppError.duelLiveAlreadyActive();
    }
    const entry: SprintQueueEntry = { userId, rating, joinedAtMs: now.getTime() };
    await this.redis.zadd(sprintQueueKey(), rating, userId);
    await this.redis.set(
      sprintQueueEntryKey(userId),
      JSON.stringify(entry),
      DUELS.SPRINT_QUEUE_TTL_SEC
    );
    this.logger.info('Sprint queued', { userId, rating });
    return this.statusOf(entry, now.getTime());
  }

  /** Leave the queue cleanly (cancel). Idempotent: leaving when not queued is a no-op. */
  async dequeue(userId: string): Promise<void> {
    await this.redis.zrem(sprintQueueKey(), userId);
    await this.redis.del(sprintQueueEntryKey(userId));
  }

  /** Current queue status for a user (never throws for a non-queued user). */
  async status(userId: string, now: Date = new Date()): Promise<SprintQueueStatus> {
    const raw = await this.redis.get(sprintQueueEntryKey(userId));
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
    const entry = JSON.parse(raw) as SprintQueueEntry;
    return this.statusOf(entry, now.getTime());
  }

  /**
   * Find the best opponent in the caller's current window, or null.
   * The caller stays queued when no match is found.
   */
  async findOpponent(userId: string, now: Date = new Date()): Promise<SprintMatchCandidate | null> {
    const raw = await this.redis.get(sprintQueueEntryKey(userId));
    if (!raw) return null;
    const entry = JSON.parse(raw) as SprintQueueEntry;
    const waitedMs = now.getTime() - entry.joinedAtMs;
    const window = sprintWindowForWait(waitedMs);
    const members = await this.redis.zrangebyscore(
      sprintQueueKey(),
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
      const otherRaw = await this.redis.get(sprintQueueEntryKey(c.id));
      if (!otherRaw) continue; // stale member — entry expired, skip
      const other = JSON.parse(otherRaw) as SprintQueueEntry;
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

  private statusOf(entry: SprintQueueEntry, nowMs: number): SprintQueueStatus {
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
   * the sprints. Pure pairing over Redis reads — no sprint is created here.
   */
  async sweep(): Promise<Array<{ a: SprintQueueEntry; b: SprintQueueEntry }>> {
    const members = await this.redis.zrangebyscore(
      sprintQueueKey(),
      Number.NEGATIVE_INFINITY,
      Number.POSITIVE_INFINITY
    );
    const entries: SprintQueueEntry[] = [];
    for (let i = 0; i < members.length; i += 2) {
      const id = members[i] as string;
      if (!id) continue;
      const raw = await this.redis.get(sprintQueueEntryKey(id));
      if (!raw) continue; // stale member — entry expired
      entries.push(JSON.parse(raw) as SprintQueueEntry);
    }
    entries.sort((x, y) => x.joinedAtMs - y.joinedAtMs);
    const used = new Set<string>();
    const pairs: Array<{ a: SprintQueueEntry; b: SprintQueueEntry }> = [];
    const nowMs = Date.now();
    for (const entry of entries) {
      if (used.has(entry.userId)) continue;
      const window = sprintWindowForWait(nowMs - entry.joinedAtMs);
      let best: SprintQueueEntry | null = null;
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
