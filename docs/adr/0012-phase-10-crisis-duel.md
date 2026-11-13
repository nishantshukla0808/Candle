# ADR 0012 — Phase 10 Crisis Duel (T2)

**Date:** 2026-11-12
**Status:** Accepted (built and verified; see §11)
**Context:** docs/05-duels-system-design.md §1/§7 (build order Step 8 —
"Simulated crash mid-duel. Smallest loss + calmest decisions wins."),
docs/04-ratings-and-deployment.md (Ratings, not ELO; Trading Rating),
docs/08 (trading duels use actions, not question formats — §3.7; Tara
§2.2), docs/14 + ADR 0011 (the Phase 9 Paper Trading Sprint this phase
is a variant of — its engine, scoring, matchmaking, settlement, and
bot are the baseline), ADR 0003 (the Phase 2 simulator: virtual
₹100,000, 6 fictional tickers, deterministic minute-bucketed price
engine). The sprint (T1), Speed Quiz Duel, Myth vs Fact Blitz, Case
Duel, and Chart Detective are built; no crisis duel existed before
this phase.

## 1. What was built

A live, rated, head-to-head Crisis Duel (T2) — a Paper Trading Sprint
**with a seeded crash mid-duel**, built as a **variant of the sprint
engine, not a second engine**:

- Backend: `src/modules/crisis-duel/` — `crisis-matchmaking.service.ts`
  (own Redis queue `crisis:*`, Trading Rating), `crisis.gateway.ts`
  (Socket.IO namespace `/crisis`, transport only),
  `crisis.controller.ts` (REST: active / queue status / state / forfeit /
  result / history), `crisis.module.ts` (imports `TradingSprintModule`).
  The engine, repository, result service, and settlement code are
  **shared with the sprint** (`src/modules/trading-sprint/`), parameterised
  by the variant on the Redis state (`variant: 'SPRINT' | 'CRISIS'`).
- Shared with the sprint, extended for crisis: `sprint-engine.service.ts`
  (variant-aware emitters, pricing, crash check, settlement, rematch),
  `sprint-state.ts` (variant + `crashMinute`/`crashFired`/`crashFiredAtMs`
  on the state, `crisis:*` keys), `sprint.repository.ts` (type-aware
  lookups, crash fields on result rows), `sprint.service.ts` (the `crisis`
  block on stored-result views + plain-words crash line, type-filtered
  history).
- New pure modules: `crisis-crash.ts` (seeded crash minute, crash price
  path, panic-sell detection), `crisis-scoring.ts` (the crisis score —
  §5), `crisis-bot.ts` (Mira's crash behaviour — §7).
- Prisma: `DuelType.CRISIS`, four nullable columns on
  `SprintDuelResult` (`crashMinute`, `crashDrawdownPct`,
  `tradesDuringCrash`, `panicSold`), migration
  `0012_phase10_crisis_duel` (hand-reviewed, via `prisma migrate diff`,
  §9). No new tables: a crisis duel reuses `Duel` + `SprintTrade` +
  `SprintDuelResult`.
- Shared: `DUELS.CRISIS_*` tunables (§2/§4) + `CRISIS_HOST_NAME`
  ('Tara'), error codes `CRISIS_ALREADY_QUEUED`, `CRISIS_NOT_IN_QUEUE`,
  `CRISIS_NOT_ACTIVE`, `CRISIS_ALREADY_ACTIVE`.
- Ratings: unchanged — `RatingsService.recordTradingDuel` /
  `recordTradingDuelVsBot` (kind TRADING, same ELO formula/K/caps as the
  sprint, §8). Gamification: `grantDuelRewards` reason union gains
  `duel.crisis_completed` (XP win 20 / draw 5 / loss 0 — no XP per
  trade, §8).
- Config: no new env vars. The sprint's `SPRINT_DURATION_MS` (default
  900,000) and `SPRINT_TICK_MS` (default 30,000) drive the crisis duel
  too, and the crash is proportional to the duration (§4) — so the
  test-time shortening (20 s) exercises a full crisis duel.
- Web: `apps/web/app/duels/crisis/page.tsx` (the sprint page's patterns
  - the CRASH banner + the crash panel on the result) + a Crisis Duel
    card on the duels hub (`apps/web/app/duels/page.tsx`) + crisis fields
    on the shared sprint types in `apps/web/lib/api.ts` (the `crisis`
    block on results, `crashFired` on ticks and active summaries).
- Tests: unit + e2e (see §11). Docs: `docs/15-phase-10-crisis-duel.md`
  (architecture, what was reused vs new, crash design with worked
  examples, scoring with worked examples, bot crash behaviour,
  matchmaking separation, timers/disconnect/forfeit, Trading Rating
  integration, testing, manual QA checklist), this ADR, module README,
  docs/05 + docs/08 status updates.

No Weekly Portfolio Battle (T3), league/tournament, Friend Challenge,
bank growth, new question format, or profiles/settings/community code.
Those are later steps — and bank growth is explicitly deferred per
Nishu's decision (complete all duels first, then grow the bank per
duel). A trading duel needs no question bank: the "bank" for a crisis
duel is the market.

## 2. The duel

**Crisis Duel (T2, live, rated, Trading Rating).** 15 minutes, both
players start with the same virtual ₹100,000 on the same fictional
market — the same 6 instruments (NVLT, KVRF, ASTL, MRUM, SGNR, HELX),
the same minute-bucketed prices from the Phase 2 `PriceEngine`, the
same starting cash — and **a crash hits mid-duel** (§4). Actions are
BUY / SELL / HOLD (whole units only, 1–100,000 per order, max 120
orders per player per duel). The winner is the best **crisis
risk-adjusted return** (§5): smallest loss + calmest decisions. Host
is **Tara (Risk Guardian)**: she speaks before the duel ("15 minutes,
same market, same ₹1,00,000 — and somewhere in the middle, the market
crashes. Nobody knows when. Smallest loss + calmest decisions wins.
Good luck.") and after it, never during the duel, and never gives
trading advice (doc 08 §2.2). In a bot crisis duel Mira plays the
opponent (§7).

No leverage, no shorting in v1 — same reason as the sprint (ADR 0011
§2): both would let a player multiply return and volatility together
and game the risk divisor, and shorting needs borrow mechanics the
duel does not have. If either is ever added, it needs its own ADR.

## 3. Engine reuse — a variant, not a second engine

The crisis duel is a variant of the 1,305-line sprint engine. The
variant lives on the Redis state (`variant: 'SPRINT' | 'CRISIS'`) and
picks five things; everything else is shared and identical:

| What differs                              | Sprint                          | Crisis                                 |
| ----------------------------------------- | ------------------------------- | -------------------------------------- |
| Redis keyspace / socket prefix / DuelType | `sprint:*`, `sprint:`, `SPRINT` | `crisis:*`, `crisis:`, `CRISIS`        |
| Price path                                | base `PriceEngine` price        | base price × crash factor (§4)         |
| Scoring                                   | sprint score (§5, base)         | crisis score (§5, loss branch divides) |
| Bot step                                  | sprint rules                    | crash rules (§7)                       |
| Host lines / result wording               | sprint lines                    | crisis lines (§2)                      |

Shared, identical: the 15-minute timer, 30-second ticks, order
execution (orders execute at the server-priced value — during the
crash, at crashed prices), live portfolio values, the 15-second
disconnect grace then forfeit, settlement in one transaction (§8),
the rematch offer with the 5-minute cooldown, matchmaking windows
(±50 → ±400 on the Trading Rating), and the bot offer after 30
seconds.

The engine keeps one emitter per variant (`Map<TradingDuelVariant,
SprintEmitter>`); the sprint gateway binds `'SPRINT'`, the crisis
gateway binds `'CRISIS'`. A crisis event can never reach a sprint
socket, and vice versa — the variant is part of the emit path, not
just the event name.

Why a variant and not a copy: the crash is a price-path and scoring
change on top of an already-correct trading engine. Copying the
engine would have duplicated the timer, order execution, disconnect,
settlement, and rematch logic — five places a future fix would have
to land twice. The variant costs one branch per differing behaviour,
each in the function that owns that behaviour (`priceOf`,
`botStep`, `settleDuel`, the tick's crash check), and the sprint's
behaviour is unchanged: every pre-existing sprint test passes
unmodified except one rematch test whose fake needed the new
type-aware repository methods (§11).

## 4. Crash design

**Seeded crash minute, never fixed, never disclosed in advance.**
`crashMinute = 7 + (FNV-1a(seed) % 4)` — minute 7–10 of 15 — where
`seed` is the duel's market seed (the same seed both players share,
stored on the `Duel` row). A fixed minute would be gameable: players
would learn to sell at minute 7 and buy back at minute 10. A seeded
minute in a 4-minute band cannot be gamed — the player knows a crash
is coming (Tara says so before the duel) but never knows when. The
crash minute is stored in the Redis state and on the stored result
row; it is never sent to a client before settlement. The crash event
payload carries the minute only after it has fired.

**Crash shape (deterministic, identical for both players).** A
multiplier on the Phase 2 price engine, applied to all 6 instruments
together — a market crash, not a single-stock event:

| Minutes relative to crash minute      | Factor                             |
| ------------------------------------- | ---------------------------------- |
| before the crash                      | 1.00                               |
| crash minute, +1, +2 (3 fall minutes) | 0.96 / 0.92 / 0.88 (−12% total)    |
| +3 … +7 (5 recovery minutes)          | 0.89 … 0.93 (+5% partial recovery) |
| after +7                              | 0.93 flat (net −7%)                |

The recovery is load-bearing for the scoring (§5): without it, a
panic seller and a calm holder would both end at the bottom and the
duel could not separate them. With it, the holder recovers part of
the fall and the seller — who sold at the bottom — does not. The
recovery is partial (+5% of a −12% fall), so the duel still ends in
the red for anyone who held: the lesson is "smallest loss", not "the
crash was free".

**Visibility.** One `crisis:crash` socket event when it hits
(`duelId`, `crashMinute`, `crashFiredAtMs`, `dropPct: 12`,
`dropMinutes: 3`, `recoveryPct: 5`, `serverNowMs`) + a CRASH banner
in the UI + a `crashFired` flag on the state, the active summary, and
every tick after the crash. The banner says the market is falling
~12% over 3 minutes, then recovering ~5% — the shape is public once
it has happened; only the timing was secret.

**Test-time rule (mandatory, implemented).** A "crisis minute" is
`durationMs / 15`, not a wall-clock minute. In production that is
60,000 ms (a real minute); in e2e (`SPRINT_DURATION_MS=20000`) it is
~1,333 ms, so the crash fires at ~50% of the shortened duel, falls
over the next ~20%, and recovers after — a full crisis duel runs in
test time. The crash check runs on **every tick**, not only on minute
advance: with a 5-second tick in tests, a minute-advance check would
miss the crash window entirely. The crash window in ms is
`crashStartMs = startedAtMs + crashMinute × (duration/15)`,
`crashEndMs = startedAtMs + (crashMinute+3) × (duration/15)`.

**What is stored where.** The crash minute, the crash-fired flag,
and the fired-at time live in the Redis state (they drive the live
duel) and, after settlement, on the `SprintDuelResult` row
(`crashMinute`, `crashDrawdownPct`, `tradesDuringCrash`, `panicSold`)
— the result screen needs them after settlement, so they are Prisma
fields, not just result JSON. The seed and the drop/recovery params
are not stored per duel: the seed is already on the `Duel` row and
the params are constants (`CRISIS_CRASH_*` in `packages/shared`).

## 5. Scoring — the crisis score (one explicit adjustment)

The base is the sprint score (§4 of ADR 0011): with return R
(fraction), realised volatility V (%), and max drawdown D (%),

- `score = R / (1 + V + D)` for R ≥ 0,
- `score = R × (1 + V + D)` for R < 0,

clamped to ±100. The loss branch multiplies because a loss made
with high volatility and a deep drawdown is worse than the same loss
made calmly — the multiplier punishes risky losses.

**The base formula alone does not cleanly separate property (b).**
Worked examples (16-point minute-sampled curves, start ₹100,000,
pre-crash drift to ₹102,000 by minute 6, crash minutes 7–9 to 0.88×,
recovery minutes 10–14 to 0.93×; computed with the same math as
`computeRiskMetrics`, pinned in `crisis-scoring.spec.ts`):

| Player                                                 | R      | V      | D   | Sprint score   | Crisis score |
| ------------------------------------------------------ | ------ | ------ | --- | -------------- | ------------ |
| Cash-early (sold to cash at minute 6)                  | +2.00  | 0.6375 | 0   | +1.2214        | **+1.2214**  |
| Calm holder                                            | −5.14  | 7.5803 | 12  | −100 (clamped) | **−0.2498**  |
| Panic seller (sold everything at the bottom, minute 9) | −10.24 | 6.7483 | 12  | −100 (clamped) | **−0.5185**  |
| Half-cash holder                                       | −2.53  | 3.6944 | 6   | −0.2366        | **−0.2366**  |

With the sprint formula, the calm holder scores ≈ −5.14 × (1 + 7.58

- 12. ≈ −105.8 and the panic seller ≈ −10.24 × (1 + 6.75 + 12) ≈
      −202.3 — both clamp to −100 and tie on score, surviving only on the
      return tie-break. The multiplier is doing double duty: it is meant to
      punish risky losses, but in a crash every loss is a big loss, so the
      multiplier saturates and stops discriminating. The formula cannot
      tell a calm −5% from a panicked −10% once both are past the clamp.

**The one crisis adjustment: the loss branch divides instead of
multiplying.** `score = R / (1 + V + D)` for R < 0 as well as for
R ≥ 0. Gains are untouched. The crisis score stays in sprint range
and orders players by (return, risk): a bigger loss still scores
worse, and a riskier loss still scores worse than a calmer loss of
the same size — but the score no longer saturates, so the ordering
survives the crash. The two required properties hold on the worked
examples:

- (a) **Cash-early beats the holder:** +1.2214 vs −0.2498. Moving to
  cash early (small loss — here a small gain — low vol, no drawdown)
  beats holding through the crash.
- (b) **Panic seller does not beat the calm holder:** −0.5185 vs
  −0.2498. Selling at the bottom locks the full −12% and misses the
  +5% recovery; holding recovers part of the fall.
- **Holder vs holder with different pre-crash risk:** the half-cash
  holder (−0.2366) beats the all-in holder (−0.2498) — less pre-crash
  risk, smaller crash loss.

Winner: higher crisis score; scores within 0.001 tie on score and
higher return wins; equal on both is a draw — the same tie-break as
the sprint. The panic-sell flag is **reported, not scored**: the
missed recovery already prices panic into the return, so no second
penalty is stacked on top of it. Flag definition: sold ≥ 50%
(`CRISIS_PANIC_SELL_SHARE`) of the units held at crash start, during
the panic window — the 3-minute fall plus one crisis minute of
execution grace (`crashPanicWindowMs`), i.e. any sell executing while
the crash factor is ≤ 0.89 — for any one instrument, replayed from
the trade log at settlement. `tradesDuringCrash` counts the player's
trades whose `executedAtMs` falls in the same panic window, so the
two stats stay coherent. `crashDrawdownPct` keeps the strict fall
window. The grace exists because `executedAtMs` is stamped at server
execution, not at the player's click: under full-suite load a sale
acted at the bottom can execute just past the fall window, and a
strict window then misses a genuine panic sale (proven in
verification — full e2e 127/128 twice, same test, only `panicSold`
false; see §10.5).

No second score was invented: the crisis score is the sprint score
with one branch changed, and the change is justified by the clamp
saturation above, not by taste.

## 6. Matchmaking — own queue, never matched into a sprint

The crisis queue is Redis only (`crisis:queue`, a sorted set scored
by Trading Rating; `crisis:queue-entry:{userId}` carrying the rating

- join time), one entry per user, swept every 5 seconds. The windows
  are the sprint's (±50 → ±100 → ±200 → ±400 on the Trading Rating),
  the bot offer is the sprint's (Mira, after 30 s), the pairing rule
  is the sprint's (earliest first, nearest Rating wins, stale members
  skipped). Separation is structural: the queue key is `crisis:queue`
  and the sweep only ever pairs crisis waiters — a crisis waiter is
  never matched into a sprint or a learning duel, and a sprint waiter
  is never matched into a crisis (proven in e2e, §11, and at unit
  level in `crisis-matchmaking.spec.ts`).

Queue-level rules only (anti-farming lives at settlement, in
Ratings): one queue entry per user, no queueing while a crisis duel,
a sprint, or a live quiz duel is active. The crisis enqueue checks
all three; the sprint enqueue checks only its own type + live duels
(ADR 0011 §8.5, extended — §10.4).

## 7. Bot — Mira sells to cash on the first crash tick

Mira's crash behaviour is defined, not emergent: on the first crash
tick she **sells ALL of every holding to cash and stays in cash for
the rest of the duel** (no re-buy during the crash or the recovery).
Implemented as a thin wrapper over the sprint's `decideBotTrades`
(`crisis-bot.ts`): `crashFired=false` → normal sprint rules
(momentum buy, take-profit +1% sell half, stop-loss −1% sell all,
trim, max 12 trades); `crashFired=true` → sell-all per held
instrument, else no orders. Her orders execute through the same
`executeOrder` path as humans; her trades are not persisted as rows
(same as the sprint bot, ADR 0011 §8.2).

Deliberately, Mira is a **panic seller by design**: she locks the
fall and misses the recovery, so a calm human holder beats her — the
bot teaches the lesson by losing it. A human who copies her loses
the same way. (The bot's own crisis score is computed the same way
as a human's; the bot duel is rated through
`recordTradingDuelVsBot`, §8.)

## 8. Settlement (Trading Rating once, then everything else, once)

Identical to the sprint (ADR 0011 §6), with the crisis score and
crash fields in place of the sprint score:

1. Trading Rating first, via `recordTradingDuel` /
   `recordTradingDuelVsBot` (kind TRADING), idempotency key
   `duel:{duelId}` — a settlement retry (crash recovery, ADR 0002
   §8.4) can never move the Rating twice.
2. Then, in one transaction: the `Duel` row (status, winner,
   finishedAt), the trade rows (humans only), both `SprintDuelResult`
   rows (with `crashMinute`, `crashDrawdownPct`,
   `tradesDuringCrash`, `panicSold`), and XP (`duel.crisis_completed`,
   win 20 / draw 5 / loss 0).
3. Then the finished payloads (the stored results, never
   recomputed) with the crisis host lines, the rematch offer, and
   the 5-minute cooldown.

XP comes only from the result — no XP per trade, so there is no
incentive to churn orders through the crash. The forfeit path is
the sprint's: leaving mid-duel (or 15 seconds disconnected) settles
immediately, the leaver loses, the opponent wins, the Rating moves
±20 at equal ratings.

## 9. Migration 0012 (hand-reviewed)

`apps/api/prisma/migrations/0012_phase10_crisis_duel/migration.sql`,
authored via `prisma migrate diff` (schema-before reconstructed at
`/tmp/schema-before.prisma`, no live DB) and hand-reviewed;
`prisma validate` passes; the Prisma client was regenerated
(`CRISIS` in the generated client). **Not applied to a live
Postgres.**

- `DuelType.CRISIS` added to the `DuelType` enum.
- `SprintDuelResult` gains four nullable columns: `crashMinute
Int?`, `crashDrawdownPct Float?`, `tradesDuringCrash Int?`,
  `panicSold Boolean?` — nullable because sprint rows (and all
  pre-Phase-10 rows) have no crash. No new tables, no backfill: a
  crisis duel reuses `Duel` + `SprintTrade` + `SprintDuelResult`.

## 10. Deviations and known limits (recorded, not hidden)

1. **A crisis duel is a variant of the sprint engine, not a second
   engine** (§3). Deliberate: the crash is a price-path and scoring
   change on an already-correct engine. The cost is that the sprint
   engine now carries a variant branch; the benefit is one timer,
   one order path, one settlement, one rematch.
2. **The loss branch divides in the crisis score** (§5). Deliberate:
   the sprint multiplier saturates in a crash and stops
   discriminating. The change is one branch, pinned by worked
   examples in `crisis-scoring.spec.ts`.
3. **Bot trades are not persisted** (§7). Same as the sprint bot
   (ADR 0011 §8.2): reproducible from seed + strategy, but a future
   audit of "what did Mira do, trade by trade" would need to replay
   the crisis duel, not read rows.
4. **One-live-duel-at-a-time is one-directional, extended.** Crisis
   enqueue is blocked while a sprint is active, but sprint enqueue
   is not blocked while a crisis is active (the sprint matchmaking
   checks only its own type). A player who queues for a sprint
   mid-crisis ends up in two trading duels; the engines do not know
   about each other. Fixing it means a shared "active trading duel"
   check in the sprint matchmaking service — a later phase.
5. **The panic seller's edge in test time is the bottom minute —
   and the panic window needs an execution grace.** In the
   20-second e2e duel the tick grid (5 s) is coarse next to the
   crash (1.33 s per crisis minute), so a panic sale timed from the
   observed price could land on 0.92 instead of the 0.88 bottom and
   the 1% gap could flip on base-price drift (found in the unit
   test, fixed by selling at the bottom minute). The e2e panic test
   therefore sells at a computed time — the last fall minute,
   derived from the crash event's public `crashMinute` and the
   started payload's `startedAtMs` — not from the observed price,
   centred in that minute (+650 ms of 1,333 ms). Centring alone
   turned out NOT to be sufficient, and the earlier "suspected
   timing flake" is now a proven, reproducible failure: the
   coordinator's independent verification ran the full e2e suite
   twice at 127/128 with the same test failing both times
   (`crisis panic seller loses to the calm holder, and is flagged
panicSold` — `expect(fa.crisis.panicSold).toBe(true)`, received
   `false`), while the Rating deltas in that test were correct and
   the test passed in isolation. Diagnosis: `executedAtMs` is
   stamped at server execution, and under full-suite load the
   sleep + socket + server round-trip drifts past `crashEndMs`, so
   the strict fall window `[crashStartMs, crashEndMs)` misses a
   sale the player acted at the bottom. Fix (product-side, not
   test-side): settlement passes the panic window
   (`crashPanicWindowMs` — fall plus one crisis minute of execution
   grace, i.e. executions priced at factor ≤ 0.89) to BOTH
   `tradesDuringCrash` and `computePanicSold`, so the two stats
   stay coherent; the drawdown keeps the strict fall window, and
   the scoring formula, crash shape, and win/loss/Rating logic are
   unchanged. A sale from the second recovery minute on (factor ≥
   0.90) still does not flag. Pinned in unit tests
   (`crashPanicWindowMs` shape, grace behaviour at the pure-function
   level, and a settlement-level test selling at the first recovery
   minute) and proven by the full e2e suite passing after the fix
   (see §11).
6. **Single-server tested config; migration not applied to a live
   Postgres; Docker not booted; seed not run against a live DB**
   (see §11).
7. **No live Trading Rating change is provable from a no-trade
   timed settle in e2e** — same as the sprint (ADR 0011 §8.7):
   minute-bucketed prices barely move in a 20-second test duel, so
   a no-trade settle is usually a draw. The nonzero Trading Rating
   change is proven by the crisis happy-path test (cash-early beats
   holder, ±20) and the panic test (±20).

## 11. Verification

- **Unit: 548/548 passed, 43 suites** (baseline 476/476, 37 suites
  before this phase; +72 tests). New: `crisis-crash.spec.ts`,
  `crisis-scoring.spec.ts`, `crisis-bot.spec.ts` (39/39 — crash
  minute derivation, crash price path, crisis scoring worked
  examples, bot crash behaviour), `crisis-engine.spec.ts` (8/8 —
  creation, crash firing, price path, cash-early-beats-holder
  end-to-end with mirrored ±20 Trading Rating deltas, panic seller
  loses with `panicSold`, a sale executing one crisis minute past
  the fall still flags `panicSold` (panic-window grace, §5),
  bot sells to cash and never re-buys, order pricing before vs during the crash), `crisis-matchmaking.spec.ts`
  (7/7 — queue separation at the keyspace level),
  `crisis.gateway.spec.ts` (12/12 — transport only). One pre-existing
  sprint rematch test needed its fake to gain the new type-aware
  repository methods; no sprint behaviour changed.
- **E2E: 128/128 passed** (baseline 123/123; +5 crisis tests):
  happy path (queue → match → trade → `crisis:crash` received with
  minute 7–10 and drop 12% → settle → cash-early beats holder, ±20
  Trading Rating, stored result with the `crisis` block, history
  lists the crisis), panic seller loses to the calm holder with
  `panicSold: true` and `tradesDuringCrash: 1`, queue separation
  (crisis waiter + sprint waiter, neither matched in 6 s), REST
  (queue status, active crisis with `crashFired: false`, state,
  another player's result 403, forfeit settles), socket without a
  token is disconnected. Two timing failures in the panic test were
  found under full-suite load during verification and fixed (§10.5):
  the sale executing past `crashEndMs` (panic window grace,
  product-side) and the test's own `fa.crashDrawdownPct >
fb.crashDrawdownPct` comparison (both 11.8835 — a sampling
  artifact, not a product property; replaced by per-player `> 0`).
  Full e2e 128/128 after both fixes, confirmed twice (two
  back-to-back full runs).
- **Gates:** API typecheck clean, API lint clean, API format clean,
  web typecheck clean, web lint clean, `prisma validate` passes,
  Prisma client regenerated. `packages/shared` dist rebuilt before
  running tests (Phase 9 lesson: stale dist caused NaN scores).
- **Not verified:** no live Postgres (migration not applied), no
  Docker boot, no seed run against a live DB, no multi-server
  sticky-session test (single-server tested config), no live
  browser/manual QA (see docs/15 §10 checklist).

## 12. Consequences

- The sprint engine is now the **trading engine**: the Weekly
  Portfolio Battle (T3) and any later trading duel should be built
  as a third variant on the same parameterisation, not as a third
  engine. If a third variant needs a behaviour the variant switch
  cannot express cleanly, that is the moment to split the engine —
  with its own ADR.
- The crisis score's loss branch (divide) is now the precedent for
  any duel whose losses are large by design: when the loss branch
  multiplies, large losses saturate the clamp and stop
  discriminating. Any future duel with a crash-like event should
  reuse the crisis branch, not re-derive it.
- The `SprintDuelResult` table now carries crash columns that are
  null for sprints. A future trading duel that needs its own
  per-duel fields should follow the same pattern (nullable columns
  on the shared result table) until the table's width justifies a
  split — and that split needs its own ADR.
- The one-directional one-live-duel gap now covers two trading
  duel types (§10.4). It is still one-directional and still
  recorded, not hidden — but the next trading duel should close it
  rather than extend it again.
