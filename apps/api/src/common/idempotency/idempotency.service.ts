import { Injectable } from '@nestjs/common';
import { ErrorCode } from '@candle/shared';
import { AppError } from '../errors/app-error';
import type { TxClient } from '../../database/tx-client';
import { IdempotencyRepository } from './idempotency.repository';

/**
 * IdempotencyService — blueprint §6, ADR 0002/7.
 *
 * Endpoints that create money-like or XP-like effects REQUIRE an
 * `Idempotency-Key` header. The first call executes and stores its
 * response; replays with the same key return 409 IDEMPOTENCY_REPLAY with
 * the original result in `data` — the effect is never applied twice.
 *
 * Keys are scoped per user and expire after 24h.
 */
@Injectable()
export class IdempotencyService {
  private static readonly TTL_SECONDS = 24 * 60 * 60;

  constructor(private readonly repo: IdempotencyRepository) {}

  /**
   * Proceeds when the key is fresh; throws IDEMPOTENCY_REPLAY on replay.
   * The original response is carried in `error.details.original`.
   */
  async guard(key: string | undefined, userId: string, tx?: TxClient): Promise<void> {
    if (!key || key.trim() === '') {
      throw AppError.validationFailed([
        { field: 'Idempotency-Key', issue: 'This endpoint requires an Idempotency-Key header.' },
      ]);
    }
    const stored = await this.repo.find(key, userId, tx);
    if (stored !== null) {
      throw new AppError(ErrorCode.IDEMPOTENCY_REPLAY, 409, undefined, { original: stored });
    }
  }

  async store(key: string, userId: string, response: unknown, tx?: TxClient): Promise<void> {
    await this.repo.store(key, userId, response, IdempotencyService.TTL_SECONDS, tx);
  }

  /** Raw lookup for race-recovery paths; returns null when absent/expired. */
  async find(key: string, userId: string, tx?: TxClient): Promise<unknown> {
    return this.repo.find(key, userId, tx);
  }
}
