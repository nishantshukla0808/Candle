import { StreakService } from './streak.service';
import { STREAK_TIMEZONE } from '@candle/shared';

describe('StreakService', () => {
  const svc = new StreakService();

  describe('kolkataDateString', () => {
    it('uses Asia/Kolkata, not UTC', () => {
      // 2026-11-01 20:30 UTC = 2026-11-02 02:00 IST.
      const at = new Date('2026-11-01T20:30:00.000Z');
      expect(svc.kolkataDateString(at)).toBe('2026-11-02');
      expect(STREAK_TIMEZONE).toBe('Asia/Kolkata');
    });

    it('formats as YYYY-MM-DD', () => {
      expect(svc.kolkataDateString(new Date('2026-01-05T10:00:00.000Z'))).toMatch(
        /^\d{4}-\d{2}-\d{2}$/
      );
    });
  });

  describe('nextStreak', () => {
    it('starts at 1 on first activity', () => {
      expect(svc.nextStreak(null, '2026-11-01', 0)).toEqual({ streak: 1, continued: false });
    });

    it('increments on the next calendar day', () => {
      expect(svc.nextStreak('2026-11-01', '2026-11-02', 3)).toEqual({ streak: 4, continued: true });
    });

    it('does not change on the same day', () => {
      expect(svc.nextStreak('2026-11-01', '2026-11-01', 3)).toEqual({
        streak: 3,
        continued: false,
      });
    });

    it('resets after a gap', () => {
      expect(svc.nextStreak('2026-10-28', '2026-11-01', 9)).toEqual({
        streak: 1,
        continued: false,
      });
    });

    it('handles month boundaries', () => {
      expect(svc.nextStreak('2026-10-31', '2026-11-01', 2)).toEqual({ streak: 3, continued: true });
    });

    it('handles year boundaries', () => {
      expect(svc.nextStreak('2026-12-31', '2027-01-01', 5)).toEqual({ streak: 6, continued: true });
    });
  });
});
