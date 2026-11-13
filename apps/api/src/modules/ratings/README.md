# Ratings module

Skill ratings — docs/04-ratings-and-deployment.md (Phase 3, ADR 0005).

Separate **Learning** and **Trading** ratings per user, starting at 1000
(floor 100). The headline **Candle Rating** is derived
(0.5 × Learning + 0.5 × Trading) and shown only with its two parts.

## Endpoints (`/api/v1/ratings`)

| Method | Path                  | Auth   | Notes                                                                                       |
| ------ | --------------------- | ------ | ------------------------------------------------------------------------------------------- |
| POST   | `/duels`              | user   | **Rated learning duel** — requires `Idempotency-Key` header matching body `idempotencyKey`. |
| POST   | `/trading-week`       | ADMIN  | Weekly Trading rating vs the simulated index (1200). Caller supplies the numbers.           |
| POST   | `/admin/season-reset` | ADMIN  | Quarterly soft reset: halfway toward 1000. Idempotent per season.                           |
| POST   | `/admin/decay`        | ADMIN  | Inactivity decay: 10/week past a 30-day grace, max 50/run, never below floor.               |
| GET    | `/me`                 | user   | My Learning / Trading / Candle ratings, tiers, ranks, percentiles.                          |
| GET    | `/me/history`         | user   | My rating history (audit trail), paginated, `?kind=LEARNING\|TRADING`.                      |
| GET    | `/leaderboard`        | public | Top 100 per kind/scope: `?kind=LEARNING&scope=global\|country&country=IN`.                  |
| GET    | `/users/:id`          | public | Public ratings for one user.                                                                |

Every endpoint carries the educational disclaimer (blueprint §16).

## Formula (one formula for every rated event)

`Ea = 1 / (1 + 10^((Rb − Ra) / 400))`, `Ra' = Ra + K × (Sa − Ea)`,
`Sa` = 1 win / 0.5 draw / 0 loss. Both sides update in the same
transaction; the delta is rounded to 1 decimal first, so points gained
exactly equal points lost. Pure math lives in `rating-math.ts`
(`expectedScore`, `kFactor`, `tierFor`, `applyUpdate`, `softReset`,
`decayFor`) and is fully unit-tested, including the doc's worked
example (1200 vs 1400, K=32, win ⇒ +24.3 → 1224.3).

K-factor: 40 provisional (first 10 rated events), 32 at 1400 and below,
24 for 1401–1799, 16 at 1800+ (the 1400 boundary follows the doc's
worked example, not the table's literal "<1400" — see ADR 0005/2).

Tiers: Bronze <1100 · Silver 1100–1299 · Gold 1300–1499 ·
Platinum 1500–1699 · Diamond 1700–1899 · Master 1900+.

## What counts (and what does not)

- **Learning:** duels only. Practice quizzes, lesson quizzes, and daily
  challenges give XP/streaks but NEVER change a rating.
- **Trading:** weekly seasons + live Paper Trading Sprints (Phase 9,
  ADR 0011 §6). Weekly: one rated update per user per week; fewer
  than 3 trades = unrated week (`applied:false`, no change, key not
  consumed). Win when the portfolio beats the index by >2 points,
  loss when it trails by >2, draw within ±2. Opponent is the simulated
  index, fixed at 1200. Sprints: `recordTradingDuel` /
  `recordTradingDuelVsBot` (kind TRADING, source DUEL) — the winner
  is decided on risk-adjusted return, not on the weekly index
  comparison; a bot sprint is rated at the player's own Trading
  Rating (expected score 0.5). Pair/day caps are TRADING-only, so
  learning duels never consume sprint caps.

## Anti-gaming (enforced server-side, docs/04 §5)

- Same pair: max 3 rated duels/day (`RATING_DAILY_LIMIT`, 409).
- Each user: max 10 rated events/day, all kinds (`RATING_DAILY_LIMIT`).
- Same pair: 5-minute rematch cooldown (`RATING_DUEL_COOLDOWN`, 409).
- Duplicate event ids: `RATING_EVENT_DUPLICATE` (409); the
  `Idempotency-Key` replay path returns 409 `IDEMPOTENCY_REPLAY` with
  the original result, as in the simulator.

## Seasons, decay, leaderboards

- Season = calendar quarter (`2026-Q4`). Soft reset at season start:
  `R_new = 1000 + (R_old − 1000) × 0.5`, recorded in history, order
  preserved. Re-running a season is a no-op (history event id).
- Decay: after 30 days with no rated event in a rating, 10 points per
  started week past the grace toward 1000, max 50 per run, never below
  the floor. One decay per user/kind/week (history event id carries the
  week). Decay never touches `lastRatedAt`.
- Leaderboards: Redis sorted sets per kind per scope
  (`ratings:lb:LEARNING:global`, `ratings:lb:LEARNING:country:IN`),
  updated on every rating change; Postgres is the source of truth and
  an empty set is rebuilt from it on read. Percentile =
  (users below ÷ total in scope) × 100. Users with no country appear
  only on the global board. Leaderboard responses expose display name,
  rating, tier, rank, percentile — never email/phone/holdings.

## Country

`User.countryCode` (2-letter ISO, uppercase) + `countryCodeChangedAt`.
Set via `PATCH /users/me` (`UpdateProfileDto.countryCode`); changing to
a different code within 90 days is 409 `RATING_COUNTRY_COOLDOWN`.
First set is always allowed; setting the same code is a no-op.
`countryCode` is denormalised onto `UserRating` rows at write time and
refreshed when the user changes country, so leaderboard rebuilds can
use it; the `User` row stays the authority.

## Simulator seam (ADR 0005/7)

The Ratings module never imports or queries the simulator module. The
admin trading-week caller supplies `portfolioReturnPct`,
`indexReturnPct`, `tradeCount`, and `weekStart`; Ratings only applies
the formula. The seam is the endpoint contract, not shared code.

## History (audit trail)

`rating_history`: one row per rated event — `eventId` (idempotency key,
unique per user), opponent, expected/actual score, K, delta,
ratingBefore/After, season, `weekStart` for weekly events. Any rating
is replayable from history. Reset/decay rows carry `kFactor: 0` and
scores `0` — they are adjustments, not contested events.

## Layout (the Feature Module Template, blueprint §5)

- `ratings.controller.ts` — thin
- `ratings.service.ts` — transactional duel/trading/season/decay core
- `ratings.repository.ts` — the ONLY file touching Prisma here
- `rating-math.ts` — pure formula, no I/O
- `dto/ratings.dto.ts` — boundary validation
- `*.spec.ts` — unit tests
