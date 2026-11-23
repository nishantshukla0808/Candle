# Candle — Phase 13: Profiles + Settings (docs/06 §1–§2, built)

**Date:** 2026-11-13
**Status:** BUILT and verified (ADR 0015; unit 687, e2e 151 — see §9)
**Design source:** docs/06-profiles-settings-community.md (§10 decisions
ALL LOCKED — implemented, not relitigated). Blueprint 01 (production
rules), Ratings design 04 (Ratings display, tiers, country).
**Scope:** Profiles (Step A) + Settings (Step B) only. Post-game stats
already exists in `DuelGameResult` (not rebuilt). Friends/chat,
communities, and question-bank growth are NOT in this phase (§8).

**Rule for this whole doc:** the public name is **Ratings**, never ELO.
All money is virtual. All tickers are fictional. Nothing here is
investment advice. The showcase label says so on every profile.

---

## 1. Architecture

Two new modules, both following the Feature Module Template
(blueprint §5): thin controllers, services hold business logic,
repositories are the only Prisma touchpoint, DTO validation on every
mutating endpoint, standard envelope + error catalogue, `JwtAuthGuard`

- ownership by construction (`/me` routes have no user-id parameter
  to tamper with).

```
apps/api/src/modules/
  profiles/                 # Step A — the profile VIEW
    profiles.controller.ts  # PATCH /users/me/privacy, GET /users/:id/duels|ratings
    profiles.service.ts     # visibility gates, history assembly, showcase
    profiles.repository.ts  # ONLY Prisma touchpoint for profiles
    career-title.ts         # careerTitleFor, joinedMonthYear (pure)
    bio-validation.ts       # validateBio (pure)
    display-name.ts         # validateDisplayName, displayNameCooldown (pure)
    dto/profiles.dto.ts     # UpdateMyProfileDto, UpdatePrivacyDto
    README.md
  settings/                 # Step B
    settings.controller.ts  # /settings/* (thin; current family from §5)
    settings.service.ts     # settings, notifications, sessions, DPDP
    settings.repository.ts  # ONLY Prisma touchpoint for settings
    quiet-hours.ts          # isInQuietHours, streakReminderDue (pure)
    dto/settings.dto.ts     # UpdateSettingsDto, UpdateNotificationDto,
                            # ChangePasswordDto, DeleteAccountDto, FamilyParamDto
    README.md
  users/                    # EXTENDED, not replaced
    users.controller.ts     # GET /me, PATCH /me, GET /:id — delegate to ProfilesService
    users.service.ts        # avatar handling only; profile logic moved out
  auth/                     # EXTENDED (additive)
    token.service.ts        # access token carries the `fam` claim (§5)
    refresh-token.service.ts# issuePair/rotate pass the family in
    auth.service.ts         # login cancels a deletion inside the grace (§7)
    auth.repository.ts      # userAgent, listRefreshTokensByUser,
                            # revokeAllExceptFamily, cancelDeletion
  simulator/                # EXTENDED (one read-only method)
    simulator.service.ts    # peekPortfolioValuation (find-only, §4)
  onboarding/               # ONE LINE — forwardRef (§9.3)
```

### 1.1 What was reused vs what is new

| Area              | Reused (unchanged)                                                                             | New in Phase 13                                                                                |
| ----------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Ratings display   | `RatingsService.getUserRatings`, `tierFor`, candleRating                                       | Career-title bands (§2.2), `toRatingsSection` / `toRankSection` projections in ProfilesService |
| Learning progress | `LearningRepository` rows via ProfilesRepository reads (tracks, modules, lessons, completions) | `listTrackProgress` projection (completed/total per track, current track)                      |
| Badges + XP       | `UserBadge` / `UserStats` / XP ledger rows                                                     | Projections only (`listBadges`, `listXpLedger`)                                                |
| Duel history      | `DuelGameResult`, `SprintDuelResult`, `WeeklyResult` rows                                      | `listRecent*` queries (rated-only, take 5); no new table, no duplicated data                   |
| Simulator         | `SimPortfolio`, holdings, price engine                                                         | `peekPortfolioValuation` (find-only) + `SimShowcaseSnapshot` table                             |
| Sessions          | `RefreshToken` families, rotation, reuse detection                                             | `userAgent` column, `listRefreshTokensByUser`, `revokeAllExceptFamily`, `fam` claim (§5)       |
| Passwords         | `PasswordService` (policy + Argon2id + token hashing)                                          | Nothing — change-password calls the same policy                                                |
| Audit log         | `AuditService` (append-only)                                                                   | `AdminModule` now exports it; settings writes password-change / deletion / purge entries       |
| Storage/avatar    | `StorageService` (§10)                                                                         | Nothing                                                                                        |

The profiles repository **reads** other modules' tables for the
profile view only and **never writes** outside its own tables
(User profile fields, `UserPrivacySettings`, `SimShowcaseSnapshot`).
Writes to other modules' tables stay with those modules.

### 1.2 Data model (migration 0015)

`User` += `bio`, `profileVisibility` (PUBLIC default), `displayNameChangedAt`,
`deletionRequestedAt`, `deletionScheduledAt`. `RefreshToken` += `userAgent`.
New: `UserPrivacySettings` (1:1, 10 toggles, all default true),
`UserSettings` (1:1 — theme SYSTEM, font NORMAL, reduce-motion false,
language `en`, timezone `Asia/Kolkata`, quiet hours 22:00–08:00, streak
reminder on at 19:00, marketing consent false), `NotificationPreference`
(1 per user × type), `DataExport` (one row per export request),
`SimShowcaseSnapshot` (1:1, `computedDate` = the Asia/Kolkata date the
snapshot is for). Enums: `ProfileVisibility`, `Theme`, `FontSize`,
`NotificationType` (12 types). Migration generated via
`prisma migrate diff`, hand-reviewed, all additive, no backfill.
Full DDL notes: ADR 0015 §10.

---

## 2. Profiles (Step A)

### 2.1 Fields

| Field                      | Rule                                                                                                                                                                                                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Display name               | 2–30 chars, letters/numbers/spaces only. Same rule at registration (`RegisterDto`) and at change. Max **1 change per 30 days** (`User.displayNameChangedAt`; second change inside the window is `PROFILE_DISPLAY_NAME_COOLDOWN`, 409, with the next-allowed date). |
| Bio                        | Max 160 chars. Links, phone numbers, and emails are **rejected** with per-field errors (one issue per problem; one email = one issue), not stripped (ADR 0015 §3.4).                                                                                               |
| Avatar                     | Existing StorageService flow, unchanged (multipart, magic-byte validation, old avatar deleted after the new one is stored).                                                                                                                                        |
| Country                    | ISO alpha-2, shown on the profile. **Locked after signup** — no change endpoint; `PATCH /me` rejects `countryCode` at the boundary (`@Strict()` → `VALIDATION_FAILED`, 400). See §2.5 for the known gap.                                                           |
| Career title               | Derived from the **Candle Rating** (decision 2): <1100 Intern, 1100–1299 Analyst, 1300–1499 Strategist, 1500–1699 Risk Manager, 1700–1899 Portfolio Manager, 1900+ Market Expert. XP level is shown separately as "Level N".                                       |
| Joined                     | Month + year only, e.g. "Nov 2026".                                                                                                                                                                                                                                |
| Ratings                    | Learning / Trading / Candle + tier + provisional flag, from the ratings module (never stored in profiles).                                                                                                                                                         |
| Learning progress + badges | Read from the existing modules (tracks with completed/total lessons, current track, badge list with award dates).                                                                                                                                                  |

### 2.2 Visibility rules

Main switch: **PUBLIC** (default) / **FRIENDS** / **PRIVATE** +
10 granular toggles: `showRatings`, `showRank`,
`showLearningProgress`, `showDuelHistory`, `showSimulatorShowcase`,
`showBadges`, `showFriendsList`, `allowFriendRequests`,
`allowChallengesFromStrangers`, `showOnlineStatus`. All default ON.

| Viewer                                | PUBLIC                    | FRIENDS               | PRIVATE                                                     |
| ------------------------------------- | ------------------------- | --------------------- | ----------------------------------------------------------- |
| Owner (`GET /users/me`, or own `:id`) | Everything                | Everything            | Everything                                                  |
| Anyone else (incl. logged-out)        | Privacy-filtered sections | **As PRIVATE** (§2.3) | "This profile is private." (HTTP 200 minimal body, not 404) |

Rules, in order (all enforced in `ProfilesService`, never in the
frontend):

1. **Deactivated users are not found.** `deletedAt` set → public
   and owner reads both return 404 (`NOT_FOUND`).
2. **The visibility gate runs first.** PRIVATE (or FRIENDS) hides
   everything for non-owners — the toggles are not consulted.
3. **A toggle OFF returns null for that section, never an empty
   list.** (`ratings: null`, `duelHistory: null`, …). Switching to
   PRIVATE does **not** rewrite the toggles — the gate hides
   everything; the toggles keep their values for when the user goes
   public again.
4. **The owner always sees everything** on `GET /users/me`. On
   `GET /users/:id` with their own id they see the full public-shaped
   profile — but never email/roles/toggles, which stay `/me`-only.
5. **Sub-endpoints follow the same gates.** `GET /users/:id/duels`
   and `GET /users/:id/ratings` return null sections (not 404) when
   hidden; an unknown user is a 404. The ratings sub-endpoint also
   returns null when _both_ `showRatings` and `showRank` are off.
6. **Friends list is always `[]` for the owner** (no friends list
   exists yet) and **online status is always `null`** (no presence
   system yet).

### 2.3 The FRIENDS decision (ADR 0015 §3.1)

The friends system does not exist yet, so FRIENDS visibility cannot
be enforced against a friend list. The locked rule is **FRIENDS
behaves as PRIVATE until the friends phase lands** — fail closed,
never fail open. ("FRIENDS means everyone for now" would have
silently published private profiles.) When the friends phase lands,
the only change is that one gate; the toggles, response shapes, and
PUBLIC/PRIVATE tests do not move.

### 2.4 Duel history

Last **5 games per duel type only**, newest first, **rated duels
only**:

| Group                           | Source table                                | Rated filter               |
| ------------------------------- | ------------------------------------------- | -------------------------- |
| LIVE, BLITZ, CASE, CHART, DAILY | `DuelGameResult` (+ `Duel.type`)            | `ratingBefore IS NOT NULL` |
| SPRINT, CRISIS                  | `SprintDuelResult` (+ `Duel.type`)          | `ratingDelta IS NOT NULL`  |
| WEEKLY                          | `WeeklyResult` (+ `WeeklySeason.weekStart`) | `ratingDelta IS NOT NULL`  |

BOT practice duels and unrated weekly weeks have null ratings and
never appear. Each learning item carries the opponent (human display
name, or **"Mira"** for bot duels — hosts speak before/after only,
never during a rated question) and the opponent's score from the
paired result row. Each trading item carries return %, risk score,
opponent risk score + equity, and trade count. Each weekly item
carries rank, league size, tier, return %, and trade count. No
total/full history view exists (extra rule from the task) — the API
returns at most 5 per type and there is no endpoint for more.

### 2.5 Simulator showcase

ON by default (decision 3, overturns the doc 06 §1.8 draft). A
**once-per-day snapshot** (`SimShowcaseSnapshot`, one row per user
per Asia/Kolkata date), recomputed only when `computedDate` is not
today — never a live feed. Contents: virtual total equity
(2-decimal string), return % vs the virtual ₹100,000 starting cash,
top 3 fictional holdings **by symbol only** (+ market value). Label
on every showcase: "Virtual money only. Not real investing. Not
investment advice." Users who never opened the simulator see
`{ status: 'NO_ACTIVITY', message: 'No simulator activity yet' }`,
not ₹0. Exact cash, quantities, and order history are never shown
(order history exists only in the DPDP export, §7.1, for the owner).

The valuation comes from `SimulatorService.peekPortfolioValuation`
(find-only — returns `null` when no portfolio exists; a profile read
never creates a portfolio). `asOf` is the IST date the snapshot was
computed for, so staleness is visible, not hidden.

### 2.6 Country — locked, and the known gap

Country is locked after signup (decision 4): there is no change
endpoint, and `PATCH /me` rejects `countryCode` at the boundary.
The old 90-day cooldown is gone (`RatingsService.syncCountry` is
kept, dormant, for a future admin correction flow only).

**Known gap:** signup collects no mobile number and no country
today, so `countryCode` is null for every user in v1 and national
leaderboards are empty. Country becomes real when signup collects a
mobile number code — a follow-up for the auth/signup flow. Do not
paper over this with a default country: a wrong default would put
users on the wrong national leaderboard.

---

## 3. Settings (Step B)

### 3.1 Catalogue

| Area          | Setting                     | Default / rule                                                                                                                                                                                                                                                                                                       |
| ------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Account       | Email                       | Shown. Change-email **deferred** (§8).                                                                                                                                                                                                                                                                               |
| Account       | Display name                | Same 30-day rule as §2.1 (via `PATCH /users/me`).                                                                                                                                                                                                                                                                    |
| Account       | Change password             | Current + new; **platform policy governs** (min 12, upper+lower+digit+symbol, denylist — the task's "min 8, letter + number" is the shorthand floor, not a weaker rule; ADR 0015 §5). After change, all **other** sessions are revoked (§5).                                                                         |
| Security      | Sessions                    | List over refresh-token families (§5). Revoke one; revoke all others.                                                                                                                                                                                                                                                |
| Security      | Login history (last 20)     | **Deferred** (§8).                                                                                                                                                                                                                                                                                                   |
| Security      | 2FA                         | **Deferred** (§8).                                                                                                                                                                                                                                                                                                   |
| Notifications | 12 types × inApp/push/email | Defaults in §3.2. No row = use the default (reads never write).                                                                                                                                                                                                                                                      |
| Notifications | Quiet hours                 | 22:00–08:00, user's timezone. No push inside them; in-app still appears. Pure helper `isInQuietHours`.                                                                                                                                                                                                               |
| Notifications | Streak reminder             | Preference + time, default 19:00 user timezone, max 1/day. Eligibility via pure helper `streakReminderDue` (ON + not sent today + past the chosen time + not in quiet hours). The character-emotions widget delivery is UI, not a push system — the preference controls whether a reminder is due, not how it looks. |
| Appearance    | Theme                       | LIGHT / DARK / SYSTEM, default SYSTEM.                                                                                                                                                                                                                                                                               |
| Appearance    | Font size                   | NORMAL / LARGE.                                                                                                                                                                                                                                                                                                      |
| Appearance    | Reduce motion               | Flag.                                                                                                                                                                                                                                                                                                                |
| Language      | `language`                  | `en` only in v1 (allowlist-validated).                                                                                                                                                                                                                                                                               |
| Timezone      | `timezone`                  | IANA name, default `Asia/Kolkata`. Streaks still computed in Asia/Kolkata (`StreakService`, unchanged); the setting changes display times and the streak-reminder time only. Language + timezone live **only** in `UserSettings`.                                                                                    |

### 3.2 Notification types and defaults (doc 06 §2.3)

All 12 types: `DUEL_INVITE`, `DUEL_RESULT`, `REMATCH_REQUEST`,
`FRIEND_REQUEST`, `FRIEND_ACCEPTED`, `CHALLENGE_RECEIVED`,
`LESSON_REMINDER`, `STREAK_REMINDER`, `WEEKLY_RECAP`,
`NEW_LESSON`, `PRODUCT_NEWS`, `MARKETING`. Important types are ON
(inApp + push for invites; inApp for results/rematches/friend
events), marketing / new-lesson / product-news are OFF for inApp +
push. There is no single "all notifications" switch that turns
marketing on. Updating one type never touches the others
(`upsertNotificationPref` merges per-channel, falling back to the
stored row, then the default).

---

## 4. Sessions — the `fam` claim (ADR 0015 §6)

The first version of this phase identified the current session from
the refresh cookie. That cannot work: the refresh cookie is
path-scoped to `/api/v1/auth`, so it is never sent to
`/api/v1/settings/*` — "revoke all others" and password change would
always have revoked the caller's own session too. The e2e suite
caught this before delivery.

The fix: the access token carries its refresh family as the `fam`
claim (`TokenService.signAccessToken(user, familyId?)`;
`RefreshTokenService.issuePair` / `rotate` pass the family in).
`verifyAccessToken` returns it as `RequestUser.familyId`. The
settings controller resolves the current family from the claim first
(`SettingsService.resolveCurrentFamilyById` — the family only counts
while it still holds a live, non-revoked, non-expired refresh token
for this user) and falls back to the cookie for claim-less tokens
minted before Phase 13. Without either, the endpoints still work but
treat every session as revocable and say so (`keptCurrent: false`).

The `fam` claim is an identifier, not a credential: it only ever
identifies a session, and every use is checked server-side. No
cookie path was widened (widening would send the refresh token with
every API call).

The session list shows `familyId`, the User-Agent recorded at
login/rotation (`RefreshToken.userAgent`, threaded from the
`user-agent` header), `lastActiveAt`, `createdAt`, and `isCurrent`.
Revoked and expired families are excluded. No IP is stored
(city/country from IP is deferred).

---

## 5. DPDP (docs/06 §2.6)

### 5.1 Export my data — 1/day, inline JSON

One button, max **1/day (rolling 24 h)** — a second request the same
day is `SETTINGS_EXPORT_DAILY_LIMIT` (429). v1 generates the JSON
**synchronously and returns it inline** — no file is stored, no
7-day link yet (a stored file + link is the documented upgrade when
exports grow; the `DataExport` row already records each request, so
the limit and the audit trail survive the upgrade). Contents:
profile, learning progress, XP ledger, badges, duel history,
simulator orders, settings, notification preferences. Messages/posts
are NOT included — those features do not exist yet.

### 5.2 Delete my account — two steps, 30-day grace

1. **Password confirm → deactivated at once.** `deletedAt` +
   `deletionRequestedAt` + `deletionScheduledAt` (+30 days) are
   stamped, the profile is hidden (public and owner reads treat
   `deletedAt` as not-found), login is blocked, and **all** refresh
   families are revoked. A second request during the grace is
   `SETTINGS_DELETE_ALREADY_REQUESTED` (409) — a still-valid access
   token can reach the endpoint for up to 15 minutes after
   deactivation.
2. **Grace: login inside the 30 days cancels the deletion.**
   `AuthService.login` clears the three timestamps (audit-logged).
   After 30 days the account is hard-deleted by the **future
   scheduler job** — there is no HTTP endpoint for it in v1. The
   exact rule lives in `SettingsService.purgeExpiredDeletions`:
   rating rows are first anonymised onto the tombstone user
   (`deleted-user@candle.invalid`, display name "Deleted user",
   unusable password hash) so leaderboard history survives, then the
   User row is deleted and everything else personal cascades with it.

Every password change, deletion request, cancellation, and purge is
written to the append-only audit log. **Limit:** deactivated users'
access tokens remain valid for up to 15 minutes (stateless JWTs
cannot be revoked early). Every profile/settings read re-checks
`deletedAt`, so a stale token cannot read or change anything.

### 5.3 Min age 16+ — the enforcement gap

The User model has no birthdate field and signup does not collect
age, so the 16+ minimum **cannot be enforced yet**. Recorded as a
follow-up for the auth/signup flow; no signup change was invented
in this phase.

---

## 6. API

All under `/api/v1`, standard envelope + error catalogue, OpenAPI on
every endpoint. New routes (existing `GET /users/me`, `PATCH
/users/me`, `GET /users/:id` unchanged in shape):

| Method | Path                              | Notes                                                                                                   |
| ------ | --------------------------------- | ------------------------------------------------------------------------------------------------------- |
| PATCH  | `/users/me/privacy`               | `@Strict()` — visibility + 10 toggles.                                                                  |
| GET    | `/users/:id/duels`                | `@Public()` — last 5 rated per type, if allowed.                                                        |
| GET    | `/users/:id/ratings`              | `@Public()` — Ratings + rank, if allowed.                                                               |
| GET    | `/settings/me`                    | Email, display name, settings, deletion status.                                                         |
| PATCH  | `/settings/me`                    | `@Strict()` — theme, font, motion, language, timezone, quiet hours, streak reminder, marketing consent. |
| GET    | `/settings/notifications`         | All 12 types with effective values (row or default).                                                    |
| PATCH  | `/settings/notifications`         | `@Strict()` — one type per call.                                                                        |
| GET    | `/settings/sessions`              | Active sessions (refresh-token families).                                                               |
| DELETE | `/settings/sessions/:familyId`    | Revoke one session.                                                                                     |
| DELETE | `/settings/sessions`              | Revoke all other sessions (keeps the current one).                                                      |
| POST   | `/settings/change-password`       | Current + new. Revokes all other sessions.                                                              |
| POST   | `/settings/export`                | Export my data as JSON, max 1/day.                                                                      |
| POST   | `/settings/delete-account`        | Password confirm → deactivated at once (30-day grace).                                                  |
| POST   | `/settings/delete-account/cancel` | Cancel a deletion in its grace period.                                                                  |

Error codes added in this phase: `PROFILE_DISPLAY_NAME_COOLDOWN`
(409), `SETTINGS_EXPORT_DAILY_LIMIT` (429),
`SETTINGS_SESSION_NOT_FOUND` (404),
`SETTINGS_DELETE_ALREADY_REQUESTED` (409),
`SETTINGS_DELETE_NOT_REQUESTED` (409).

---

## 7. Testing

### 7.1 Automated

- **Unit (61 Phase 13 tests, 687 total):** pure helpers
  (`career-title`, `bio-validation`, `display-name`,
  `quiet-hours`, `timezone-date`) and the two service specs with
  in-file fakes — profiles (owner view, toggle-nulls,
  PRIVATE/FRIENDS-as-private, logged-out read, deactivated 404,
  cooldown 409, bio 400, last-5 history, showcase
  NO_ACTIVITY/snapshot-reuse/stale-recompute) and settings
  (defaults, validation, notification defaults, session
  grouping/revoke, `resolveCurrentFamilyById` trust rules, password
  change, export 1/day, delete + cancel, purge onto the tombstone).
- **E2E (12 Phase 13 tests, 151 total)** in
  `describe('profiles + settings (Phase 13)')`, over the in-memory
  fakes (`FakeProfilesRepository`, `FakeSettingsRepository`,
  extended `FakeAuthRepository` / `FakeUsersRepository` /
  `FakeSimulatorRepository`): owner profile, public profile +
  ratings sub-endpoint, last-5-per-type history (7 rated + 1 unrated
  LIVE, BLITZ/SPRINT/CRISIS/WEEKLY), showcase ON + label +
  NO_ACTIVITY, PRIVATE + FRIENDS-as-private, granular toggle →
  null, settings defaults/update/validation, notifications (12
  types, defaults, one change), export (inline JSON, then 429),
  bio/display-name validation + 30-day cooldown, sessions (list,
  revoke one, revoke all others, idempotent), password change
  (revokes other sessions only) + delete flows (wrong password 401,
  deactivate → profile 404, second request 409, login during grace
  cancels, login past grace fails generically). Pre-existing country
  e2e tests rewritten to assert the lock (§2.6).
- Typecheck, lint (`--max-warnings=0`), Prettier — all clean.

### 7.2 Manual QA (for the reviewer — no live DB exists yet)

1. Register two users; set user A's profile PRIVATE; as user B (and
   logged out) `GET /users/<A>` shows only the private stub; as A it
   shows everything.
2. Set A to FRIENDS; B still sees the private stub (FRIENDS =
   PRIVATE until friends land).
3. Turn off `showDuelHistory` (PUBLIC); B sees `duelHistory: null`
   but `ratings` still present; `GET /users/<A>/duels` returns
   `duelHistory: null`.
4. Play 7 rated LIVE duels as A; B sees exactly 5, newest first.
5. Open the simulator as A, buy NVLT; `GET /users/me` shows the
   showcase ACTIVE with the label and `NVLT` in top holdings; a
   second read the same day shows the same `asOf`.
6. `PATCH /users/me { countryCode: "IN" }` → 400.
7. Change display name twice within 30 days → second is 409.
8. Log in on two browsers; `GET /settings/sessions` shows 2 with
   one `isCurrent`; revoke one; the other browser's refresh fails.
9. Change password; the other browser's refresh fails; this
   browser's still works.
10. `POST /settings/export` twice → second is 429.
11. `POST /settings/delete-account` (wrong password → 401; right
    password → 200); profile is 404; log in again → deletion
    cancelled, profile back.

---

## 8. Deferred items (with reasons)

| Item                                                     | Reason it waits                                                                                                                                          |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Friends / chat (incl. 1-to-1 chat for 16–17, group chat) | Needs the friends system first; Profiles + Settings was decision 10's first step. FRIENDS visibility is already gated for it (§2.3).                     |
| Communities (6 seeded at launch, user-created later)     | Needs the community model + moderation; doc 06 §5. The 6 seeded names live in shared constants only — no tables seeded.                                  |
| Post-game stats rebuild                                  | Already exists in `DuelGameResult`; the next phase after Profiles + Settings.                                                                            |
| Change-email                                             | Needs a verified-email flow (new email must be verified before it replaces the old one); out of scope for v1.                                            |
| Login history (last 20)                                  | Needs a login-events table (or deriving from refresh families, which loses logins that never refreshed); deferred, not faked.                            |
| 2FA                                                      | Needs TOTP enrolment + recovery codes + login-flow changes; a whole phase on its own.                                                                    |
| Blocked users                                            | Deferred with friends/chat (blocking only makes sense once other users can reach you).                                                                   |
| Hard-delete scheduler job                                | Needs the future scheduler (named `weekly-season-scheduler` precedent); the exact rule is implemented in `purgeExpiredDeletions` and waits for a caller. |
| Age enforcement (16+)                                    | Needs a birthdate field + signup change (§5.3).                                                                                                          |
| Export as stored file + 7-day link                       | Inline JSON is enough while exports are small; the `DataExport` row is the seam for the upgrade.                                                         |
| Favourite topic                                          | Needs a defined minimum-sample rule (a favourite from 1 game is noise); not in the task's Scope A list.                                                  |
| City/country from IP on sessions                         | Needs IP storage + a geo lookup; privacy decision, not taken in v1.                                                                                      |
| IP-based login history / device names                    | Same as above.                                                                                                                                           |

---

## 9. Known limits

- Migration 0015 not applied to a live Postgres; Docker not booted;
  seed not executed against a live DB; single-server tested config.
- FRIENDS = PRIVATE until the friends phase lands (§2.3).
- Country unsettable in v1; national leaderboards empty (§2.6).
- Age 16+ not enforced (§5.3). Hard-delete needs the scheduler (§8).
- Deactivated access tokens valid up to 15 min (§5.2).
- Tokens minted before Phase 13 have no `fam` claim and fall back
  to the refresh cookie for current-session identification (§4).
- Showcase snapshot is at most one day stale by design (§2.5).
- No web pages in this phase — API only.
