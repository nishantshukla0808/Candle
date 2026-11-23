/**
 * Quiet hours + streak reminder eligibility — docs/06 §2.3, ADR 0015 §7.
 *
 * Pure helpers, no I/O. The future push sender calls these before
 * sending anything; nothing in Phase 13 sends a push. The rules:
 * - Quiet hours (default 22:00–08:00, user's timezone): no push.
 *   In-app notifications still appear when the user opens the app.
 * - Streak reminder: at most 1 per day, at the user's chosen time
 *   (default 19:00, user's timezone), never in quiet hours, only when
 *   the preference is ON. The reminder itself is delivered in the
 *   character-emotions widget style (a mentor reacting) — that
 *   delivery is UI, not a push system; this helper only decides
 *   whether the day's reminder is due.
 *
 * All times are "HH:MM" in the user's IANA timezone. Streaks are
 * still computed in Asia/Kolkata by the existing StreakService —
 * these helpers never touch streak math.
 */

import { dateInTimezone, minutesInTimezone } from '../../common/utils/timezone-date';

/** Re-exported so existing importers keep working (single home: common/utils). */
export { dateInTimezone, minutesInTimezone } from '../../common/utils/timezone-date';

/** "HH:MM" -> minutes since midnight. Throws on a malformed value. */
export function parseHHMM(value: string): number {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) throw new Error(`Invalid HH:MM time: ${value}`);
  return Number(match[1]) * 60 + Number(match[2]);
}

/** True when value is a valid "HH:MM" (00:00–23:59). Never throws. */
export function isValidHHMM(value: string): boolean {
  try {
    parseHHMM(value);
    return true;
  } catch {
    return false;
  }
}

/** True when value is a valid IANA timezone name. Never throws. */
export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/**
 * True when `at` falls inside quiet hours. Quiet hours may wrap
 * midnight (22:00–08:00): then the interval is [start, 24:00) ∪
 * [00:00, end). A start equal to the end means "no quiet hours".
 */
export function isInQuietHours(
  at: Date,
  quietHoursStart: string,
  quietHoursEnd: string,
  timezone: string
): boolean {
  const start = parseHHMM(quietHoursStart);
  const end = parseHHMM(quietHoursEnd);
  if (start === end) return false;
  const now = minutesInTimezone(at, timezone);
  if (start < end) return now >= start && now < end;
  return now >= start || now < end;
}

export interface StreakReminderCheck {
  enabled: boolean;
  reminderTime: string;
  timezone: string;
  quietHoursStart: string;
  quietHoursEnd: string;
  /** When the last reminder was sent (null = never). */
  lastSentAt: Date | null;
}

/**
 * Whether the streak reminder is due at `now`, and why not when it
 * is not. Checked in order: preference OFF → already sent today
 * (user's timezone) → before the chosen time → inside quiet hours.
 * The caller records the send (lastSentAt) — this helper never writes.
 */
export function streakReminderDue(
  check: StreakReminderCheck,
  now: Date = new Date()
): { due: boolean; reason: string } {
  if (!check.enabled) return { due: false, reason: 'DISABLED' };
  if (check.lastSentAt) {
    const lastDay = dateInTimezone(check.lastSentAt, check.timezone);
    const today = dateInTimezone(now, check.timezone);
    if (lastDay === today) return { due: false, reason: 'ALREADY_SENT_TODAY' };
  }
  if (minutesInTimezone(now, check.timezone) < parseHHMM(check.reminderTime)) {
    return { due: false, reason: 'NOT_YET_TIME' };
  }
  if (isInQuietHours(now, check.quietHoursStart, check.quietHoursEnd, check.timezone)) {
    return { due: false, reason: 'QUIET_HOURS' };
  }
  return { due: true, reason: 'DUE' };
}
