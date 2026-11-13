# Trading Sprint module

Paper Trading Sprint (T1, live, rated, Trading Rating) — docs/05-duels-system-design.md §1/§7 Step 7, docs/14-phase-9-paper-trading-sprint.md, ADR 0011. **A different engine from the question-based live duels** — trading duels use actions (BUY/SELL), not question formats (doc 08 §3.7). The Phase 5 patterns carry over (one socket per user, JWT at the handshake, 5 s sweep, windows ±50→±400, bot offer after 30 s, 15 s disconnect grace, 3 s countdown, Ratings-first settlement, idempotency key `duel:{duelId}`); the engine itself is new.

## The duel

15 minutes, both players start with the same virtual ₹100,000 on the same fictional market — the same 6 instruments, the same minute-bucketed prices from the Phase 2 `PriceEngine` (wall-clock minute, so both players share the window and see the same prices). Whole units only, 1–100,000 per order, max 120 orders per player per sprint. No leverage, no shorting in v1 (ADR 0011 §2). Winner by **risk-adjusted return** (§ Scoring), not highest return. Host is Tara (Risk Guardian): speaks before and after only, never during the sprint, never gives trading advice.

## Endpoints (`/api/v1/sprint`)

| Method | Path            | Auth | Notes                                                                                |
| ------ | --------------- | ---- | ------------------------------------------------------------------------------------ |
| GET    | `/active`       | user | My active sprint, if any (phase, start/end, my equity, opponent equity).             |
| GET    | `/queue/status` | user | My queue status (waited time, Trading Rating window, bot offer).                     |
| GET    | `/history`      | user | My finished sprints, newest first.                                                   |
| GET    | `/:id/state`    | user | One sprint's state summary — mine only (404 otherwise). My portfolio, both equities. |
| POST   | `/:id/forfeit`  | user | Forfeit my sprint (leaving counts as a loss).                                        |
| GET    | `/:id/result`   | user | One sprint's stored result — mine only (403 otherwise).                              |

Every endpoint carries the educational disclaimer (blueprint §16). Live trading happens over the Socket.IO namespace `/sprint`, not over REST.

## Socket events (`/sprint`)

Client → server: `sprint:join-queue` (no payload), `sprint:leave-queue`, `sprint:accept-bot` (only after 30 s), `sprint:order` (`{ duelId, instrumentId, side, quantity, clientOrderId }`), `sprint:leave-sprint`, `sprint:rematch`. Server → client: `sprint:queued`, `sprint:queue-left`, `sprint:bot-offer`, `sprint:matched`, `sprint:countdown`, `sprint:started` (per player — own cash + portfolio only), `sprint:tick` (prices + both TOTAL equities, never holdings or orders), `sprint:order-accepted`, `sprint:opponent-disconnected` / `sprint:opponent-reconnected`, `sprint:rematch-requested`, `sprint:finished` (the stored result), `sprint:error`. Every handler acks `{ ok: true, ... }` or `{ ok: false, code, message }`.

## Scoring (risk-adjusted return)

From the minute-sampled equity curve: `R` = return %, `V` = realised volatility % (stdev of per-minute returns × √n), `D` = max drawdown %. `score = R / (1 + V + D)` when R ≥ 0; `score = R × (1 + V + D)` when R < 0. Clamped to ±100. Higher score wins; scores within 0.001 tie on score and the higher return wins; equal on both is a draw. Worked examples in docs/14 §6 and `sprint-scoring.ts` (`riskAdjustedScoreFor`, `computeRiskMetrics`, `decideSprintWinner`, `summariseTrades`).

## Mira (rules-based, deterministic)

`sprint-bot.ts`: 5-minute momentum above a threshold → BUY; position +1% vs avg cost → sell half; −1% → sell all; momentum below −threshold while holding → sell half. One order per instrument per minute; max 12 trades/sprint; max 30% of portfolio value in one instrument. Skill bands by the player's Trading Rating (`SPRINT_BOT_BANDS`): threshold 0.40%→0.20%, size 15%→25% of cash. Same seed ⇒ same orders. Bot trades execute through the same `executeOrder` path as humans but are NOT persisted as `SprintTrade` rows (reproducible from seed + strategy); the bot summary lives on the Duel row (`botScore`, `botCorrect`).

## Matchmaking

One queue (`sprint:queue`, Redis sorted set by Trading Rating), separate from every learning-duel queue. Windows ±50 → ±100 → ±200 → ±400 with wait time. 5-second sweep pairs waiters whose windows overlap (earliest first, nearest Rating wins; stale members skipped). Rematch: 5-minute cooldown per pair, both players must ask; no rematch for bot sprints.

### Friend Challenge (Phase 12, ADR 0014, docs/17)

The challenge module (`modules/friend-challenge/`) starts SPRINT /
CRISIS duels by calling `SprintEngine.createSprint` / `createCrisis`
directly — the queue skipped, pair already chosen. The duel it
creates is a normal sprint/crisis duel: same market, same timers,
same settlement (Trading Rating once, `duel:{duelId}` idempotency).
The sprint/crisis play pages resume it via their `/active`
endpoints.

## Settlement (Trading Rating once, then everything else, once)

Rating first (`RatingsService.recordTradingDuel` / `recordTradingDuelVsBot`, kind TRADING, same ELO formula/K/caps, TRADING-only pair/day counters), then Duel + SprintTrade + SprintDuelResult rows + XP in one transaction. Idempotency key `duel:{duelId}`; a re-settle replays the stored result. Duplicate Rating events are recovered from history (`getDuelOutcome`, kind TRADING); any other Rating failure settles without a Rating change (ADR 0007 §8.2). XP win 20 / draw 5 / loss 0, reason `duel.sprint_completed`; no XP per trade. Forfeit (leave, or disconnect past the 15 s grace) settles immediately: the leaver loses.

## Layout

- `sprint-engine.service.ts` — timer, order execution, bot step, settlement, disconnect/rematch, reads.
- `sprint-matchmaking.service.ts` — queue, status, findOpponent, sweep.
- `sprint.gateway.ts` — transport only (auth, validation, rooms, delegation).
- `sprint.controller.ts` — thin REST.
- `sprint.service.ts` — stored-result views (`getResult`, `listHistory`, `toView`) + the rating-reason strings.
- `sprint.repository.ts` — the only Prisma touchpoint (SPRINT Duel rows, trades, results).
- `sprint-scoring.ts` / `sprint-bot.ts` / `sprint-state.ts` — pure logic / pure strategy / Redis state + keys.
- `dto/sprint.dto.ts` — REST + socket DTOs (class-validator). Note: `sprint:join-queue` has no DTO — class-validator rejects a metadata-less class, and the payload carries no fields.

## The Crisis Duel variant (Phase 10, T2)

The Crisis Duel is a **variant of this engine, not a second engine**
(docs/15, ADR 0012). The variant lives on the Redis state
(`variant: 'SPRINT' | 'CRISIS'`, see `sprint-state.ts`) and picks:
Redis keyspace (`crisis:*` vs `sprint:*`), socket event prefix
(`crisis` vs `sprint`), price path (crash factor, crisis only —
`crisis-crash.ts`), scoring (crisis score, crisis only —
`crisis-scoring.ts`: the loss branch divides instead of multiplying),
bot step (crisis only — `crisis-bot.ts`: Mira sells everything to
cash on the first crash tick and stays in cash). Timer, order
execution, disconnect grace, settlement, rematch, matchmaking
windows, and the bot offer are shared and identical. The crisis
queue/gateway/controller live in `../crisis-duel/` (own Redis queue
`crisis:*`, namespace `/crisis`, REST `/api/v1/crisis`,
`DuelType.CRISIS`, crash fields on `SprintDuelResult`). A future
trading duel (T3) should be a third variant on this parameterisation,
not a third engine — if a third variant needs a behaviour the variant
switch cannot express cleanly, that is the moment to split the
engine, with its own ADR.

## Known limits

- Single-server is the tested config (multi-server sticky LB + Redis adapter implemented but not tested end to end); a process crash mid-sprint voids the sprint.
- One-live-duel-at-a-time is one-directional: sprint enqueue is blocked while a live quiz duel is active, but joining a live quiz queue mid-sprint is not blocked (ADR 0011 §8.5).
- The 30% single-instrument bot cap never binds for a first buy at the current size shares (a guard, not an active constraint).
