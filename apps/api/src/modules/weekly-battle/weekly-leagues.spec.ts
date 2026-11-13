import { formLeagues, nextTierFor, type LeagueJoiner } from './weekly-leagues';

/**
 * League formation — docs/16 §4 (ADR 0013 §4).
 * League of 30, seeded by Trading Rating; leftover singleton merges;
 * lone joiner carried; new joiners enter at the lowest tier.
 */

function joiner(
  userId: string,
  rating: number,
  joinedAtMs = 1000,
  nextTier: number | null = null
): LeagueJoiner {
  return { userId, tradingRating: rating, joinedAtMs, nextTier };
}

function thirty(fromRating = 2000): LeagueJoiner[] {
  return Array.from({ length: 30 }, (_, i) =>
    joiner(`u${String(i).padStart(2, '0')}`, fromRating - i * 10, 1000 + i)
  );
}

describe('formLeagues', () => {
  it('forms one league of 30 from 30 joiners', () => {
    const f = formLeagues(thirty());
    expect(f.leagues).toHaveLength(1);
    expect(f.leagues[0]?.memberUserIds).toHaveLength(30);
    expect(f.leagues[0]?.tier).toBe(1);
    expect(f.leagues[0]?.leagueNumber).toBe(1);
    expect(f.carriedUserIds).toEqual([]);
  });

  it('sorts by Trading Rating desc (highest first)', () => {
    const f = formLeagues([joiner('low', 1000), joiner('high', 1800), joiner('mid', 1400)]);
    expect(f.leagues[0]?.memberUserIds).toEqual(['high', 'mid', 'low']);
  });

  it('merges a leftover single player into the previous league (max 31)', () => {
    const f = formLeagues(thirty().concat([joiner('u30', 1700)]));
    expect(f.leagues).toHaveLength(1);
    expect(f.leagues[0]?.memberUserIds).toHaveLength(31);
    expect(f.carriedUserIds).toEqual([]);
  });

  it('splits 32 joiners into 30 + 2, not 30 + 1 + 1', () => {
    const f = formLeagues(thirty().concat([joiner('u30', 1700), joiner('u31', 1690)]));
    expect(f.leagues).toHaveLength(2);
    expect(f.leagues.map((l) => l.memberUserIds.length)).toEqual([30, 2]);
  });

  it('splits 61 joiners into 30 + 31 (the last singleton merges)', () => {
    const f = formLeagues(
      thirty(2000)
        .concat(thirty(1700))
        .concat([joiner('u60', 1400)])
    );
    expect(f.leagues).toHaveLength(2);
    expect(f.leagues.map((l) => l.memberUserIds.length)).toEqual([30, 31]);
  });

  it('carries a lone joiner instead of forming a solo league', () => {
    const f = formLeagues([joiner('solo', 1200)]);
    expect(f.leagues).toHaveLength(0);
    expect(f.carriedUserIds).toEqual(['solo']);
    expect(f.tierByUserId.get('solo')).toBe(1);
  });

  it('new joiners enter at the lowest tier in play', () => {
    const f = formLeagues([
      joiner('veteran', 1500, 1000, 1),
      joiner('veteran2', 1450, 1000, 1),
      joiner('demoted', 1100, 1000, 2),
      joiner('newcomer', 1900, 1000, null),
    ]);
    // Newcomer (highest rating, no tier) goes to tier 2, not tier 1.
    expect(f.tierByUserId.get('newcomer')).toBe(2);
    expect(f.tierByUserId.get('veteran')).toBe(1);
    expect(f.leagues.map((l) => l.tier)).toEqual([1, 2]);
    // League numbers run tier by tier: tier 1 first.
    expect(f.leagues[0]?.leagueNumber).toBe(1);
    expect(f.leagues[1]?.leagueNumber).toBe(2);
    // The newcomer does not outrank the tier-1 veterans' league.
    expect(f.leagues[0]?.memberUserIds).toEqual(['veteran', 'veteran2']);
    expect(f.leagues[1]?.memberUserIds).toEqual(['newcomer', 'demoted']);
  });

  it('a tier with one returning player carries them even when other tiers form', () => {
    const f = formLeagues([
      joiner('a', 1500, 1000, 1),
      joiner('b', 1400, 1000, 1),
      joiner('lonely', 1200, 1000, 2),
    ]);
    expect(f.leagues).toHaveLength(1);
    expect(f.carriedUserIds).toEqual(['lonely']);
  });
});

describe('nextTierFor', () => {
  it('promotes the top 3 one tier (never above tier 1)', () => {
    expect(nextTierFor(1, 30, 1)).toBe(1);
    expect(nextTierFor(3, 30, 2)).toBe(1);
    expect(nextTierFor(2, 30, 3)).toBe(2);
  });

  it('demotes the bottom 3 one tier, middle unchanged', () => {
    expect(nextTierFor(28, 30, 1)).toBe(2);
    expect(nextTierFor(30, 30, 1)).toBe(2);
    expect(nextTierFor(15, 30, 1)).toBe(1);
  });

  it('in a small league only rank 1 is promoted and only the last rank is demoted', () => {
    expect(nextTierFor(1, 4, 1)).toBe(1);
    expect(nextTierFor(2, 4, 1)).toBe(1);
    expect(nextTierFor(3, 4, 1)).toBe(1);
    expect(nextTierFor(4, 4, 1)).toBe(2);
    expect(nextTierFor(1, 2, 1)).toBe(1);
    expect(nextTierFor(2, 2, 1)).toBe(2);
  });
});
