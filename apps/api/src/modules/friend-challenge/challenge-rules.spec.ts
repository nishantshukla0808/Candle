import {
  CHALLENGE_DUEL_TYPES,
  expiresAtFrom,
  expiresInMs,
  inviteLinkFor,
  isChallengeDuelType,
  isLiveChallengeType,
  isTradingChallengeType,
  playPathFor,
  ratingKindFor,
} from './challenge-rules';

/**
 * Challenge rules — pure helpers (Phase 12, docs/17, ADR 0014).
 * No I/O: the service owns every check, these only classify.
 */

describe('challenge-rules', () => {
  it('the six 1v1 types are challengeable; DAILY / WEEKLY / BOT are not', () => {
    expect(CHALLENGE_DUEL_TYPES).toEqual(['LIVE', 'BLITZ', 'CASE', 'CHART', 'SPRINT', 'CRISIS']);
    for (const t of CHALLENGE_DUEL_TYPES) expect(isChallengeDuelType(t)).toBe(true);
    for (const t of ['DAILY', 'WEEKLY', 'BOT', 'LIVE2', '']) {
      expect(isChallengeDuelType(t)).toBe(false);
    }
  });

  it('live vs trading split matches the engine that owns each type', () => {
    for (const t of ['LIVE', 'BLITZ', 'CASE', 'CHART'] as const) {
      expect(isLiveChallengeType(t)).toBe(true);
      expect(isTradingChallengeType(t)).toBe(false);
      expect(ratingKindFor(t)).toBe('LEARNING');
    }
    for (const t of ['SPRINT', 'CRISIS'] as const) {
      expect(isLiveChallengeType(t)).toBe(false);
      expect(isTradingChallengeType(t)).toBe(true);
      expect(ratingKindFor(t)).toBe('TRADING');
    }
  });

  it('each type plays on its own page (the page resumes the active duel on load)', () => {
    expect(playPathFor('LIVE')).toBe('/duels/live');
    expect(playPathFor('BLITZ')).toBe('/duels/blitz');
    expect(playPathFor('CASE')).toBe('/duels/case');
    expect(playPathFor('CHART')).toBe('/duels/chart');
    expect(playPathFor('SPRINT')).toBe('/duels/sprint');
    expect(playPathFor('CRISIS')).toBe('/duels/crisis');
  });

  it('the invite link carries only the code (the code alone identifies the challenge)', () => {
    expect(inviteLinkFor('a1b2c3d4e5f6a7b8')).toBe('/duels/challenge?code=a1b2c3d4e5f6a7b8');
  });

  it('expiry is 24 hours from creation', () => {
    const now = new Date('2026-11-13T10:00:00.000Z');
    expect(expiresAtFrom(now).toISOString()).toBe('2026-11-14T10:00:00.000Z');
    expect(expiresInMs(expiresAtFrom(now), now)).toBe(24 * 60 * 60 * 1000);
    expect(expiresInMs(expiresAtFrom(now), new Date('2026-11-14T10:00:01.000Z'))).toBe(-1000);
  });
});
