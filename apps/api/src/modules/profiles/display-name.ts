import {
  PROFILE_DISPLAY_NAME_COOLDOWN_DAYS,
  PROFILE_DISPLAY_NAME_MAX,
  PROFILE_DISPLAY_NAME_MIN,
  PROFILE_DISPLAY_NAME_PATTERN,
} from '@candle/shared';

/**
 * Display-name rules — docs/06 §1.3, ADR 0015 §3.
 *
 * Display name: 2–30 chars, letters / numbers / spaces only. Names
 * can repeat (the id is the unique key). Max 1 change per 30 days.
 *
 * Pure: no I/O. The service enforces the cooldown; this file only
 * decides whether a change is allowed and how long is left.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Returns one issue per broken rule (empty = valid). Never throws. */
export function validateDisplayName(name: string): string[] {
  const issues: string[] = [];
  const trimmed = name.trim();
  if (trimmed.length < PROFILE_DISPLAY_NAME_MIN) {
    issues.push(`Display name must be at least ${PROFILE_DISPLAY_NAME_MIN} characters.`);
  }
  if (trimmed.length > PROFILE_DISPLAY_NAME_MAX) {
    issues.push(`Display name must be at most ${PROFILE_DISPLAY_NAME_MAX} characters.`);
  }
  if (trimmed.length > 0 && !PROFILE_DISPLAY_NAME_PATTERN.test(trimmed)) {
    issues.push('Display name may only contain letters, numbers, and spaces.');
  }
  if (trimmed !== name) {
    issues.push('Display name must not start or end with a space.');
  }
  return issues;
}

/**
 * The 30-day change cooldown. The first set is always allowed
 * (lastChangedAt null — e.g. a name set at signup). Returns the
 * whole days remaining, rounded up: a change 29 days ago leaves
 * 1 day, not 0.
 */
export function displayNameCooldown(
  lastChangedAt: Date | null,
  now: Date = new Date()
): { allowed: boolean; daysRemaining: number } {
  if (!lastChangedAt) return { allowed: true, daysRemaining: 0 };
  const elapsedDays = (now.getTime() - lastChangedAt.getTime()) / DAY_MS;
  if (elapsedDays >= PROFILE_DISPLAY_NAME_COOLDOWN_DAYS) {
    return { allowed: true, daysRemaining: 0 };
  }
  return {
    allowed: false,
    daysRemaining: Math.ceil(PROFILE_DISPLAY_NAME_COOLDOWN_DAYS - elapsedDays),
  };
}
