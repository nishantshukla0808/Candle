/**
 * Asia/Kolkata calendar dates for duels (ADR 0006/6).
 *
 * The Daily Duel day — and the Bot Duel daily cap — are the
 * **Asia/Kolkata calendar date** (IST), NOT the UTC day the Ratings
 * module uses for its daily caps (ADR 0005/2). A duel played at
 * 00:30 IST belongs to the new IST day even though it is still the
 * previous UTC day. This distinction is deliberate and documented in
 * ADR 0006: the Daily Duel is a daily habit loop for Indian users, so
 * its "day" is the day on their wall clock.
 *
 * The one-liner below duplicates StreakService.kolkataDateString
 * instead of importing it: StreakService is not exported by
 * GamificationModule, and the streak itself is still owned by
 * GamificationService (duels only borrow the date, never the streak
 * logic — see grantDuelRewards).
 */

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000; // Asia/Kolkata is UTC+05:30, no DST.

/** Calendar date (YYYY-MM-DD) of `at` in Asia/Kolkata. Pure. */
export function kolkataDateString(at: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

/**
 * UTC instant of the start of the Asia/Kolkata calendar day containing
 * `at` (i.e. IST midnight, 18:30 UTC the previous day). Used to count
 * Bot Duels started "today" (IST) with a UTC `startedAt` column.
 */
export function istDayStartUtc(at: Date = new Date()): Date {
  const [y, m, d] = kolkataDateString(at).split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d) - IST_OFFSET_MS);
}

/** True when `s` is a real calendar date in YYYY-MM-DD form. */
export function isValidIstDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number) as [number, number, number];
  const asDate = new Date(Date.UTC(y, m - 1, d));
  return (
    asDate.getUTCFullYear() === y && asDate.getUTCMonth() === m - 1 && asDate.getUTCDate() === d
  );
}
