import { Global, Module } from '@nestjs/common';
import { IdempotencyRepository } from './idempotency.repository';
import { IdempotencyService } from './idempotency.service';

/**
 * IdempotencyModule — global (blueprint §6). Any endpoint that creates
 * XP-like or money-like effects guards with IdempotencyService.
 */
@Global()
@Module({
  providers: [IdempotencyRepository, IdempotencyService],
  exports: [IdempotencyService],
})
export class IdempotencyModule {}
