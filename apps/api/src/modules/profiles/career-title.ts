import { CAREER_TITLES } from '@candle/shared';

/**
 * Career title — docs/06 §1.7, ADR 0015 §2.
 *
 * Derived from the Candle Rating, never typed by the user. The bands
 * are the same as the Rating tiers, so the title and the tier always
 * agree. XP level is a separate number ("Level N") and never changes
 * the title: a Level 7 user can still be an Intern if their Rating
 * is low — XP measures effort, Rating measures skill.
 *
 * Pure: no I/O, no dates. Unit-tested at every band boundary.
 */

/** Career title for a Candle Rating (display rating, rounded integer). */
export function careerTitleFor(candleRating: number): string {
  let title: string = CAREER_TITLES[0]?.title ?? 'Intern';
  for (const band of CAREER_TITLES) {
    if (candleRating >= band.min) title = band.title;
  }
  return title;
}

/**
 * Joined date, month + year only (docs/06 §1.3) — e.g. "Nov 2026".
 * Never the exact time. UTC is used so the value is deterministic
 * for a stored createdAt, wherever the reader sits.
 */
export function joinedMonthYear(createdAt: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(createdAt);
}
