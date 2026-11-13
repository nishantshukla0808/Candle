# ADR 0013 — Phase 11 Weekly Portfolio Battle (T3) + Leagues

**Date:** 2026-11-13
**Status:** Accepted (built and verified; see §11)
**Context:** docs/05-duels-system-design.md §1/§7 (build order Step 9 —
"Weekly Portfolio Battle (T3) + Leagues + Tournaments: Season, league
promotion/demotion, weekly tournament bracket"), docs/04-ratings-and-
deployment.md §5/§9 (Trading Rating weekly seasons: Mon 00:00 IST–Sun
23:59 IST, vs index at 1200, win > index+2% / draw ±2% / loss <
index−2%, min 3 trades/week, one update/week), docs/08 §3.7 + §2.2
(trading duels use BUY/SELL/HOLD actions, not question formats; host
is Anaya, Portfolio Architect, speaks before/after only, never gives
trading advice), docs/14 + ADR 0011 (the Phase 9 Paper Trading Sprint
this phase reuses — its risk-adjusted scoring, order execution, and
settlement pattern are the baseline), ADR 0003 (the Phase 2 simulator:
virtual ₹100,000, 6 fictional tickers, deterministic minute-bucketed
price engine). The sprint (T1) and Crisis Duel (T2) are built; no
weekly/league code existed before this phase.

## 1. What was built

A week-long, rated, ASYNC trading duel — the Weekly Portfolio Battle
(T3) — plus leagues with promotion and relegation:

- Backend: `src/modules/weekly-battle/` — `weekly.service.ts`
  (season lifecycle, joining, trading, standings, settlement),
  `weekly.controller.ts` (REST under `/weekly`, §8),
  `weekly.repository.ts` (the only Prisma touchpoint),
  `weekly-portfolio.ts` / `weekly-leagues.ts` / `weekly-scoring.ts`
  (pure helpers, §2/§5/§6), `weekly.module.ts` (imports
  `RatingsModule`, `GamificationModule`, `SimulatorModule`),
  `README.md`.
- Reused, unchanged: the sprint's `computeRiskMetrics`
  (`trading-sprint/sprint-scoring.ts` — the risk math is imported,
  not duplicated), the Phase 2 `PriceEngine` (same 6 fictional
  instruments, same minute-bucketed prices for every player),
  `RatingsService.recordTradingWeek` (the doc 04 §5 vs-index weekly
  update — min 3 trades, one update/week — reused, not re-implemented).
- Prisma: new enum `WeeklySeasonStatus` (OPEN/ACTIVE/SETTLED) + five
  new tables `WeeklySeason`, `WeeklyLeague`, `WeeklyLeagueMembership`,
  `WeeklyTrade`, `WeeklyResult`, migration
  `0013_phase11_weekly_portfolio_battle` (hand-reviewed, via
  `prisma migrate diff`, §9). **No `DuelType.WEEKLY`** — §3.
- Shared: `DUELS.WEEKLY_*` tunables (§2/§4) + `WEEKLY_HOST`
  (Anaya), error codes `WEEKLY_ALREADY_JOINED`,
  `WEEKLY_JOIN_CLOSED`, `WEEKLY_NOT_STARTED`, `WEEKLY_NOT_ACTIVE`,
  `WEEKLY_NOT_ENDED`, `WEEKLY_ALREADY_SETTLED`, `WEEKLY_NOT_IN_LEAGUE`.
- Gamification: `grantDuelRewards` reason union gains
  `duel.weekly_completed` (XP by league outcome — top 3 win 20,
  middle draw 5, bottom 3 loss 0, never-traded 0, §7).
- Config: `WEEKLY_SEASON_DURATION_MS` (default 604,800,000 = 7 days),
  §4 — so the test-time shortening (15 s) exercises a full weekly
  cycle in e2e.
- Web: `apps/web/app/duels/weekly/page.tsx` (league standings with
  promotion/relegation zones, my portfolio, trade form, season
  countdown, Anaya host lines before/after only, educational
  disclaimer on every trading screen) + a Weekly Battle card on the
  duels hub (`apps/web/app/duels/page.tsx`) + Weekly types in
  `apps/web/lib/api.ts`.

## 2. The season — one week, one market, one starting cash

- A season is identified by its Monday date (`YYYY-MM-DD`,
  Asia/Kolkata). `mondayStartMs` computes Monday 00:00 IST as Sunday
  18:30 UTC; `isMondayIst` validates the input with `Intl` in the
  Asia/Kolkata timezone. A non-Monday `weekStart` is rejected (400).
- Lifecycle: `OPEN` (joinable) → `ACTIVE` (leagues formed, trading)
  → `SETTLED`. `ENDED` is derived, never stored: a season is ended
  when it is ACTIVE and `now ≥ endsAt`. A season is created by ADMIN
  (`POST /weekly/seasons`); the ADMIN start (`POST .../start`) sets
  `startedAt`/`endsAt` from the wall clock. The _scheduled_ window
  (Monday 00:00 IST + 7 days) is stored on the row as plan only —
  the trading window is `[startedAt, startedAt + duration)`, where
  `duration = WEEKLY_SEASON_DURATION_MS` (default 7 days). In prod
  the admin (later a cron, §10) starts the season on Monday 00:00 IST,
  so the scheduled and actual windows coincide.
- Same fictional market for every player: the Phase 2 `PriceEngine`,
  same 6 instruments, same minute prices. Same starting virtual cash
  ₹100,000 (`SIMULATOR_STARTING_CASH`). No leverage, no shorting in
  v1 — same reasons as ADR 0011 §2 (a teaching product must not let a
  beginner blow up on borrowed money or owe on a position they do not
  own; the simulator has no margin model).

## 3. No Duel row, no DuelType.WEEKLY, no WebSocket namespace

A weekly battle is a **season of leagues, not a 1v1 duel**. There is
no opponent pair, no match, no live timer, and no per-duel result to
store on a `Duel` row — so no `DuelType.WEEKLY` was added and no Duel
row is created. The season/league/membership/trade/result tables are
the model (§9). Trading is REST only: a week-long async duel has no
live state to push, so no Socket.IO namespace was built and no Redis
state is kept (no matchmaking queue, no sticky sessions, no
disconnect grace — none of those concepts apply to a week of REST
orders). This is a deliberate scope decision, not an omission: the
live engine stays for live duels, and the weekly battle stays a
season of REST orders.

## 4. Leagues — formation, tiers, the leftover, the lone joiner

- **Formation:** at season start, joiners are sorted by Trading
  Rating descending (ties: earlier join, then userId) and chunked
  into groups of 30 (`DUELS.WEEKLY_LEAGUE_SIZE`). Tier = league
  number (1 = top). Memberships carry the player's Trading Rating
  at formation time (the seed), so standings and settlement never
  re-read a Rating that may have moved since.
- **Minimum league size 2.** A leftover group of exactly 1 merges
  into the previous league (max 31, `DUELS.WEEKLY_LEAGUE_MAX_SIZE`) —
  a 30-player league plus one extra is a fair league; a 1-player
  league is not a league at all. A tier with exactly 1 joiner total
  forms no league: that joiner is **CARRIED** to the next season's
  join pool (`WeeklyLeagueMembership.carried = true`, leagueId null)
  and is auto-enrolled when the next season is created, at their
  current Trading Rating. Carried players are never charged, never
  rated, and never lose a week — they simply play the next one.
- **Joining:** only while OPEN. Joining mid-season is NOT allowed.
  Leagues are seeded by Trading Rating at start; a mid-season joiner
  would face a week's head start (or enter a league whose standings
  are already decided) — either way the league is no longer a fair
  comparison. Joining is one membership per user per season
  (unique `seasonId + userId`); a second join is 409.
- **New joiners next season** enter at the **lowest tier in play**
  (they have no weekly history to place them higher), while
  returning players keep the tier their last season earned
  (`WeeklyResult.nextTier`). Within a tier, seeding is still by
  Trading Rating, so a strong newcomer climbs fast — one good week
  promotes them out of the bottom tier.
- **Promotion/relegation:** at season end, top 3 promoted one tier
  (never above tier 1), bottom 3 demoted one tier, middle unchanged
  (`nextTierFor`). **Small-league rule:** in a league smaller than 6
  the top-3 and bottom-3 zones would overlap (rank 2 would be both
  promoted and demoted), so only rank 1 is promoted and only the last
  rank is demoted (`leagueZoneFor` in `weekly-leagues.ts`, used by
  both `nextTierFor` and the XP/ranking zones). This rule was found by
  a failing test, not by review — the 4-player e2e league pins it.
- **Never-traded players are defined, not undefined:** they score 0,
  rank last (the trade-count tie-break puts traded players above
  never-traded players on an equal 0), are unrated for the week per
  the min-3-trades rule (§7), get 0 XP, and count toward the bottom-3
  demotion. They joined, so they occupy a league slot and a
  demotion — the alternative (dropping them silently) would let a
  player dodge demotion by never trading.

## 5. Trading during the week — REST orders, persisted

- `POST /weekly/seasons/:id/trade { instrumentId, side BUY|SELL,
quantity, clientOrderId }` — server-priced via `PriceEngine` at the
  current minute, same execution rules as the sprint: whole units
  only, funds check on BUY, holdings check on SELL, idempotent
  `clientOrderId` (a retried order replays the stored trade, never
  double-applies; unique `seasonId + userId + clientOrderId`). Max
  500 orders per player per season
  (`DUELS.WEEKLY_MAX_ORDERS_PER_PLAYER`) — a guard against a runaway
  client, not a gameplay limit. No XP per trade.
- Orders are **persisted as rows** (`WeeklyTrade`) — unlike the
  sprint bot, these are real user trades and they are the audit trail:
  settlement, standings, and any dispute are replayed from them.
- **Equity curve (limitation, stated honestly):** there is no
  scheduler/tick for a week-long duel in v1, so V (realised
  volatility) and D (max drawdown) come from **trade-time +
  settlement samples** (start + one sample per trade + final), NOT a
  fixed daily grid. A player who trades once has a 2-point curve; a
  player who trades fifty times has a 51-point curve. The score is
  still comparable (same formula, same market), but a sparse curve
  understates intra-week swings — that is a v1 limitation, recorded
  here and in docs/16 §5, and the fix is a daily equity snapshot
  (the future cron in §10, or a nightly job) — not a scoring change.
- **Index return:** equal-weighted mean return of the 6 fictional
  instruments from season start to settlement, via `PriceEngine`
  (`weeklyIndexReturnPct`). The index is the market, not an opponent.

## 6. Scoring — two separate things

League ranking and Trading Rating are **two separate things**, and
the split is stated here so nobody is surprised:

- **(a) League ranking** by risk-adjusted return, sprint family,
  reusing `computeRiskMetrics` from
  `trading-sprint/sprint-scoring.ts` (imported, not duplicated):
  score = R/(1+V+D) for R≥0, R×(1+V+D) for R<0, clamped ±100
  (`DUELS.WEEKLY_SCORE_CLAMP`). Winner = highest score in the league.
  Worked examples (pinned in unit tests): R=+2/V=1/D=0.5 → 0.8;
  R=+3/V=4/D=2 → 0.4286; R=−2/V=1/D=1 → −6; R=0 → 0; clamp ±100.
  Ties on score break by earlier join (the formation order), then
  userId — deterministic, and pinned in tests.
- **(b) Trading Rating** via the existing `recordTradingWeek` path
  (doc 04 §5): vs the index at 1200, win > index+2% / draw ±2% /
  loss < index−2%, min 3 trades, one update per user per week. **A
  league winner can therefore gain Rating or not depending on the
  index** — winning your league by +1% while the index rose +5% is
  a Rating loss, and that is correct: the Rating measures you
  against the market, the league measures you against your rivals.
  Never-traded players are unrated (the Rating call is skipped
  entirely when tradeCount < 3, and the stored reason says so).

## 7. XP by league outcome

XP is granted by league outcome, not by Rating: top 3 = WIN 20 XP,
middle = DRAW 5 XP, bottom 3 = LOSS 0 XP, never-traded = 0 XP
(reason `duel.weekly_completed`, added to the `grantDuelRewards`
reason union). The values reuse the existing XP constants
(`XP.QUIZ_PASS` 20 / `XP.TRADE_EXECUTED` 5) — no new XP economy was
invented for the weekly battle. The small-league zone rule (§4)
applies here too: in a league under 6, only rank 1 is WIN and only
the last rank is LOSS. A never-traded player is LOSS-equivalent in
XP (0) but is recorded with result `LOSS` only in the sense that
they sit in the bottom zone — the stored `WeeklyResult.result`
reflects the zone, and the XP is 0 either way.

## 8. Settlement — manual ADMIN in v1, one transaction per league

- `POST /weekly/seasons/:id/settle` (ADMIN) settles the whole
  season: final equity + risk metrics per player, league results +
  promotion/relegation, Trading Rating updates via
  `recordTradingWeek` (idempotency key
  `weekly:{seasonId}:{userId}`), XP grants, season status →
  SETTLED. Settlement is refused before the season ends
  (`WEEKLY_NOT_ENDED`, 409) and on a season that was never started.
- **One transaction per league** (bounded ≤31 players; a failure in
  one league never blocks the others), not one transaction for the
  season — a season with 100 leagues should not roll back 99
  settled leagues because the 100th hit a transient error. Rating
  first, then the league transaction (sprint order, ADR 0011 §6):
  the Rating call is the side effect that cannot be rolled back, so
  it runs first and its result is stored in the league transaction.
- **Crash-safe:** re-calling settle on a SETTLED season replays the
  stored results, never double-applies (status check + unique
  `seasonId + userId` result rows). A resume mid-settlement skips
  leagues that already have stored results. If the Rating call
  throws `RATING_EVENT_DUPLICATE`, the deltas are read back via
  `ratings.getDuelOutcome(userId, key, RatingKind.TRADING)`; if it
  throws `IDEMPOTENCY_REPLAY`, the stored `TradingWeekResponse` is
  taken from `err.details.original`; anything else settles the player
  unrated rather than losing the league result.
- **The doc names the future cron:** `weekly-season-scheduler`
  (docs/16 §9) — a Monday 00:00 IST start + a Sunday 23:59 IST
  settle, replacing the two manual ADMIN endpoints. No scheduler
  was invented in v1 because none exists in the codebase and a
  half-built cron is worse than an explicit manual step.

## 9. Schema — migration 0013 (hand-reviewed)

`apps/api/prisma/migrations/0013_phase11_weekly_portfolio_battle/migration.sql`
(166 lines): 1 new enum + 5 new tables + indexes. Generated via
`prisma migrate diff --from-schema-datamodel /tmp/schema-before.prisma
--to-schema-datamodel prisma/schema.prisma --script` (note:
`--from-schema` is NOT a valid flag in Prisma 6.19.3 — use
`--from-schema-datamodel`). Schema-before was reconstructed in
`/tmp` (the repo has no pre-migration schema snapshot); the live DB
was not touched. `prisma validate` passes (needs `DATABASE_URL` set).

- `WeeklySeason` — `weekStart` (unique, the Monday date),
  `scheduledStartsAt`/`scheduledEndsAt` (plan), `startedAt`/`endsAt`
  (actual), `indexReturnPct`, status OPEN/ACTIVE/SETTLED.
- `WeeklyLeague` — `seasonId`, `tier`, `leagueNumber` (unique per
  season).
- `WeeklyLeagueMembership` — `seasonId`, `userId` (unique pair),
  `leagueId` nullable (null = carried), `tradingRating` at
  formation, `tier`, `carried`, `joinedAt`.
- `WeeklyTrade` — `seasonId`, `leagueId`, `userId`, `instrumentId`,
  `side`, `quantity`, `price`, `totalValue`, `clientOrderId`
  (unique per season+user), `executedAt`. Indexes on
  (seasonId, userId) and (seasonId, leagueId) for standings and
  settlement.
- `WeeklyResult` — `seasonId`, `leagueId`, `userId` (unique pair),
  `rank`, `leagueSize`, `tier`, `nextTier`, `result`,
  `finalEquity`, `returnPct`, `realisedVolPct`, `maxDrawdownPct`,
  `riskAdjustedScore`, `tradeCount`, `equityCurve` (JSON),
  `perInstrument` (JSON), `ratingBefore`/`ratingAfter`/`ratingDelta`/
  `ratingResult`/`ratingReason`, `xpAwarded`, `xpBreakdown` (JSON),
  `settledAt`.
- Reverse relations on `User` and `SimInstrument`. No `Duel` row,
  no `DuelType.WEEKLY` (§3).

## 10. Tournaments — deferred (why)

Single-elimination brackets are **NOT built** in this phase, and
docs/05 Step 9 therefore reads **PARTIALLY BUILT** (leagues built,
tournaments deferred). Leagues already deliver the weekly loop —
join, trade all week, promote/demote every Monday, Rating moves
against the index. A bracket is a **second competition format**,
not a finishing touch on leagues: it needs its own seeding (from
league position or Rating?), its own match scheduling (a week of
1v1 trading matches inside a week-long season?), its own
forfeit/disconnect rules, and its own prize/XP economy. None of
that is specified in doc 05 §7 Step 9's core ("Season, league
promotion/demotion, weekly tournament bracket" — the bracket is
listed after the league, as an addition, not as the loop itself).
Building it now, unspecced, would have meant inventing a format
Nishu never approved. It is a later phase, with its own design.

## 11. Verification

- **Unit: 597/597 pass (47 suites)** — baseline 548/548 (43
  suites); +49 new tests. Pure specs 34/34 (scoring worked examples,
  league formation/chunking/promotion-relegation edge cases: 31-merge,
  lone carry, small-league zones, never-traded, tie on score);
  service spec 15/15 (Monday validation, duplicate weekStart,
  join/start/formation, trade validation/replay/funds/holdings,
  standings privacy, settle-before-end refusal, full settle cycle,
  re-settle replay, duplicate-rating recovery).
- **E2E: 131/131 pass (1 suite).** Baseline 128 + 3 new weekly
  tests, all green — including the known bot-duel XP-ledger flake
  (ADR 0009 §9.7), which did not fire on this run. The weekly e2e
  exercises a full cycle in test time (15 s season): create → join
  (4 users, one never trades) → start → trade (3× each + idempotent
  replay) → standings (promotion/relegation zones, no
  holdings/clientOrderId leaked) → settle before end refused → sleep
  → settle → Rating deltas +10.4 for the three traders (1000 →
  1010.4, provisional K=40, draw vs index), never-traded unrated/0
  XP/rank 4/nextTier 2, XP 20/5/5/0, re-settle replays (gamesPlayed
  stays 1), history lists 1 item, standings after settle return
  stored results; plus validation/RBAC tests and the lone-joiner
  carry test.
- **API typecheck, lint (`--max-warnings=0`), format clean.**
  **Web typecheck + lint clean.** **`prisma validate` passes.**
- **Limits (unchanged from earlier phases, plus this phase's):**
  migration not applied to a live Postgres; Docker not booted on
  the VM; seed never executed against a live DB; single-server is
  the tested config; settlement is manual ADMIN in v1 (the
  `weekly-season-scheduler` cron is named in §8/docs/16 §9, not
  built); tournaments deferred (§10); equity curve sampled at
  trade time + settlement only (§5); only the tested config is
  single-server (no Redis state exists for weekly, so there is no
  multi-server weekly state to test — standings and settlement are
  pure Postgres reads/writes).

## 12. Decisions log (for the record)

| #   | Decision                                                                | Why                                                                       |
| --- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 1   | No `DuelType.WEEKLY`, no Duel row                                       | A season of leagues is not a 1v1 duel (§3)                                |
| 2   | REST only, no socket/Redis                                              | Week-long async duel has no live state to push (§3)                       |
| 3   | Join only while OPEN                                                    | Mid-season joiner faces a week's head start (§4)                          |
| 4   | Leftover of 1 merges into previous league (max 31)                      | A 30+1 league is fair; a 1-player league is not (§4)                      |
| 5   | Lone joiner carried to next season                                      | Never lose a player for being the only joiner (§4)                        |
| 6   | New joiners enter at the lowest tier in play                            | No weekly history to place them higher (§4)                               |
| 7   | Small-league rule (<6: only rank 1 promoted, only last demoted)         | Top-3/bottom-3 zones overlap otherwise (§4)                               |
| 8   | Never-traded: score 0, rank last, unrated, 0 XP, counts toward demotion | Defined, not undefined (§4)                                               |
| 9   | Orders persisted as rows                                                | Real user trades are the audit trail (§5)                                 |
| 10  | Equity sampled at trade time + settlement                               | No scheduler/tick exists in v1 (§5)                                       |
| 11  | League ranking and Trading Rating are separate                          | Winner can gain Rating or not, depending on the index (§6)                |
| 12  | XP top 3 = 20 / middle = 5 / bottom 3 = 0 / never-traded = 0            | Clean league-outcome rule, reuses existing XP values (§7)                 |
| 13  | One transaction per league                                              | A failure in one league never blocks the others (§8)                      |
| 14  | Manual ADMIN settle in v1; future cron named `weekly-season-scheduler`  | No scheduler exists; an explicit manual step beats a half-built cron (§8) |
| 15  | Tournaments deferred                                                    | Second competition format, needs its own design (§10)                     |
