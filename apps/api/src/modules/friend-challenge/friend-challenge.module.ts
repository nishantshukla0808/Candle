import { Module } from '@nestjs/common';
import { FriendChallengeController } from './friend-challenge.controller';
import { FriendChallengeRepository } from './friend-challenge.repository';
import { FriendChallengeService } from './friend-challenge.service';
import { DuelsModule } from '../duels/duels.module';
import { RatingsModule } from '../ratings/ratings.module';
import { TradingSprintModule } from '../trading-sprint/sprint.module';

/**
 * FriendChallengeModule — docs/17 (Phase 12, ADR 0014).
 *
 * Friend Challenge (P2): an invite-only start-mode on the existing
 * duel engines, not a separate engine and not the friends system
 * (doc 06). It consumes other modules only through their PUBLIC
 * service interfaces (blueprint §4):
 * - DuelsModule: LiveDuelEngine.createLiveDuel (LIVE / BLITZ / CASE /
 *   CHART) + DuelsRepository reads (user lookup, active-duel and
 *   last-duel checks).
 * - TradingSprintModule: SprintEngine.createSprint / createCrisis
 *   (SPRINT / CRISIS) + SprintRepository reads.
 * - RatingsModule: RatingsService.getUserRatings (the Ratings shown
 *   on the invite and used at duel start; the rated caps themselves
 *   are enforced at settlement by the engines' existing Ratings calls).
 * No engine is duplicated, no new queue is created, no socket
 * namespace is added: accept returns the duel id + playUrl, and the
 * existing play pages resume the active duel on load.
 */
@Module({
  imports: [DuelsModule, TradingSprintModule, RatingsModule],
  controllers: [FriendChallengeController],
  providers: [FriendChallengeService, FriendChallengeRepository],
  exports: [FriendChallengeService],
})
export class FriendChallengeModule {}
