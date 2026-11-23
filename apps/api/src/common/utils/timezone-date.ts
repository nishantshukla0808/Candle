/**
 * Timezone date helpers — pure, no I/O.
 *
 * Used wherever a product rule is defined in a user's timezone
 * (showcase snapshots, quiet hours, streak reminders): the calendar
 * date and the minutes-since-midnight for an instant, in an IANA
 * timezone. Streak math itself stays in StreakService (Asia/Kolkata);
 * these helpers never compute a streak.
 */

/** Minutes since midnight for `at`, in `timezone` (default UTC). */
export function minutesInTimezone(at: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: timezone,
  }).formatToParts(at);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  // en-GB can render midnight as 24:xx — normalise to 0:xx.
  return ((hour % 24) * 60 + minute) % (24 * 60);
}

/** Calendar date (YYYY-MM-DD) for `at`, in `timezone`. */
export function dateInTimezone(at: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: timezone,
  }).formatToParts(at);
  const get = (type: string): string =>
    parts.find((p) => p.type === type)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
