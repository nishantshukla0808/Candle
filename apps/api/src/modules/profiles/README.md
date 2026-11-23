# Profiles module

Profile view + privacy — docs/06 §1, docs/18, ADR 0015 (Phase 13, Step A).

Profiles **extend** the users module; they do not replace it.
`GET /users/me`, `PATCH /users/me`, and `GET /users/:id` stay in
`UsersController` and delegate here. Only the privacy + history +
ratings sub-routes live in `ProfilesController`.

## Endpoints (`/api/v1/users`)

| Method | Path           | Auth   | Notes                                                                  |
| ------ | -------------- | ------ | ---------------------------------------------------------------------- |
| GET    | `/me`          | user   | Full owner profile (users controller → `ProfilesService`).             |
| PATCH  | `/me`          | user   | `@Strict()` — display name + bio only. Country is rejected (§Country). |
| PATCH  | `/me/privacy`  | user   | `@Strict()` — visibility switch + 10 granular toggles.                 |
| GET    | `/:id`         | public | Public profile, privacy-filtered server-side.                          |
| GET    | `/:id/duels`   | public | Last 5 rated games per duel type, if allowed.                          |
| GET    | `/:id/ratings` | public | Ratings + rank, if allowed.                                            |
| POST   | `/me/avatar`   | user   | Unchanged (users module, StorageService §10).                          |

## Visibility (ADR 0015 §1)

| Setting          | Who can see the public profile?                                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Public (default) | Anyone, including logged-out visitors                                                                                          |
| Friends only     | **Behaves as PRIVATE until the friends phase lands** — no friend list exists to check against, so fail closed, never fail open |
| Private          | Only the owner. Others see "This profile is private."                                                                          |

Granular toggles (`showRatings`, `showRank`, `showLearningProgress`,
`showDuelHistory`, `showSimulatorShowcase`, `showBadges`,
`showFriendsList`, `allowFriendRequests`,
`allowChallengesFromStrangers`, `showOnlineStatus`) all default ON.
If a toggle is OFF the API returns `null` for that section, never an
empty list. Switching to PRIVATE does not rewrite the toggles — the
visibility gate hides everything first.

## Profile fields

- **Display name:** 2–30 chars, letters/numbers/spaces only. Max 1
  change per 30 days (`PROFILE_DISPLAY_NAME_COOLDOWN`, 409).
- **Bio:** max 160 chars. Links, phone numbers, and emails are
  **rejected** with per-field errors (not silently stripped).
- **Avatar:** existing StorageService flow, unchanged.
- **Country:** ISO alpha-2, shown on the profile. **Locked after
  signup** (decision 4) — no change endpoint, `PATCH /me` rejects
  `countryCode` at the boundary.
- **Career title:** derived from the Candle Rating (§1.7 bands:
  <1100 Intern, 1100–1299 Analyst, 1300–1499 Strategist, 1500–1699
  Risk Manager, 1700–1899 Portfolio Manager, 1900+ Market Expert).
  XP level is shown separately as "Level N".
- **Joined:** month + year only, e.g. "Nov 2026".
- **Ratings:** Learning / Trading / Candle + tier + provisional flag,
  read from the ratings module (never stored here).
- **Learning progress + badges:** read from the existing modules.

## Duel history

Last **5 games per duel type only** (LIVE / BLITZ / CASE / CHART /
DAILY from `DuelGameResult`, SPRINT / CRISIS from
`SprintDuelResult`, WEEKLY from `WeeklyResult`). Only **rated**
duels appear (BOT practice never does; unrated weekly weeks never
do). History is **read** from the existing result rows — no game
data is duplicated, no new history table exists.

## Simulator showcase

ON by default (decision 3, overturns the doc 06 §1.8 draft). A
**once-per-day snapshot** (`SimShowcaseSnapshot`, one row per user
per Asia/Kolkata date) — never a live feed. Shows virtual total
equity (2-decimal string), return % vs the virtual starting cash,
and the top 3 fictional holdings **by symbol only** (no quantities,
no exact cash, no order history), labelled "Virtual money only. Not
real investing. Not investment advice." Users who never opened the
simulator see "No simulator activity yet", not ₹0. The valuation
comes from `SimulatorService.peekPortfolioValuation`, which is
find-only: a profile read never creates a portfolio.

## What is NOT here

Friends/chat, communities, post-game stats rebuild, blocked users —
see ADR 0015 §10. `friendsList` is always `[]` for the owner and
`onlineStatus` is always `null`: no friends list or presence system
exists yet. Favourite topic is deferred (needs a defined
minimum-sample rule; see docs/18 §8).

## Layout

- `profiles.controller.ts` — thin: privacy + duels + ratings routes
- `profiles.service.ts` — business logic, privacy filtering, history assembly
- `profiles.repository.ts` — the ONLY file touching Prisma for
  profiles (reads other modules' tables for the view only; never
  writes outside its own tables)
- `career-title.ts`, `bio-validation.ts`, `display-name.ts` — pure helpers
- `dto/` — `UpdateMyProfileDto`, `UpdatePrivacyDto`
- `*.spec.ts` — unit tests
