import { Module } from '@nestjs/common';
import { GamificationModule } from '../gamification/gamification.module';
import { OnboardingController } from './onboarding.controller';
import { OnboardingRepository } from './onboarding.repository';
import { OnboardingService } from './onboarding.service';

/**
 * OnboardingModule — knowledge assessment (docs/03-onboarding-assessment-design.md, ADR 0004).
 *
 * One-directional link to GamificationModule: accepting placement emits
 * `onboarding.placement_accepted`, and the gamification module grants the
 * one-time 50 XP bonus idempotently. The service injects GamificationService
 * via @Inject(forwardRef(...)) — the same pattern learning.service uses —
 * so the onboarding → gamification → learning → onboarding cycle resolves.
 *
 * Exports OnboardingService: the learning module's prerequisite gate reads
 * placement waivers through its public `getWaivedUpToOrder` (ADR 0004/5).
 */
@Module({
  imports: [GamificationModule],
  controllers: [OnboardingController],
  providers: [OnboardingService, OnboardingRepository],
  exports: [OnboardingService, OnboardingRepository],
})
export class OnboardingModule {}
