# ADR 0011 — Phase 9 Paper Trading Sprint (T1)

**Date:** 2026-11-12
**Status:** Accepted (built and verified; see §11)
**Context:** docs/05-duels-system-design.md §1/§7 (build order Step 7),
docs/04-ratings-and-deployment.md (Ratings, not ELO; Trading Rating),
docs/08 (trading duels use actions, not question formats — §3.7; Tara
§2.2), docs/07 + ADR 0006 (the settlement pattern), docs/09 + ADR 0007
(the Phase 5 live engine patterns this phase borrows), docs/12 + ADR
0009 and docs/13 + ADR 0010 (the variant pattern), ADR 0003 (the Phase
2 simulator: virtual ₹100,000, 6 fictional tickers, deterministic
minute-bucketed price engine). The live Speed Quiz Duel (Phase 5), Myth
vs Fact Blitz (Phase 6), Case Duel (Phase 7), and Chart Detective
(Phase 8) are built; no trading duel existed before this phase.

## 1. What was built

A live, rated, head-to-head Paper Trading Sprint (T1) on a **separate
trading engine** — not on the Phase 5 question engine:

- Backend: `src/modules/trading-sprint/` — `sprint-engine.service.ts`
  (server-authoritative 15-minute timer, order execution, bot, settlement),
  `sprint-matchmaking.service.ts` (own Redis queue, Trading Rating),
  `sprint.gateway.ts` (Socket.IO namespace `/sprint`, transport only),
  `sprint.controller.ts` (REST: active / queue status / state / forfeit /
  result / history), `sprint.service.ts` (stored-result views + history),
  `sprint.repository.ts` (the only Prisma touchpoint), `sprint-scoring.ts`
  (risk-adjusted scoring, pure), `sprint-bot.ts` (Mira's rules-based
  strategy, pure), `sprint-state.ts` (Redis state, keys, windows).
- Prisma: `DuelType.SPRINT`, new tables `SprintTrade` +
  `SprintDuelResult`, migration `0011_phase9_paper_trading_sprint`
  (hand-reviewed, via `prisma migrate diff`, §9). The `Duel` /
  `DuelGameResult` rows are reused where they fit; trading duels need
  their own trade + result rows (§9).
- Shared: `DUELS.SPRINT_*` tunables (§2/§3) + `SPRINT_BOT_BANDS`, error
  codes `SPRINT_ALREADY_QUEUED`, `SPRINT_NOT_IN_QUEUE`,
  `SPRINT_NOT_ACTIVE`, `SPRINT_ALREADY_ACTIVE`.
- Ratings: `RatingsService.recordTradingDuel` +
  `recordTradingDuelVsBot` (kind TRADING, same ELO formula/K/caps as
  learning duels, §6), repository methods `countPairTradingDuelsSince`
  / `lastPairTradingDuel` (TRADING-only), `getDuelOutcome` gains an
  optional `kind` parameter (TRADING crash recovery).
- Gamification: `grantDuelRewards` reason union gains
  `duel.sprint_completed` (XP win 20 / draw 5 / loss 0 — no XP per
  trade, §6).
- Config: `SPRINT_DURATION_MS` (default 900,000), `SPRINT_TICK_MS`
  (default 30,000).
- Web: `apps/web/app/duels/sprint/page.tsx` (queue, countdown, trading
  with portfolio card / order form / holdings table / risk panel / live
  equities, result + rematch) + `sprint-result.tsx` + a Sprint card on
  the duels hub (`apps/web/app/duels/page.tsx`) + Sprint types in
  `apps/web/lib/api.ts`.
- Tests: unit + e2e (see §11). Docs: `docs/14-phase-9-paper-trading-sprint.md`
  (architecture, market fairness, risk-adjusted scoring with worked
  examples, bot strategy, matchmaking, timers/disconnect, Trading
  Rating integration, testing, manual QA), this ADR, module README,
  docs/05 + docs/08 status updates.

No Crisis Duel, Weekly Portfolio Battle, league/tournament, Friend
Challenge, bank growth, new question format, or
profiles/settings/community code. Those are later steps — and bank
growth is explicitly deferred per Nishu's decision (complete all duels
first, then grow the bank per duel). A trading duel needs no question
bank: the "bank" for a sprint is the market.

## 2. The duel

**Paper Trading Sprint (T1, live, rated, Trading Rating).** 15 minutes,
both players start with the same virtual ₹100,000 on the same fictional
market — the same 6 instruments (NVLT, KVRF, ASTL, MRUM, SGNR, HELX),
the same minute-bucketed prices from the Phase 2 `PriceEngine`
(wall-clock minute, so both players share the window and see the same
prices), the same starting cash. Actions are BUY / SELL / HOLD (whole
units only, 1–100,000 per order, max 120 orders per player per sprint).
The winner is the best **risk-adjusted return**, not the highest return
(§4). Host is **Tara (Risk Guardian)**: she speaks before the sprint
("15 minutes, same market, same ₹1,00,000. Best risk-adjusted return
wins — not the biggest gain. Good luck.") and after it, never during
the sprint, and never gives trading advice (doc 08 §2.2). In a bot
sprint Mira plays the opponent (§5).

No leverage, no shorting in v1. Both would let a player multiply
return and volatility together and game the risk divisor (§4), and
shorting needs borrow mechanics the sprint does not have. If either is
ever added, it needs its own ADR: the scoring formula, the caps, and
the borrow/liquidation rules all change with it.

## 3. Transport and authority (the live patterns, a different engine)

The Phase 5 patterns carry over, but the engine is different —
trading duels use actions, not question formats (doc 08 §3.7), so
parameterising the question engine would have meant threading
"no questions" through every question-shaped assumption. A clean
second engine was cheaper to reason about than a forked one:

- **Namespace `/sprint`** (own Socket.IO namespace, own Redis
  keyspace `sprint:*` — never `live:*`). One socket per user; a second
  connection replaces the first. JWT auth at the handshake, exactly
  like HTTP (`TokenService.verifyAccessToken`); no anonymous sprints.
- **Server owns the clock.** The 15-minute timer, the 30-second ticks,
  and every order price live on the server. The client timer is display
  only. Orders are priced from the deterministic engine at the current
  minute — the same price for both players.
- **DTO validation on every boundary** (blueprint §8): every REST
  endpoint and every socket payload is validated (class-validator).
  `sprint:join-queue` carries no payload and has no DTO — class-validator
  rejects a class with no validation metadata outright, and a
  metadata-less DTO would validate nothing anyway.
- **Live values, not live orders.** Ticks broadcast prices + both
  players' TOTAL equity only — never holdings or orders. A player's own
  portfolio (cash + holdings) is sent only to that player, at start
  and on each of their own order acks.
- **Timers live on this process (v1, single server).** A reconnect to
  another server re-arms them from the Redis state
  (`handleReconnect` / `rearmTimers`), but a process crash mid-sprint
  voids the sprint rather than inventing a result — see docs/14 §7.
  Multi-server sticky load balancing + the Redis adapter are the
  Phase 5 design (docs/09 §7), shared with this namespace by the
  Socket.IO server, but end-to-end multi-server is not tested (see §8).
- **One live duel at a time.** Sprint enqueue is blocked while a live
  quiz duel is active (`LiveDuelEngine.activeDuelSummary`) — a player
  cannot be in two live duels at once. The reverse direction (joining
  a live quiz queue mid-sprint) is NOT blocked — recorded as a known
  limit in §8.5.

## 4. Scoring — risk-adjusted return

From the minute-sampled equity curve (start cash + one sample per
minute + the final sample at settlement):

```
R = returnPct          = (finalEquity − startCash) / startCash × 100
V = realisedVolPct     = stdev(per-minute simple returns, %) × √(n)
D = maxDrawdownPct     = largest peak-to-trough fall of the curve, %

score = R / (1 + V + D)   when R ≥ 0   (risk divides the gain)
score = R × (1 + V + D)   when R < 0   (risk multiplies the loss)
```

The asymmetry is deliberate: a player who gains 3% by swinging wildly
scores less than a player who gains 2% steadily — and a player who
LOSES 2% by swinging wildly scores worse than one who loses 2%
calmly. Risk can never turn a loss into a smaller loss, and it can
never turn a wild gain into a bigger score. The score is clamped to
±100 (`SPRINT_SCORE_CLAMP`). Worked examples (pinned in unit tests):

- R=+2.0, V=1.0, D=0.5 → 2.0 / 2.5 = **0.8**
- R=+3.0, V=4.0, D=2.0 → 3.0 / 7.0 ≈ **0.4286** — the wild winner
  loses to the steady one
- R=−2.0, V=1.0, D=1.0 → −2.0 × 3.0 = **−6.0** — the risky loser
  scores worse than the calm loser (−2.0)
- R=0 → **0**, whatever V and D are (a no-trade sprint is a draw)

Winner: higher score; scores within 0.001 (`SPRINT_SCORE_TIE_EPSILON`)
tie on score and the higher return wins; equal on both is a draw.
No-trade vs no-trade is a draw (0 vs 0).

Why not Sharpe-style (R / V)? Two reasons. First, a Sharpe ratio
explodes when V → 0 (a player who never trades would score infinity
if they gained a rupee on a price drift) — the "+1" in the divisor
keeps a no-trade sprint at exactly 0. Second, max drawdown is what a
beginner actually feels ("how far did I fall?"), so it belongs in the
number, not just in the risk panel.

## 5. Matchmaking and the Mira bot

**Matchmaking** — one queue, `sprint:queue`, a Redis sorted set keyed
by Trading Rating. The same windows as the live duels, on the Trading
Rating instead of the Learning Rating: ±50 (0–5 s) → ±100 (5–15 s) →
±200 (15–30 s) → ±400 (30+ s). A 5-second sweep pairs waiters whose
windows overlap (earliest joiner first, nearest Rating wins); a stale
queue member (entry row lost) is skipped, never matched. A sprint
waiter is never matched into a learning duel — the queue key is
`sprint:queue` and the sweep only ever pairs sprint waiters (proven
in e2e). Bot offer after 30 seconds in the queue. Rematch: 5-minute
cooldown per pair (docs/04 §5), enforced at the offer, not at
settlement — both players must ask; the second ask creates the new
sprint directly (no re-queue). No rematch for bot sprints.

**The Mira bot** (`sprint-bot.ts`) trades by rules, not by randomness,
on the same market and the same timer as a human, through the same
`executeOrder` path. Deterministic per seed (mulberry32 + FNV-1a,
the same pattern as `duels/bot-simulation.ts`, deliberately duplicated
rather than imported — the two bots answer different questions):

- 5-minute momentum above a threshold → BUY (size = a share of cash)
- Position +1% vs average cost → sell half (take profit)
- Position −1% vs average cost → sell all (stop loss)
- Momentum below −threshold while holding → sell half (trim)
- One order per instrument per minute; max 12 trades per sprint;
  max 30% of portfolio value in one instrument

Skill bands by the player's Trading Rating (`SPRINT_BOT_BANDS`):
threshold 0.40% → 0.20% and size 15% → 25% of cash across the bands
<1100 / 1100–1299 / 1300–1499 / 1500–1699 / 1700+. A stronger player
faces a sharper bot. Bot trades are NOT persisted as `SprintTrade`
rows (no user account — reproducible from the seed + the documented
strategy); the bot's summary is stored on the Duel row (`botScore` =
risk score ×1000, `botCorrect` = bot trade count) and in the human's
`SprintDuelResult` opponent fields.

## 6. Settlement (Trading Rating once, then everything else, once)

Ordering follows ADR 0006/7: the Trading Rating call runs FIRST, then
the Duel row + SprintTrade rows + both SprintDuelResult rows + both XP
grants commit in one transaction. The idempotency key is
`duel:{duelId}`; a re-settle replays the stored result, never
re-applies (proven in unit + e2e).

- **Trading Rating** — new `RatingsService.recordTradingDuel` +
  `recordTradingDuelVsBot` (kind TRADING, source DUEL, same ELO
  formula / K-factor / caps as learning duels: provisional K=40, same
  pair max 3 rated duels/day, max 10 rated events/user/day, 5-minute
  rematch cooldown). The pair/day counters are TRADING-only
  (`countPairTradingDuelsSince` / `lastPairTradingDuel`), so learning
  duels never consume sprint caps and sprint duels never consume
  learning caps. A bot sprint is rated at the player's own Trading
  Rating (expected score 0.5) via `recordTradingDuelVsBot` — the
  player queued for a rated sprint, and silently switching them to
  unrated practice would change the stakes after a 30-second wait.
  This supersedes doc 04 §5's "weekly seasons only" for Trading
  Rating, which was scoped to the Phase 3 v1 design, and doc 04 §9's
  "no live head-to-head trading duels", which was scoped to Phase 3
  v1. The weekly `recordTradingWeek` path is untouched. The reason
  string is "on risk-adjusted return" (`sprintRatingReasonFor`).
- **Crash recovery** — if the Rating call fails with
  `RATING_EVENT_DUPLICATE` (a crash between the Rating step and the
  transaction), the settlement re-reads the deltas from history
  (`getDuelOutcome`, kind TRADING) instead of applying them twice.
  Any other Rating failure settles without a Rating change (ADR 0007
  §8.2 carries over): result + XP are stored, the reason says so in
  plain words. Losing a played sprint's result would be worse than a
  missed Rating update.
- **XP** — win 20 / draw 5 / loss 0, reason `duel.sprint_completed`,
  ledger key `duel:{duelId}:{userId}`. No XP per trade — XP only at
  settle, so a rated duel cannot be farmed trade by trade.
- **Forfeit** — leaving mid-sprint, or a disconnect past the 15-second
  grace, settles immediately: the leaver loses, the opponent wins
  (forfeit is decided on the forfeit, not on the score — the market
  does not get to vote after a player leaves).

## 7. Load balancing (docs/05 §3.4 — the honest version, unchanged)

Single-server is the tested config. The Redis adapter
(`live-redis.adapter.ts`, shared with `/duels-live`) and sticky
sessions are implemented for multi-server fan-out, but multi-server
end-to-end is not tested and a process crash mid-sprint voids the
sprint (state lost in Redis → 503, no Rating change). See docs/14 §7.

## 8. Deviations and known limits (recorded, not hidden)

1. **A second engine, not a variant.** Deliberate (§3): trading duels
   use actions, not question formats. The cost is a second engine to
   maintain; the benefit is that neither engine carries the other's
   assumptions.
2. **Bot trades are not persisted** (§5). Reproducible from seed +
   strategy, but a future audit of "what did Mira do, trade by trade"
   would need to replay the sprint, not read rows.
3. **The 30% single-instrument cap never binds for a first buy** —
   the bot's size share (15–25% of cash) is always below 30% of
   portfolio value. It is a guard for future size-share changes, not
   an active constraint. Documented here so nobody "fixes" it by
   removing it.
4. **Equity is sampled per minute; ticks are 30 seconds.** A tick
   inside a minute broadcasts without sampling — the curve has one
   point per minute, never more.
5. **One-live-duel-at-a-time is one-directional.** Sprint enqueue is
   blocked while a live quiz duel is active, but joining a live quiz
   queue mid-sprint is not blocked. A player who does both ends up in
   two live duels; the quiz engine and the sprint engine do not know
   about each other. Fixing it means a shared "active live duel"
   check in the live matchmaking service — a later phase.
6. **Single-server tested config; migration not applied to a live
   Postgres; Docker not booted; seed not run against a live DB**
   (see §11).
7. **No live Trading Rating change is provable from a no-trade
   timed settle in e2e** — minute-bucketed prices barely move in a
   20-second test sprint, so a no-trade settle is usually a draw
   (delta 0). The nonzero Trading Rating change is proven by the
   forfeit test (±20) and by the traded-sprint unit test (mirrored
   ±20 deltas).

## 9. Migration 0011 (hand-reviewed)

`apps/api/prisma/migrations/0011_phase9_paper_trading_sprint/migration.sql`,
authored via `prisma migrate diff` (schema-before reconstructed at
`/tmp/schema-before.prisma`, no live DB) and hand-reviewed;
`prisma validate` passes; the Prisma client was regenerated
(`SprintTrade` present, `SPRINT` in the generated client).
**Not applied to a live Postgres.**

- `DuelType.SPRINT` added to the `DuelType` enum.
- `SprintTrade`: id, duelId, userId, instrumentId, side, quantity
  `Decimal(18,6)`, price/totalValue `Decimal(18,2)`, clientOrderId,
  executedAt; unique (duelId, userId, clientOrderId) — the idempotency
  key, enforced at the DB level as well as in the engine; index
  (duelId, userId).
- `SprintDuelResult`: duelId, userId, result, finalEquity,
  returnPct, realisedVolPct, maxDrawdownPct, riskAdjustedScore,
  tradeCount, perInstrument Json, equityCurve Json, opponentRiskScore,
  opponentEquity (nullable), opponentTradeCount, ratingBefore/After/
  Delta (nullable — null when the Rating could not be updated, §6),
  ratingReason, xpAwarded, xpBreakdown; unique (duelId, userId);
  index (userId, createdAt).
- No new tables beyond these two. The Duel row is reused (type SPRINT,
  questionIds = [], seed = market seed). No new index is needed for
  SPRINT lookups — the Phase 5 index covers them. No `SprintDuel` 1:1
  model: the seed lives on the Duel row and the instruments are the
  global active list snapshotted into Redis state.

## 10. Additive core touchpoints (blueprint §2.4)

- `packages/shared`: `DUELS.SPRINT_*` + `SPRINT_BOT_BANDS`
  (constants), 4 sprint error codes (error-codes), mapped to 409s in
  `error-status-map.ts` + helpers in `app-error.ts`. **The shared
  `dist/` was stale (pre-Phase 9 constants) and had to be rebuilt
  (`npm run build` in `packages/shared`) — the unit suite failed
  with NaN scores until it was. If a future phase adds shared
  constants, rebuild `dist/` before running tests.**
- `apps/api`: `config/configuration.ts` + `.env.example`
  (`SPRINT_DURATION_MS`, `SPRINT_TICK_MS`); `simulator.module.ts`
  now exports `SimulatorService` + `SimulatorRepository` (the sprint
  engine needs the repository for instrument reads);
  `gamification.service.ts` reason union gains
  `duel.sprint_completed`; `app.module.ts` registers
  `TradingSprintModule`.
- `apps/web`: Sprint types in `lib/api.ts`; sprint page + result
  component + hub card. No changes to the simulator pages.
- Ratings module: two new methods + two new repository methods +
  optional `kind` on `getDuelOutcome` (§6). No change to the weekly
  trading-season path.

## 11. Verification

Independently re-ran the suites on the final tree (not just the new
files):

- **Unit: 476/476 pass (37 suites)** — baseline before Phase 9 was
  397/397 (31 suites). New: sprint scoring (17: worked examples,
  volatility/drawdown from synthetic curves, tie-breaks, clamp,
  `summariseTrades`), sprint bot (11: determinism, momentum buy,
  stop-loss/take-profit/trim, caps, bands), sprint state (6),
  sprint matchmaking (7: windows, bot offer, nearest opponent,
  sweep, stale members, queue separation by key), sprint engine
  (13: create/start/order/replay/validation/tick/settle/draw/traded
  win/mirrored deltas/forfeit/disconnect grace/bot settle/rematch
  cooldown + match), sprint gateway (12: auth, queue, bot offer
  timing, order validation, leave, rematch, sweep), ratings
  (13 new: `recordTradingDuel` win/mirror/caps/cooldown/duplicate/
  learning-isolation/daily limit/crash recovery +
  `recordTradingDuelVsBot` win/draw/loss/duplicate/daily limit).
- **E2E: 123/123 pass** — baseline before Phase 9 was 116/116.
  7 new sprint tests: happy path (queue → match → trade → timer
  settle → mirrored Rating deltas + gamesPlayed 1 + stored result +
  history), queue separation (sprint waiter never matches a live
  waiter), REST (queue status, active sprint, state, another
  player's result is 403), forfeit (−20/+20 Trading Rating, 0/20
  XP), order validation (bad quantity, unknown instrument, no
  holdings), bot duel (30 s offer → Mira → trade → rated settle),
  unauthenticated socket disconnect. TEST_ENV shrinks the sprint to
  20 s and the tick to 5 s.
- **API typecheck, lint (`eslint src test --max-warnings=0`),
  format (`prettier --check`), web typecheck, web lint, and
  `prisma validate` all pass.** Two real bugs were found and fixed
  by the gates, not by review: `DuelType` was referenced in the
  engine's `rematch` but never imported (unit test failure), and the
  shared `dist/` was stale (unit failures with NaN scores). A third
  was found by the gateway spec: class-validator rejects a
  metadata-less DTO, so join-queue carries no DTO (§3).
- **Limits:** migration not applied to a live Postgres, Docker not
  booted on the VM, seed never executed against a live DB,
  single-server is the tested config (multi-server sticky LB + Redis
  adapter implemented but not tested end to end), no live duels or
  matchmaking yet against real users.

## 12. Consequences

- Trading Rating now moves from live head-to-head sprints as well as
  weekly seasons (doc 04 §5/§9 updated in docs/14; the weekly path
  is unchanged).
- The question-bank launch target (2,000 items) is untouched by this
  phase — a sprint needs no bank. Bank growth stays deferred until
  all duels are complete, per Nishu's order.
- The next duel is Crisis Duel (T2, host Tara) — it reuses the
  trading engine's market, timer, and settlement, with a crisis
  event feed on top. Friend Challenge and Weekly Portfolio Battle +
  leagues/tournaments remain after it.
- The one-directional one-live-duel check (§8.5) should be closed
  when the next live duel type is built, before real users can hold
  two live duels at once.
