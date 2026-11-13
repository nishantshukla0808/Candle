import { Module } from '@nestjs/common';
import { CrisisController } from './crisis.controller';
import { CrisisGateway } from './crisis.gateway';
import { CrisisMatchmakingService } from './crisis-matchmaking.service';
import { AuthModule } from '../auth/auth.module';
import { DuelsModule } from '../duels/duels.module';
import { RatingsModule } from '../ratings/ratings.module';
import { TradingSprintModule } from '../trading-sprint/sprint.module';

/**
 * CrisisDuelModule — docs/05 §1 T2, docs/15 (Phase 10).
 *
 * Crisis Duel (T2, live, rated, Trading Rating): 15 minutes, same
 * fictional market, same starting cash, winner by crisis
 * risk-adjusted return — a Paper Trading Sprint with a seeded crash
 * mid-duel. It is a VARIANT of the sprint engine, not a second engine
 * (docs/15 §3): the engine, repository, result service and settlement
 * code are shared with the sprint (TradingSprintModule), parameterised
 * by the variant on the Redis state. This module owns only what
 * differs: the crisis queue (`crisis:*`), the `/crisis` namespace
 * gateway, and the `/crisis` REST controller. The Redis adapter for
 * multi-server fan-out is installed in main.ts, not here (docs/09 §7,
 * shared with the /duels-live and /sprint namespaces).
 */
@Module({
  imports: [TradingSprintModule, RatingsModule, AuthModule, DuelsModule],
  controllers: [CrisisController],
  providers: [CrisisMatchmakingService, CrisisGateway],
  exports: [CrisisMatchmakingService],
})
export class CrisisDuelModule {}
