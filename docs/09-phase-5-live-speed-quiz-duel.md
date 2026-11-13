# Candle — Phase 5 Live Speed Quiz Duel (L1)

**Date:** 2026-11-12
**Status:** Built and verified (ADR 0007). The first live duel.
**Depends on:** Blueprint 01, Ratings design 04, Duels design 05,
Phase 4 doc 07, formats/characters doc 08, ADR 0006.

Step 3 of the duels build order (docs/05 §7): the first live duel.
WebSocket gateway, matchmaking, sticky sessions, live timer — on the
same bank (520 LIVE items), scoring, and Rating path that Steps 1–2
proved. Myth vs Fact Blitz (L2) and everything after it reuse this
engine; they do not build a new transport.

---

## 1. What Step 3 is (and is not)

| Duel                 | Type              | Rated?                    | Format                                                |
| -------------------- | ----------------- | ------------------------- | ----------------------------------------------------- |
| Speed Quiz Duel (L1) | Live head-to-head | **Yes** — Learning Rating | 7 questions, 15 sec each, same set, live progress bar |

Not in this step: Myth vs Fact Blitz (L2), Case Duel (L3), Chart
Detective (L4), any trading duel, leagues/tournaments, Friend
Challenge, profiles/settings/community. Those are later steps.

**Formats (doc 08 §4, binding):** Speed Quiz = MCQ_4 + TRUE_FALSE
only, with their predeclared UIs and timers. No new question format
was added, and no other format can appear in a live duel — the
selection blueprint passes `types: ['MCQ_4', 'TRUE_FALSE']` to the
bank, and the web page renders by the question's `type` code only.

**Host:** Mira (doc 08 §2.2). She speaks before the duel ("7
questions, 15 seconds each. Same set for both of you. Good luck.")
and after it (a result line + the Rating change in plain words +
one practise-next suggestion). She never speaks during a question,
and she never reveals an answer while a timer is running.

---

## 2. Technical architecture

### 2.1 Module map

```
apps/api/src/modules/duels/
  live-duel-state.ts        — pure: state types, keys, windowForWait,
                              botOfferDue, parse/scores helpers (no I/O)
  live-matchmaking.service.ts — Redis queue (sorted set + entry keys)
  live-duel-engine.service.ts — match creation, timers, grading,
                              reveal, disconnect/forfeit, settlement,
                              rematch (no Socket.IO import)
  live-duels.gateway.ts     — Socket.IO transport only (auth, payload
                              validation, rooms, delegation)
  live-redis.adapter.ts     — optional Socket.IO Redis adapter
                              (multi-server fan-out; main.ts wiring)
  dto/live-duels.dto.ts     — socket payload validation
  duels.controller.ts       — + 4 live REST endpoints (§4)
  duels.service.ts          — result/history views understand LIVE
  duels.repository.ts       — + findActiveLiveDuelForUser,
                              findLastLiveDuelBetween
  live-*.spec.ts            — unit tests (state, matchmaking,
                              engine, gateway)
  README.md                 — module readme (updated)

Consumed through public service interfaces only (blueprint §4):
  QuestionBankService  — selectSet / recordExposure / getItemsForGrading
  RatingsService       — recordDuel / recordDuelVsBot / getDuelOutcome /
                         getUserRatings
  GamificationService  — grantDuelRewards
  TokenService         — verifyAccessToken (gateway handshake)
  DuelsService         — getResult (stored finished payloads)
```

No core file is edited except the additive touchpoints listed in
ADR 0007 §11 (shared constants/error codes, Redis primitives,
config timers, the Gamification reason, `main.ts` adapter wiring,
e2e fakes). No BaaS, no real tickers/money, fictional only.

### 2.2 State machine (one duel, server is the authority)

```
QUEUED → MATCHED → COUNTDOWN (3 s) → IN_PROGRESS
  → REVEAL (per question) → … → FINISHED → SETTLED (Rating once)
```

- The server owns the timer. The client timer is display only.
- Answers are sent as `{ duelId, questionId, optionId }` — no
  `timeMs` at all. The server grades from its own clock
  (`server now − question start`). Late, duplicate, or out-of-order
  answers are rejected.
- Scoring is computed on the server after each question, then the
  scores (not the answers) are broadcast to both players.
- Disconnect: 15-second grace. Reconnect resumes the same duel.
  After 15 seconds, the disconnected player forfeits, and the other
  player wins by forfeit (Rating still updates — see §7).
- State lives in **Redis** (duel state, scores), not in server
  memory. Postgres is the source of truth after the duel ends. If
  Redis state is lost mid-duel, the duel is voided and no Rating
  changes — a void is always safer than a wrong Rating.

### 2.3 Redis keys (all of them)

| Key                         | Shape                                                | TTL                                                          | Purpose                                                                |
| --------------------------- | ---------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------- |
| `live:queue:LIVE`           | sorted set, member = userId, score = Learning Rating | — (members expire via entry TTL + sweep skips stale members) | Matchmaking queue                                                      |
| `live:queue-entry:{userId}` | JSON `{ userId, rating, joinedAtMs }`                | 300 s                                                        | Who is queued, since when, at what Rating                              |
| `live:duel:{duelId}`        | JSON `LiveDuelState`                                 | 900 s                                                        | The duel: players, scores, questions, phase, deadlines, answers so far |
| `live:user-duel:{userId}`   | duelId                                               | 900 s                                                        | Reconnect lookup: which duel is this user in?                          |
| `live:rematch:{duelId}`     | JSON `[userId, …]`                                   | 300 s                                                        | Who has asked for a rematch on a finished duel                         |

The state never holds correct answers. Answers are graded at
answer time from the bank and stored as `DuelAnswer` rows; the
state holds only whether each player answered, their points, and
their scores — so a leaked state can never reveal an answer before
its reveal.

### 2.4 Request flow

```
join-queue → enqueue (rating from RatingsService) → live:queued
             → sweep pairs waiters → createLiveDuel (one selectSet
               for both, exposure for both, one Duel row)
             → live:matched + live:countdown (both players)
countdown  → startQuestion(0) → live:question (public view only)
answer     → ownership → IN_PROGRESS? → current question? → first
             answer only? → option belongs to question? → in time?
             → grade server-side, store DuelAnswer, live:score
             → both answered? → reveal now, else timer reveals
reveal     → live:reveal (correct option + explanation + my
             correctness/points + scores) → next question / settle
finish     → settleDuel (§7) → live:finished (stored result view)
rematch    → both ask? → new duel, same pair (5-min cooldown
             enforced at the offer)
```

---

## 3. WebSocket event contract

Namespace: `/duels-live` (Socket.IO, WebSocket transport preferred,
polling fallback). Auth: access JWT in the handshake
(`auth: { token }`, or an `Authorization: Bearer <token>` header).
Every handler answers with an ack; asynchronous duel events arrive
as `live:*` broadcasts. All payloads are small JSON. No question
answers are ever emitted to a client before reveal.

### 3.1 Client → server

| Event              | Payload                                          | Ack                                                                                                                             | Notes                                                                                              |
| ------------------ | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `live:join-queue`  | `{}`                                             | `{ ok, queued, waitedMs, ratingWindow }` or `{ ok:false, code, message }`                                                       | Server reads the caller's Learning Rating. 409 `DUEL_ALREADY_QUEUED` / `DUEL_LIVE_ALREADY_ACTIVE`. |
| `live:leave-queue` | —                                                | `{ ok }`                                                                                                                        | Idempotent cancel.                                                                                 |
| `live:accept-bot`  | —                                                | `{ ok, duelId, opponent:'BOT' }` or `{ ok:false, code:'DUEL_NOT_IN_QUEUE', message }`                                           | Only after the 30 s bot offer.                                                                     |
| `live:answer`      | `{ duelId, questionId, optionId }` (all UUID v4) | `{ ok, answeredCount, totalQuestions }` or `{ ok:false, code, message }`                                                        | No `timeMs` — the server clocks it. Correctness is NOT in the ack.                                 |
| `live:leave-duel`  | `{ duelId }`                                     | `{ ok, forfeited:true }`                                                                                                        | Voluntary forfeit (counts as a loss).                                                              |
| `live:rematch`     | `{ duelId }`                                     | `{ ok, matched, newDuelId? }` or `{ ok, matched:false, reason:'REMATCH_COOLDOWN', retryAfterMs }` / `reason:'WAITING_OPPONENT'` | Both players must ask.                                                                             |

Invalid payloads get `{ ok:false, code:'VALIDATION_FAILED', message }`
with per-field details — never a crash, never a silent accept.

### 3.2 Server → client

| Event                        | Payload (example)                                                                                                                                                                                                                      | When                                                                                                                                                    |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `live:queued`                | `{ queued:true, userId, rating:1000, joinedAtMs:…, waitedMs:0, ratingWindow:50, botOfferDue:false, host:{ name:'Mira', line:'Finding you an opponent…' } }`                                                                            | On joining the queue.                                                                                                                                   |
| `live:queue-left`            | `{ userId }`                                                                                                                                                                                                                           | On leaving the queue.                                                                                                                                   |
| `live:bot-offer`             | `{ message:'No opponent at your Rating yet. Play Mira (bot) instead — rated at your own Rating.', botName:'Mira' }`                                                                                                                    | After 30 s in the queue with no match.                                                                                                                  |
| `live:matched`               | `{ duelId, opponent:{ userId, displayName:'Ravi', rating:1000, kind:'HUMAN' }, host:{ name:'Mira', line:'7 questions, 15 seconds each. Same set for both of you. Good luck.' }, questionCount:7, countdownEndsAtMs:…, serverNowMs:… }` | A match is made (opponent `kind:'BOT'`, `userId:'bot:mira'` vs Mira).                                                                                   |
| `live:countdown`             | `{ duelId, countdownEndsAtMs:…, serverNowMs:…, host:{ name:'Mira', line:'Mira is hosting this duel.' } }`                                                                                                                              | Countdown starts (and on reconnect, resent).                                                                                                            |
| `live:question`              | `{ duelId, index:0, total:7, question:{ id, stem, options:[{ id, text, order }], type:'MCQ_4', topic, skill, difficulty }, deadlineMs:…, serverNowMs:…, timeLimitMs:15000 }`                                                           | Each question opens. No `isCorrect`, no explanation.                                                                                                    |
| `live:answer-accepted`       | `{ duelId, questionId, answeredCount:1, totalQuestions:7 }`                                                                                                                                                                            | Your answer was recorded (to you only).                                                                                                                 |
| `live:score`                 | `{ duelId, scores:{ playerA:{ userId, score:136, correct:1 }, playerB:{ userId, score:0, correct:0 } } }`                                                                                                                              | After any answer (both players' scores, not their answers).                                                                                             |
| `live:reveal`                | `{ duelId, index:0, questionId, correctOptionId, correctOptionText:'A plan for your money', explanation:'A budget is a plan for your money.', myCorrect:true, mySkipped:false, myPoints:136, scores:{…} }`                             | After each question's timer, or after both players answer. One copy per player (personalised `my*` fields). The opponent's chosen option is never sent. |
| `live:opponent-disconnected` | `{ duelId, userId, graceSeconds:15 }`                                                                                                                                                                                                  | Opponent's socket dropped.                                                                                                                              |
| `live:opponent-reconnected`  | `{ duelId, userId }`                                                                                                                                                                                                                   | Opponent reconnected inside the grace.                                                                                                                  |
| `live:rematch-requested`     | `{ duelId, fromUserId }`                                                                                                                                                                                                               | The opponent asked for a rematch.                                                                                                                       |
| `live:finished`              | The stored `DuelResultView` (§7) + `host:{ name:'Mira', line:'…' }` + `forfeitedBy: <userId                                                                                                                                            | null>`                                                                                                                                                  | Duel settled (one copy per player, with their own result). |
| `live:error`                 | `{ code, message }`                                                                                                                                                                                                                    | Socket-level errors (auth aside — those disconnect).                                                                                                    |

### 3.3 Worked example (one question, both players)

```
C→S  live:join-queue {}
S→C  live:queued { ratingWindow: 50, … }            (both players)
S→C  live:matched { duelId:'…', opponent:{…Ravi, 1000}, … }
S→C  live:countdown { countdownEndsAtMs: … }
S→C  live:question { index:0, question:{ id:'q1', stem:'What is a budget?',
       options:[…4…], type:'MCQ_4', … }, deadlineMs: … }
C→S  live:answer { duelId, questionId:'q1', optionId:'opt-…' }   (Asha, +4.0 s)
S→C  live:answer-accepted { answeredCount:1, totalQuestions:7 }  (Asha only)
S→C  live:score { scores:{ playerA:{ score:136, correct:1 },
       playerB:{ score:0, correct:0 } } }                        (room)
C→S  live:answer { … }                                            (Ravi, +6.0 s, wrong)
S→C  live:reveal { correctOptionId:'opt-…', correctOptionText:'A plan…',
       explanation:'A budget is a plan for your money.',
       myCorrect:true, myPoints:136, scores:{…} }                (Asha)
S→C  live:reveal { …, myCorrect:false, myPoints:0, scores:{…} }  (Ravi)
```

---

## 4. REST endpoints (new, `/api/v1/duels`)

Live play itself is WebSocket-only. These four REST endpoints exist
for page loads, reconnect/resume, and clients without a socket. All
are authenticated (`JwtAuthGuard`, global) with ownership re-checked
in the service. All carry the educational disclaimer (blueprint §16).

| Method | Path                 | Notes                                                                                                                            |
| ------ | -------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/live/active`       | My active live duel, if any (phase, current question, scores, deadline) — for reconnect / resume on page load. `null` when none. |
| GET    | `/live/queue/status` | My queue status: `queued`, `rating`, `waitedMs`, `ratingWindow`, `botOfferDue`.                                                  |
| GET    | `/live/:id/state`    | One live duel's state summary (mine only — a duel that is not mine is 404). Never answers.                                       |
| POST   | `/live/:id/forfeit`  | Forfeit my live duel (leaving mid-duel counts as a loss). Returns `{ forfeited:true, duelId }`; the duel settles immediately.    |

The existing `GET /duels/:id/result` and `GET /duels/history` now
understand `LIVE` duels (one row, both players on it — not a Daily
pair linked by `pairedDuelId`).

---

## 5. Matchmaking

- Queue: Redis sorted set per §2.3. A player enters with
  `{ userId, rating, joinedAtMs }`.
- Windows (docs/05 §3.3): 0–5 s → ±50; 5–15 s → ±100; 15–30 s →
  ±200; 30+ s → ±400. Nearest Rating in the window wins; ties break
  by earliest join.
- Sweep: every queue join AND every 5 s, the gateway pairs waiters
  whose windows overlap — earliest waiter first. This matters when
  the newcomer's own (narrow) window does not reach a long-waiting
  player, but the long waiter's (wide) window reaches the newcomer.
- Bot offer: after 30 s with no human match, `live:bot-offer`.
  Accepting creates a rated duel vs Mira (`recordDuelVsBot` at the
  player's own Rating, §7) — not unrated practice.
- Anti-farming: same pair max 3 rated duels/day, max 10 rated
  events/user/day, 5-minute rematch cooldown (docs/04 §5, enforced
  by Ratings at settlement; the cooldown is additionally enforced at
  the rematch offer, §8).

---

## 6. Timers, disconnect, forfeit

| Timer            | Default | Config                     | Behaviour                                                                                                                                                                                                        |
| ---------------- | ------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Countdown        | 3 s     | `LIVE_COUNTDOWN_MS`        | 3-2-1 before question 1.                                                                                                                                                                                         |
| Per question     | 15 s    | `LIVE_QUESTION_MS`         | Server deadline; reveal at the deadline or when both players have answered (vs the bot: when the player has answered and Mira's simulated time has landed).                                                      |
| Reveal pause     | 2 s     | `LIVE_REVEAL_PAUSE_MS`     | Between a reveal and the next question.                                                                                                                                                                          |
| Disconnect grace | 15 s    | `LIVE_DISCONNECT_GRACE_MS` | Socket drop → `live:opponent-disconnected`; reconnect inside the grace resumes the duel (current question/countdown resent, timers re-armed from Redis state); after the grace the disconnected player forfeits. |

- The client timer is display only. If a client is slow, the
  server still moves on.
- A second connection for the same user replaces the first: the old
  socket's disconnect starts the grace, the new socket's reconnect
  clears it.
- Late-join is not allowed: only the two players on the duel row
  are ever joined to its room.

---

## 7. Rating integration

Settlement calls the existing Ratings duel path once, with
idempotency key `duel:{duelId}` (ADR 0006/7 ordering: Ratings first,
then duel rows + both `DuelGameResult` rows + both XP grants in one
duels transaction; a crash between the two is recovered on a
re-settle via `IDEMPOTENCY_REPLAY` / `RATING_EVENT_DUPLICATE` +
`getDuelOutcome`).

- Human pair: `RatingsService.recordDuel`, caller = player A, result
  from player A's perspective. Both sides update in the Ratings
  transaction; pair/day caps and the rematch cooldown apply.
- Bot duel: `RatingsService.recordDuelVsBot` — only the caller
  updates, bot fixed at the caller's own rating (expected 0.5).
- Forfeit: the forfeiter loses (outcome LOSS), the other player
  wins; the Rating updates with the normal K (deviation from doc 05
  §3.1's "smaller K" — ADR 0007 §8.1: there is no smaller-K path in
  Ratings, and a full-K loss is still costly).
- Rating-cap fallback (deviation, ADR 0007 §8.2): if the Ratings
  call fails on a cap/cooldown at settle time, the duel still
  settles — result + XP are stored, the Rating is left unchanged,
  and the reason says so in plain words. The rematch cooldown, by
  contrast, is enforced at the rematch offer, so a rematch never
  wastes a played duel.
- XP reuses existing values only (`grantDuelRewards`, reason
  `duel.live_completed`): win → 20, draw → 5, loss → 0; the streak
  still counts the completion. Ledger key
  `duel:{duelId}:{userId}`; no outbox event (finish-replay is the
  recovery path).
- Post-game stats reuse `buildGameStats` / `decideWinner` /
  `mirrorOutcome` — the same stored-result shape as Phase 4
  (`DuelGameResult`, one row per duel per player, with per-topic
  worst-first breakdown, per-question answers + explanations,
  Rating change with a plain-words reason, XP breakdown). The
  result page reads the stored row; it never recomputes stats.

---

## 8. Load balancing and scaling (docs/05 §3.4 — the honest version)

- **Sticky sessions are required.** A client must always hit the
  same server process for the life of its connection, or the
  WebSocket upgrade fails. This is a load-balancer setting
  (cookie-based affinity, not just IP hash, because many users
  share one IP behind NAT).
- **Redis adapter for fan-out.** `LiveRedisAdapter`
  (`@socket.io/redis-adapter` over ioredis pub/sub) lets a message
  to a room reach players on different servers. It is installed in
  `main.ts` only when `WS_REDIS_ADAPTER_ENABLED=true` (default
  false). The adapter is pub/sub fan-out, not a database — duel
  state still lives in Redis keys + Postgres.
- **Single-server v1 works without the adapter** — the in-process
  Socket.IO server is enough, and that is the tested configuration.
- **What the adapter does NOT do:** it does not move the engine's
  in-process timers. A duel's timers live on the server that
  created it; a reconnect to another server re-arms them from Redis
  state, but a server crash mid-duel still voids the duel (§2.2).
  Multi-server live duels without sticky sessions do NOT work.
- **Separate concerns / graceful drain / backpressure** (docs/05
  §3.4) are deployment properties, not code in this phase: the
  gateway, HTTP API, and matchmaking sweep run in the same process
  in v1; splitting them is a future step, as is moving timers into
  Redis (delayed jobs) for crash-resume.
- **Performance targets** (docs/05 §3.5): match found p95 < 15 s at
  normal traffic, bot offer at 30 s; question delivery < 200 ms
  after the previous reveal; answer result < 300 ms. The duel set
  is generated at match time, so there is no DB query in the middle
  of a duel — the only live writes are scores in Redis and
  `DuelAnswer` rows; Postgres writes happen once, at duel end, in
  one transaction.

### Deployment note (for the runbook)

```
Single server (v1, tested):
  1 × API (NestJS + Socket.IO, in-process) + Postgres + Redis.
  WS_REDIS_ADAPTER_ENABLED=false. No LB affinity needed.

Multi-server (later, NOT tested here):
  N × API behind a load balancer with COOKIE-BASED STICKY SESSIONS,
  WS_REDIS_ADAPTER_ENABLED=true, same Redis for adapter + state.
  Verify: kill one node mid-duel — its duels void (no Rating change),
  other nodes' duels continue. Do NOT enable the adapter without
  sticky sessions and call it "scaled".
```

---

## 9. Web UI (`apps/web/app/duels/live/`)

One page (`page.tsx`), stages: idle → queued → countdown →
playing → revealed → done.

- **Queue screen:** waiting time ticking, current Rating window
  (±50/±100/±200/±400), bot offer after 30 s with an "Play Mira
  instead" button, leave-queue button.
- **Countdown:** "You vs Ravi (rated 1000)", big 3-2-1, Mira's
  intro line.
- **Question screen:** predeclared UIs from doc 08 — MCQ_4 as a
  1-column list (mobile) / 2×2 grid (desktop), one tap answers
  (0.5 s confirm state, no separate Submit); TRUE_FALSE as two big
  buttons, TRUE left (green tint), FALSE right (red tint). Thin
  timer bar at the top (server deadline, display only). Live score
  bar: both players' names + scores (never their answers).
- **Reveal:** correct card green, chosen wrong card red,
  explanation below in simple English, scores updated.
- **Result:** reuses the Phase 4 `DuelResultView` (stored result),
  plus Mira's host line, a forfeit notice when applicable, a
  Rematch button (both players must ask; 5-minute cooldown shown
  in plain words), and "Back to duels".
- **Disconnect:** "Your opponent lost connection — they have 15
  seconds to reconnect, or you win by forfeit."
- The hub (`/duels`) has a Live Speed Quiz Duel card. The page
  carries the educational disclaimer (blueprint §16).

---

## 10. Anti-cheat and fairness (docs/05 §5)

- Answers never leave the server before reveal.
- Server owns timing/scoring: no client `timeMs` is accepted;
  answers must be the current question, first answer only (unique
  constraint), in order.
- One account, one socket for a rated duel; a second login during a
  duel ends the duel as a forfeit if it never reconnects in time.
- Answer-time analysis: impossibly fast correct answers on hard
  questions are NOT flagged yet — there is no flag store (ADR 0007
  §8.3). The server clock already makes fake times impossible.
- All duel results are stored with the full question set, both
  players' answers and timings, so any dispute can be replayed.

---

## 11. Testing

- **Unit (297/297 total, 29 suites; +36 new):** live-duel-state
  (window boundaries, bot offer, state parse, bot scores),
  live-matchmaking (enqueue/status, window widening, nearest
  opponent, sweep incl. long-waiter pairing, dequeue), live-duel-
  engine (one set for both players, question without answers,
  server-clock grading, duplicate/late/wrong-question rejection,
  reveal after both, settle-once with Rating + XP, forfeit,
  reconnect clears grace, bot duel, rematch cooldown + rematch),
  live-duels-gateway (auth rejection, payload validation, sweep
  matching, replaced-socket disconnect).
- **E2E (101/101; +4 new live tests):** happy path (queue → match →
  7 questions → settle + rate once, +20/−20, one rated event each),
  queue-status REST, disconnect forfeit (winner +20,
  `forfeitedBy` set), unauthenticated socket disconnect.
- **Worked examples verified:** 7/7 correct vs 0/7 → +20/−20
  (K=40 provisional, equal ratings); correct in 4,000 ms → 136
  points (100 + 36).
- **Test-infra note:** during e2e, a bug in the test's buffered
  socket client (an event was delivered to a waiter AND left in the
  buffer, so a question was answered twice) was fixed in the
  helper. The product correctly rejected the duplicate as
  `DUEL_LIVE_NOT_ACTIVE` in REVEAL phase.

---

## 12. Manual QA checklist

- [ ] Open `/duels/live`: "Find an opponent" → queue screen shows waiting time + ±50 window.
- [ ] Second player joins: both see `live:matched` with the same duelId, Mira's intro, 3-2-1 countdown.
- [ ] Question 1 arrives with no answers in the payload (check the socket frames / response body).
- [ ] Answer out of order / twice / after the timer → ack `{ ok:false }` with a code; no crash.
- [ ] Answer both players: reveal shows the correct option + explanation + scores; next question follows after ~2 s.
- [ ] Finish all 7: both see `live:finished` with mirrored Rating changes; `GET /ratings/me` shows one rated event each.
- [ ] One player disconnects (close the tab / kill the socket): the other sees "reconnecting…"; reconnect within 15 s resumes the same question; after 15 s the other wins by forfeit.
- [ ] Wait 30 s in the queue alone: the bot offer appears; accepting starts a rated duel vs Mira.
- [ ] Rematch right after a duel: "Rematch opens in …s" (5-minute cooldown); after 5 minutes both asking creates a new duel.
- [ ] Leave mid-duel: the duel settles immediately, the leaver loses, the opponent's result is stored.
- [ ] Result page shows per-question explanations and the Rating reason in plain words.
- [ ] `GET /duels/history` lists the LIVE duel with its Rating delta.

---

## 13. Limits / not verified

- Migration not applied to a live Postgres; Docker not booted; seed
  never executed against a live DB.
- Single-server only, tested. Multi-server (sticky LB + Redis
  adapter) is implemented but NOT tested end to end — see §8.
- No scheduler; no leagues; no pilot-data feed from live answers
  (`discrimination` stays null, no drift check).
- The bank holds 520 LIVE items (the 2,000-item target is still
  ahead — ADR 0006 §13 deviation carries over, ADR 0007 §8.5).
- E2E bank seed (96 MCQ_4 items, difficulties 1–3) exercises the
  selector's nearest-difficulty fallback for the difficulty-4 cells
  and the TRUE_FALSE type filter (pool = MCQ_4 only in e2e); the
  real 520-item bank has both live formats.
- Concurrent double-settle relies on the status check + unique
  `(duelId, userId)` result constraint (same posture as the
  simulator race check, ADR 0003/4).
