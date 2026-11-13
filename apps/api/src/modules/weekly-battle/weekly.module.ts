import { Module } from '@nestjs/common';
import { WeeklyController } from './weekly.controller';
import { WeeklyRepository } from './weekly.repository';
import { WeeklyService } from './weekly.service';
import { GamificationModule } from '../gamification/gamification.module';
import { RatingsModule } from '../ratings/ratings.module';
import { SimulatorModule } from '../simulator/simulator.module';

/**
 * WeeklyBattleModule — docs/05 §1 T3, docs/16 (Phase 11).
 *
 * Weekly Portfolio Battle (T3, rated, Trading Rating) + Leagues: a
 * week-long ASYNC trading duel on the Phase 2 deterministic price
 * engine — same fictional market, same starting cash, winner by
 * risk-adjusted return, leagues of 30 with promotion/relegation.
 * REST only: no WebSocket namespace (a week-long duel has no live
 * clock to push), no Redis state, no matchmaking queue. It consumes
 * other modules only through their PUBLIC service interfaces
 * (blueprint §4): RatingsService (getUserRatings / recordTradingWeek /
 * getDuelOutcome), GamificationService.grantDuelRewards,
 * SimulatorRepository.listActiveInstruments, PriceEngine (pure).
 *
 * Weekly pieces: WeeklyService (seasons, leagues, trading, standings,
 * settlement), WeeklyRepository (the only Prisma touchpoint),
 * weekly-leagues.ts (formation, pure), weekly-portfolio.ts (trade
 * replay + equity curve + index return, pure), weekly-scoring.ts
 * (ranking + XP outcomes, pure — the risk math is REUSED from the
 * sprint's computeRiskMetrics, not duplicated).
 */
@Module({
  imports: [RatingsModule, GamificationModule, SimulatorModule],
  controllers: [WeeklyController],
  providers: [WeeklyService, WeeklyRepository],
  exports: [WeeklyService, WeeklyRepository],
})
export class WeeklyBattleModule {}
