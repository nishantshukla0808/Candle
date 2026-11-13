# Candle — Phase 9 Paper Trading Sprint (T1)

**Date:** 2026-11-12
**Status:** BUILT and verified (unit 476/476, e2e 123/123 — see §14)
**Depends on:** Blueprint 01, Ratings doc 04, Duels doc 05 §1/§7,
doc 08 §3.7 (trading duels use actions, not question formats) + §2.2
(Tara), ADR 0003 (Phase 2 simulator), ADR 0006 (settlement pattern),
ADR 0007 (live engine patterns), ADR 0011 (this phase's decisions).

---

## 1. What Step 7 is (and is not)

**Step 7 is:** the first trading duel — a live, rated, head-to-head
Paper Trading Sprint (T1). 15 minutes, both players start with the
same virtual ₹100,000 on the same fictional market (the Phase 2
price engine, the same 6 instruments, the same minute-bucketed
prices), BUY/SELL/HOLD actions, winner by **risk-adjusted return**,
not highest return (§6). Own Trading Rating queue, Mira bot offer
after 30 seconds (§7/§8), 15-second disconnect grace then forfeit
(§9), settlement in one transaction with the Trading Rating first
(§10). Host is Tara (Risk Guardian), who speaks before and after
only, never during the sprint, never gives trading advice.

**Step 7 is not:**

- A new question format or any bank growth. A sprint needs no
  question bank — the "bank" is the market. Bank growth stays
  deferred until all duels are complete, per Nishu's order.
- Leverage or shorting (v1). Both are excluded with reasons in
  ADR 0011 §2.
- Real money, real tickers, or real advice. Fictional only,
  educational disclaimers on every trading screen (blueprint §16).
- Crisis Duel (T2), Weekly Portfolio Battle (T3), leagues,
  tournaments, Friend Challenge, or profiles/settings/community
  code. Those are later steps.

## 2. Technical architecture

### 2.1 What was reused from earlier phases, and what is new

**Reused:**

- Phase 2 simulator: `PriceEngine` (deterministic minute-bucketed
  prices), the 6 fictional instruments, `SIMULATOR_STARTING_CASH`
  (₹100,000), Decimal money handling. The sprint engine reads the
  instrument list through `SimulatorRepository.listActiveInstruments`
  (the simulator module now exports the repository for this).
- Phase 5 live patterns (docs/09): one socket per user, JWT auth at
  the handshake, 5-second matchmaking sweep, windows ±50 → ±400,
  bot offer after 30 s, 15 s disconnect grace, 3 s countdown,
  Ratings-first settlement with idempotency key `duel:{duelId}` +
  `getDuelOutcome` crash recovery, rating-cap fallback (settle
  without Rating), XP win 20 / draw 5 / loss 0, 5-minute rematch
  cooldown, Redis state + Postgres source of truth after the duel,
  the Redis adapter for multi-server fan-out.
- Ratings (doc 04): the same ELO formula, K-factor table, caps
  (same pair max 3/day, max 10 rated events/user/day), and the same
  `applyUpdate` math as learning duels — only the kind is TRADING.
- Gamification: `grantDuelRewards` with a new reason
  (`duel.sprint_completed`).

**New (this phase only):**

- `src/modules/trading-sprint/` — a second engine, not a variant of
  the question engine (ADR 0011 §3): `sprint-engine.service.ts`
  (timer, order execution, bot, settlement),
  `sprint-matchmaking.service.ts` (own queue, Trading Rating),
  `sprint.gateway.ts` (namespace `/sprint`),
  `sprint.controller.ts` (REST), `sprint.service.ts` (stored-result
  views + history), `sprint.repository.ts` (the only Prisma
  touchpoint), `sprint-scoring.ts` (pure risk math),
  `sprint-bot.ts` (pure bot strategy), `sprint-state.ts` (Redis
  state, keys, windows).
- Prisma: `DuelType.SPRINT`, `SprintTrade`, `SprintDuelResult`
  (migration 0011, ADR 0011 §9).
- Ratings: `recordTradingDuel`, `recordTradingDuelVsBot`,
  `countPairTradingDuelsSince`, `lastPairTradingDuel`,
  `getDuelOutcome(userId, eventId, kind?)`.
- Web: `apps/web/app/duels/sprint/` + hub card + Sprint types in
  `lib/api.ts`.

### 2.2 Data flow (one sprint, end to end)

1. Player joins the sprint queue (`sprint:join-queue`). The server
   reads their Trading Rating; the queue is a Redis sorted set by
   Rating (`sprint:queue`).
2. The 5-second sweep pairs two waiters whose windows overlap
   (or the player accepts the Mira bot after 30 s). The engine
   creates one Duel row (type SPRINT, seed = market seed) and Redis
   state in COUNTDOWN, snapshots the 6 active instruments, and arms
   the 3-second countdown.
3. `startTrading`: phase TRADING, `startedAtMs`/`endsAtMs` set, first
   equity sample, per-player `sprint:started` (own cash + portfolio
   only), 30-second tick interval + 15-minute end timer armed.
4. Orders (`sprint:order`): server prices from the deterministic
   engine at the current minute, validates funds/holdings, applies
   to the player's Redis portfolio. A retried `clientOrderId`
   replays the stored order, never a second trade.
5. Ticks (`sprint:tick`, every 30 s): prices + both players' TOTAL
   equity. Equity is sampled per minute (a tick inside a minute
   broadcasts without sampling); in a bot sprint, a new minute lets
   Mira trade.
6. Settlement (`settleDuel`, timer or forfeit): final equity sample,
   risk metrics per player (§6), Trading Rating first (§10), then
   Duel + SprintTrade + SprintDuelResult rows + XP in one
   transaction, then per-player `sprint:finished` with the stored
   result. Redis state deleted. A re-settle replays the stored
   result.

## 3. WebSocket event contract — full

Namespace `/sprint`. Every handler answers with an ack
`{ ok: true, ... }` or `{ ok: false, code, message }`; asynchronous
sprint events arrive as `sprint:*` broadcasts. Errors never leak
internals (blueprint §2.5).

### Client → server

| Event | Payload | Behaviour |
| --- | --- | --- |
| `sprint:join-queue` | `{}` (no payload) | Enqueue on the Trading Rating. Emits `sprint:queued` + starts the 30 s bot-offer timer. Already queued / active sprint / active live duel → 409 ack. |
| `sprint:leave-queue` | `{}` | Dequeue. Emits `sprint:queue-left`. Idempotent. |
| `sprint:accept-bot` | `{}` | Only after 30 s in the queue (`SPRINT_NOT_IN_QUEUE` before). Creates the bot sprint, emits `sprint:matched` + `sprint:countdown`. |
| `sprint:order` | `{ duelId, instrumentId, side: BUY \| SELL, quantity: 1–100000, clientOrderId: UUID }` | Server-priced order (§5). Ack carries the order + the player's portfolio. A retried `clientOrderId` replays. |
| `sprint:leave-sprint` | `{ duelId }` | Voluntary forfeit — settles immediately (§9). |
| `sprint:rematch` | `{ duelId }` | Both players must ask; 5-minute cooldown per pair. Second ask creates the new sprint. Bot sprints: `BOT_NO_REMATCH`. |

### Server → client

| Event | Payload | Notes |
| --- | --- | --- |
| `sprint:queued` | `{ queued, waitedMs, ratingWindow, botOfferDue, host }` | Host is Tara. |
| `sprint:queue-left` | `{ userId }` | |
| `sprint:bot-offer` | `{ message, botName: 'Mira' }` | After 30 s in the queue. |
| `sprint:matched` | `{ duelId, opponent: { userId, displayName, rating, kind }, host, startingCash: '100000.00', instruments: [{ id, symbol, name }], countdownEndsAtMs, serverNowMs }` | Opponent kind is `HUMAN` or `BOT`. |
| `sprint:countdown` | `{ duelId, countdownEndsAtMs, serverNowMs, host }` | 3 s. |
| `sprint:started` | `{ duelId, instruments: [{ id, symbol, name, price }], cash, portfolio, startedAtMs, endsAtMs, serverNowMs }` | Per player — own cash + portfolio only. |
| `sprint:tick` | `{ duelId, serverNowMs, endsAtMs, prices: [{ instrumentId, symbol, price }], equities: { [userId]: { userId, equity } } }` | Prices + both TOTAL equities. Never holdings or orders. |
| `sprint:order-accepted` | `{ duelId, order, portfolio }` | To the ordering player only. |
| `sprint:opponent-disconnected` | `{ duelId, userId, graceSeconds: 15 }` | 15 s to reconnect. |
| `sprint:opponent-reconnected` | `{ duelId, userId }` | |
| `sprint:rematch-requested` | `{ duelId, fromUserId }` | To the opponent only. |
| `sprint:finished` | `{ ...SprintResultResponse, host, forfeitedBy }` | The stored result, never recomputed. |
| `sprint:error` | `{ code, message }` | |

## 4. REST endpoints (`/api/v1/sprint`)

All authenticated (`JwtAuthGuard`), all carry the educational
disclaimer in their OpenAPI docs. Live trading happens over the
socket, not over REST — these endpoints exist for page loads,
reconnect/resume, and clients without a socket.

| Endpoint | Behaviour |
| --- | --- |
| `GET /sprint/active` | My active sprint, if any (phase, start/end, my equity, opponent equity). `null` when none. |
| `GET /sprint/queue/status` | My queue status (waited time, Trading Rating window, bot offer). |
| `GET /sprint/history?page&limit` | My finished sprints, newest first (result, final equity, return, risk-adjusted score, opponent, Trading Rating change). |
| `GET /sprint/:id/state` | One sprint's state summary — mine only (404 otherwise). My portfolio + both equities; never the opponent's holdings. |
| `POST /sprint/:id/forfeit` | Forfeit my sprint (leaving counts as a loss). |
| `GET /sprint/:id/result` | One sprint's stored result — mine only (403 otherwise). |

## 5. Market fairness (same prices for both)

Fairness is structural, not policed after the fact:

- **One market.** Both players trade the same 6 instruments from
  the same snapshot (taken at match time from
  `listActiveInstruments`), with the same starting cash
  (`SIMULATOR_STARTING_CASH`, ₹100,000).
- **One price.** Orders are priced by the Phase 2 `PriceEngine` at
  the current wall-clock minute. Both players share the window, so
  both see the same price for the same instrument at the same time.
  There is no per-player price, no spread, no slippage, no
  order book — immediate fills at the engine price.
- **One clock.** The server owns the 15-minute timer; both players'
  windows start and end on the same server timestamps.
- **One rulebook.** The bot executes through the same
  `executeOrder` path as humans (§7).

What is NOT shared: holdings, orders, cash, and the equity curve
are per player, and the opponent only ever sees the other player's
TOTAL equity (§3).

## 6. Risk-adjusted scoring, with worked examples

From the minute-sampled equity curve (start cash + one sample per
minute + the final sample at settlement). Full derivation, including
why not Sharpe-style, is in ADR 0011 §4; the formula:

```
R = returnPct          = (finalEquity − startCash) / startCash × 100
V = realisedVolPct     = stdev(per-minute simple returns, %) × √(n)
D = maxDrawdownPct     = largest peak-to-trough fall of the curve, %

score = R / (1 + V + D)   when R ≥ 0
score = R × (1 + V + D)   when R < 0
```

Clamped to ±100. Winner: higher score; scores within 0.001 tie on
score and the higher return wins; equal on both is a draw.

Worked examples (pinned in `sprint-scoring.spec.ts`):

| Player | R | V | D | Score | Verdict |
| --- | --- | --- | --- | --- | --- |
| Steady | +2.0% | 1.0 | 0.5 | 2.0 / 2.5 = **0.80** | **Wins** |
| Wild | +3.0% | 4.0 | 2.0 | 3.0 / 7.0 ≈ **0.43** | Loses — the higher return does not win |
| Risky loser | −2.0% | 1.0 | 1.0 | −2.0 × 3.0 = **−6.00** | Loses by more than the calm loser |
| Calm loser | −2.0% | 0 | 0 | **−2.00** | Loses by exactly the return |
| No trades | 0% | 0 | 0 | **0** | Draw vs another no-trade sprint |

Per-instrument summary (`summariseTrades`): realised P&L replays
the trade log against a running weighted-average cost; a sell
realises (sell price − average cost) × quantity. Buys update the
average; sells never change it.

## 7. The Mira bot — strategy, in full

Mira trades by rules, not by randomness (`sprint-bot.ts`,
deterministic per seed — same input, same orders, proven in unit
tests):

1. **Momentum buy.** 5-minute momentum (price now vs 5 minutes ago)
   above a threshold → BUY, spending a share of cash.
2. **Take profit.** A position up 1% vs its average cost → sell half.
3. **Stop loss.** A position down 1% vs its average cost → sell all.
4. **Trim.** Momentum below −threshold while holding → sell half.
5. **One order per instrument per minute** (the rules are an
   if/else chain — even when two fire, exactly one order is placed).
6. **Caps.** Max 12 trades per sprint; max 30% of portfolio value
   in one instrument (a guard — see ADR 0011 §8.3, it never binds
   for a first buy at the current size shares).

Skill bands by the player's Trading Rating (`SPRINT_BOT_BANDS`):

| Player Trading Rating | Momentum threshold | Buy size (share of cash) |
| --- | --- | --- |
| < 1100 | 0.40% | 15% |
| 1100–1299 | 0.35% | 18% |
| 1300–1499 | 0.30% | 20% |
| 1500–1699 | 0.25% | 22% |
| 1700+ | 0.20% | 25% |

A stronger player faces a sharper bot. The bot's summary is stored
on the Duel row (`botScore` = risk score ×1000, `botCorrect` = bot
trade count); its trades are not persisted as rows (reproducible
from the seed + this strategy).

## 8. Matchmaking

One queue (`sprint:queue`, Redis sorted set by Trading Rating),
separate from every learning-duel queue — a sprint waiter is never
matched into a quiz duel (proven in e2e: a sprint waiter and a live
waiter sit in their queues for 6+ seconds and neither is matched).

- Windows on the Trading Rating: ±50 (0–5 s) → ±100 (5–15 s) →
  ±200 (15–30 s) → ±400 (30+ s).
- The 5-second sweep pairs waiters whose windows overlap; earliest
  joiner first, nearest Rating wins; a stale member (entry row lost)
  is skipped.
- Bot offer after 30 s. Accepting creates the bot sprint directly.
- Rematch: 5-minute cooldown per pair, enforced at the offer; both
  players must ask; the second ask creates the new sprint. No
  rematch for bot sprints.
- One live duel at a time: sprint enqueue is blocked while a live
  quiz duel is active. The reverse direction is a known limit
  (ADR 0011 §8.5).

## 9. Timers, disconnect, forfeit

- **Countdown:** 3 s (`LIVE_COUNTDOWN_MS`, shared with the live
  duels). No trading during the countdown.
- **Sprint:** 15 minutes (`SPRINT_DURATION_MS`, default 900,000).
  The end timer settles the sprint even if a player is idle.
- **Ticks:** 30 s (`SPRINT_TICK_MS`, default 30,000). Equity is
  sampled per minute, not per tick.
- **Disconnect:** 15 s grace (`LIVE_DISCONNECT_GRACE_MS`, shared).
  The opponent sees a "reconnecting…" notice; trading continues for
  the other player — the market does not pause. Reconnect clears
  the grace, re-arms the timers from the Redis state, and resends
  the current sprint state.
- **Forfeit:** leaving voluntarily, or a disconnect past the grace,
  settles immediately — the leaver loses, the opponent wins. The
  forfeit is decided on the forfeit, not on the score.
- **Crash:** Redis state lost mid-sprint voids the sprint (503, no
  Rating change) rather than inventing a result.

## 10. Trading Rating integration

New `RatingsService.recordTradingDuel` + `recordTradingDuelVsBot`
(kind TRADING, source DUEL). Same ELO formula and K-factor table as
learning duels (`Ra' = Ra + K×(Sa − Ea)`; provisional K=40 for the
first 10 events), same caps (same pair max 3 rated duels/day, max
10 rated events/user/day, 5-minute rematch cooldown) — but the
pair/day counters are TRADING-only, so learning duels never consume
sprint caps and sprint duels never consume learning caps (proven in
unit tests: 3 seeded LEARNING duels do not block a trading duel).

- A bot sprint is rated at the player's own Trading Rating
  (expected score 0.5) — the player queued for a rated sprint.
- The weekly `recordTradingWeek` path (doc 04 §5) is untouched.
- The stored reason is "on risk-adjusted return"
  (`sprintRatingReasonFor`).
- This supersedes doc 04 §5's "weekly seasons only" and §9's "no
  live head-to-head trading duels" — both were scoped to the Phase 3
  v1 design. Doc 04 §9's line is now out of date; the Trading Rating
  section should be read with this doc.
- Settlement ordering and crash recovery follow ADR 0006/7 (§2.2):
  Rating first, then one transaction; duplicate Rating events are
  recovered from history (`getDuelOutcome`, kind TRADING); any
  other Rating failure settles without a Rating change.
- XP: win 20 / draw 5 / loss 0, reason `duel.sprint_completed`.
  No XP per trade.

## 11. Load balancing and scaling (docs/05 §3.4 — the honest version)

Single-server is the tested config. The Redis adapter
(`live-redis.adapter.ts`, shared with `/duels-live`) and sticky
sessions are implemented for multi-server fan-out, but multi-server
end-to-end is not tested and a process crash mid-sprint voids the
sprint. Data-scaling principles (doc 11) apply unchanged: do not
shard now; the sprint tables are small, indexed, and append-mostly
(`SprintTrade` grows at most 120 rows per player per sprint).

## 12. Web UI (`apps/web/app/duels/sprint/`)

Stages: idle → queued → countdown → trading → done. Reuses the
simulator UI patterns (portfolio card, holdings table with
unrealised P&L) and the live-duel page patterns (buffered socket,
display-only client timer, host lines, rematch).

- **Idle:** "Find an opponent" + the player's recent sprints (last
  5, from `/sprint/history`).
- **Queued:** wait time, Rating window, bot offer after 30 s
  ("Play Mira instead").
- **Countdown:** 3-2-1, opponent + Trading Rating.
- **Trading:** countdown clock + progress bar; your equity vs
  opponent equity (totals only); virtual cash; order form
  (instrument select with live prices, BUY/SELL, units); holdings
  table (qty, avg cost, price, value, P&L); risk panel (return %
  so far + the note that the score is calculated at the end from
  the full equity curve); "Leave sprint (counts as a loss)".
- **Done:** Tara's result line, the stored result
  (`sprint-result.tsx`: risk-adjusted score, return, realised
  volatility, max drawdown, per-instrument realised P&L, Rating
  reason, XP), rematch + "Back to duels".
- **Resume:** on load, the page reads `/sprint/active` and
  `/sprint/:id/state` and reconnects to an in-progress sprint.
- Every trading screen carries the educational disclaimer
  (blueprint §16): "Educational purpose only — this is not
  investment advice. All tickers are fictional and all money is
  virtual." The hub carries a Sprint card (`/duels`).

## 13. Anti-cheat and fairness (docs/05 §5)

- The server prices every order; the client never sends a price.
- The opponent's holdings and orders are never sent to the client
  (ticks carry totals only; the state endpoint returns only the
  caller's portfolio).
- Order idempotency is enforced twice: the engine replays a retried
  `clientOrderId`, and the DB unique constraint
  (duelId, userId, clientOrderId) rejects a duplicate row.
- Rating caps (pair/day, rematch cooldown) and the idempotency key
  `duel:{duelId}` prevent double-rating.
- No XP per trade, so a rated duel cannot be farmed trade by trade.
- The deterministic price engine is public in the repo (Phase 2) —
  a player could in principle predict the next minute's prices from
  the formula. That is a known property of a deterministic simulator,
  not a sprint-specific hole: both players share the same prices, so
  prediction helps both equally, and the risk-adjusted score punishes
  the all-in bets prediction would invite.

## 14. Testing

- **Unit: 476/476 (37 suites)** — 79 new in this phase: scoring
  (17), bot (11), state (6), matchmaking (7), engine (13), gateway
  (12), ratings (13). The engine spec uses in-memory fakes with the
  real ELO math; the ratings spec proves the TRADING-only caps and
  the learning-isolation rule.
- **E2E: 123/123** — 7 new: happy path (queue → match → trade →
  timer settle → mirrored Rating deltas + gamesPlayed 1 + stored
  result + history), queue separation, REST (queue status, active,
  state, another player's result is 403), forfeit (−20/+20 Trading
  Rating, 0/20 XP), order validation, bot duel (30 s offer → Mira
  → trade → rated settle), unauthenticated socket disconnect.
  TEST_ENV shrinks the sprint to 20 s (`SPRINT_DURATION_MS`) and
  the tick to 5 s (`SPRINT_TICK_MS`).
- **Gates:** API typecheck, lint, format, web typecheck, web lint,
  `prisma validate` — all clean. The gates caught two real bugs:
  a missing `DuelType` import in the engine's `rematch`, and a
  stale shared `dist/` (rebuild `packages/shared` after adding
  constants — see ADR 0011 §10).

## 15. Manual QA checklist

1. Two browsers, two accounts: queue both → matched within a few
   seconds, Tara's intro line, 3-2-1 countdown, trading opens.
2. A buys 10 NVLT: cash falls, holding appears, order ack shows the
   order + portfolio. B's screen shows only A's total equity moving
   on the next tick — never A's holding.
3. Wait 15 minutes (or shorten `SPRINT_DURATION_MS` locally): both
   `sprint:finished` payloads arrive, results mirror, Trading
   Ratings move once each, history lists the sprint.
4. Queue alone for 30+ seconds: the Mira bot offer appears; accept
   → bot sprint; Mira trades (her trade count is on the Duel row).
5. Disconnect one player mid-sprint: the other sees
   "reconnecting…"; reconnect within 15 s resumes; after 15 s the
   disconnector forfeits.
6. Leave mid-sprint: the leaver loses, the opponent wins +20.
7. Rematch right after a sprint: "Rematch opens in …s" (5-minute
   cooldown); both ask after 5 minutes → new sprint.
8. Mobile (360 px): the order form, holdings table, and dialogs fit
   without overflow; buttons are tappable.
9. Reload mid-sprint: the page resumes the active sprint (state +
   portfolio reload, socket reconnects).

## 16. Limits / not verified

- Migration not applied to a live Postgres; Docker not booted on
  the VM; seed never executed against a live DB.
- Single-server is the tested config (multi-server sticky LB +
  Redis adapter implemented but not tested end to end).
- No live sprints or matchmaking yet against real users.
- Bot trades are not persisted as rows (reproducible from seed +
  strategy, §7).
- One-live-duel-at-a-time is one-directional (ADR 0011 §8.5).
- A no-trade timed settle in tests is usually a draw (prices barely
  move in 20 s) — the nonzero Trading Rating change is proven by
  the forfeit test, not by a timed settle.
