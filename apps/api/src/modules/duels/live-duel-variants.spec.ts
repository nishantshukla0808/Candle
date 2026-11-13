import { LIVE_DUEL_VARIANTS, variantConfig } from './live-duel-variants';

/**
 * Live duel variants — Phase 6 (Myth vs Fact Blitz, L2), Phase 7
 * (Case Duel, L3), Phase 8 (Chart Detective, L4).
 * The variant is the duel's shape only: the engine, gateway, timers,
 * and settlement are shared (docs/05 §3, docs/09).
 */

describe('live-duel-variants', () => {
  it('Speed Quiz (LIVE): 7 questions, 15 s each, MCQ_4 + TRUE_FALSE', () => {
    const config = variantConfig('LIVE');
    expect(config.variant).toBe('LIVE');
    expect(config.duelType).toBe('LIVE');
    expect(config.questionCount).toBe(7);
    expect(config.questionTimeMs).toBe(15_000);
    expect(config.types).toEqual(['MCQ_4', 'TRUE_FALSE']);
    expect(config.difficultyMix).toEqual({ 2: 2, 3: 3, 4: 2 });
    expect(Object.values(config.difficultyMix).reduce((s, n) => s + n, 0)).toBe(7);
    expect(config.maxPerTopic).toBe(2);
  });

  it('Myth vs Fact Blitz (BLITZ): 10 questions, 10 s each, TRUE_FALSE only', () => {
    const config = variantConfig('BLITZ');
    expect(config.variant).toBe('BLITZ');
    expect(config.duelType).toBe('BLITZ');
    expect(config.questionCount).toBe(10);
    expect(config.questionTimeMs).toBe(10_000);
    expect(config.types).toEqual(['TRUE_FALSE']);
    expect(config.difficultyMix).toEqual({ 2: 3, 3: 4, 4: 3 });
    expect(Object.values(config.difficultyMix).reduce((s, n) => s + n, 0)).toBe(10);
    expect(config.maxPerTopic).toBe(3);
    expect(config.hostIntro).toContain('10 rapid true-or-false');
  });

  it('Case Duel (CASE): 5 cases, 45 s each, CASE_CHOICE only, Kabir hosts', () => {
    const config = variantConfig('CASE');
    expect(config.variant).toBe('CASE');
    expect(config.duelType).toBe('CASE');
    expect(config.questionCount).toBe(5);
    expect(config.questionTimeMs).toBe(45_000);
    expect(config.types).toEqual(['CASE_CHOICE']);
    expect(config.difficultyMix).toEqual({ 2: 1, 3: 2, 4: 2 });
    expect(Object.values(config.difficultyMix).reduce((s, n) => s + n, 0)).toBe(5);
    expect(config.maxPerTopic).toBe(2);
    expect(config.hostName).toBe('Kabir');
    expect(config.hostIntro).toContain('5 cases, 45 seconds each');
  });

  it('Chart Detective (CHART): 5 charts, 30 s each, CHART_CHOICE only, Kabir hosts', () => {
    const config = variantConfig('CHART');
    expect(config.variant).toBe('CHART');
    expect(config.duelType).toBe('CHART');
    expect(config.questionCount).toBe(5);
    expect(config.questionTimeMs).toBe(30_000);
    expect(config.types).toEqual(['CHART_CHOICE']);
    expect(config.difficultyMix).toEqual({ 2: 1, 3: 2, 4: 2 });
    expect(Object.values(config.difficultyMix).reduce((s, n) => s + n, 0)).toBe(5);
    expect(config.maxPerTopic).toBe(2);
    expect(config.hostName).toBe('Kabir');
    expect(config.hostIntro).toContain('5 charts, 30 seconds each');
  });

  it('every variant’s difficulty mix sums to its question count', () => {
    for (const config of Object.values(LIVE_DUEL_VARIANTS)) {
      const sum = Object.values(config.difficultyMix).reduce((s, n) => s + n, 0);
      expect(sum).toBe(config.questionCount);
    }
  });

  it('rejects an unknown variant instead of guessing', () => {
    expect(() => variantConfig('DAILY' as any)).toThrow('Unknown live duel variant');
  });
});
