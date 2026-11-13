import { Injectable } from '@nestjs/common';
import { STREAK_TIMEZONE } from '@candle/shared';

/**
 * StreakService — the ONLY place that computes calendar dates
 * (blueprint §6, ADR 0002/8).
 *
 * Streaks are counted in Asia/Kolkata calendar days. Dates are stored as
 * `YYYY-MM-DD` strings; no date math is scattered anywhere else.
 */
@Injectable()
export class StreakService {
  /**
   * Calendar date (YYYY-MM-DD) of `at` in the streak timezone.
   * Pure — unit-tested with fixed instants.
   */
  kolkataDateString(at: Date = new Date()): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: STREAK_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(at);
  }

  /**
   * Computes the next streak state. Pure — unit-tested.
   *
   * - Same day as last activity: streak unchanged.
   * - Exactly the next day: streak + 1.
   * - Anything else (gap or first activity): streak restarts at 1.
   */
  nextStreak(
    lastActivityDate: string | null,
    today: string,
    currentStreak: number
  ): { streak: number; continued: boolean } {
    if (lastActivityDate === today) {
      return { streak: currentStreak, continued: false };
    }
    if (lastActivityDate && isNextDay(lastActivityDate, today)) {
      return { streak: currentStreak + 1, continued: true };
    }
    return { streak: 1, continued: false };
  }
}

/** True when `today` is exactly the calendar day after `last`. */
function isNextDay(last: string, today: string): boolean {
  const [ly, lm, ld] = last.split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = today.split('-').map(Number) as [number, number, number];
  // Date math in UTC on calendar dates — no timezone involved, since both
  // inputs are already Asia/Kolkata calendar dates.
  const lastMs = Date.UTC(ly, lm - 1, ld);
  const todayMs = Date.UTC(ty, tm - 1, td);
  return todayMs - lastMs === 24 * 60 * 60 * 1000;
}
