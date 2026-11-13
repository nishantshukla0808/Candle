import { Injectable } from '@nestjs/common';
import type { TxClient } from '../../database/tx-client';
import { GamificationRepository, type BadgeRow } from './gamification.repository';

/**
 * BadgeService — rule-based badge checks (blueprint §17, ADR 0002).
 *
 * Badges are awarded inside the reward transaction. `award` is idempotent:
 * the (userId, badgeId) unique constraint makes re-awards a no-op.
 * Definitions are upserted on demand so the service never depends on
 * seed ordering.
 */

export interface BadgeDefinition {
  slug: string;
  name: string;
  description: string;
}

export const BADGE_DEFINITIONS: BadgeDefinition[] = [
  {
    slug: 'first-lesson',
    name: 'First Steps',
    description: 'Completed your first lesson.',
  },
  {
    slug: 'streak-3',
    name: 'On a Roll',
    description: 'Reached a 3-day learning streak.',
  },
  {
    slug: 'streak-7',
    name: 'Unstoppable',
    description: 'Reached a 7-day learning streak.',
  },
  {
    slug: 'quiz-ace',
    name: 'Sharp Shooter',
    description: 'Scored 100% on a quiz.',
  },
  {
    slug: 'foundation-graduate',
    name: 'Foundation Graduate',
    description: 'Completed every lesson in the Money Foundations track.',
  },
];

/** Slug of the Phase 1 flagship track (seeded). */
export const FOUNDATION_TRACK_SLUG = 'foundations';

@Injectable()
export class BadgeService {
  constructor(private readonly repo: GamificationRepository) {}

  private async award(userId: string, slug: string, tx?: TxClient): Promise<BadgeRow | null> {
    const def = BADGE_DEFINITIONS.find((d) => d.slug === slug);
    if (!def) return null;
    const badge = await this.repo.ensureBadge(def, tx);
    const isNew = await this.repo.awardBadge(userId, badge.id, tx);
    return isNew ? badge : null;
  }

  /** Checks after a lesson completion. Returns newly awarded badges. */
  async checkAfterCompletion(
    userId: string,
    completionsCount: number,
    trackComplete: boolean,
    tx?: TxClient
  ): Promise<BadgeRow[]> {
    const awarded: BadgeRow[] = [];
    if (completionsCount <= 1) {
      const b = await this.award(userId, 'first-lesson', tx);
      if (b) awarded.push(b);
    }
    if (trackComplete) {
      const b = await this.award(userId, 'foundation-graduate', tx);
      if (b) awarded.push(b);
    }
    return awarded;
  }

  /** Checks after a streak update. Returns newly awarded badges. */
  async checkAfterStreak(
    userId: string,
    currentStreak: number,
    tx?: TxClient
  ): Promise<BadgeRow[]> {
    const awarded: BadgeRow[] = [];
    if (currentStreak >= 3) {
      const b = await this.award(userId, 'streak-3', tx);
      if (b) awarded.push(b);
    }
    if (currentStreak >= 7) {
      const b = await this.award(userId, 'streak-7', tx);
      if (b) awarded.push(b);
    }
    return awarded;
  }

  /** Checks after a quiz submit. Returns newly awarded badges. */
  async checkAfterQuiz(userId: string, perfectScore: boolean, tx?: TxClient): Promise<BadgeRow[]> {
    if (!perfectScore) return [];
    const b = await this.award(userId, 'quiz-ace', tx);
    return b ? [b] : [];
  }
}
