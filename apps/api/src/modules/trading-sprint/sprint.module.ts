import { Module } from '@nestjs/common';
import { SprintController } from './sprint.controller';
import { SprintRepository } from './sprint.repository';
import { SprintService } from './sprint.service';
import { SprintMatchmakingService } from './sprint-matchmaking.service';
import { SprintEngine } from './sprint-engine.service';
import { SprintGateway } from './sprint.gateway';
import { AuthModule } from '../auth/auth.module';
import { DuelsModule } from '../duels/duels.module';
import { GamificationModule } from '../gamification/gamification.module';
import { RatingsModule } from '../ratings/ratings.module';
import { SimulatorModule } from '../simulator/simulator.module';

/**
 * TradingSprintModule — docs/05 §1 T1, docs/14 (Phase 9).
 *
 * Paper Trading Sprint (T1, live, rated, Trading Rating): 15 minutes,
 * same fictional market, same starting cash, winner by risk-adjusted
 * return. A DIFFERENT engine from the question-based live duels —
 * trading duels use actions (BUY/SELL), not question formats
 * (doc 08 §3.7). It consumes other modules only through their PUBLIC
 * service interfaces (blueprint §4):
 * RatingsService (recordTradingDuel / recordTradingDuelVsBot /
 * getDuelOutcome / getUserRatings), GamificationService.grantDuelRewards,
 * SimulatorRepository.listActiveInstruments (the instrument snapshot),
 * TokenService (gateway auth), LiveDuelEngine.activeDuelSummary
 * (one-live-duel-at-a-time check at queue time).
 *
 * Sprint pieces: SprintMatchmakingService (Redis queue, Trading
 * Rating), SprintEngine (server-authoritative timer, order execution,
 * bot, settlement), SprintGateway (Socket.IO transport only — no sprint
 * logic), SprintService (stored-result views + history). The Redis
 * adapter for multi-server fan-out is installed in main.ts, not here
 * (docs/09 §7, shared with the /duels-live namespace).
 */
@Module({
  imports: [RatingsModule, GamificationModule, SimulatorModule, AuthModule, DuelsModule],
  controllers: [SprintController],
  providers: [
    SprintService,
    SprintRepository,
    SprintMatchmakingService,
    SprintEngine,
    SprintGateway,
  ],
  exports: [SprintService, SprintRepository, SprintMatchmakingService, SprintEngine],
})
export class TradingSprintModule {}
