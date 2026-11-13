import { Module } from '@nestjs/common';
import { DuelsController } from './duels.controller';
import { DuelsRepository } from './duels.repository';
import { DuelsService } from './duels.service';
import { LiveDuelEngine } from './live-duel-engine.service';
import { LiveDuelsGateway } from './live-duels.gateway';
import { LiveMatchmakingService } from './live-matchmaking.service';
import { AuthModule } from '../auth/auth.module';
import { GamificationModule } from '../gamification/gamification.module';
import { QuestionBankModule } from '../question-bank/question-bank.module';
import { RatingsModule } from '../ratings/ratings.module';

/**
 * DuelsModule — docs/05 §1/§7, docs/07 (Phase 4), docs/09 (Phase 5).
 *
 * Bot Duel (P1, unrated) + Async Daily Duel (L5, rated) + Live Speed
 * Quiz Duel (L1, rated, WebSocket). It consumes other modules only
 * through their PUBLIC service interfaces (blueprint §4):
 * QuestionBankService.selectSet / recordExposure / getItemsForGrading,
 * RatingsService (duel recording + outcome recovery),
 * GamificationService.grantDuelRewards, TokenService (gateway auth).
 *
 * Live pieces: LiveMatchmakingService (Redis queue), LiveDuelEngine
 * (server-authoritative timers, grading, settlement), LiveDuelsGateway
 * (Socket.IO transport only — no duel logic). The Redis adapter for
 * multi-server fan-out is installed in main.ts, not here (docs/09 §7).
 *
 * DuelsRepository is exported for FriendChallengeModule (Phase 12):
 * the challenge service reads users, active duels, and last duels
 * through it — it never writes a Duel row except through the engines.
 */
@Module({
  imports: [QuestionBankModule, RatingsModule, GamificationModule, AuthModule],
  controllers: [DuelsController],
  providers: [
    DuelsService,
    DuelsRepository,
    LiveMatchmakingService,
    LiveDuelEngine,
    LiveDuelsGateway,
  ],
  exports: [DuelsService, DuelsRepository, LiveMatchmakingService, LiveDuelEngine],
})
export class DuelsModule {}
