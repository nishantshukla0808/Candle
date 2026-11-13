# Crisis Duel module

Crisis Duel (T2, live, rated, Trading Rating) — docs/05-duels-system-design.md §1/§7 Step 8, docs/15-phase-10-crisis-duel.md, ADR 0012. **A variant of the Paper Trading Sprint, not a second engine** (ADR 0012 §3): a sprint with a seeded crash mid-duel. The engine, repository, result service, and settlement code are shared with the sprint (`../trading-sprint/`), parameterised by the variant on the Redis state. This module owns only what differs: the crisis queue, the `/crisis` namespace gateway, and the `/crisis` REST controller.

## The duel

15 minutes, both players start with the same virtual ₹100,000 on the same fictional market — the same 6 instruments, the same minute-bucketed prices from the Phase 2 `PriceEngine`. A crash hits at a seeded minute (7–10, never disclosed in advance): all 6 instruments fall ~12% over 3 minutes, then recover ~5% (net −7%). Whole units only, 1–100,000 per order, max 120 orders per player per duel. No leverage, no shorting in v1 (ADR 0012 §2). Winner by **crisis risk-adjusted return** (§ Scoring): smallest loss + calmest decisions. Host is Tara (Risk Guardian): speaks before and after only, never during the duel, never gives trading advice.

## Endpoints (`/api/v1/crisis`)

| Method | Path            | Auth | Notes                                                                                                                                                                       |
| ------ | --------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/active`       | user | My active crisis duel, if any (phase, start/end, my equity, opponent equity, `crashFired`).                                                                                 |
| GET    | `/queue/status` | user | My crisis queue status (waited time, Trading Rating window, bot offer).                                                                                                     |
| GET    | `/history`      | user | My finished crisis duels, newest first (type-filtered).                                                                                                                     |
| GET    | `/:id/state`    | user | One crisis duel's state summary — mine only (404 otherwise). My portfolio, both equities. The crash minute is never disclosed; only whether the crash has fired.            |
| POST   | `/:id/forfeit`  | user | Forfeit my crisis duel (leaving counts as a loss).                                                                                                                          |
| GET    | `/:id/result`   | user | One crisis duel's stored result — mine only (403 otherwise). Includes the `crisis` block: `crashMinute`, `crashDrawdownPct`, `tradesDuringCrash`, `panicSold`, `crashLine`. |

Every endpoint carries the educational disclaimer (blueprint §16). Live trading happens over the Socket.IO namespace `/crisis`, not over REST.

## Socket events (`/crisis`)

Client → server: `crisis:join-queue` (no payload), `crisis:leave-queue`, `crisis:accept-bot` (only after 30 s), `crisis:order` (`{ duelId, instrumentId, side, quantity, clientOrderId }`), `crisis:leave-duel`, `crisis:rematch`. Server → client: `crisis:queued`, `crisis:queue-left`, `crisis:bot-offer`, `crisis:matched`, `crisis:countdown`, `crisis:started` (per player — own cash + portfolio only), `crisis:tick` (prices + both TOTAL equities, never holdings or orders; `crashFired` after the crash), `crisis:crash` (once, when the crash hits: `crashMinute`, `dropPct: 12`, `dropMinutes: 3`, `recoveryPct: 5`), `crisis:order-accepted`, `crisis:opponent-disconnected` / `crisis:opponent-reconnected`, `crisis:rematch-requested`, `crisis:finished` (the stored result, with the `crisis` block), `crisis:error`. Every handler acks `{ ok: true, ... }` or `{ ok: false, code, message }`.

## The crash (seeded, never disclosed)

`crashMinute = 7 + (FNV-1a(seed) % 4)` — minute 7–10 of 15, same seed for both players, stored in the Redis state and on the stored result row, never sent to a client before settlement. Crash factor on the base price: 1.00 before; 0.96 / 0.92 / 0.88 across 3 fall minutes (−12% total); then +0.01/minute for 5 minutes to 0.93 (+5% partial recovery); flat 0.93 after (net −7%). The recovery is load-bearing for the scoring: without it, a panic seller and a calm holder would both end at the bottom. A "crisis minute" is `durationMs / 15`, not a wall-clock minute — so the crash fires proportionally in test time (20 s duel → ~1.33 s per crisis minute). The crash check runs on every tick. See `../trading-sprint/crisis-crash.ts` (`deriveCrashMinute`, `crashFactorAt`, `crashWindowMs`, `computePanicSold`).

## Scoring (crisis risk-adjusted return)

From the minute-sampled equity curve: `R` = return %, `V` = realised volatility %, `D` = max drawdown %. `score = R / (1 + V + D)` for R ≥ 0 **and** for R < 0 — the loss branch divides instead of multiplying (the sprint multiplies). The sprint multiplier saturates in a crash (a calm −5% and a panicked −10% both clamp to −100); dividing keeps the score in sprint range and orders players by (return, risk). Clamped to ±100. Higher score wins; scores within 0.001 tie on score and the higher return wins; equal on both is a draw. Worked examples in docs/15 §6 and `../trading-sprint/crisis-scoring.ts` (`crisisScoreFor`, `computeCrisisMetrics`, `decideCrisisWinner`): cash-early +1.2214 beats holder −0.2498; panic seller −0.5185 loses to calm holder −0.2498; half-cash holder −0.2366 beats all-in holder −0.2498. The panic-sell flag is reported, not scored: sold ≥ 50% of the units held at crash start, during the crash window, for any one instrument (replayed from the trade log).

## Mira (crash behaviour, defined)

`../trading-sprint/crisis-bot.ts`: `crashFired=false` → normal sprint rules; `crashFired=true` → sell ALL of every holding to cash and stay in cash for the rest of the duel (no re-buy during the crash or the recovery). Mira is a panic seller by design: she locks the fall and misses the recovery, so a calm human holder beats her. Her orders execute through the same `executeOrder` path as humans but are NOT persisted as `SprintTrade` rows (same as the sprint bot).

## Matchmaking

One queue (`crisis:queue`, Redis sorted set by Trading Rating), separate from every other queue — a crisis waiter is never matched into a sprint or a learning duel. Windows ±50 → ±100 → ±200 → ±400 with wait time. 5-second sweep pairs waiters whose windows overlap (earliest first, nearest Rating wins; stale members skipped). Queue-level rules only: one queue entry per user, no queueing while a crisis duel, a sprint, or a live quiz duel is active.

## Settlement (Trading Rating once, then everything else, once)

Shared with the sprint: Rating first (`RatingsService.recordTradingDuel` / `recordTradingDuelVsBot`, kind TRADING, same ELO formula/K/caps, TRADING-only pair/day counters), then Duel + SprintTrade + SprintDuelResult rows (with `crashMinute`, `crashDrawdownPct`, `tradesDuringCrash`, `panicSold`) + XP in one transaction. Idempotency key `duel:{duelId}`; a re-settle replays the stored result. XP win 20 / draw 5 / loss 0, reason `duel.crisis_completed`; no XP per trade. Forfeit (leave, or disconnect past the 15 s grace) settles immediately: the leaver loses.

## Known limits

- One-live-duel-at-a-time is one-directional, extended (ADR 0012 §10.4): crisis enqueue is blocked while a sprint is active, but sprint enqueue is not blocked while a crisis is active.
- Bot trades are not persisted as rows (same as the sprint bot).
- Single-server tested config; migration 0012 not applied to a live Postgres; Docker not booted; seed not run against a live DB.
