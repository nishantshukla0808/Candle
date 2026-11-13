import { Inject, Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/app-error';
import { AppLogger } from '../services/logger.service';
import { RedisService } from '../services/redis.service';
import { CONFIG } from '../../config/config.module';
import type { AppConfig } from '../../config/configuration';

/**
 * RateLimitMiddleware — blueprint §9 step 4.
 * Redis-backed fixed-window rate limiting, keyed by IP + user id.
 *
 * - Global limit applies to every request.
 * - Path prefixes listed in RATE_LIMIT_STRICT_PREFIXES (e.g. /api/v1/auth)
 *   use the stricter limit.
 *
 * Exceeding the limit throws AppError.rateLimited() -> 429 RATE_LIMITED
 * envelope via GlobalExceptionFilter. Standard RateLimit-* headers are set.
 */
@Injectable()
export class RateLimitMiddleware implements NestMiddleware {
  constructor(
    private readonly redis: RedisService,
    private readonly logger: AppLogger,
    @Inject(CONFIG) private readonly config: AppConfig
  ) {}

  async use(
    req: Request & { user?: { sub?: string }; requestId?: string },
    res: Response,
    next: NextFunction
  ): Promise<void> {
    const strict = this.config.rateLimitStrictPrefixes.some((p) => req.path.startsWith(p));
    const windowSec = strict
      ? this.config.RATE_LIMIT_STRICT_WINDOW_SECONDS
      : this.config.RATE_LIMIT_WINDOW_SECONDS;
    const max = strict ? this.config.RATE_LIMIT_STRICT_MAX : this.config.RATE_LIMIT_MAX;

    const identity = req.user?.sub ?? req.ip ?? 'unknown';
    const windowId = Math.floor(Date.now() / 1000 / windowSec);
    const key = `ratelimit:${strict ? 'strict' : 'global'}:${windowId}:${identity}`;

    try {
      const count = await this.redis.incr(key);
      if (count === 1) {
        await this.redis.expire(key, windowSec);
      }
      const remaining = Math.max(0, max - count);
      res.setHeader('RateLimit-Limit', String(max));
      res.setHeader('RateLimit-Remaining', String(remaining));
      res.setHeader('RateLimit-Reset', String((windowId + 1) * windowSec));
      if (count > max) {
        this.logger.warn('Rate limit exceeded', {
          requestId: req.requestId,
          path: req.path,
          identity: this.redactIdentity(identity),
          strict,
        });
        throw AppError.rateLimited();
      }
      next();
    } catch (err) {
      if (err instanceof AppError) throw err;
      // Fail OPEN on Redis failure: rate limiting must never take the API
      // down. The incident is logged for alerting.
      this.logger.error('Rate limiter Redis failure — failing open', {
        requestId: req.requestId,
        err: err instanceof Error ? err.message : String(err),
      });
      next();
    }
  }

  private redactIdentity(identity: string): string {
    return identity.length > 8 ? `${identity.slice(0, 4)}…${identity.slice(-4)}` : '…';
  }
}
