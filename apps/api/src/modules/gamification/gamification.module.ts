import { Module, forwardRef } from '@nestjs/common';
import { BadgeService } from './badge.service';
import { GamificationController } from './gamification.controller';
import { GamificationRepository } from './gamification.repository';
import { GamificationService } from './gamification.service';
import { StreakService } from './streak.service';
import { LearningModule } from '../learning/learning.module';

/**
 * GamificationModule — XP, levels, streaks, badges (blueprint §17).
 *
 * Circular dependency note: LearningModule needs GamificationService
 * (completion rewards), and GamificationService needs LearningService
 * (dashboard track progress). Both directions go through the modules'
 * PUBLIC service interfaces only (blueprint §4) — forwardRef is the
 * standard NestJS mechanism for this (ADR 0002).
 */
@Module({
  imports: [forwardRef(() => LearningModule)],
  controllers: [GamificationController],
  providers: [GamificationService, GamificationRepository, StreakService, BadgeService],
  exports: [GamificationService],
})
export class GamificationModule {}
