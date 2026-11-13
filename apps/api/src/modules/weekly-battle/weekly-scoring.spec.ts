import { riskAdjustedScoreFor } from '../trading-sprint/sprint-scoring';
import {
  rankLeagueEntries,
  weeklyRatingReasonFor,
  weeklyRiskMetrics,
  weeklyXpOutcome,
} from './weekly-scoring';

/**
 * Weekly scoring — docs/16 §6/§7 (ADR 0013 §7).
 * The league ranking reuses the sprint risk math, so the worked
 * examples from docs/14 §6 are pinned here too: the same formula,
 * the same numbers.
 */

describe('weekly scoring (sprint formula, reused)', () => {
  it('pins the worked examples from docs/14 §6', () => {
    // Steady beats wild: the higher return does not win.
    expect(riskAdjustedScoreFor(2.0, 1.0, 0.5)).toBe(0.8);
    expect(riskAdjustedScoreFor(3.0, 4.0, 2.0)).toBe(0.4286);
    // Risky loser scores worse than the calm loser.
    expect(riskAdjustedScoreFor(-2.0, 1.0, 1.0)).toBe(-6);
    expect(riskAdjustedScoreFor(-2.0, 0, 0)).toBe(-2);
    // No return, no score — whatever V and D are.
    expect(riskAdjustedScoreFor(0, 5, 5)).toBe(0);
    // Clamp.
    expect(riskAdjustedScoreFor(200, 0, 0)).toBe(100);
    expect(riskAdjustedScoreFor(-200, 0, 0)).toBe(-100);
  });

  it('computes metrics from a flat curve as 0 across the board', () => {
    expect(weeklyRiskMetrics([100000, 100000, 100000], 100000)).toEqual({
      returnPct: 0,
      realisedVolPct: 0,
      maxDrawdownPct: 0,
      riskAdjustedScore: 0,
    });
  });

  it('computes metrics from a rising curve', () => {
    const m = weeklyRiskMetrics([100000, 102000], 100000);
    expect(m.returnPct).toBe(2);
    expect(m.realisedVolPct).toBe(0);
    expect(m.maxDrawdownPct).toBe(0);
    expect(m.riskAdjustedScore).toBe(2);
  });
});

describe('league ranking', () => {
  const base = (over: Record<string, unknown>) => ({
    userId: 'u1',
    displayName: 'A',
    riskAdjustedScore: 0,
    returnPct: 0,
    tradeCount: 3,
    joinedAtMs: 1000,
    ...over,
  });

  it('ranks by risk-adjusted score, not by return', () => {
    const ranked = rankLeagueEntries([
      base({ userId: 'wild', riskAdjustedScore: 0.4286, returnPct: 3 }),
      base({ userId: 'steady', riskAdjustedScore: 0.8, returnPct: 2 }),
    ]);
    expect(ranked[0]?.userId).toBe('steady');
    expect(ranked[0]?.rank).toBe(1);
    expect(ranked[1]?.userId).toBe('wild');
    expect(ranked[1]?.rank).toBe(2);
  });

  it('breaks a score tie on return, then on trade count, then on join order', () => {
    const ranked = rankLeagueEntries([
      base({ userId: 'late', riskAdjustedScore: 1, returnPct: 1, joinedAtMs: 2000 }),
      base({ userId: 'early', riskAdjustedScore: 1, returnPct: 1, joinedAtMs: 1000 }),
      base({ userId: 'higher-return', riskAdjustedScore: 1, returnPct: 2, joinedAtMs: 3000 }),
      base({
        userId: 'more-trades',
        riskAdjustedScore: 1,
        returnPct: 1,
        tradeCount: 5,
        joinedAtMs: 4000,
      }),
    ]);
    expect(ranked.map((r) => r.userId)).toEqual(['higher-return', 'more-trades', 'early', 'late']);
  });

  it('ranks never-traded players last, even on an equal 0 score', () => {
    const ranked = rankLeagueEntries([
      base({ userId: 'never', riskAdjustedScore: 0, returnPct: 0, tradeCount: 0 }),
      base({ userId: 'traded-flat', riskAdjustedScore: 0, returnPct: 0, tradeCount: 3 }),
    ]);
    expect(ranked[0]?.userId).toBe('traded-flat');
    expect(ranked[1]?.userId).toBe('never');
    expect(ranked[1]?.rank).toBe(2);
  });

  it('flags promotion (top 3) and relegation (bottom 3) zones', () => {
    const entries = Array.from({ length: 30 }, (_, i) =>
      base({ userId: `u${i}`, riskAdjustedScore: 30 - i })
    );
    const ranked = rankLeagueEntries(entries);
    expect(ranked.filter((r) => r.promotionZone).map((r) => r.rank)).toEqual([1, 2, 3]);
    expect(ranked.filter((r) => r.relegationZone).map((r) => r.rank)).toEqual([28, 29, 30]);
  });
});

describe('weekly XP outcomes', () => {
  it('top 3 win (20), middle draw (5), bottom 3 loss (0)', () => {
    expect(weeklyXpOutcome(1, 30, 5)).toBe('WIN');
    expect(weeklyXpOutcome(3, 30, 5)).toBe('WIN');
    expect(weeklyXpOutcome(15, 30, 5)).toBe('DRAW');
    expect(weeklyXpOutcome(28, 30, 5)).toBe('LOSS');
    expect(weeklyXpOutcome(30, 30, 5)).toBe('LOSS');
  });

  it('never-traded is a loss for XP whatever the rank', () => {
    expect(weeklyXpOutcome(1, 30, 0)).toBe('LOSS');
  });

  it('in a small league only rank 1 wins and only the last rank loses', () => {
    // 4-player league: #1 wins, #2–#3 draw, #4 loses.
    expect(weeklyXpOutcome(1, 4, 5)).toBe('WIN');
    expect(weeklyXpOutcome(2, 4, 5)).toBe('DRAW');
    expect(weeklyXpOutcome(3, 4, 5)).toBe('DRAW');
    expect(weeklyXpOutcome(4, 4, 5)).toBe('LOSS');
    // 2-player league: #1 wins, #2 loses.
    expect(weeklyXpOutcome(1, 2, 5)).toBe('WIN');
    expect(weeklyXpOutcome(2, 2, 5)).toBe('LOSS');
  });
});

describe('weekly rating reason', () => {
  it('says plainly when a week was unrated (fewer than 3 trades)', () => {
    const reason = weeklyRatingReasonFor({
      rank: 4,
      leagueSize: 4,
      tier: 1,
      leagueNumber: 1,
      tradeCount: 0,
      returnPct: 0,
      indexReturnPct: 0.1,
      ratingResult: null,
      ratingDelta: null,
    });
    expect(reason).toContain('fewer than 3');
    expect(reason).toContain('unrated');
    expect(reason).toContain('#4 of 4');
  });

  it('states the index result and the delta for a rated week', () => {
    const reason = weeklyRatingReasonFor({
      rank: 1,
      leagueSize: 30,
      tier: 1,
      leagueNumber: 1,
      tradeCount: 5,
      returnPct: 4.5,
      indexReturnPct: 1.2,
      ratingResult: 'WIN',
      ratingDelta: 12.3,
    });
    expect(reason).toContain('beat the simulated index');
    expect(reason).toContain('went up by 12.3');
    expect(reason).toContain('#1 of 30');
  });
});
