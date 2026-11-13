# Candle — Phase 10 Crisis Duel (T2)

**Status:** Built and verified 2026-11-12 (ADR 0012; unit 543/543, e2e
128/128). **Step 8 of the duels build order** (docs/05 §1/§7) — "Simulated
crash mid-duel. Smallest loss + calmest decisions wins." — and the
**eighth of ten duel types built**.

A Crisis Duel is a Paper Trading Sprint (T1, docs/14) with a **seeded
crash mid-duel**. Same 15 minutes, same fictional market, same virtual
₹100,000, same order execution — plus a crash nobody can time, a
partial recovery that rewards holding through it, and a scoring rule
that can tell a calm loss from a panicked one. It is a **variant of
the sprint engine, not a second engine** (ADR 0012 §3): the engine,
repository, result service, and settlement code are shared with the
sprint, parameterised by the variant on the Redis state.

## 1. What Step 8 is (and is not)

**Is:** a live, rated, head-to-head trading duel on the Trading
Rating. Two players, 15 minutes, virtual ₹100,000 each, the same 6
fictional instruments (NVLT, KVRF, ASTL, MRUM, SGNR, HELX), the same
minute-bucketed prices from the Phase 2 `PriceEngine` — and a crash
that hits at a seeded minute (7–10), falls ~12% over 3 minutes, then
recovers ~5%. The winner is the best **crisis risk-adjusted return**
(§6): smallest loss + calmest decisions. Host is Tara (Risk Guardian);
Mira plays the opponent in a bot crisis duel (§7).

**Is not:** a new engine (the sprint engine is parameterised — §2.1);
a new question format (trading duels use actions, not formats, doc 08
§3.7); a prediction game (nobody knows the crash minute in advance,
§5); a second score (the crisis score is the sprint score with one
branch changed, §6); the Weekly Portfolio Battle (T3, a later step);
profiles/settings/community code; bank growth (deferred per Nishu's
decision — complete all duels first).

## 2. Technical architecture

### 2.1 What was reused from earlier phases, and what is new

**Reused from the sprint (Phase 9, docs/14 + ADR 0011) — unchanged:**

- The whole trading engine: 15-minute timer, 30-second ticks, order
  execution (`executeOrder` — the server prices every order), live
  portfolio values, 15-second disconnect grace then forfeit,
  settlement in one transaction (Trading Rating first, idempotency
  key `duel:{duelId}`, then Duel + trade rows + both result rows + XP),
  rematch offer with the 5-minute cooldown.
- The matchmaking shape: one Redis queue, Trading Rating windows
  ±50 → ±400, 5-second sweep, bot offer after 30 seconds.
- The settlement and Rating integration: `RatingsService.recordTradingDuel`
  / `recordTradingDuelVsBot` (kind TRADING), XP win 20 / draw 5 / loss 0.
- The Prisma rows: `Duel` + `SprintTrade` + `SprintDuelResult` — no new
  tables. The `Duel` row is reused with `seed` = market seed.
- The web patterns: queue → countdown → trading (portfolio card, order
  form, holdings table, risk panel, live equities) → result + rematch,
  educational disclaimer on every trading screen.

**New in this phase:**

- `apps/api/src/modules/crisis-duel/` — `crisis-matchmaking.service.ts`
  (own Redis queue `crisis:*`), `crisis.gateway.ts` (namespace
  `/crisis`), `crisis.controller.ts` (REST `/api/v1/crisis`),
  `crisis.module.ts`, `dto/crisis.dto.ts`, plus matchmaking + gateway
  specs. The module imports `TradingSprintModule` — it owns only what
  differs.
- `apps/api/src/modules/trading-sprint/crisis-crash.ts` (pure: seeded
  crash minute, crash price path, panic-sell detection),
  `crisis-scoring.ts` (pure: the crisis score), `crisis-bot.ts` (pure:
  Mira's crash behaviour).
- Variant parameterisation of the sprint engine/state/repository/
  result service: `variant: 'SPRINT' | 'CRISIS'` on the Redis state,
  one emitter per variant, variant-aware pricing/scoring/bot/
  settlement/rematch, `crisis:*` keys, type-aware repository lookups,
  the `crisis` block on stored-result views.
- Prisma: `DuelType.CRISIS` + four nullable columns on
  `SprintDuelResult` (`crashMinute`, `crashDrawdownPct`,
  `tradesDuringCrash`, `panicSold`), migration
  `0012_phase10_crisis_duel` (hand-reviewed, via `prisma migrate
diff`, not applied to a live Postgres).
- Shared: `DUELS.CRISIS_*` tunables + `CRISIS_HOST_NAME` ('Tara'),
  error codes `CRISIS_ALREADY_QUEUED`, `CRISIS_NOT_IN_QUEUE`,
  `CRISIS_NOT_ACTIVE`, `CRISIS_ALREADY_ACTIVE`; gamification reason
  `duel.crisis_completed`.
- Web: `apps/web/app/duels/crisis/page.tsx` (the sprint page's
  patterns + the CRASH banner + the crash panel on the result), a
  Crisis Duel card on the duels hub, crisis fields on the shared
  sprint types in `apps/web/lib/api.ts`.

### 2.2 Data flow (one crisis duel, end to end)

1. Two players join the crisis queue (`crisis:join-queue`, no payload
   — the server reads each caller's Trading Rating). The 5-second
   sweep pairs them when their windows overlap; after 30 seconds the
   Mira bot is offered instead.
2. The engine creates the duel (`Duel` row, type `CRISIS`, `seed` =
   market seed) and the Redis state (`crisis:duel:{id}`,
   `crisis:user-duel:{userId}`), deriving `crashMinute = 7 +
(FNV-1a(seed) % 4)` — minute 7–10, same for both players, never
   sent to a client. Both players get `crisis:matched` (opponent,
   Tara's intro — which says a crash is coming but never says when —
   starting cash, instruments, countdown) and `crisis:countdown`.
3. After the 3-second countdown, `crisis:started` carries each
   player's own cash + portfolio and the instruments with current
   prices; the 15-minute timer starts. Every 30 seconds a
   `crisis:tick` carries prices + both TOTAL equities (never holdings
   or orders).
4. Orders (`crisis:order`) are validated by DTO, executed by the
   engine at the server price — during the crash, at the crashed
   price — and acked with the order + the player's portfolio. A
   retried `clientOrderId` replays, never double-applies.
5. On the first tick at or after the crash minute, the engine sets
   `crashFired`/`crashFiredAtMs`, runs Mira's crash step immediately
   if it is a bot duel, and emits one `crisis:crash` event to the
   room (the banner). Every later tick carries `crashFired: true`.
6. At 15 minutes (or on forfeit) the duel settles: Trading Rating
   first (idempotency key `duel:{duelId}`), then Duel + trade rows +
   both result rows (with the crash fields) + XP in one transaction,
   then `crisis:finished` to each player (their stored result + Tara's
   result line) and the rematch offer.

## 3. WebSocket event contract — full

Namespace `/crisis`. Auth: the access JWT in the handshake
(`auth.token`, or an `Authorization: Bearer` header), verified exactly
like HTTP. One socket per user: a second connection replaces the
first. Every handler acks `{ ok: true, ... }` or
`{ ok: false, code, message }`; errors never leak internals.

### Client → server

| Event                | Payload                                                   | Notes                                                                      |
| -------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------- |
| `crisis:join-queue`  | — (no payload)                                            | Server reads the caller's Trading Rating.                                  |
| `crisis:leave-queue` | —                                                         | Idempotent; leaving when not queued is a no-op.                            |
| `crisis:accept-bot`  | —                                                         | Only after 30 s in the queue (`botOfferDue`); creates the bot crisis duel. |
| `crisis:order`       | `{ duelId, instrumentId, side, quantity, clientOrderId }` | DTO-validated (UUIDs, side BUY/SELL, qty 1–100,000, clientOrderId UUID).   |
| `crisis:leave-duel`  | `{ duelId }`                                              | Forfeits (counts as a loss).                                               |
| `crisis:rematch`     | `{ duelId }`                                              | Both players must ask; 5-minute cooldown per pair.                         |

### Server → client

| Event                                                          | Payload                                                                                             | Notes                                                                    |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `crisis:queued`                                                | queue status + host Tara                                                                            | `ratingWindow`, `waitedMs`, `botOfferDue`.                               |
| `crisis:queue-left`                                            | `{ userId }`                                                                                        |                                                                          |
| `crisis:bot-offer`                                             | `{ message, botName: 'Mira' }`                                                                      | After 30 s with no human match.                                          |
| `crisis:matched`                                               | `{ duelId, opponent, host, startingCash, instruments, countdownEndsAtMs, serverNowMs }`             | Host line mentions the crash, never the minute.                          |
| `crisis:countdown`                                             | `{ duelId, countdownEndsAtMs, serverNowMs, host }`                                                  |                                                                          |
| `crisis:started`                                               | `{ duelId, instruments, cash, portfolio, startedAtMs, endsAtMs, serverNowMs }`                      | Per player — own cash + portfolio only.                                  |
| `crisis:tick`                                                  | `{ duelId, serverNowMs, endsAtMs, prices, equities, crashFired?, crashFiredAtMs? }`                 | Prices + both TOTAL equities. `crashFired` only after the crash.         |
| `crisis:crash`                                                 | `{ duelId, crashMinute, crashFiredAtMs, dropPct: 12, dropMinutes: 3, recoveryPct: 5, serverNowMs }` | Once, when the crash hits. The minute is public only after it has fired. |
| `crisis:order-accepted`                                        | `{ order, portfolio }`                                                                              |                                                                          |
| `crisis:opponent-disconnected` / `crisis:opponent-reconnected` | `{ userId, duelId }`                                                                                | 15-second grace.                                                         |
| `crisis:rematch-requested`                                     | `{ duelId, userId }`                                                                                |                                                                          |
| `crisis:finished`                                              | the stored result + `{ host, forfeitedBy }`                                                         | Never recomputed; includes the `crisis` block (§4).                      |
| `crisis:error`                                                 | `{ code, message }`                                                                                 |                                                                          |

## 4. REST endpoints (`/api/v1/crisis`)

Thin controllers; the response envelope is applied by the global
interceptor. Every endpoint carries the educational disclaimer
(blueprint §16). Live trading happens over the Socket.IO namespace
`/crisis`, not over REST.

| Method | Path            | Auth | Notes                                                                                                                                                                                     |
| ------ | --------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/active`       | user | My active crisis duel, if any (phase, start/end, my equity, opponent equity, `crashFired`).                                                                                               |
| GET    | `/queue/status` | user | My crisis queue status (waited time, Trading Rating window, bot offer).                                                                                                                   |
| GET    | `/history`      | user | My finished crisis duels, newest first (type-filtered).                                                                                                                                   |
| GET    | `/:id/state`    | user | One crisis duel's state summary — mine only (404 otherwise). My portfolio, both equities. The crash minute is never disclosed; only whether the crash has fired.                          |
| POST   | `/:id/forfeit`  | user | Forfeit my crisis duel (leaving counts as a loss).                                                                                                                                        |
| GET    | `/:id/result`   | user | One crisis duel's stored result — mine only (403 otherwise). Includes the `crisis` block: `crashMinute`, `crashDrawdownPct`, `tradesDuringCrash`, `panicSold`, `crashLine` (plain words). |

## 5. Crash design (decided — ADR 0012 §4)

**Seeded crash minute.** `crashMinute = 7 + (FNV-1a(seed) % 4)` —
minute 7–10 of 15, same seed for both players, never disclosed in
advance. A fixed minute would be gameable (sell at minute 7, buy
back at minute 10); a seeded minute in a 4-minute band cannot be.
The crash minute lives in the Redis state and on the stored result
row; it is never sent to a client before settlement.

**Crash shape (deterministic, identical for both players).** A
multiplier on the Phase 2 price engine, applied to all 6 instruments
together:

| Minutes relative to crash minute      | Factor                             |
| ------------------------------------- | ---------------------------------- |
| before the crash                      | 1.00                               |
| crash minute, +1, +2 (3 fall minutes) | 0.96 / 0.92 / 0.88 (−12% total)    |
| +3 … +7 (5 recovery minutes)          | 0.89 … 0.93 (+5% partial recovery) |
| after +7                              | 0.93 flat (net −7%)                |

The recovery is load-bearing for the scoring (§6): without it, a
panic seller and a calm holder would both end at the bottom and the
duel could not separate them. With it, the holder recovers part of
the fall and the seller — who sold at the bottom — does not. The
recovery is partial, so the duel still ends in the red for anyone
who held: the lesson is "smallest loss", not "the crash was free".

**Visibility.** One `crisis:crash` socket event when it hits (§3) +
a CRASH banner in the UI + a `crashFired` flag on the state, the
active summary, and every tick after the crash. The banner states
the shape (falling ~12% over 3 minutes, then recovering ~5%) — the
shape is public once it has happened; only the timing was secret.

**Test-time rule (mandatory).** A "crisis minute" is `durationMs /
15`, not a wall-clock minute. In production that is 60,000 ms; in
e2e (`SPRINT_DURATION_MS=20000`) it is ~1,333 ms, so the crash fires
at ~50% of the shortened duel, falls over the next ~20%, and
recovers after. The crash check runs on **every tick**, not only on
minute advance — with a 5-second tick in tests, a minute-advance
check would miss the crash window entirely. Crash window in ms:
`crashStartMs = startedAtMs + crashMinute × (duration/15)`,
`crashEndMs = startedAtMs + (crashMinute+3) × (duration/15)`.

**What is stored where.** The crash minute, the crash-fired flag,
and the fired-at time live in the Redis state (they drive the live
duel) and, after settlement, on the `SprintDuelResult` row
(`crashMinute`, `crashDrawdownPct`, `tradesDuringCrash`,
`panicSold`) — the result screen needs them after settlement. The
seed is already on the `Duel` row; the drop/recovery params are
constants (`CRISIS_CRASH_*` in `packages/shared`).

## 6. Crisis scoring, with worked examples

The base is the sprint score (docs/14 §6): with return R (fraction),
realised volatility V (%), and max drawdown D (%), `score = R / (1 +
V + D)` for R ≥ 0 and `score = R × (1 + V + D)` for R < 0, clamped to
±100. The **one crisis adjustment: the loss branch divides instead
of multiplying** — `score = R / (1 + V + D)` for R < 0 as well.
Gains are untouched.

Why: the base formula alone does not cleanly separate a calm holder
from a panic seller. With realistic 16-point minute-sampled curves,
a calm holder scores ≈ −5.14 × (1 + 7.58 + 12) ≈ −105.8 and a panic
seller ≈ −10.24 × (1 + 6.75 + 12) ≈ −202.3 — both clamp to −100 and
tie on score, surviving only on the return tie-break. The multiplier
is meant to punish risky losses, but in a crash every loss is a big
loss, so it saturates and stops discriminating. Dividing keeps the
score in sprint range and orders players by (return, risk).

Worked examples (16-point curves, start ₹100,000; pre-crash drift
to ₹102,000 by minute 6; crash minutes 7–9 to 0.88×; recovery
minutes 10–14 to 0.93×; computed with the same math as
`computeRiskMetrics`, pinned in `crisis-scoring.spec.ts`):

| Player                                                 | R      | V      | D   | Crisis score |
| ------------------------------------------------------ | ------ | ------ | --- | ------------ |
| Cash-early (sold to cash at minute 6)                  | +2.00  | 0.6375 | 0   | **+1.2214**  |
| Calm holder                                            | −5.14  | 7.5803 | 12  | **−0.2498**  |
| Panic seller (sold everything at the bottom, minute 9) | −10.24 | 6.7483 | 12  | **−0.5185**  |
| Half-cash holder                                       | −2.53  | 3.6944 | 6   | **−0.2366**  |

Both required properties hold:

- (a) **Cash-early beats the holder:** +1.2214 vs −0.2498. Moving
  to cash early (small loss — here a small gain — low vol, no
  drawdown) beats holding through the crash.
- (b) **Panic seller does not beat the calm holder:** −0.5185 vs
  −0.2498. Selling at the bottom locks the full −12% and misses the
  +5% recovery; holding recovers part of the fall.
- **Holder vs holder with different pre-crash risk:** the half-cash
  holder (−0.2366) beats the all-in holder (−0.2498) — less pre-crash
  risk, smaller crash loss.

Winner: higher crisis score; scores within 0.001 tie on score and
higher return wins; equal on both is a draw — the same tie-break as
the sprint.

The panic-sell flag is **reported, not scored**: the missed recovery
already prices panic into the return, so no second penalty is stacked
on top of it. Flag definition: sold ≥ 50%
(`CRISIS_PANIC_SELL_SHARE`) of the units held at crash start, during
the **panic window**, for any one instrument — replayed from the trade
log at settlement. The panic window is the 3-minute fall
`[crashStartMs, crashEndMs)` **plus one crisis minute of execution
grace** (`crashPanicWindowMs` in `crisis-crash.ts`), i.e. any sell
executing while the crash factor is ≤ 0.89 — the 0.88 bottom plus one
recovery step. A sale from the second recovery minute on (factor ≥
0.90, recovery genuinely underway) is still not panic, and neither is
a sale before the crash or a calm hold (0 trades). The grace exists
because `executedAtMs` is stamped at server execution, not at the
player's click: a player who acts at the bottom can have the order
execute just past the fall window (client sleep + socket round-trip

- server Redis load/save), and a strict fall window then misses a
  genuine panic sale — proven, not a flake: the coordinator's
  independent verification ran the full e2e suite twice at 127/128
  with the same test failing (`panicSold` false, Rating deltas still
  correct), while the test passed in isolation. One crisis minute is
  the right size for the grace: it is the smallest unit the crash
  shape itself uses (the factor changes once per crisis minute) and it
  is proportional (duration/15) — 1 minute in production, ~1.33 s in
  a 20-second test duel. `tradesDuringCrash` counts the player's
  trades whose `executedAtMs` falls in the same panic window, so the
  two stats can never contradict each other (`panicSold: true` always
  implies `tradesDuringCrash ≥ 1`). `crashDrawdownPct` keeps the
  strict fall window: it is the player's drawdown across the crash
  window (peak before the crash to trough in the window), in percent.

## 7. The Mira bot — crash behaviour, in full

Mira's crash behaviour is defined, not emergent: on the first crash
tick she **sells ALL of every holding to cash and stays in cash for
the rest of the duel** (no re-buy during the crash or the recovery).
Implemented as a thin wrapper over the sprint's `decideBotTrades`
(`crisis-bot.ts`): `crashFired=false` → normal sprint rules
(momentum buy, take-profit +1% sell half, stop-loss −1% sell all,
trim, max 12 trades); `crashFired=true` → sell-all per held
instrument, else no orders. Her orders execute through the same
`executeOrder` path as humans; her trades are not persisted as rows
(same as the sprint bot).

Deliberately, Mira is a **panic seller by design**: she locks the
fall and misses the recovery, so a calm human holder beats her — the
bot teaches the lesson by losing it. A human who copies her loses
the same way. Her crisis score is computed the same way as a human's;
the bot duel is rated through `recordTradingDuelVsBot`.

## 8. Matchmaking

One queue (`crisis:queue`, Redis sorted set by Trading Rating),
separate from every other queue — sprint, learning duels, all of
them. Windows ±50 → ±100 → ±200 → ±400 with wait time. 5-second
sweep pairs waiters whose windows overlap (earliest first, nearest
Rating wins; stale members skipped). Separation is structural: the
queue key is `crisis:queue` and the sweep only ever pairs crisis
waiters. Queue-level rules only (anti-farming lives at settlement,
in Ratings): one queue entry per user, no queueing while a crisis
duel, a sprint, or a live quiz duel is active.

## 9. Timers, disconnect, forfeit

Same as the sprint (docs/14 §9): 3-second countdown, 15-minute
timer, 30-second ticks, 15-second disconnect grace then forfeit.
Leaving mid-duel (or disconnecting past the grace) settles
immediately: the leaver loses, the opponent wins, the Rating moves
±20 at equal ratings. The server owns the clock — the client timer
is display only. Rematch: both players must ask, 5-minute cooldown
per pair, no rematch for bot crisis duels.

## 10. Trading Rating integration

Identical to the sprint (docs/14 §10): Rating first via
`RatingsService.recordTradingDuel` / `recordTradingDuelVsBot` (kind
TRADING, same ELO formula/K/caps, TRADING-only pair/day counters),
idempotency key `duel:{duelId}` — a settlement retry can never move
the Rating twice — then Duel + trade rows + both result rows (with
the crash fields) + XP in one transaction. XP win 20 / draw 5 /
loss 0, reason `duel.crisis_completed`; no XP per trade. The result
screen shows the Rating change with a crisis worded reason ("in the
Crisis Duel, on crisis risk-adjusted return") and the plain-words
crash line (`crisisCrashLineFor` — distinct wording for panic-sold /
traded-during-crash / held-through).

## 11. Load balancing and scaling (docs/05 §3.4 — the honest version)

Same as the sprint (docs/14 §11): single-server tested config; the
Socket.IO Redis adapter is shared with the `/duels-live` and
`/sprint` namespaces (installed in `main.ts`, not in the module);
sticky sessions are REQUIRED in multi-server deploys. The variant
emitter map means a crisis event can never reach a sprint socket —
the variant is part of the emit path, not just the event name.

## 12. Web UI (`apps/web/app/duels/crisis/`)

The sprint page's patterns, on the `/crisis` namespace and
`crisis:*` events, plus two crisis-only pieces:

- **The CRASH banner** (role="alert", rose): appears when
  `crisis:crash` arrives or any tick carries `crashFired: true`,
  and survives a reconnect (the active summary carries
  `crashFired`). It states the shape (falling ~12% over 3 minutes,
  then recovering ~5%) and the lesson (selling at the bottom locks
  the fall and misses the recovery). The crash minute is shown only
  after it has fired.
- **The crash panel on the result**: the `crisis` block from the
  stored result — the plain-words crash line, crash minute, crash
  drawdown, trades during the crash, and (when it applies) the
  panic-sold note. The shared `SprintResultView` renders the score,
  equities, per-instrument table, Rating change, and XP, as for a
  sprint.

The duels hub carries a Crisis Duel card next to the Sprint card.
Every trading screen carries the educational disclaimer
(`DuelsDisclaimer`).

## 13. Anti-cheat and fairness (docs/05 §5)

Same as the sprint (docs/14 §13), plus the crash-specific points:

- The crash minute is seeded per duel and never sent to a client
  before settlement — a player cannot time the crash from the
  client, from the network, or from a previous duel (the seed
  changes every duel).
- Both players share the seed, the crash minute, and the crash
  factor — the crash is identical for both, by construction.
- Orders execute at the server price at execution time; a client
  cannot send a price, so a client cannot buy at a pre-crash price
  during the crash.
- The crisis score is computed server-side from the stored equity
  curve at settlement; the client never computes or sends a score.
- The panic-sell flag is replayed from the trade log at settlement,
  not from anything the client reports.

## 14. Testing

**Unit: 548/548, 43 suites** (baseline 476/476, 37 suites). New
crisis tests: `crisis-crash.spec.ts`, `crisis-scoring.spec.ts`,
`crisis-bot.spec.ts` (39/39 — crash minute derivation from seed,
crash price path drop-then-recovery deterministic and identical for
both players, crisis scoring worked examples §6, bot crash
behaviour); `crisis-engine.spec.ts` (8/8 — creation with a seeded
crash minute, crash firing once with the correct `crisis:crash`
payload, price path, cash-early-beats-holder end-to-end with
mirrored ±20 Trading Rating deltas, panic seller loses with
`panicSold`, a sale executing one crisis minute past the fall still
flags `panicSold` (the panic-window grace, §6), bot sells to cash
and never re-buys, order pricing before vs during the crash);
`crisis-matchmaking.spec.ts` (7/7 — queue separation at the keyspace
level); `crisis.gateway.spec.ts` (12/12 — transport only);
`sprint-state.spec.ts` gained crisis-key and legacy-parse tests. One
pre-existing sprint rematch test needed its fake to gain the new
type-aware repository methods; no sprint behaviour changed.

Two test lessons worth keeping: (1) `placeOrder` defaults `now` to
real wall-clock time — unit tests must pass an explicit fake `now`,
or orders execute at real-now prices and crash-window math lands
outside the duel. (2) The base `PriceEngine` drifts minute to
minute, and that drift can overturn a 1% gap — the panic test sells
at the bottom minute (0.88), not one minute into the fall (0.92),
because only the bottom is the panic case the scoring is designed
around.

**E2E: 128/128** (baseline 123/123; +5 crisis tests): happy path
(queue → match → trade → `crisis:crash` received with minute 7–10
and drop 12% → settle → cash-early beats holder, ±20 Trading
Rating, stored result with the `crisis` block, history lists the
crisis), panic seller loses to the calm holder with `panicSold:
true` and `tradesDuringCrash: 1` (the sale is timed from the crash
event's public `crashMinute` and the started payload's
`startedAtMs` — the last fall minute, centred in that minute, not
the observed price; see ADR 0012 §10.5), queue separation (crisis waiter + sprint waiter,
neither matched in 6 s), REST (queue status, active crisis with
`crashFired: false`, state, another player's result 403, forfeit
settles), socket without a token is disconnected.

Two timing failures in the panic test were found and fixed during
verification, both under full-suite load only (the test passed in
isolation throughout): (1) the sale executed past `crashEndMs`, so
the strict fall window missed it and `panicSold` was false — full
e2e 127/128 twice, same test, Rating deltas still correct. Fixed
product-side with the panic window (§6): settlement passes the fall
plus one crisis minute of execution grace to both panic stats.
(2) Once the flag passed, the test's own
`fa.crashDrawdownPct > fb.crashDrawdownPct` assertion failed with
both at 11.8835 — both equities touch the bottom, so that ordering
is a minute-sampling artifact, not a product property. Fixed
test-side: the comparison is replaced by per-player `> 0`
assertions, with the reason in the test comment. Full e2e 128/128
after both fixes, confirmed twice (two back-to-back full runs).

## 15. Manual QA checklist

- [ ] Queue as two players; both get matched, countdown 3-2-1, trading opens.
- [ ] The intro line says a crash is coming; it never says the minute.
- [ ] Trade before the crash; the order executes at the shown price.
- [ ] When the crash hits: the CRASH banner appears on both screens at the same time, prices fall together, the tick carries `crashFired`.
- [ ] Sell during the crash; the order executes at the crashed price.
- [ ] Hold through the crash; the price recovers part of the fall by the end.
- [ ] Settlement: the winner is the better crisis score (not the higher return); the result shows the crash panel (minute, drawdown, trades during the crash, panic-sold note when it applies).
- [ ] Trading Rating moves ±20 at equal ratings; history lists the crisis duel.
- [ ] Rematch: both ask → new crisis duel; the 5-minute cooldown message appears when it applies.
- [ ] Leave mid-duel: the leaver loses, the opponent wins immediately.
- [ ] Disconnect for 15+ seconds: forfeit. Reconnect within 15 seconds: resume with the banner state intact.
- [ ] Bot: after 30 seconds in the queue Mira is offered; accept → she trades, sells everything to cash on the crash tick, and never re-buys.
- [ ] Mobile (360px): the CRASH banner, the order form, and the result panel fit without overflow; buttons are tappable.
- [ ] The disclaimer is visible on the queue, trading, and result screens.

## 16. Limits / not verified

- Migration 0012 not applied to a live Postgres; Docker not booted;
  seed not executed against a live DB; single-server tested config.
- Bot trades are not persisted as rows (same as the sprint bot).
- One-live-duel-at-a-time is one-directional, extended to crisis
  (ADR 0012 §10.4): crisis enqueue is blocked while a sprint is
  active, but sprint enqueue is not blocked while a crisis is active.
- No live browser/manual QA yet — see the checklist above (§15).
