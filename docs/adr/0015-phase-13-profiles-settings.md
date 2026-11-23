# ADR 0015 — Phase 13 Profiles + Settings (docs/06 §1–§2)

**Date:** 2026-11-13
**Status:** Accepted (built and verified; see §12)
**Context:** docs/06-profiles-settings-community.md (the design doc;
§10 decisions ALL LOCKED by Nishu 2026-11-12 — this ADR implements
them, it does not relitigate them), docs/01-system-design-blueprint.md
(production rules), docs/04-ratings-and-deployment.md (Ratings display,
tiers, country). All 12 duel phases are built and verified (Phases
1–12); Profiles + Settings is the next build in the doc 06 order
(decision 10): Profiles + Settings first, then post-game stats.
The question bank is NOT grown in this phase (on hold).

## 1. What was built

Two new modules, plus small additive changes to existing modules:

**Profiles (`src/modules/profiles/`, Step A)** — the profile is a
VIEW over data owned by other modules, not a second users module.
`GET /users/me`, `PATCH /users/me`, and `GET /users/:id` stay on
`UsersController` and delegate to `ProfilesService`; only the privacy

- history + ratings sub-routes live in `ProfilesController`.

* Fields: display name (2–30 chars, letters/numbers/spaces only,
  max 1 change per 30 days, §3), bio (max 160 chars; links, phone
  numbers, and emails are **rejected** with per-field errors, not
  silently stripped), avatar (existing StorageService flow, unchanged),
  country (ISO alpha-2, shown, **locked**, §2), career title from the
  Candle Rating (§1.7 bands: <1100 Intern, 1100–1299 Analyst,
  1300–1499 Strategist, 1500–1699 Risk Manager, 1700–1899 Portfolio
  Manager, 1900+ Market Expert; XP level shown separately as
  "Level N"), joined month + year only, Ratings display (Learning /
  Trading / Candle + tier + provisional flag) and learning progress +
  badges read from the existing modules.
* Visibility: one main switch PUBLIC (default) / FRIENDS / PRIVATE +
  10 granular toggles (§1.5). A toggle OFF returns **null** for that
  section, never an empty list. The owner (`GET /users/me`) sees
  everything. The public profile (`GET /users/:id`) is
  privacy-filtered server-side. **FRIENDS behaves as PRIVATE until
  the friends phase lands** (§3) — fail closed, never fail open.
* Duel history: last **5 games per duel type only** (LIVE / BLITZ /
  CASE / CHART / DAILY from `DuelGameResult`, SPRINT / CRISIS from
  `SprintDuelResult`, WEEKLY from `WeeklyResult`), **rated duels
  only**. History is **read** from the existing result rows — no game
  data is duplicated, no new history table exists.
* Simulator showcase ON by default (decision 3, overturns the doc 06
  §1.8 draft): a **once-per-day snapshot** (`SimShowcaseSnapshot`,
  one row per user per Asia/Kolkata date) — never a live feed. Shows
  virtual total equity (2-decimal string), return % vs the virtual
  starting cash, and the top 3 fictional holdings **by symbol only**
  (no quantities, no exact cash, no order history), labelled
  "Virtual money only. Not real investing. Not investment advice."
  Users who never opened the simulator see "No simulator activity
  yet", not ₹0. The valuation comes from
  `SimulatorService.peekPortfolioValuation`, which is **find-only**: a
  profile read never creates a portfolio.

**Settings (`src/modules/settings/`, Step B)** — account, security,
notifications, appearance, language + timezone, DPDP export/delete.

- Account: email shown (change-email is **deferred**, §10);
  display name (same 30-day rule); change password (current + new;
  after change all **other** sessions are revoked, §6).
- Security: session list over the existing refresh-token families
  (`familyId`, User-Agent if recorded, `lastActiveAt`, `createdAt`,
  `isCurrent`); revoke one session; revoke all other sessions.
  Login history (last 20) and 2FA are **deferred** (§10).
- Notifications: all **12 types** from doc 06 §2.3 with `inApp` /
  `push` / `email` flags and the documented defaults (important ON,
  marketing / new-lesson / product-news OFF for inApp + push).
  Quiet hours default 22:00–08:00; no push in quiet hours (pure
  helper `isInQuietHours`, which the future push sender calls).
  Streak reminder preference + time (default 19:00, user's timezone,
  max 1/day); eligibility is decided by the pure helper
  `streakReminderDue` (preference ON, not yet sent today, past the
  chosen time, not in quiet hours). The character-emotions widget
  delivery is UI, not a push system — the preference controls whether
  a reminder is due, not how it looks.
- Appearance: theme LIGHT / DARK / SYSTEM (default SYSTEM), font size
  NORMAL / LARGE, reduce-motion flag.
- Language + timezone: language `en` only in v1 (allowlist-validated);
  timezone IANA name, default `Asia/Kolkata`. Streaks are still
  computed in Asia/Kolkata by the existing `StreakService` — this
  setting changes display times and the streak-reminder time only.
  Language + timezone live **only** in `UserSettings` (the User model
  has no such columns).
- DPDP (§8): export my data (one button, max 1/day, JSON generated
  **synchronously and returned inline** — no stored file, no 7-day
  link in v1); delete account in two steps (password confirm →
  deactivated at once, 30-day grace, login during grace cancels the
  deletion; hard-delete after 30 days is a **future scheduler job**,
  exact rule recorded in §8). Ratings history is anonymised onto a
  tombstone user ("Deleted user") so leaderboard history survives.
- Blocked users: **deferred** with friends/chat (§10).

**Shared (`packages/shared/`):** Phase 13 constants (display-name
rules, 30-day cooldown, history per-type 5, career-title bands,
privacy toggles, showcase label + snapshot timezone, settings
defaults, 12 notification types + defaults, export limit 1/day,
delete grace 30 days, seeded communities list — the list only, no
tables) and error codes `PROFILE_DISPLAY_NAME_COOLDOWN` (409),
`SETTINGS_EXPORT_DAILY_LIMIT` (429), `SETTINGS_SESSION_NOT_FOUND`
(404), `SETTINGS_DELETE_ALREADY_REQUESTED` (409),
`SETTINGS_DELETE_NOT_REQUESTED` (409).

**Prisma:** `User` += `bio`, `profileVisibility` (enum
`ProfileVisibility`, default PUBLIC), `displayNameChangedAt`,
`deletionRequestedAt`, `deletionScheduledAt`; `RefreshToken` +=
`userAgent`; new enums `Theme` / `FontSize` / `NotificationType`;
new models `UserPrivacySettings`, `UserSettings`,
`NotificationPreference`, `DataExport`, `SimShowcaseSnapshot`.
Migration `0015_phase13_profiles_settings` (hand-reviewed, via
`prisma migrate diff`, §10). All additive, nullable columns, no
backfill.

## 2. What was NOT built (scope guard)

- Friends / chat, communities (no community tables are seeded — the 6
  seeded communities from doc 06 §5 are noted in docs/18 only, as
  later work), post-game stats rebuild (already exists in
  `DuelGameResult`; not rebuilt), question-bank growth (on hold).
- Change-email, login history (last 20), 2FA, blocked users, the
  hard-delete scheduler job, age enforcement (see §10).
- No web pages in this phase: the API is the deliverable; the frontend
  consumes it in a later phase. (Earlier phases shipped web pages
  alongside the API; Phase 13 is API-only by the task's scope.)

## 3. Decisions this ADR locks

### 3.1 FRIENDS visibility = PRIVATE until the friends phase lands

The friends system does not exist yet, so FRIENDS visibility cannot
be enforced against a friend list. Two readings were possible —
"FRIENDS means everyone for now" (fail open) or "FRIENDS means
nobody for now" (fail closed). This ADR locks **fail closed**: a
profile set to FRIENDS is readable only by its owner, exactly like
PRIVATE, until a friend list exists to check against. The rule is
enforced in `ProfilesService` (one place) and stated in the API docs,
the module README, and docs/18. When the friends phase lands, the
only change is that one gate — the toggles, the response shapes, and
the tests for PUBLIC/PRIVATE do not move.

### 3.2 Country is locked after signup — there is no change endpoint

Decision 4 (country locked, defined by mobile number code, no change
flow in v1) is implemented by **removing the field from the boundary
entirely**: `UpdateProfileDto` has no `countryCode`, so `@Strict()`
rejects it with `VALIDATION_FAILED` (400). The old 90-day country
cooldown and the `RatingsService.syncCountry` path are gone from the
service layer (`syncCountry` is kept, dormant, for a future admin
correction flow only). The e2e tests that asserted country change now
assert rejection instead.

**Known gap, recorded honestly:** signup collects no mobile number
and no country today, so `countryCode` is null for every user in v1
and national leaderboards are empty. Country becomes real when the
signup flow collects a mobile number code — that is a follow-up for
the auth/signup flow, not a silent default. The doc 06 §1.6 text
("country is set at signup") describes the intended flow, not the
current one.

### 3.3 Display-name cooldown: 1 change per 30 days, enforced server-side

`User.displayNameChangedAt` is stamped on every successful change
(and on registration, which also validates the 2–30 / charset rule).
A second change inside 30 days is `PROFILE_DISPLAY_NAME_COOLDOWN`
(409) with the next-allowed date in the message. The rule is checked
in `UsersService.updateMe` (the only writer of the display name) so
both the profile and the settings paths go through it.

### 3.4 Bio: reject, do not strip

A bio containing a link, phone number, or email is rejected with
per-field errors (`VALIDATION_FAILED` with one issue per problem —
an email counts once, not once per pattern it matches). Stripping was
considered and rejected: silently rewriting what a user typed is a
worse experience than telling them what to fix, and a stripped bio
("Check my site" with the URL gone) reads as broken.

## 4. Duel history and the showcase — why read-only, why a snapshot

Duel history reads the existing result rows because the game data
already exists exactly once. A second history table would drift from
the source of truth (the settlement rows) and would need its own
backfill for the ~620-question bank era's games. The per-type cap of
5 is enforced at the query (`take: 5`, newest first), and the rated
filter is `ratingBefore IS NOT NULL` (learning duels) /
`ratingDelta IS NOT NULL` (trading + weekly) — BOT practice and
unrated weekly weeks have null ratings and never appear.

The showcase is a snapshot, not a live feed, for the same reason the
task states it: a profile read is the most frequent read on the
platform, and valuing a portfolio on every read would price the
simulator on every profile view. One row per user per Asia/Kolkata
date, recomputed only when `computedDate` is not today. The snapshot
stores the rendered values (2-decimal strings), so a profile read
never touches the price engine. Staleness is honest and documented:
`asOf` is the IST date the snapshot was computed for, and the UI
shows it.

## 5. Password policy: the platform policy governs, not the shorthand

The task text says "min 8 chars, letter + number" for change
password. That is the shorthand floor, not a weaker rule: a password
change must never let a user **downgrade** their security below what
registration requires. `PasswordService.validatePolicy` (min 12,
upper + lower + digit + symbol, common-password denylist) governs
registration, reset, and change alike. The e2e password in the test
suite (`Str0ng!Passphrase12`) already satisfies it.

## 6. Sessions and the `fam` claim — the one thing the build caught late

### 6.1 The problem the e2e suite found

The first version of this phase identified the current session from
the refresh cookie: the settings controller read the cookie the auth
module sets and resolved its family. That design is **unworkable in
production**, and the e2e suite proved it: the refresh cookie is
path-scoped to `/api/v1/auth` (auth README), so no browser — and no
cookie jar — ever sends it to `/api/v1/settings/*`. "Revoke all
OTHER sessions" and "change password" could never have preserved the
current session; they would always have revoked everything. The
first e2e run failed exactly there (password change revoked the
caller's own session).

### 6.2 The fix: the access token carries its family

`TokenService.signAccessToken(user, familyId?)` now carries the
refresh family as the `fam` claim on the access token, and
`verifyAccessToken` returns it on `RequestUser.familyId`.
`RefreshTokenService.issuePair` / `rotate` pass the family in, so
every token minted from Phase 13 on carries it. The settings
controller resolves the current family from the claim first
(`SettingsService.resolveCurrentFamilyById`, which checks server-side
that the family still holds a live — not revoked, not expired —
refresh token for this user) and falls back to the cookie for
claim-less tokens minted before Phase 13. Without either, the
endpoints still work but treat every session as revocable and say so
(`keptCurrent: false`).

The `fam` claim is an identifier, not a credential: knowing a family
id lets nobody mint a refresh token, and every use is checked against
the stored family. A stolen access token already owns the session;
the claim adds nothing to the attacker. No cookie path was widened —
widening the refresh cookie to `/api/v1` would have sent the refresh
token with every API call, a larger exposure for no benefit.

### 6.3 What the session list shows

`userAgent` was added to `RefreshToken` and is threaded through
login/refresh (the controller reads the `user-agent` header), so the
list can label devices/browsers. No IP is stored — city/country from
IP is deferred. The current session is marked `isCurrent: true`;
revoked and expired families are excluded; a rotated family is one
session whose `lastActiveAt` is its newest token.

## 7. Timezone and language have one home

Language + timezone live **only** in `UserSettings`. The User model
has no such columns (deviation from doc 06 §1.10, which sketched
them on the profile — the settings module is the single home, and
the profile never duplicates settings). Streaks are still computed
in Asia/Kolkata by the existing `StreakService` (unchanged); the
timezone setting changes display times and the streak-reminder time
only. `isValidTimezone` uses `Intl.DateTimeFormat` (no hardcoded
list); `isInQuietHours` / `streakReminderDue` are pure functions in
`settings/quiet-hours.ts` with their own spec, so the future push
sender and the future streak-reminder job can import them without
the HTTP layer.

## 8. DPDP: export inline, delete in two steps, purge by scheduler

**Export (1/day, rolling 24 h):** v1 generates the JSON
**synchronously and returns it inline** — no file is stored, no
7-day link yet. A stored file + link is the documented upgrade when
exports grow (the `DataExport` row already records each request, so
the limit and the audit trail survive the upgrade). Contents:
profile, learning progress, XP ledger, badges, duel history,
simulator orders, settings, notification preferences. Messages/posts
are NOT included — those features do not exist yet.

**Delete (two steps):** step 1 (password confirm) **deactivates at
once**: `deletedAt` + `deletionRequestedAt` + `deletionScheduledAt`
(+30 days) are stamped, the profile is hidden (public and owner
reads treat `deletedAt` as not-found), login is blocked, and **all**
refresh families are revoked. A second request during the grace is
`SETTINGS_DELETE_ALREADY_REQUESTED` (409), not a 404 — a still-valid
access token can reach the endpoint for up to 15 minutes after
deactivation. Step 2 is the grace: **login inside the 30 days
cancels the deletion** (`AuthService.login` clears the three
timestamps; the cancellation is audit-logged). After 30 days the
account is hard-deleted by the **future scheduler job** — there is no
HTTP endpoint for it in v1. The exact rule lives in
`SettingsService.purgeExpiredDeletions` (callable by the future
scheduler): rating rows are first anonymised onto the tombstone user
(`deleted-user@candle.invalid`, display name "Deleted user",
unusable password hash) so leaderboard history survives, then the
User row is deleted and everything else personal cascades with it.
Every password change, deletion request, cancellation, and purge is
written to the append-only audit log (`AuditService`, exported from
`AdminModule` for this phase).

**Deactivated users' access tokens remain valid for up to 15
minutes** after deactivation (stateless JWTs cannot be revoked
early). That is a documented limit, not an oversight: the profile
and settings reads check `deletedAt` on every call, so a stale token
cannot read or change anything — it can only reach endpoints that
re-check, and they all return 404.

## 9. Module wiring (additive, plus one cycle fix)

- `AppModule` imports `ProfilesModule` + `SettingsModule`.
- `ProfilesModule` imports `RatingsModule` + `SimulatorModule`
  (read-only use: Ratings for the Ratings display, Simulator for the
  showcase valuation). `UsersModule` imports `ProfilesModule` and
  delegates; the `RatingsModule` import it used to carry is removed.
- `SettingsModule` imports `ProfilesModule` (export data),
  `AuthModule` (sessions + password change), `AdminModule`
  (audit log).
- `AuthModule` now also exports `AuthRepository`,
  `PasswordService`, and `RefreshTokenService` (settings needs them);
  `TokenService` was already exported (the global `JwtAuthGuard`
  uses it). `AdminModule` now exports `AuditService`.
- `UsersService` is rewritten to delegate `getMe` / `getPublicUser`
  / `updateMe` to `ProfilesService`; avatar handling is the only
  logic left in it. The legacy `getPublicProfile` that returned the
  email is removed.
- **Cycle fix:** `OnboardingModule` now imports `GamificationModule`
  via `forwardRef`. Profiles pulls `SimulatorModule` →
  `GamificationModule` into the graph first, so `onboarding.module.ts`
  was being evaluated while `gamification.module.ts` was still
  mid-evaluation and its direct import resolved to `undefined`
  (Nest: "module at index [0] is undefined"). LearningModule,
  QuizModule, and GamificationModule already use `forwardRef` for
  this exact cycle; OnboardingModule now matches them. No behaviour
  changed — only the import timing.

## 10. Data model + migration

Migration `0015_phase13_profiles_settings`, generated via
`prisma migrate diff --from-schema-datamodel <before> --to-schema-datamodel <after> --script`
(note: this Prisma 6.19 uses `--from-schema-datamodel`, NOT
`--from-schema`), header comment added, hand-reviewed: all additive,
nullable columns, no backfill, no data rewritten.

- `User`: `bio String?`, `profileVisibility ProfileVisibility`
  (default PUBLIC), `displayNameChangedAt DateTime?`,
  `deletionRequestedAt DateTime?`, `deletionScheduledAt DateTime?`
  (plus the pre-existing `deletedAt` from the soft-delete column).
- `RefreshToken`: `userAgent String?`.
- New: `UserPrivacySettings` (1:1, all 10 toggles default true),
  `UserSettings` (1:1, theme SYSTEM / font NORMAL / reduce-motion
  false / language `en` / timezone `Asia/Kolkata` / quiet hours
  22:00–08:00 / streak reminder on, 19:00 / marketing consent
  false), `NotificationPreference` (1 per user × type, `@@unique
([userId, type])`), `DataExport` (one row per export request),
  `SimShowcaseSnapshot` (1:1, `computedDate` is the Asia/Kolkata
  date the snapshot is for).
- Enums: `ProfileVisibility` (PUBLIC / FRIENDS / PRIVATE), `Theme`
  (LIGHT / DARK / SYSTEM), `FontSize` (NORMAL / LARGE),
  `NotificationType` (the 12 types from doc 06 §2.3).

## 11. API

All under `/api/v1`, standard envelope + error catalogue, OpenAPI on
every endpoint. New routes (existing `GET /users/me`, `PATCH
/users/me`, `GET /users/:id` unchanged in shape, new behaviour in
§1):

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

Private profile response is HTTP 200 with a minimal body
(`{ id, displayName, isPrivate: true, message: "This profile is
private.", ...nulls }`), not a 404 — per doc 06 §1.2. The owner
fetching their own `GET /users/:id` sees the full public-shaped
profile (no email/roles/toggles — those stay `/me`-only). Hidden
history/ratings sub-endpoints return null sections, not 404s; an
unknown user is a 404.

## 12. Verification

- Unit: **687 passed, 53 suites** (`npm test`), including 61
  Phase 13 tests: pure helpers (career title, bio validation,
  display-name rule + cooldown, quiet hours, streak-reminder
  eligibility, IST date helpers) and the two service specs with
  in-file fakes (profiles 11 tests, settings 12 tests — visibility
  rules, last-5 history, showcase snapshot reuse/staleness,
  sessions, password change, export limit, delete + cancel, purge
  onto the tombstone).
- E2E: **151 passed, 1 suite** (`npm run test:e2e`), including a
  new `describe('profiles + settings (Phase 13)')` with 12 tests:
  owner profile (career title, level, joined month, showcase ON +
  label), public profile + ratings sub-endpoint, last-5-per-type
  history (7 rated + 1 unrated LIVE, BLITZ/SPRINT/CRISIS/WEEKLY),
  showcase NO_ACTIVITY, PRIVATE + FRIENDS-as-private, granular
  toggle → null, settings defaults/update/validation, notifications
  (12 types, defaults, one change), export (inline JSON, then 429),
  bio/display-name validation + 30-day cooldown, sessions (list,
  revoke one, revoke all others, idempotent), password change
  (revokes other sessions only) + delete flows (wrong password 401,
  deactivate → profile 404, second request 409, login during grace
  cancels, login past grace fails generically). The pre-existing
  country e2e tests were rewritten to assert the lock (§3.2).
- Typecheck, lint (`--max-warnings=0`), and Prettier all clean.
- The e2e suite caught two real bugs before delivery: the refresh
  cookie cannot identify the current session (§6 — fixed with the
  `fam` claim) and a module-load-order cycle (§9 — fixed with
  `forwardRef` in OnboardingModule). Both fixes are covered by tests
  (the sessions e2e tests; the whole suite booting at all).

## 13. Limits and follow-ups (not in this phase)

- Migration 0015 is **not applied to a live Postgres**; Docker was
  not booted; the seed was not executed against a live DB;
  single-server tested config (same as Phases 1–12).
- **FRIENDS = PRIVATE** until the friends phase lands (§3.1).
- **Country is unsettable in v1** — signup collects no mobile
  number / country, so `countryCode` is null for everyone and
  national leaderboards are empty (§3.2).
- **Min age 16+ is not enforced**: the User model has no birthdate
  field and signup does not collect age. Recorded as a follow-up for
  the auth/signup flow; no signup change was invented in this phase.
- **Hard-delete is a future scheduler job** — deactivation +
  cancellation are built; `purgeExpiredDeletions` is the exact rule
  the job must call (§8).
- **Export is inline JSON only** — no stored file, no 7-day link yet
  (§8).
- **Login history (last 20) and 2FA: deferred.** Change-email:
  deferred. Blocked users: deferred with friends/chat. Favourite
  topic: deferred (needs a defined minimum-sample rule; see
  docs/18 §8). Online status is always null (no presence system);
  friends list is always `[]` for the owner.
- Deactivated users' access tokens remain valid for up to 15 minutes
  (§8); every profile/settings read re-checks `deletedAt`.
- The `fam` claim is new in Phase 13: tokens minted before it have
  no claim and fall back to the cookie (§6.2).
