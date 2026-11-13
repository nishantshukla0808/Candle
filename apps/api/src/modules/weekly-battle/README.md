# Weekly Portfolio Battle (T3) + Leagues

**Docs:** `docs/16-phase-11-weekly-portfolio-battle.md`, ADR 0013
(`docs/adr/0013-phase-11-weekly-portfolio-battle.md`).
**Design:** docs/05 §1/§7 Step 9, docs/04 §5 (Trading Rating weekly
seasons), docs/08 §3.7 (trading duels use actions, not question
formats) + §2.2 (host Anaya).

## What it is

A week-long ASYNC trading duel (T3, rated, Trading Rating) + leagues.
One season = one calendar week (Mon 00:00 IST – Sun 23:59 IST, doc 04
§5), identified by its Monday date (YYYY-MM-DD, Asia/Kolkata). Every
player trades the same fictional market (Phase 2 `PriceEngine`, same 6
instruments, same minute prices) from the same virtual ₹100,000. No
leverage, no shorting in v1 (same reasons as ADR 0011 §2).

Leagues of 30, seeded by Trading Rating at season start. Top 3 are
promoted one tier, bottom 3 demoted one tier, every season. Tier is
the league number (1 = top). New joiners enter at the lowest tier.

## What it is not

- A live duel: there is **no WebSocket namespace**, no Redis state, no
  matchmaking queue. Trading is REST; standings are computed on
  demand; settlement is a manual ADMIN endpoint in v1 (no scheduler
  exists — docs/16 §9 names the future cron).
- A 1v1 Duel row: there is **no `DuelType.WEEKLY`** and no `Duel` row.
  The season/league/membership/trade/result tables are the whole
  store (ADR 0013 §2).
- Friend Challenge, tournaments (single-elimination brackets are
  deferred — ADR 0013 §10), profiles/settings/community, bank growth.
  A trading duel needs no question bank.

## Endpoints (`/api/v1/weekly`)

| Method | Path                     | Auth  | Behaviour                                                                                                 |
| ------ | ------------------------ | ----- | --------------------------------------------------------------------------------------------------------- |
| POST   | `/seasons`               | ADMIN | Create a season for a Monday (OPEN). Carried joiners from the previous season are enrolled automatically. |
| GET    | `/seasons`               | user  | List seasons, newest first.                                                                               |
| GET    | `/seasons/:id`           | user  | One season (status, window, counts, host).                                                                |
| POST   | `/seasons/:id/join`      | user  | Join while OPEN. No mid-season joining.                                                                   |
| POST   | `/seasons/:id/start`     | ADMIN | Close joining, form leagues, open the trading window (`WEEKLY_SEASON_DURATION_MS`).                       |
| POST   | `/seasons/:id/settle`    | ADMIN | Settle after the season ends. Re-settling replays stored results.                                         |
| POST   | `/seasons/:id/trade`     | user  | One order (server-priced, idempotent `clientOrderId`).                                                    |
| GET    | `/seasons/:id/standings` | user  | Live standings (totals/scores only). Settled seasons return stored results.                               |
| GET    | `/seasons/:id/portfolio` | user  | My portfolio (cash, holdings, prices, equity).                                                            |
| GET    | `/seasons/:id/result`    | user  | My stored result for a settled season.                                                                    |
| GET    | `/history`               | user  | My weekly history, newest first.                                                                          |

## Season lifecycle

```
OPEN (joinable) → ACTIVE (leagues formed, trading) → SETTLED
```

ENDED is derived, not stored: ACTIVE + now ≥ endsAt stops trading
and opens settlement. The trading window is
`[startedAt, startedAt + WEEKLY_SEASON_DURATION_MS)` — one week in
production (default 604,800,000 ms), 15 s in tests
(`WEEKLY_SEASON_DURATION_MS=15000` in the e2e TEST_ENV).

## League formation (weekly-leagues.ts, pure)

Joiners sort by Trading Rating desc (ties: earlier join, then
userId), chunked into 30s. A leftover group of exactly 1 merges into
the previous league (max 31); a tier with exactly 1 joiner total has
no league — that joiner is CARRIED to the next season's join pool.
Minimum league size is 2. Returning players keep the tier their last
season earned them; new joiners enter at the lowest tier in play.

Promotion/relegation (`nextTierFor` / `leagueZoneFor`): top 3
promoted one tier (never above tier 1), bottom 3 demoted one tier,
middle unchanged. In leagues smaller than 6 the zones would overlap,
so only rank 1 is promoted and only the last rank is demoted.

## Scoring — two separate things (weekly-scoring.ts, pure)

(a) **League ranking** by risk-adjusted return — the sprint formula
(`computeRiskMetrics`, REUSED from `trading-sprint/sprint-scoring`,
not duplicated): score = R/(1+V+D) for R ≥ 0, R×(1+V+D) for R < 0,
clamped ±100, from the equity curve (start + one sample per trade +
settlement). Winner = highest score in the league. Players who never
traded score 0 and rank last.

(b) **Trading Rating** per doc 04 §5 via the existing
`recordTradingWeek` path (vs the index at 1200, win > index+2% /
draw ±2% / loss < index−2%, min 3 trades, one update per user per
week). A league winner can therefore GAIN Rating or not depending on
the index — both numbers are shown on the result.

XP by league outcome: top 3 = win (20), middle = draw (5), bottom 3
= loss (0), never-traded = 0. Reason: `duel.weekly_completed`.

## Equity curve (weekly-portfolio.ts, pure)

No scheduler or tick exists for a week-long duel in v1, so V/D come
from trade-time + settlement samples, not a fixed daily grid (ADR
0013 §9). The portfolio is replayed from the stored `WeeklyTrade`
rows whenever it is needed (standings, settlement, "my portfolio");
the index return is the equal-weighted mean return of the 6
instruments from season start to settlement.

## Settlement (docs/16 §9)

Rating first, then one transaction per league: result rows + XP
grants. Idempotency key `weekly:{seasonId}:{userId}`. A crash
between the Rating step and the league transaction is recovered on
the next call: the Rating call throws `RATING_EVENT_DUPLICATE` /
`IDEMPOTENCY_REPLAY` and the stored deltas are read back
(`getDuelOutcome` / the stored response) instead of applied twice.
A league whose results already exist is skipped on re-settle.

## Invariants (tested)

- Joining is OPEN-only; trading is ACTIVE-only and before `endsAt`.
- One order per (season, user, `clientOrderId`) — retried orders replay.
- Standings never expose holdings or orders — totals/scores only.
- Never-traded players rank last, are unrated for the week, get 0
  XP, and count toward the bottom-3 demotion.
- Re-settling a SETTLED season changes nothing (no second Rating
  call, no second XP grant).
- No `DuelType.WEEKLY`: a weekly battle is a season of leagues.
