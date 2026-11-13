import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis, { Redis as RedisClient } from 'ioredis';
import { AppLogger } from './logger.service';
import { CONFIG } from '../../config/config.module';
import type { AppConfig } from '../../config/configuration';

/**
 * RedisService — blueprint §3.
 * Thin wrapper over ioredis. Used now for rate limiting; later for
 * sessions, cache, queues, leaderboards.
 *
 * Only the primitives the app needs are exposed — no raw client leaks,
 * so the backing store can change without touching callers.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client!: RedisClient;
  private ready = false;

  constructor(
    private readonly logger: AppLogger,
    @Inject(CONFIG) private readonly config: AppConfig
  ) {}

  async onModuleInit(): Promise<void> {
    this.client = new Redis(this.config.REDIS_URL, {
      maxRetriesPerRequest: 2,
      enableReadyCheck: true,
      lazyConnect: false,
    });
    this.client.on('error', (err: Error) => {
      this.logger.error('Redis connection error', { err: err.message });
    });
    this.client.on('ready', () => {
      this.ready = true;
      this.logger.info('Redis connected');
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.quit().catch(() => undefined);
  }

  /** Liveness probe for /health/ready — never throws. */
  async ping(): Promise<boolean> {
    try {
      return (await this.client.ping()) === 'PONG';
    } catch {
      return false;
    }
  }

  async incr(key: string): Promise<number> {
    return this.client.incr(key);
  }

  async expire(key: string, seconds: number): Promise<number> {
    return this.client.expire(key, seconds);
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<'OK'> {
    return ttlSeconds ? this.client.set(key, value, 'EX', ttlSeconds) : this.client.set(key, value);
  }

  async del(key: string): Promise<number> {
    return this.client.del(key);
  }

  // --- sorted sets (leaderboards, docs/04 §7) -----------------------------------

  /**
   * Sorted-set primitives for rating leaderboards. One sorted set per
   * rating kind per scope (`ratings:lb:LEARNING:global`,
   * `ratings:lb:LEARNING:country:IN`); member is the user id, score is
   * the rating. Postgres stays the source of truth; Redis is rebuilt
   * from it when empty.
   */
  async zadd(key: string, score: number, member: string): Promise<number> {
    return this.client.zadd(key, score, member);
  }

  /** Members with scores, highest first: [member, score, member, score, ...]. */
  async zrevrange(key: string, start: number, stop: number): Promise<string[]> {
    return this.client.zrevrange(key, start, stop, 'WITHSCORES');
  }

  /** 0-based rank, highest first; null when the member is not in the set. */
  async zrevrank(key: string, member: string): Promise<number | null> {
    return this.client.zrevrank(key, member);
  }

  async zcard(key: string): Promise<number> {
    return this.client.zcard(key);
  }

  /** Removes a member from a sorted set (e.g. leaving a national board). */
  async zrem(key: string, member: string): Promise<number> {
    return this.client.zrem(key, member);
  }

  /** Members with scores in [min, max], lowest first: [member, score, ...]. */
  async zrangebyscore(key: string, min: number, max: number): Promise<string[]> {
    const lo = min === Number.NEGATIVE_INFINITY ? '-inf' : min;
    const hi = max === Number.POSITIVE_INFINITY ? '+inf' : max;
    return this.client.zrangebyscore(key, lo, hi, 'WITHSCORES');
  }

  /** A member's score, or null when it is not in the set. */
  async zscore(key: string, member: string): Promise<number | null> {
    const raw = await this.client.zscore(key, member);
    return raw === null ? null : Number(raw);
  }

  // --- hashes (live duel state, docs/05 §3.2) -----------------------------------

  async hset(key: string, field: string, value: string): Promise<number> {
    return this.client.hset(key, field, value);
  }

  async hget(key: string, field: string): Promise<string | null> {
    return this.client.hget(key, field);
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    return this.client.hgetall(key);
  }

  async hdel(key: string, field: string): Promise<number> {
    return this.client.hdel(key, field);
  }

  /**
   * Set only when the key does not exist, with a TTL. Returns true when
   * the key was set (the caller won the claim), false when it existed.
   * Used for single-flight claims (one active live duel per user).
   */
  async setnx(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    const res = await this.client.set(key, value, 'EX', ttlSeconds, 'NX');
    return res === 'OK';
  }

  isReady(): boolean {
    return this.ready;
  }
}
