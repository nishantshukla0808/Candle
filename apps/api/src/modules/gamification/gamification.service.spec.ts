import { levelForXp } from './gamification.service';
import { LEVEL_XP_THRESHOLDS } from '@candle/shared';

describe('levelForXp', () => {
  it('starts at level 1 with 0 XP', () => {
    expect(levelForXp(0)).toBe(1);
  });

  it('levels up exactly at thresholds', () => {
    LEVEL_XP_THRESHOLDS.forEach((threshold, i) => {
      expect(levelForXp(threshold)).toBe(i + 1);
      if (threshold > 0) expect(levelForXp(threshold - 1)).toBe(i);
    });
  });

  it('caps at the highest defined level', () => {
    expect(levelForXp(1_000_000)).toBe(LEVEL_XP_THRESHOLDS.length);
  });
});
