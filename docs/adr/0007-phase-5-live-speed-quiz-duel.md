# ADR 0007 — Phase 5 Live Speed Quiz Duel (L1)

**Date:** 2026-11-12
**Status:** Accepted (built and verified; see §12)
**Context:** docs/05-duels-system-design.md §3/§7 (build order Step 3),
docs/04-ratings-and-deployment.md (Ratings, not ELO), docs/08
(predeclared formats + characters), ADR 0006 (the Step 2 settlement
pattern this step reuses). The rated Daily Duel and the Bot Duel are
built (Phase 4); no live duel, no matchmaking, no WebSocket gateway
existed before this phase.

## 1. What was built

A live, rated, head-to-head Speed Quiz Duel (L1) on a NestJS +
Socket.IO gateway, with Redis matchmaking and Redis duel state:

- `src/modules/duels/` (new): `live-duel-state.ts` (pure state +
  matchmaking-window helpers), `live-matchmaking.service.ts` (Redis
  queue), `live-duel-engine.service.ts` (server-authoritative timers,
  grading, reveal, disconnect/forfeit, settlement, rematch),
  `live-duels.gateway.ts` (Socket.IO transport only),
  `live-redis.adapter.ts` (optional multi-server fan-out),
  `dto/live-duels.dto.ts` (socket payload validation), plus 4 new
  unit-test suites.
- Prisma: `DuelType.LIVE` only, migration `0007_phase5_live_speed_quiz`
  (authored via `prisma migrate diff`, hand-reviewed — see §10). No
  new tables: the queue and the live state live in Redis, not Postgres.
- Shared: `DUELS.LIVE_*` tunables (counts, mix, windows, bot offer,
  grace, TTLs) and four new error codes (`DUEL_ALREADY_QUEUED`,
  `DUEL_NOT_IN_QUEUE`, `DUEL_LIVE_NOT_ACTIVE`,
  `DUEL_LIVE_ALREADY_ACTIVE`) with default messages, status-map
  entries (all 409), and `AppError` factories.
- Additive seams elsewhere: Redis primitives the queue/state need
  (`zrangebyscore`, `zscore`, hashes, `setnx`); config timers
  (`LIVE_QUESTION_MS`, `LIVE_COUNTDOWN_MS`,
  `LIVE_DISCONNECT_GRACE_MS`, `LIVE_REVEAL_PAUSE_MS`,
  `WS_REDIS_ADAPTER_ENABLED`); `grantDuelRewards` accepts the new
  reason `'duel.live_completed'`; `DuelsService.ratingReasonFor` is
  exported for the live settlement; `DuelsService` result/history
  views understand a LIVE row (one row, both players on it — not a
  Daily pair). `main.ts` installs the Redis adapter only when
  `WS_REDIS_ADAPTER_ENABLED=true`.
- Web: `apps/web/app/duels/live/page.tsx` (queue, countdown, question,
  reveal, result + rematch) + a Live Duel card on the duels hub.
- Tests: unit + e2e (see §12). Docs: `docs/09-phase-5-live-speed-quiz-duel.md`
  (architecture, full event contract, matchmaking, timers, Rating,
  load balancing, testing, manual QA), this ADR, module README,
  docs/05 + docs/08 status updates.

No Myth vs Fact Blitz, Case Duel, Chart Detective, trading duel,
league, or profiles/settings/community code. Those are later steps.

## 2. The duel

**Speed Quiz Duel (L1, rated, Learning Rating).** 7 questions,
15 seconds each, same set in the same order with the same option
order for both players, live progress (scores, not answers).
Scoring is the one rule from ADR 0006/3 (100 base + up to 50 speed
bonus; more correct wins, then lower total time, else draw). Host is
Mira: she speaks before and after the duel, never during a question
(doc 08 §2.2). Formats are MCQ_4 + TRUE_FALSE only, with their
predeclared UIs (doc 08 §3.1/§3.2, §4) — no new format was added.

## 3. Transport and authority (docs/05 §3.1/§3.2)

- One `LiveDuelsGateway` on namespace `/duels-live`. Auth is the
  access JWT in the handshake (`auth.token`, or an `Authorization:
Bearer` header), verified by `TokenService.verifyAccessToken` —
  exactly like HTTP. No anonymous live duels; a bad/missing token
  disconnects the socket.
- One room per duel (`duel:{duelId}`). The gateway is transport
  only: it authenticates, validates payloads, joins rooms, and
  delegates every rule to the matchmaking service / engine. No
  scoring, timing, or Rating logic lives in the gateway.
- The server owns the clock. The client timer is display only.
  Answers carry NO `timeMs` — the engine grades from
  `server now − question start`. Late, duplicate, out-of-order, or
  wrong-question answers are rejected. Correctness and points are
  never returned before reveal.
- State lives in Redis (`live:duel:{duelId}`, JSON, 900 s TTL;
  `live:user-duel:{userId}` for reconnect lookup). Postgres is the
  source of truth after the duel ends (the Duel row + DuelAnswer
  rows + DuelGameResult rows). If Redis state is lost mid-duel, the
  duel is voided — settlement throws SERVICE_UNAVAILABLE and no
  Rating changes (docs/05 §3.2). A void is always safer than a wrong
  Rating.
- Timers live on the process that created the duel (v1, single
  server). A reconnect to another server re-arms them from the Redis
  state (`handleReconnect` → `rearmTimers`); a process crash
  mid-duel voids the duel rather than inventing a result (§7).

## 4. Matchmaking (docs/05 §3.3)

- Queue: Redis sorted set `live:queue:LIVE`, member = user id,
  score = Learning Rating, plus a per-user entry key
  (`live:queue-entry:{userId}`, JSON: rating + join time, 300 s TTL).
- Windows widen with wait: ±50 (0–5 s) → ±100 (5–15 s) → ±200
  (15–30 s) → ±400 (30+ s). Nearest Rating in the window wins; ties
  break by earliest join. A 5-second sweep pairs waiters whose
  windows overlap, so a long-waiting player is matched even when the
  newcomer's own (narrow) window does not reach them yet.
- After 30 s with no human match, the server emits `live:bot-offer`:
  play Mira instead. The bot duel is RATED via `recordDuelVsBot` at
  the player's own Rating — the same fallback the Daily Duel uses
  (ADR 0006/7) — because the player queued for a rated duel;
  silently switching them to unrated practice after a 30-second wait
  would change the stakes.
- Queue-level rules: one queue entry per user (409
  `DUEL_ALREADY_QUEUED`), no queueing while a live duel is active
  (409 `DUEL_LIVE_ALREADY_ACTIVE`), clean cancel (`live:leave-queue`,
  idempotent). The Ratings caps (same pair max 3/day, max 10 rated
  events/user/day, 5-minute rematch cooldown) still apply at
  settlement (docs/04 §5).

## 5. The live flow (state machine)

```
QUEUED → MATCHED → COUNTDOWN (3 s) → IN_PROGRESS
  → REVEAL (per question) → … → FINISHED → SETTLED (Rating once)
```

- Match: `selectSet` is called ONCE with both user ids and one
  seeded RNG, so the question ids, order, and option order are
  identical for both players; exposure is recorded for both.
- Countdown: 3 s (config `LIVE_COUNTDOWN_MS`). Then question 1.
- Question: 15 s (config `LIVE_QUESTION_MS`). The `live:question`
  payload carries the public view only. Each answer is graded and
  stored as a DuelAnswer row immediately; the room gets `live:score`
  (scores + correct counts, never answers). When both humans have
  answered — or, vs the bot, when the player has answered and Mira's
  simulated time has landed — the question reveals early; otherwise
  the server timer reveals it at the deadline.
- Reveal: `live:reveal` per player — correct option id + text,
  explanation, the player's own correctness/points, and the scores.
  Nothing about the opponent's chosen option is sent. 2 s pause
  (config `LIVE_REVEAL_PAUSE_MS`), then the next question.
- Disconnect: 15 s grace (config `LIVE_DISCONNECT_GRACE_MS`). The
  opponent sees `live:opponent-disconnected` ("reconnecting…"), not
  a forfeit — yet. Reconnect clears the grace, re-joins the room,
  re-arms the timers, and resends the current question/countdown.
  After 15 s the disconnected player forfeits: the duel settles,
  the other player wins, and the Rating still updates. Leaving
  voluntarily (`live:leave-duel`, or REST `POST /duels/live/:id/forfeit`)
  is a forfeit too. Late-join is impossible: only the two players on
  the duel row are ever joined to its room.
- One socket per user: a second connection replaces the first. The
  old socket's disconnect starts the grace; the new socket's
  reconnect clears it (docs/05 §5 — a second login during a rated
  duel ends as a forfeit only if it never reconnects in time).

## 6. Settlement (one Rating update, once)

Ordering follows ADR 0006/7: the Ratings call runs FIRST, then duel
rows + both `DuelGameResult` rows + both XP grants commit in one
duels transaction. Idempotency key `duel:{duelId}`; a re-settle
replays the stored result. A crash between the two steps is
recovered by reading the deltas back from history
(`getDuelOutcome`, `IDEMPOTENCY_REPLAY` / `RATING_EVENT_DUPLICATE`).

XP reuses existing values only (`grantDuelRewards`, reason
`'duel.live_completed'`): win → 20, draw → 5, loss → 0, streak
still counts. Post-game stats reuse `buildGameStats` /
`decideWinner` / `mirrorOutcome` — the same stored-result shape as
Phase 4 (`GET /duels/:id/result` reads it; the `live:finished`
payload is that stored view plus Mira's host line and
`forfeitedBy`).

## 7. Load balancing (docs/05 §3.4 — the honest version)

- Sticky sessions are REQUIRED for the WebSocket upgrade in any
  multi-server deploy (cookie-based affinity, not just IP hash).
- `LiveRedisAdapter` (`@socket.io/redis-adapter` over ioredis
  pub/sub) fans room messages out to players on different servers.
  It is installed in `main.ts` only when
  `WS_REDIS_ADAPTER_ENABLED=true` (default false).
- Single-server v1 works WITHOUT the adapter — the in-process
  Socket.IO server is enough, and that is the tested configuration.
- What the adapter does NOT do: it does not move the engine's
  in-process timers. A duel's timers live on the server that
  created it; a reconnect to another server re-arms them from Redis
  state, but a server crash mid-duel still voids the duel (§3).
  Multi-server live duels without sticky sessions do NOT work, and
  this ADR does not claim otherwise. A future step can move timers
  into Redis (delayed jobs) if crash-resume becomes a requirement.

## 8. Deviations and known limits (recorded, not hidden)

1. **Forfeit Rating uses the normal K, not a smaller K.** Doc 05
   §3.1 says a forfeit updates the Rating "with a smaller K, so a
   dropped connection is not a free win". `RatingsService` has no
   smaller-K path, and inventing one would change the shared rating
   formula for one caller. A forfeit therefore counts as a normal
   loss (full K). The forfeit is still costly — a loss at full K —
   so the "not a free win" property holds in the other direction
   (the winner gains normally, the forfeiter loses normally).
2. **Rating-cap failure at settle time settles without a Rating.**
   The caps are enforced by Ratings at settlement; a duel that hits
   a cap (e.g. the pair's 4th rated duel that day) still settles —
   result + XP are stored, the Rating is left unchanged, and the
   reason says so in plain words. Losing a played duel's result
   would be worse than a missed Rating update. The rematch
   cooldown, by contrast, is enforced at the rematch OFFER (not at
   settlement), so a rematch never wastes a played duel on a
   cooldown failure.
3. **No impossibly-fast-answer flagging yet** (doc 05 §5). The
   server clock makes fake times impossible, but sub-300 ms correct
   answers on hard questions are not flagged — there is still no
   flag store (same as ADR 0006/5).
4. **No scheduler, no leagues, no pilot-data feed** (unchanged from
   ADR 0006/14): live answers do not feed `discrimination` /
   calibration yet.
5. **The 2,000-item launch target is still ahead** (ADR 0006/13):
   the bank holds 520 LIVE items; the rated live duel launches on
   it as the same recorded deviation, with the same exposure rules
   (both players' exclusions apply to the shared set).

## 9. Anti-gaming (enforced server-side, docs/05 §5)

- Answers never leave the server before reveal (public views carry
  option id + text only; the correct option + explanation arrive
  only in `live:reveal` / the stored result).
- Server owns timing/scoring: no client `timeMs` is accepted at
  all in live play; answers must be the current question, first
  answer only (unique `(duelId, userId, questionId)`), in order.
- One account, one socket for a rated duel (second connection
  replaces the first; §5).
- Ratings pair/day caps + rematch cooldown at settlement/offer;
  duplicate settlement is idempotent (stored result replay;
  ledger-keyed XP; `duel:{duelId}`-keyed Rating).

## 10. Migration 0007 (hand-reviewed)

`0007_phase5_live_speed_quiz`, authored via `prisma migrate diff
--from-schema-datamodel <before> --to-schema-datamodel
prisma/schema.prisma --script` (schema-before reconstructed from
the pre-change schema; no live DB) and hand-reviewed:

```sql
ALTER TYPE "DuelType" ADD VALUE 'LIVE';
CREATE INDEX "duels_type_status_createdAt_idx"
  ON "duels"("type", "status", "createdAt");
```

No new tables — queue and live state are Redis-only by design
(docs/05 §3.2/§3.3). Note: `ALTER TYPE … ADD VALUE` cannot run
inside a transaction block; `prisma migrate deploy` handles enum
additions accordingly — do not hand-wrap this file in
BEGIN/COMMIT. The migration was NOT applied to a live Postgres
(none on this machine). `prisma validate` passes with
`DATABASE_URL` set.

## 11. Additive core touchpoints (blueprint §2.4)

The only edits outside `duels/` are additive: the shared
constants/error codes (§1), the four status-map entries + `AppError`
factories, the Redis primitives, the config timers, the
Gamification reason union, the exported `ratingReasonFor`, the
`main.ts` adapter wiring (conditional, off by default), the e2e
fakes (`FakeRedisService` primitives, `FakeDuelsRepository`
live lookups), and the live timer overrides in the e2e `TEST_ENV`.
No existing behaviour was changed.

## 12. Verification

- Unit: **297/297** (29 suites; baseline 261/25, +36 new: 13
  live-duel-state incl. all 8 window boundaries, 7 live-matchmaking
  incl. window widening + sweep, 10 live-duel-engine incl.
  one-set-both-players, server-clock grading, reveal-after-both,
  settle-once, forfeit, reconnect-clears-grace, bot duel, rematch
  cooldown + rematch, 6 live-duels-gateway incl. auth rejection +
  payload validation + sweep matching).
- E2E: **101/101** (baseline 97, +4 new live tests: happy path —
  queue → match → 7 questions → settle + rate once, queue-status
  REST, disconnect forfeit, unauthenticated socket disconnect).
- typecheck / lint / format clean (api + web); `prisma validate`
  clean; web typecheck + lint clean.
- Worked examples verified end to end in e2e: Asha 7/7 correct vs
  Ravi 0/7 → Asha +20 (K=40 provisional, equal ratings), Ravi −20;
  one rated event each (`gamesPlayed` 1); forfeit winner +20 with
  `forfeitedBy` set.
- A test-helper bug found during e2e (the buffered socket client's
  `push` delivered an event to a waiter AND left it buffered, so a
  question was answered twice) was fixed in the helper, not the
  product — the product correctly rejected the duplicate as
  `DUEL_LIVE_NOT_ACTIVE` in REVEAL phase.

## 13. Consequences

- Step 4 (Myth vs Fact Blitz, L2) inherits the live engine, the
  gateway, and the matchmaking queue: it needs only the TRUE_FALSE
  bank depth + a 10-question / 10-second variant of the same flow,
  not a new transport.
- Any future rating-formula change must keep the audit trail honest
  (ADR 0005/14); live settlement writes the same history shape as
  `recordDuel` / `recordDuelVsBot`.
- If crash-resume for live duels becomes a requirement, the timers
  must move out of process memory (e.g. Redis delayed jobs) — see
  §7. Until then, a crash voids the duel and no Rating changes.
- Growing the bank toward 2,000 remains open (§8.5).
