import { PROFILE_BIO_MAX } from '@candle/shared';

/**
 * Bio validation — docs/06 §1.3, ADR 0015 §3.
 *
 * Bio: max 160 chars. No links, no phone number, no email. Phase 13
 * REJECTS a bio that contains one (per-field VALIDATION_FAILED), it
 * does not silently strip it: stripping rewrites what the user typed
 * without telling them, and a rejected bio tells them exactly which
 * rule broke so they can fix it.
 *
 * Pure: no I/O. Unit-tested, including the near-misses (a small
 * number such as "₹45,000" is not a phone number; "www." is a link).
 */

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const LINK_RE = /(https?:\/\/|www\.)[^\s]+/i;
/** A bare domain such as example.com — no scheme needed to be a link. */
const BARE_DOMAIN_RE = /\b[\w-]+(\.[\w-]+)*\.(com|in|io|org|net|me|co|app|dev)\b/i;
/** A run of digits (spaces/dashes/parens allowed) with 7+ digits. */
const PHONE_RUN_RE = /\+?[\d][\d\s\-().]{5,}\d/g;

function containsPhoneNumber(text: string): boolean {
  for (const match of text.matchAll(PHONE_RUN_RE)) {
    const digits = match[0].replace(/\D/g, '');
    if (digits.length >= 7) return true;
  }
  return false;
}

/** Returns one issue per broken rule (empty = valid). Never throws. */
export function validateBio(bio: string): string[] {
  const issues: string[] = [];
  if (bio.length > PROFILE_BIO_MAX) {
    issues.push(`Bio must be at most ${PROFILE_BIO_MAX} characters.`);
  }
  // An email address contains a domain — check links on the text with
  // emails removed, so one email reports one issue, not two.
  const withoutEmails = bio.replace(new RegExp(EMAIL_RE, 'g'), '');
  if (LINK_RE.test(withoutEmails) || BARE_DOMAIN_RE.test(withoutEmails)) {
    issues.push('Bio must not contain links.');
  }
  if (EMAIL_RE.test(bio)) {
    issues.push('Bio must not contain an email address.');
  }
  if (containsPhoneNumber(bio)) {
    issues.push('Bio must not contain a phone number.');
  }
  return issues;
}
