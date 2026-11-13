import type {
  OnboardingAssessmentSubmittedPayload,
  OnboardingPlacementAcceptedPayload,
} from '../../common/events/event-bus';

/**
 * Onboarding domain events (blueprint §3, spec §8.2).
 *
 * - `onboarding.assessment_submitted` — written to the outbox on every
 *   submit. No XP side effect (the assessment is diagnostic). Reserved for
 *   the future analytics / adaptive engine.
 * - `onboarding.placement_accepted` — written to the outbox when placement
 *   is accepted. The gamification module grants the one-time 50 XP bonus
 *   (idempotent, ADR 0004/2), on both the direct path and the outbox-relay
 *   recovery path.
 */
export const ONBOARDING_ASSESSMENT_SUBMITTED = 'onboarding.assessment_submitted' as const;
export const ONBOARDING_PLACEMENT_ACCEPTED = 'onboarding.placement_accepted' as const;

export type { OnboardingAssessmentSubmittedPayload, OnboardingPlacementAcceptedPayload };
