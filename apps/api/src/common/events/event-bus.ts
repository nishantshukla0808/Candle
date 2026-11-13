import { Injectable } from '@nestjs/common';
import { AppLogger } from '../services/logger.service';

/**
 * EventBus — the in-process port for domain events (blueprint §3, ADR 0002/3).
 *
 * Events are ALSO written to the outbox table in the same transaction as the
 * domain change; the OutboxRelay replays them for durability. Handlers must
 * therefore be idempotent — the same event may be delivered twice (once via
 * the direct path, once via the relay recovery path).
 *
 * Payloads are plain JSON; never put secrets or PII in an event.
 */

export type DomainEventType =
  | 'lesson.completed'
  | 'quiz.submitted'
  | 'trade.executed'
  | 'onboarding.assessment_submitted'
  | 'onboarding.placement_accepted';

export interface LessonCompletedPayload {
  userId: string;
  lessonId: string;
  lessonVersionId: string;
  completionId: string;
  /** Idempotency key the XP grant must use (ADR 0002/2). */
  xpIdempotencyKey: string;
  completedAt: string;
  /** Track context for badge checks (computed by the learning service). */
  trackId: string;
  trackSlug: string;
  /** 1-based count of this user's completions after this one. */
  completionsCount: number;
  /** True when every lesson in the track is now complete. */
  trackComplete: boolean;
}

export interface QuizSubmittedPayload {
  userId: string;
  lessonId: string;
  lessonVersionId: string;
  attemptId: string;
  passed: boolean;
  score: number;
  totalPoints: number;
  /** Idempotency key the XP grant must use (ADR 0002/2). */
  xpIdempotencyKey: string;
  submittedAt: string;
}

export interface TradeExecutedPayload {
  userId: string;
  orderId: string;
  instrumentId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: string;
  /** Idempotency key the XP grant must use (ADR 0003/5). */
  xpIdempotencyKey: string;
  executedAt: string;
}

/** Emitted when an assessment is submitted (analytics future; no XP). */
export interface OnboardingAssessmentSubmittedPayload {
  userId: string;
  attemptId: string;
  versionId: string;
  overallLevel: number;
  submittedAt: string;
}

/** Emitted when placement is accepted — grants the one-time bonus (ADR 0004/2). */
export interface OnboardingPlacementAcceptedPayload {
  userId: string;
  attemptId: string;
  trackId: string;
  /** Idempotency key the XP grant must use (ADR 0004/2). */
  xpIdempotencyKey: string;
  placedAt: string;
}

export type DomainEventPayload =
  | LessonCompletedPayload
  | QuizSubmittedPayload
  | TradeExecutedPayload
  | OnboardingAssessmentSubmittedPayload
  | OnboardingPlacementAcceptedPayload;

type Handler = (payload: DomainEventPayload) => Promise<void> | void;

@Injectable()
export class EventBus {
  private readonly handlers = new Map<DomainEventType, Handler[]>();

  constructor(private readonly logger: AppLogger) {}

  on(type: DomainEventType, handler: Handler): void {
    const list = this.handlers.get(type) ?? [];
    list.push(handler);
    this.handlers.set(type, list);
  }

  async emit(type: DomainEventType, payload: DomainEventPayload): Promise<void> {
    const list = this.handlers.get(type) ?? [];
    for (const handler of list) {
      try {
        await handler(payload);
      } catch (err) {
        // A failing handler must never break the publisher or other handlers.
        this.logger.error('Event handler failed', {
          type,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
}
