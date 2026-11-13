import { DUELS } from '@candle/shared';
import type { DuelType } from '@prisma/client';

/**
 * Friend Challenge rules — pure helpers (Phase 12, docs/17, ADR 0014).
 * No I/O here: the service owns every check, these only classify.
 */

/** Duel types a challenge may start (docs/17 §2): the six 1v1 live duels. */
export type ChallengeDuelType = 'LIVE' | 'BLITZ' | 'CASE' | 'CHART' | 'SPRINT' | 'CRISIS';

/** The six challengeable types, as a runtime list (DTO + service share it). */
export const CHALLENGE_DUEL_TYPES: ChallengeDuelType[] = [...DUELS.CHALLENGE_DUEL_TYPES];

/** True for a duel type a challenge may start; false for DAILY / WEEKLY / BOT. */
export function isChallengeDuelType(type: string): type is ChallengeDuelType {
  return (CHALLENGE_DUEL_TYPES as string[]).includes(type);
}

/** True for the four question-based live variants (the LiveDuelEngine owns them). */
export function isLiveChallengeType(type: ChallengeDuelType): boolean {
  return type === 'LIVE' || type === 'BLITZ' || type === 'CASE' || type === 'CHART';
}

/** True for the two trading variants (the SprintEngine owns them). */
export function isTradingChallengeType(type: ChallengeDuelType): boolean {
  return type === 'SPRINT' || type === 'CRISIS';
}

/** Which Rating moves when this challenge's duel settles (docs/17 §7). */
export function ratingKindFor(type: ChallengeDuelType): 'LEARNING' | 'TRADING' {
  return isTradingChallengeType(type) ? 'TRADING' : 'LEARNING';
}

/** The Prisma DuelType written on the duel the challenge creates (same value). */
export function duelTypeFor(type: ChallengeDuelType): DuelType {
  return type;
}

/**
 * Where the players play after accept (docs/17 §6). Each variant has
 * its own play page, and every play page resumes an active duel on
 * load (live pages via GET /duels/live/active + socket reconnect,
 * sprint/crisis pages via /sprint/active + /crisis/active) — so the
 * URL needs no duel id: the server already knows the active duel.
 */
export function playPathFor(type: ChallengeDuelType): string {
  switch (type) {
    case 'LIVE':
      return '/duels/live';
    case 'BLITZ':
      return '/duels/blitz';
    case 'CASE':
      return '/duels/case';
    case 'CHART':
      return '/duels/chart';
    case 'SPRINT':
      return '/duels/sprint';
    case 'CRISIS':
      return '/duels/crisis';
  }
}

/**
 * The invite link (docs/17 §6). The code alone identifies the
 * challenge — it is unguessable (16 hex chars), so the link needs no
 * challenge id in it. Opening the link shows the invite; accepting
 * still requires being the invitee (the code proves possession of the
 * link, not identity).
 */
export function inviteLinkFor(inviteCode: string): string {
  return `/duels/challenge?code=${inviteCode}`;
}

/** Expiry of a challenge created at `now` (24 h, ADR 0014 §4). */
export function expiresAtFrom(now: Date): Date {
  return new Date(now.getTime() + DUELS.CHALLENGE_EXPIRY_MS);
}

/** Whole milliseconds until expiry (negative once expired) — the countdown the UI shows. */
export function expiresInMs(expiresAt: Date, now: Date): number {
  return expiresAt.getTime() - now.getTime();
}
