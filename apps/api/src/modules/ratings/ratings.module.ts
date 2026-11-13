import { Module } from '@nestjs/common';
import { RatingsController } from './ratings.controller';
import { RatingsRepository } from './ratings.repository';
import { RatingsService } from './ratings.service';

/**
 * RatingsModule — docs/04-ratings-and-deployment.md (Phase 3).
 *
 * Self-contained: it imports no other feature module. User reads
 * (existence, display name, country) go through its own repository,
 * and trading weeks arrive as caller-supplied numbers, so there is no
 * dependency on the simulator or users modules (ADR 0005/7).
 * RedisService, IdempotencyService, and TransactionService are global.
 *
 * Exports RatingsService so UsersService can keep the denormalised
 * countryCode on rating rows in sync when a user changes country
 * (ADR 0005/8). UsersModule imports this module; this module imports
 * nothing from users, so there is no cycle.
 */
@Module({
  controllers: [RatingsController],
  providers: [RatingsService, RatingsRepository],
  exports: [RatingsService, RatingsRepository],
})
export class RatingsModule {}
