# Candle — Phase 11 Weekly Portfolio Battle (T3) + Leagues

**Status:** Built and verified 2026-11-13 (ADR 0013; unit 597/597, e2e
131/131). **Step 9 of the duels build order** (docs/05 §1/§7) — the
final duel in the catalogue except Friend Challenge — and the
**ninth of ten duel types built**.

A Weekly Portfolio Battle is a **week-long, async trading duel in a
league of 30**. Join a season while it is OPEN, trade all week once
it is ACTIVE on the same fictional market as every other player, and
read the settled result after the admin settles it. The winner of a
league is the best **risk-adjusted return**, not the highest return.
Top 3 are promoted one tier, bottom 3 demoted, every Monday. Your
Trading Rating moves against the market index, not your rivals — so a
league winner can gain Rating or not, depending on the index (§7).
Host is Anaya (Portfolio Architect). Tournaments (single-elimination
brackets) are **deferred** to a later phase — §9 says why, and
docs/05 Step 9 therefore reads **PARTIALLY BUILT**.

## 1. What Step 9 is (and is not)

**Is:** a week-long, rated, async trading duel on the Trading Rating.
One season per week (Monday 00:00 IST–Sunday 23:59 IST, doc 04 §5),
same fictional market for every player (the same 6 instruments, same
minute-bucketed prices from the Phase 2 `PriceEngine`), same virtual
₹100,000 starting cash, BUY/SELL/HOLD, leagues of 30 seeded by
Trading Rating, promotion/relegation every Monday, Trading Rating
updated once per week against the index, XP by league outcome, Anaya
host.

**Is not:** a 1v1 duel (there is no `Duel` row and no
`DuelType.WEEKLY` — ADR 0013 §3); a live duel (no WebSocket
namespace, no Redis state, no matchmaking queue — trading is REST
only, ADR 0013 §3); a new question format (trading duels use
actions, not formats, doc 08 §3.7); a prediction game; a second
Rating (the Trading Rating is updated by the existing
`recordTradingWeek` path, §7); a tournament (deferred, §9);
profiles/settings/community code; bank growth (deferred per Nishu's
decision — complete all duels first).

## 2. Technical architecture

### 2.1 What was reused from earlier phases, and what is new

**Reused — unchanged:**

- The Phase 2 simulator: `PriceEngine` (deterministic
  minute-bucketed prices, 6 fictional instruments), virtual
  ₹100,000 starting cash (`SIMULATOR_STARTING_CASH`), `SimInstrument`
  rows.
- The sprint's risk math: `computeRiskMetrics`
  (`trading-sprint/sprint-scoring.ts`) — imported by
  `weekly-scoring.ts`, not duplicated. The sprint score family is the
  league score (§7).
- The sprint's order execution rules: whole units only, funds check
  on BUY, holdings check on SELL, idempotent `clientOrderId` — the
  same checks, applied to REST orders instead of socket orders.
- `RatingsService.recordTradingWeek` (doc 04 §5): the vs-index weekly
  update — min 3 trades, one update per user per week, idempotency
  key `weekly:{seasonId}:{userId}` — reused, not re-implemented.
  `RatingsService.getDuelOutcome` for crash recovery (§8).
- `grantDuelRewards` (reason `duel.weekly_completed` added to the
  reason union; XP values reuse `XP.QUIZ_PASS` 20 /
  `XP.TRADE_EXECUTED` 5).

**New — `apps/api/src/modules/weekly-battle/`:**

- `weekly-portfolio.ts` (pure): `replayWeeklyPortfolio`
  (replay a player's trades into cash/holdings/equity at a given
  minute), `weeklyEquityAt`, `buildWeeklyEquityCurve` (start + one
  sample per trade + final), `weeklyIndexReturnPct` (equal-weighted
  mean return of the 6 instruments).
- `weekly-leagues.ts` (pure): `formLeagues` (sort by Trading Rating
  desc, ties by earlier join then userId; chunk into 30s; leftover
  of 1 merges into the previous league; a lone joiner is carried),
  `nextTierFor` (promotion/relegation), `leagueZoneFor` (the
  small-league rule, §4).
- `weekly-scoring.ts` (pure): `rankLeagueEntries` (score desc, then
  trade count, then joined order, then userId), `weeklyXpOutcome`
  (XP by zone), `weeklyRiskMetrics` (re-export of the sprint math),
  `weeklyRatingReasonFor` (the plain-words Rating line).
- `weekly.repository.ts` — the only Prisma touchpoint.
- `weekly.service.ts` — season lifecycle, joining, trading,
  standings, settlement, history. Config injected via `@Inject(CONFIG)`
  (`AppConfig` type imported from `../../config/configuration`).
- `weekly.controller.ts` — REST under `/weekly` (§3), thin.
- `weekly.module.ts` — imports `RatingsModule`,
  `GamificationModule`, `SimulatorModule`.
- Specs: `weekly-scoring.spec.ts`, `weekly-leagues.spec.ts`,
  `weekly-portfolio.spec.ts`, `weekly.service.spec.ts`.
- `README.md` — module-level reference.

**Shared changes:** `DUELS.WEEKLY_*` tunables + `WEEKLY_HOST`
(Anaya) in `packages/shared/src/constants.ts` (dist rebuilt before
tests); 7 weekly error codes in `packages/shared/src/error-codes.ts`
(all → 409 in `error-status-map.ts`, factories in `app-error.ts`);
`WEEKLY_SEASON_DURATION_MS` (default 604,800,000) in
`apps/api/src/config/configuration.ts` + `.env.example`.

### 2.2 Data model (migration 0013)

`apps/api/prisma/migrations/0013_phase11_weekly_portfolio_battle/migration.sql`
(166 lines, hand-reviewed, via `prisma migrate diff` — schema-before
reconstructed in `/tmp`, live DB untouched). One new enum
`WeeklySeasonStatus` (OPEN/ACTIVE/SETTLED) + five new tables:

| Table                    | Purpose                                                                                                                                                                  | Key indexes                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `WeeklySeason`           | One row per week; `weekStart` (unique Monday date), scheduled vs actual start/end, `indexReturnPct`, status                                                              | unique `weekStart`                                                                 |
| `WeeklyLeague`           | One row per league in a season; `tier`, `leagueNumber`                                                                                                                   | unique (seasonId, leagueNumber)                                                    |
| `WeeklyLeagueMembership` | One row per joiner; `leagueId` nullable (null = carried), `tradingRating` at formation, `tier`, `carried`, `joinedAt`                                                    | unique (seasonId, userId)                                                          |
| `WeeklyTrade`            | One row per order; `side`, `quantity`, `price`, `totalValue`, `clientOrderId`, `executedAt`                                                                              | unique (seasonId, userId, clientOrderId); (seasonId, userId); (seasonId, leagueId) |
| `WeeklyResult`           | One row per settled player; rank, tier, nextTier, risk metrics, equity curve + per-instrument JSON, Rating before/after/delta/result/reason, XP awarded + breakdown JSON | unique (seasonId, userId)                                                          |

Reverse relations on `User` and `SimInstrument`. No `Duel` row, no
`DuelType.WEEKLY` (ADR 0013 §3).

## 3. API

Base `/api/v1/weekly`. All endpoints carry the educational
disclaimer in their OpenAPI descriptions. `POST /weekly/seasons`,
`.../start`, `.../settle` are ADMIN (`@Roles('ADMIN')`); the rest are
any authenticated user, with ownership enforced in the service (you
can only trade in, view the portfolio of, or read the result of your
own membership).

| Method | Route                           | Who   | What                                                                                           |
| ------ | ------------------------------- | ----- | ---------------------------------------------------------------------------------------------- |
| POST   | `/weekly/seasons`               | ADMIN | Create a season for a Monday `weekStart`; auto-enrols carried joiners from the previous season |
| GET    | `/weekly/seasons`               | auth  | List seasons, newest first                                                                     |
| GET    | `/weekly/seasons/:id`           | auth  | One season + league/member counts                                                              |
| POST   | `/weekly/seasons/:id/join`      | auth  | Join while OPEN (409 if already joined / closed)                                               |
| POST   | `/weekly/seasons/:id/start`     | ADMIN | Form leagues from joiners, set the season ACTIVE, return leagues + carried user ids            |
| POST   | `/weekly/seasons/:id/trade`     | auth  | Place a BUY/SELL order (idempotent `clientOrderId`), returns the trade + updated portfolio     |
| GET    | `/weekly/seasons/:id/standings` | auth  | Live standings (ACTIVE) or stored results (SETTLED) — totals/scores only                       |
| GET    | `/weekly/seasons/:id/portfolio` | auth  | My cash, holdings, total equity, current prices                                                |
| POST   | `/weekly/seasons/:id/settle`    | ADMIN | Settle the season (§8); re-calling replays stored results                                      |
| GET    | `/weekly/seasons/:id/result`    | auth  | My settled result for this season                                                              |
| GET    | `/weekly/history`               | auth  | My weekly history, newest first (paginated)                                                    |

Error codes (all 409 unless noted): `WEEKLY_ALREADY_JOINED`,
`WEEKLY_JOIN_CLOSED`, `WEEKLY_NOT_STARTED`, `WEEKLY_NOT_ACTIVE`,
`WEEKLY_NOT_ENDED`, `WEEKLY_ALREADY_SETTLED`,
`WEEKLY_NOT_IN_LEAGUE`. Unknown season → 404; non-admin on an
ADMIN route → 403; bad `weekStart` / bad order → 400.

## 4. Season lifecycle and league formation

**Lifecycle.** A season is identified by its Monday date
(`YYYY-MM-DD`, Asia/Kolkata). `mondayStartMs` computes Monday
00:00 IST as Sunday 18:30 UTC; `isMondayIst` validates with `Intl`
in Asia/Kolkata. A non-Monday `weekStart` is rejected (400); a
duplicate `weekStart` is rejected (409).

```
OPEN ──(ADMIN start)──▶ ACTIVE ──(now ≥ endsAt + ADMIN settle)──▶ SETTLED
```

`ENDED` is derived, never stored: ACTIVE + `now ≥ endsAt`. The
ADMIN start sets `startedAt`/`endsAt` from the wall clock; the
trading window is `[startedAt, startedAt + duration)` where
`duration = WEEKLY_SEASON_DURATION_MS` (default 7 days). The
scheduled window (Monday 00:00 IST + 7 days) is stored as plan
only. In prod the admin (later the cron, §9) starts the season on
Monday 00:00 IST, so scheduled and actual windows coincide.

**Joining.** Only while OPEN. Joining mid-season is NOT allowed:
leagues are seeded by Trading Rating at start, and a mid-season
joiner would face a week's head start (or enter a league whose
standings are already decided) — either way the league stops being
a fair comparison. One membership per user per season.

**Formation (at start).** Joiners are sorted by Trading Rating
descending (ties: earlier join, then userId) and chunked into
groups of 30 (`DUELS.WEEKLY_LEAGUE_SIZE`). Tier = league number
(1 = top). Each membership stores the player's Trading Rating at
formation time, so standings and settlement never re-read a Rating
that may have moved since.

- **Minimum league size 2.** A leftover group of exactly 1 merges
  into the previous league (max 31, `DUELS.WEEKLY_LEAGUE_MAX_SIZE`)
  — a 30-player league plus one extra is a fair league; a 1-player
  league is not a league at all.
- **A tier with exactly 1 joiner total forms no league.** That
  joiner is **CARRIED** (`carried = true`, `leagueId` null) to the
  next season's join pool and is auto-enrolled when the next season
  is created, at their current Trading Rating. Carried players are
  never charged, never rated, and never lose a week — they simply
  play the next one.
- **New joiners next season** enter at the **lowest tier in play**
  (they have no weekly history to place them higher). Returning
  players keep the tier their last season earned
  (`WeeklyResult.nextTier`). Within a tier, seeding is still by
  Trading Rating, so a strong newcomer climbs fast — one good week
  promotes them out of the bottom tier.

**Promotion/relegation (at season end).** Top 3 promoted one tier
(never above tier 1), bottom 3 demoted one tier, middle unchanged
(`nextTierFor`). **Small-league rule:** in a league smaller than 6
the top-3 and bottom-3 zones would overlap (rank 2 would be both
promoted and demoted), so only rank 1 is promoted and only the last
rank is demoted (`leagueZoneFor`, used by both `nextTierFor` and the
XP/ranking zones). This rule was found by a failing test, not by
review — the 4-player e2e league pins it.

**Never-traded players are defined, not undefined.** They score 0,
rank last (the trade-count tie-break puts traded players above
never-traded players on an equal 0), are unrated for the week per
the min-3-trades rule (§7), get 0 XP, and count toward the bottom-3
demotion. They joined, so they occupy a league slot and a demotion
— the alternative (dropping them silently) would let a player dodge
demotion by never trading.

## 5. Trading during the week

`POST /weekly/seasons/:id/trade { instrumentId, side BUY|SELL,
quantity, clientOrderId }` — server-priced via `PriceEngine` at the
current minute, same execution rules as the sprint: whole units
only, funds check on BUY, holdings check on SELL, idempotent
`clientOrderId` (a retried order replays the stored trade, never
double-applies). Max 500 orders per player per season
(`DUELS.WEEKLY_MAX_ORDERS_PER_PLAYER`) — a guard against a runaway
client, not a gameplay limit. No XP per trade. No leverage, no
shorting in v1 (same reasons as ADR 0011 §2).

Orders are **persisted as rows** (`WeeklyTrade`) — real user trades
are the audit trail: settlement, standings, and any dispute are
replayed from them.

**Equity curve (limitation, stated honestly).** There is no
scheduler/tick for a week-long duel in v1, so V (realised
volatility) and D (max drawdown) come from **trade-time +
settlement samples** (start + one sample per trade + final), NOT a
fixed daily grid. A player who trades once has a 2-point curve; a
player who trades fifty times has a 51-point curve. The score is
still comparable (same formula, same market), but a sparse curve
understates intra-week swings — that is a v1 limitation, recorded
here and in ADR 0013 §5, and the fix is a daily equity snapshot
(the future cron in §9, or a nightly job) — not a scoring change.

**Index return.** Equal-weighted mean return of the 6 fictional
instruments from season start to settlement, via `PriceEngine`
(`weeklyIndexReturnPct`). The index is the market, not an opponent.

## 6. Standings — computed on demand, totals only

`GET /weekly/seasons/:id/standings` returns rank, user, returnPct,
risk-adjusted score, trade count, and promotion zone (top 3) /
relegation zone (bottom 3) flags per league. Live standings are
computed on demand from stored trades + current prices — no
background job exists. Settled seasons return the stored results,
never recomputed. **Never expose another player's holdings or
orders** — totals/scores only; the e2e test asserts the response
contains no `holdings` and no `clientOrderId`.

## 7. Scoring and Rating — two separate things

**League ranking** by risk-adjusted return, sprint family, reusing
`computeRiskMetrics` (imported, not duplicated):

- score = R/(1+V+D) for R≥0, R×(1+V+D) for R<0, clamped ±100
  (`DUELS.WEEKLY_SCORE_CLAMP`).
- Winner = highest score in the league. Ties break by trade count
  (more trades first — a traded player outranks a never-traded
  player on an equal 0), then formation order (earlier join first),
  then userId. Deterministic, and pinned in unit tests.

Worked examples (pinned in `weekly-scoring.spec.ts`):

| R              | V   | D    | Score        |
| -------------- | --- | ---- | ------------ |
| +2%            | 1%  | 0.5% | 0.8          |
| +3%            | 4%  | 2%   | 0.4286       |
| −2%            | 1%  | 1%   | −6           |
| 0%             | —   | —    | 0            |
| (any, extreme) | —   | —    | clamped ±100 |

**Trading Rating** via the existing `recordTradingWeek` path
(doc 04 §5): vs the index at 1200, win > index+2% / draw ±2% /
loss < index−2%, min 3 trades, one update per user per week.
**A league winner can therefore gain Rating or not depending on
the index** — winning your league by +1% while the index rose +5%
is a Rating loss, and that is correct: the Rating measures you
against the market, the league measures you against your rivals.
Never-traded players are unrated (the Rating call is skipped
entirely when tradeCount < 3, and the stored reason says so).

**XP by league outcome** (reason `duel.weekly_completed`): top 3 =
WIN 20 XP, middle = DRAW 5 XP, bottom 3 = LOSS 0 XP, never-traded
= 0 XP. The values reuse the existing XP constants
(`XP.QUIZ_PASS` 20 / `XP.TRADE_EXECUTED` 5). The small-league zone
rule (§4) applies here too: in a league under 6, only rank 1 is
WIN and only the last rank is LOSS.

## 8. Settlement — manual ADMIN in v1, one transaction per league

`POST /weekly/seasons/:id/settle` (ADMIN) settles the whole season:
final equity + risk metrics per player, league results +
promotion/relegation, Trading Rating updates via
`recordTradingWeek` (idempotency key
`weekly:{seasonId}:{userId}`), XP grants, season status → SETTLED.
Settlement is refused before the season ends
(`WEEKLY_NOT_ENDED`, 409) and on a season that was never started.

**One transaction per league** (bounded ≤31 players; a failure in
one league never blocks the others), not one transaction for the
season — a season with 100 leagues should not roll back 99 settled
leagues because the 100th hit a transient error. Rating first, then
the league transaction (sprint order, ADR 0011 §6): the Rating call
is the side effect that cannot be rolled back, so it runs first and
its result is stored in the league transaction.

**Crash-safe.** Re-calling settle on a SETTLED season replays the
stored results, never double-applies (status check + unique
`seasonId + userId` result rows). A resume mid-settlement skips
leagues that already have stored results. If the Rating call
throws `RATING_EVENT_DUPLICATE`, the deltas are read back via
`ratings.getDuelOutcome(userId, key, RatingKind.TRADING)`; if it
throws `IDEMPOTENCY_REPLAY`, the stored `TradingWeekResponse` is
taken from `err.details.original`; anything else settles the player
unrated rather than losing the league result.

## 9. The future cron (named, not built)

`weekly-season-scheduler` — a Monday 00:00 IST start + a Sunday
23:59 IST settle, replacing the two manual ADMIN endpoints
(`POST /weekly/seasons/:id/start`, `POST /weekly/seasons/:id/settle`).
No scheduler was invented in v1 because none exists in the codebase
and a half-built cron is worse than an explicit manual step. The
same cron (or a nightly job alongside it) is the natural place for
the daily equity snapshot that fixes the §5 sampling limitation.

## 10. Tournaments — deferred

Single-elimination brackets are NOT built in this phase. Leagues
already deliver the weekly loop — join, trade all week,
promote/demote every Monday, Rating moves against the index. A
bracket is a **second competition format**, not a finishing touch on
leagues: it needs its own seeding (from league position or Rating?),
its own match scheduling (a week of 1v1 trading matches inside a
week-long season?), its own forfeit/disconnect rules, and its own
prize/XP economy. None of that is specified in doc 05 §7 Step 9's
core, and building it now, unspecced, would have meant inventing a
format Nishu never approved. It is a later phase, with its own
design. docs/05 Step 9 therefore reads **PARTIALLY BUILT**.

## 11. Web UI

- `apps/web/app/duels/weekly/page.tsx` — league standings with
  promotion/relegation zones (↑/↓), my portfolio, trade form
  (instrument / BUY-SELL / quantity, `clientOrderId` generated
  client-side), season countdown (display only), Anaya host lines
  before/after only, my settled result, my weekly history (last 5),
  and the educational disclaimer on every trading screen.
- `apps/web/app/duels/page.tsx` — a Weekly Battle card on the duels
  hub (first card; the intro now says three trading duels).
- `apps/web/lib/api.ts` — `WeeklySeasonView`,
  `WeeklyStandingsResponse`, `WeeklyPortfolioView`,
  `WeeklyTradeResponse`, `WeeklyResultResponse`,
  `WeeklySettlementResponse`, `WeeklyHistoryItem`.

## 12. Testing

**Unit: 597/597 pass (47 suites)** — baseline 548/548 (43 suites);
+49 new tests. Pure specs 34/34 (scoring worked examples, league
formation/chunking/promotion-relegation edge cases: 31-merge, lone
carry, small-league zones, never-traded, tie on score); service
spec 15/15 (Monday validation, duplicate weekStart,
join/start/formation, trade validation/replay/funds/holdings,
standings privacy, settle-before-end refusal, full settle cycle,
re-settle replay, duplicate-rating recovery).

**E2E: 131/131 pass (1 suite)** — baseline 128 + 3 new weekly
tests, all green (the known bot-duel XP-ledger flake, ADR 0009
§9.7, did not fire on this run). The weekly e2e exercises a full
cycle in test time — the season duration is shrunk to 15 s via
`WEEKLY_SEASON_DURATION_MS: '15000'` in the e2e `TEST_ENV`:

1. Admin creates season `2026-11-09` (a Monday); non-admin create
   → 403.
2. 4 users join (U4 never trades); duplicate join → 409; trade
   before start → 409.
3. Admin starts; join after start → 409; 1 league formed.
4. U1–U3 trade 3× each (buy 10 NVLT, buy 10 KVRF, sell 5 NVLT);
   duplicate `clientOrderId` replays the same trade id; unknown
   instrument → 400; sell with no holdings → 409; buy 100,000 NVLT
   → 409 (insufficient funds).
5. Standings show 4 entries, rank 1 promotion zone, rank 4
   relegation zone, no `holdings`/`clientOrderId` in the JSON; U1
   portfolio cash < 100,000 with 2 holdings.
6. Settle before end → 409; sleep ~16 s; admin settles → SETTLED,
   playersSettled 4.
7. U1–U3 ratingDelta **+10.4** (1000 → 1010.4, provisional K=40,
   draw vs index), gamesPlayed 1; U4 unrated (nulls), xp 0, rank 4,
   nextTier 2; XP rank1=20 / ranks 2–3=5; re-settle replays
   (gamesPlayed still 1); history lists 1 item; standings after
   settle return stored results.
8. Validation/RBAC test: non-Monday weekStart → 400; duplicate
   weekStart → 409; non-admin settle → 403; settle OPEN season →
   409; join nonexistent season → 404; standings for OPEN season → 409.
9. Lone-joiner test: 1 user joins, start → 0 leagues, carried =
   [user]; create next season → user auto-enrolled (memberCount 1).

**Other gates:** API typecheck clean; lint (`--max-warnings=0`)
clean; format clean; web typecheck + lint clean; `prisma validate`
passes (needs `DATABASE_URL` set).

## 13. Manual QA

1. Create a season for next Monday as ADMIN; join as 2+ users;
   start; confirm one league, tier 1.
2. Trade as each user; confirm the portfolio updates and the
   standings move (return/score/trade count), and that no other
   player's holdings are visible.
3. Wait for the season to end; settle as ADMIN; confirm Rating
   deltas, XP, promotion/relegation (check `nextTier` on each
   result), and that re-settling changes nothing.
4. Create the following week's season; confirm a carried lone
   joiner (if any) is auto-enrolled and a returning player's tier
   matches their last `nextTier`.
5. Check the weekly page on a 360px phone: standings table, trade
   form, and countdown fit without horizontal overflow.

## 14. Limits

- Migration not applied to a live Postgres; Docker not booted on
  the VM; seed never executed against a live DB; single-server is
  the tested config (no Redis state exists for weekly, so there is
  no multi-server weekly state to test — standings and settlement
  are pure Postgres reads/writes).
- Settlement is manual ADMIN in v1 (`weekly-season-scheduler` cron
  named in §9, not built).
- Tournaments deferred (§10).
- Equity curve sampled at trade time + settlement only (§5) — a
  sparse curve understates intra-week swings.
- Only 6 fictional instruments (the Phase 2 set); no new tickers
  were added for the weekly battle.
