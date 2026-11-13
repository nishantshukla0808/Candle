import { Module, forwardRef } from '@nestjs/common';
import { GamificationModule } from '../gamification/gamification.module';
import { OnboardingModule } from '../onboarding/onboarding.module';
import { QuizModule } from '../quiz/quiz.module';
import { LearningController } from './learning.controller';
import { LearningRepository } from './learning.repository';
import { LearningService } from './learning.service';

/**
 * LearningModule — tracks, lessons, completions (blueprint §17).
 * Exports LearningService: the quiz module reads published versions,
 * the gamification module reads track progress (ADR 0002/13).
 * Imports OnboardingModule (forwardRef): the prerequisite gate consults
 * placement waivers through onboarding's public interface (ADR 0004/5).
 */
@Module({
  imports: [
    forwardRef(() => GamificationModule),
    forwardRef(() => QuizModule),
    forwardRef(() => OnboardingModule),
  ],
  controllers: [LearningController],
  providers: [LearningService, LearningRepository],
  exports: [LearningService, LearningRepository],
})
export class LearningModule {}
