# Settings module

Account, security, notifications, appearance, language + timezone,
DPDP export/delete — docs/06 §2, docs/18, ADR 0015 (Phase 13, Step B).

## Endpoints (`/api/v1/settings`, all authenticated)

| Method | Path                     | Notes                                                                                                               |
| ------ | ------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| GET    | `/me`                    | Email, display name, settings, deletion status.                                                                     |
| PATCH  | `/me`                    | `@Strict()` — theme, font size, reduce motion, language, timezone, quiet hours, streak reminder, marketing consent. |
| GET    | `/notifications`         | All 12 types with effective values (row or default).                                                                |
| PATCH  | `/notifications`         | `@Strict()` — one type per call (`inApp` / `push` / `email`).                                                       |
| GET    | `/sessions`              | Active sessions (refresh-token families).                                                                           |
| DELETE | `/sessions/:familyId`    | Revoke one session.                                                                                                 |
| DELETE | `/sessions`              | Revoke all other sessions (keeps the current one).                                                                  |
| POST   | `/change-password`       | Current + new. Revokes all other sessions.                                                                          |
| POST   | `/export`                | Export my data as JSON, max 1/day.                                                                                  |
| POST   | `/delete-account`        | Password confirm → deactivated at once (30-day grace).                                                              |
| POST   | `/delete-account/cancel` | Cancel a deletion in its grace period.                                                                              |

## Account

- **Email:** shown; change-email is **deferred** (ADR 0015 §10),
  not built in v1.
- **Password:** current + new. The **platform policy** governs
  (min 12 chars, upper+lower+digit+symbol, common-password
  denylist — the same policy as registration/reset). After a change,
  all **other** sessions are revoked; the current session stays
  signed in. When the current session cannot be identified (no
  refresh cookie), every session is revoked.
- **Display name:** same 30-day rule as profiles (via `PATCH /users/me`).

## Security

- **Sessions:** a view over the existing refresh-token families
  (`familyId`, User-Agent if recorded, `lastActiveAt`, `createdAt`,
  `isCurrent`). No new table. Device/browser comes from the
  User-Agent recorded at login/rotation (`RefreshToken.userAgent`,
  Phase 13); no IP is stored (city/country from IP is deferred).
  The current session is identified from the access token's `fam`
  claim (ADR 0015 §9): the refresh cookie cannot identify it,
  because it is path-scoped to `/api/v1/auth` and is never sent to
  `/api/v1/settings/*`. The claim is an identifier, not a credential
  — the family only counts as current while it holds a live token
  for the user. The cookie stays as a fallback for claim-less
  (pre-Phase-13) tokens; without either, "revoke all others" and
  password change revoke every session and say so.
- **Login history (last 20) and 2FA: DEFERRED** — no tables, no
  endpoints in v1 (ADR 0015 §10).

## Notifications (docs/06 §2.3)

12 types, each with `inApp` / `push` / `email` flags and the
documented defaults: important ON, marketing / new-lesson /
product-news OFF. No single "all notifications" switch turns on
marketing. Absent rows mean "use the default" — reads never write.

- **Quiet hours:** default 22:00–08:00 (user's timezone). No push
  in quiet hours; in-app still appears. Enforced by the pure helper
  `isInQuietHours` (the future push sender calls it).
- **Streak reminder:** preference + time (default 19:00, user's
  timezone), max 1/day. Eligibility is decided by the pure helper
  `streakReminderDue` (preference ON, not yet sent today, past the
  chosen time, not in quiet hours). Delivery in the
  character-emotions widget style is UI, not a push system — the
  preference controls whether the reminder is due, not how it looks.

## Appearance / language / timezone

- **Theme:** LIGHT / DARK / SYSTEM (default SYSTEM). **Font size:**
  NORMAL / LARGE. **Reduce motion:** flag.
- **Language:** `en` only in v1 (allowlist enforced in the service).
- **Timezone:** IANA name, default `Asia/Kolkata`. Streaks are still
  computed in Asia/Kolkata by the existing `StreakService` — this
  setting changes display times and the streak-reminder time only.
  Language + timezone live **only** in `UserSettings` (ADR 0015 §7).

## DPDP (docs/06 §2.6)

- **Export my data:** one button, max 1/day (rolling 24 h). v1
  generates the JSON **synchronously and returns it inline** — no
  file is stored, no 7-day link yet (a stored file + link is the
  documented upgrade when exports grow). Contents: profile,
  learning progress, XP ledger, badges, duel history, simulator
  orders, settings, notification preferences. Messages/posts are
  NOT included — those features do not exist yet.
- **Delete my account:** two steps. Step 1 (password confirm)
  **deactivates at once**: profile hidden, no login, all sessions
  revoked. 30-day grace: **login inside the grace cancels the
  deletion** (`AuthService.login`); after 30 days the account is
  hard-deleted by the **future scheduler job** — no HTTP endpoint
  in v1. The exact rule lives in `SettingsService.purgeExpiredDeletions`
  (callable by the future scheduler): rating rows are first
  anonymised onto the tombstone user ("Deleted user") so leaderboard
  history survives, then the User row is deleted and everything else
  personal cascades with it. Every request/cancel/purge is written
  to the append-only audit log.
- **Blocked users: DEFERRED** with friends/chat (ADR 0015 §10).
- **Min age 16+:** the User model has no birthdate field and signup
  does not collect age — the enforcement gap is recorded in ADR
  0015 §10 as a follow-up for the auth/signup flow.

## Layout

- `settings.controller.ts` — thin (current session from the refresh cookie)
- `settings.service.ts` — business logic
- `settings.repository.ts` — the ONLY file touching Prisma for
  settings (sessions/passwords stay in the auth module)
- `quiet-hours.ts` — pure helpers (quiet hours, streak-reminder eligibility)
- `dto/` — `UpdateSettingsDto`, `UpdateNotificationDto`,
  `ChangePasswordDto`, `DeleteAccountDto`, `FamilyParamDto`
- `*.spec.ts` — unit tests
