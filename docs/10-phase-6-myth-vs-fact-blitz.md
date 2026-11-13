# Candle — Phase 6 Myth vs Fact Blitz (L2)

**Date:** 2026-11-12
**Status:** Built and verified (ADR 0008). The second live duel.
**Depends on:** Blueprint 01, Ratings design 04, Duels design 05,
Phase 4 doc 07, formats/characters doc 08, Phase 5 doc 09, ADR 0007.

Step 4 of the duels build order (docs/05 §7): the second live duel.
It reuses the Phase 5 live engine, gateway, matchmaking, timers,
and settlement path — parameterised by variant — and adds only
what Blitz needs: a variant config, TRUE_FALSE-only selection,
a 10-second timer, and the streak scoring rule. No new transport,
no new table, no new question format, no bank growth.

---

## 1. What Step 4 is (and is not)

| Duel                    | Type              | Rated?                    | Format                                                                      |
| ----------------------- | ----------------- | ------------------------- | --------------------------------------------------------------------------- |
| Myth vs Fact Blitz (L2) | Live head-to-head | **Yes** — Learning Rating | 10 rapid true/false, 10 sec each, same set, live progress bar, streak bonus |

Not in this step: Case Duel (L3), Chart Detective (L4), any trading
duel, leagues/tournaments, Friend Challenge, profiles/settings/
community, bank growth. Those are later steps.

**Format (doc 08 §4, binding):** Blitz = TRUE_FALSE only, with its
predeclared UI (doc 08 §3.2) and 10-second timer. No new question
format was added, and no other format can appear in a Blitz duel —
the selection blueprint passes `types: ['TRUE_FALSE']` to the bank,
and the web page renders the TRUE_FALSE layout for every Blitz
question.

**Host:** Mira (doc 08 §2.2). She speaks before the duel ("10 rapid
true-or-false questions, 10 seconds each. One wrong answer breaks
your streak. Good luck.") and after it (a result line + the Rating
change in plain words + one practise-next suggestion). She never
speaks during a question, and she never reveals an answer while a
timer is running. In a Blitz bot duel she is also the opponent
(same as the Speed Quiz bot duel).

---

## 2. Technical architecture

### 2.1 What was reused from Phase 5, and what is new

**Reused unchanged** — one gateway, one engine, one settlement
path (docs/09 §2.1/§2.2):

| Piece             | File                                            | Reused how                                                                                                                                        |
| ----------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| WebSocket gateway | `live-duels.gateway.ts`                         | Same namespace `/duels-live`, same auth, same rooms, same handlers — `live:join-queue` only gains an optional `variant` field                     |
| Live engine       | `live-duel-engine.service.ts`                   | Same state machine, timers, grading, reveal, disconnect/forfeit, settlement, rematch — parameterised by the variant config                        |
| Matchmaking       | `live-matchmaking.service.ts`                   | Same windows, same 5 s sweep, same 30 s bot offer — run per variant queue                                                                         |
| State helpers     | `live-duel-state.ts`                            | Same keys, same `scoresOf`, same window helpers — state gains `variant` + per-player `streak`                                                     |
| Rating path       | `RatingsService.recordDuel` / `recordDuelVsBot` | Same idempotency key `duel:{duelId}`, same XP values, same stored-result shape                                                                    |
| Redis adapter     | `live-redis.adapter.ts`                         | Same optional multi-server fan-out, same limits (single-server tested)                                                                            |
| Web patterns      | `apps/web/app/duels/live/page.tsx`              | The Blitz page models the live page's stages, socket handling, and result/rematch flow; the question screen is the predeclared TRUE_FALSE UI only |

**New in Phase 6:**

| Piece                | File                                                                    | What it is                                                                                                                                                                                        |
| -------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Variant table        | `live-duel-variants.ts`                                                 | `LIVE_DUEL_VARIANTS`: `LIVE` (7 × 15 s, MCQ_4 + TRUE_FALSE, mix {2:2, 3:3, 4:2}, max 2/topic) vs `BLITZ` (10 × 10 s, TRUE_FALSE only, mix {2:3, 3:4, 4:3}, max 3/topic) + Mira's Blitz intro line |
| Blitz scoring        | `duel-scoring.ts`                                                       | `pointsForBlitzAnswer` / `blitzStreakBonus` — base 100 + 10 s speed bonus + streak bonus (§5)                                                                                                     |
| Streak state         | `live-duel-state.ts`                                                    | `LivePlayerState.streak` (current run of consecutive correct answers; 0 on a wrong answer)                                                                                                        |
| Per-variant queues   | `live-matchmaking.service.ts`                                           | `liveQueueKey(variant)` → `live:queue:LIVE` / `live:queue:BLITZ`; entry JSON carries `variant`                                                                                                    |
| Variant-aware engine | `live-duel-engine.service.ts`                                           | `blueprintFor(variant)`, `questionTimeMsFor(variant)`, streak grading in `answer()`, per-variant rematch cooldown, bot simulation with `{ timeLimitMs, streakBonus }`                             |
| Gateway/DTO/REST     | `live-duels.gateway.ts`, `dto/live-duels.dto.ts`, `duels.controller.ts` | `variant` on join-queue / queued / matched / acks; queue-status and state REST return `variant`                                                                                                   |
| Prisma               | `0008_phase6_myth_vs_fact_blitz`                                        | `ALTER TYPE "DuelType" ADD VALUE 'BLITZ'` only — no new tables, no new index                                                                                                                      |
| Shared tunables      | `packages/shared/src/constants.ts`                                      | `DUELS.BLITZ_*`: count 10, mix {2:3, 3:4, 4:3}, types `['TRUE_FALSE']`, max 3/topic, 10 s / 10,000 ms timer, streak step +10, cap +30                                                             |
| Web                  | `apps/web/app/duels/blitz/page.tsx`                                     | Blitz page (§9) + hub card + `BLITZ` in web result/history types                                                                                                                                  |

No core file is edited except the additive touchpoints listed in
ADR 0008 §11. No BaaS, no real tickers/money, fictional only.

### 2.2 Module map (duels module, Blitz-relevant files)

```
apps/api/src/modules/duels/
  live-duel-variants.ts     — NEW: variant table (LIVE vs BLITZ)
  live-duel-state.ts        — + variant + streak on LivePlayerState
  live-matchmaking.service.ts — + per-variant queues
  live-duel-engine.service.ts — + variant-aware set/timer/grading/rematch
  live-duels.gateway.ts     — + variant on join-queue / queued / matched
  dto/live-duels.dto.ts     — + optional variant enum on join-queue
  duel-scoring.ts           — + pointsForBlitzAnswer / blitzStreakBonus
  duels.controller.ts       — + variant on live REST responses
  duels.service.ts          — result/history views understand BLITZ
  duels.repository.ts       — live lookups cover LIVE + BLITZ
  README.md                 — + Blitz section (updated)
```

### 2.3 State machine (one duel, server is the authority)

```
QUEUED → MATCHED → COUNTDOWN (3 s) → IN_PROGRESS
  → REVEAL (per question) → … → FINISHED → SETTLED (Rating once)
```

Identical to Phase 5 (docs/09 §2.2), with the variant fixed at
match time and carried in the Redis state (`live:duel:{duelId}`)
for the duel's whole life. The server owns the timer; the client
timer is display only. Answers are sent as
`{ duelId, questionId, optionId }` — no `timeMs` at all; the
server grades from its own clock. Scoring is computed on the
server after each question, then the scores (not the answers)
are broadcast to both players. Disconnect: 15-second grace;
reconnect resumes the same duel; after 15 seconds the
disconnected player forfeits.

### 2.4 Redis keys (all of them — deltas from Phase 5 marked)

| Key                         | Shape                                                | TTL   | Purpose                                                                                          |
| --------------------------- | ---------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------ |
| `live:queue:LIVE`           | sorted set, member = userId, score = Learning Rating | —     | Speed Quiz matchmaking queue (unchanged)                                                         |
| `live:queue:BLITZ`          | sorted set, member = userId, score = Learning Rating | —     | **NEW:** Blitz matchmaking queue — a Speed Quiz waiter is never matched into a Blitz duel        |
| `live:queue-entry:{userId}` | JSON `{ userId, rating, joinedAtMs, variant }`       | 300 s | Who is queued, since when, at what Rating, **for which variant** (variant added)                 |
| `live:duel:{duelId}`        | JSON `LiveDuelState`                                 | 900 s | The duel: **variant**, players, scores, **streaks**, questions, phase, deadlines, answers so far |
| `live:user-duel:{userId}`   | duelId                                               | 900 s | Reconnect lookup (unchanged)                                                                     |
| `live:rematch:{duelId}`     | JSON `[userId, …]`                                   | 300 s | Who has asked for a rematch on a finished duel (unchanged)                                       |

The state never holds correct answers. Answers are graded at
answer time from the bank and stored as `DuelAnswer` rows; the
state holds only whether each player answered, their points,
their scores, and their current streak — so a leaked state can
never reveal an answer before its reveal.

### 2.5 Request flow

```
join-queue { variant:'BLITZ' } → enqueue (rating from RatingsService)
  → live:queued (variant: 'BLITZ') → sweep pairs BLITZ waiters
  → createLiveDuel (one selectSet for both, TRUE_FALSE only,
    mix {2:3, 3:4, 4:3}, max 3/topic, exposure for both, one Duel row)
  → live:matched (variant + timeLimitMs 10000) + live:countdown
countdown → startQuestion(0) → live:question (public view only,
  timeLimitMs 10000, deadlineMs = serverNowMs + 10000)
answer  → ownership → IN_PROGRESS? → current question? → first
  answer only? → option belongs to question? → in time?
  → grade server-side, streak +1 / reset to 0, store DuelAnswer,
    live:score → both answered? → reveal now, else timer reveals
reveal  → live:reveal (correct option + explanation + my
  correctness/points + scores) → next question / settle
finish  → settleDuel (§7) → live:finished (stored result view
  + bestStreak + host line)
rematch → both ask? → new BLITZ duel, same pair (5-min cooldown
  per pair PER VARIANT enforced at the offer)
```

---

## 3. WebSocket event contract — full, with deltas from Phase 5

Namespace: `/duels-live` (Socket.IO, WebSocket transport preferred,
polling fallback). Auth: access JWT in the handshake
(`auth: { token }`, or an `Authorization: Bearer <token>` header).
Every handler answers with an ack; asynchronous duel events arrive
as `live:*` broadcasts. All payloads are small JSON. No question
answers are ever emitted to a client before reveal.

### 3.1 Client → server

| Event              | Payload                                          | Ack                                                                                                                             | Notes / delta from Phase 5                                                                                                                                                                                                                          |
| ------------------ | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `live:join-queue`  | `{ variant?: 'LIVE' \| 'BLITZ' }`                | `{ ok, queued, variant, waitedMs, ratingWindow }` or `{ ok:false, code, message }`                                              | **CHANGED:** `variant` added; omitted → `'LIVE'` (old clients still get Speed Quiz). Unknown variant → `{ ok:false, code:'VALIDATION_FAILED' }`. 409 `DUEL_ALREADY_QUEUED` (any existing queue entry, either variant) / `DUEL_LIVE_ALREADY_ACTIVE`. |
| `live:leave-queue` | —                                                | `{ ok }`                                                                                                                        | Unchanged. Idempotent cancel.                                                                                                                                                                                                                       |
| `live:accept-bot`  | —                                                | `{ ok, duelId, opponent:'BOT', variant }` or `{ ok:false, code:'DUEL_NOT_IN_QUEUE', message }`                                  | **CHANGED:** ack gains `variant`. Only after the 30 s bot offer. Accepting from a Blitz queue starts a **Blitz** bot duel.                                                                                                                          |
| `live:answer`      | `{ duelId, questionId, optionId }` (all UUID v4) | `{ ok, answeredCount, totalQuestions }` or `{ ok:false, code, message }`                                                        | Unchanged. No `timeMs` — the server clocks it. Correctness is NOT in the ack.                                                                                                                                                                       |
| `live:leave-duel`  | `{ duelId }`                                     | `{ ok, forfeited:true }`                                                                                                        | Unchanged. Voluntary forfeit (counts as a loss).                                                                                                                                                                                                    |
| `live:rematch`     | `{ duelId }`                                     | `{ ok, matched, newDuelId? }` or `{ ok, matched:false, reason:'REMATCH_COOLDOWN', retryAfterMs }` / `reason:'WAITING_OPPONENT'` | Unchanged in shape. **The rematch replays the same variant** (a Blitz rematch is Blitz); the 5-minute cooldown is per pair per variant.                                                                                                             |

Invalid payloads get `{ ok:false, code:'VALIDATION_FAILED', message }`
with per-field details — never a crash, never a silent accept.

### 3.2 Server → client

| Event                        | Payload (Blitz example)                                                                                                                                                                                                                                                                                     | When / delta from Phase 5                                                                                                                                                                                                                                                        |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `live:queued`                | `{ queued:true, userId, rating:1000, joinedAtMs:…, waitedMs:0, ratingWindow:50, botOfferDue:false, variant:'BLITZ', host:{ name:'Mira', line:'Finding you an opponent at your Rating…' } }`                                                                                                                 | **CHANGED:** gains `variant`. On joining the queue.                                                                                                                                                                                                                              |
| `live:queue-left`            | `{ userId }`                                                                                                                                                                                                                                                                                                | Unchanged. On leaving the queue.                                                                                                                                                                                                                                                 |
| `live:bot-offer`             | `{ message:'No opponent at your Rating yet. Play Mira (bot) instead — rated at your own Rating.', botName:'Mira' }`                                                                                                                                                                                         | Unchanged text. After 30 s in the queue with no match.                                                                                                                                                                                                                           |
| `live:matched`               | `{ duelId, variant:'BLITZ', opponent:{ userId, displayName:'Ravi', rating:1000, kind:'HUMAN' }, host:{ name:'Mira', line:'10 rapid true-or-false questions, 10 seconds each. One wrong answer breaks your streak. Good luck.' }, questionCount:10, timeLimitMs:10000, countdownEndsAtMs:…, serverNowMs:… }` | **CHANGED:** gains `variant` + `timeLimitMs` (15000 LIVE / 10000 BLITZ); `questionCount` is 10 for Blitz; host line is the Blitz intro. Opponent `kind:'BOT'`, `userId:'bot:mira'` vs Mira.                                                                                      |
| `live:countdown`             | `{ duelId, countdownEndsAtMs:…, serverNowMs:…, host:{ name:'Mira', line:'Mira is hosting this duel.' } }`                                                                                                                                                                                                   | Unchanged. Countdown starts (3 s, shared `LIVE_COUNTDOWN_MS`; and on reconnect, resent).                                                                                                                                                                                         |
| `live:question`              | `{ duelId, index:0, total:10, question:{ id, stem, options:[{ id, text, order },{ id, text, order }], type:'TRUE_FALSE', topic, skill, difficulty }, deadlineMs:…, serverNowMs:…, timeLimitMs:10000 }`                                                                                                      | **CHANGED:** `timeLimitMs` 10000, `deadlineMs = serverNowMs + 10000`, `question.type` `'TRUE_FALSE'`, exactly 2 options (True/False, shuffled order). No `isCorrect`, no explanation.                                                                                            |
| `live:answer-accepted`       | `{ duelId, questionId, answeredCount:1, totalQuestions:10 }`                                                                                                                                                                                                                                                | Unchanged (your answer was recorded, to you only).                                                                                                                                                                                                                               |
| `live:score`                 | `{ duelId, scores:{ playerA:{ userId, score:150, correct:1 }, playerB:{ userId, score:0, correct:0 } } }`                                                                                                                                                                                                   | **UNCHANGED in shape.** Scores + correct counts, never answers — and **no streak field**: `scoresOf` returns `{ userId, score, correct }` per player only (`live-duel-state.ts`). The web page therefore shows scores only during play; the streak is a result-screen stat (§9). |
| `live:reveal`                | `{ duelId, index:0, questionId, correctOptionId, correctOptionText:'True', explanation:'…', myCorrect:true, mySkipped:false, myPoints:150, scores:{…} }`                                                                                                                                                    | Unchanged in shape. After each question's timer, or after both players answer. One copy per player (personalised `my*` fields). The opponent's chosen option is never sent.                                                                                                      |
| `live:opponent-disconnected` | `{ duelId, userId, graceSeconds:15 }`                                                                                                                                                                                                                                                                       | Unchanged. Opponent's socket dropped.                                                                                                                                                                                                                                            |
| `live:opponent-reconnected`  | `{ duelId, userId }`                                                                                                                                                                                                                                                                                        | Unchanged. Opponent reconnected inside the grace.                                                                                                                                                                                                                                |
| `live:rematch-requested`     | `{ duelId, fromUserId }`                                                                                                                                                                                                                                                                                    | Unchanged. The opponent asked for a rematch.                                                                                                                                                                                                                                     |
| `live:finished`              | The stored `DuelResultView` (§7) + `host:{ name:'Mira', line:'…' }` + `forfeitedBy: <userId \| null>`                                                                                                                                                                                                       | Unchanged in shape. The stored view carries `bestStreak` (Blitz's signature stat) and `type:'BLITZ'`. Duel settled (one copy per player, with their own result).                                                                                                                 |
| `live:error`                 | `{ code, message }`                                                                                                                                                                                                                                                                                         | Unchanged. Socket-level errors (auth aside — those disconnect).                                                                                                                                                                                                                  |

### 3.3 Worked example (one Blitz question, both players)

```
C→S  live:join-queue { variant:'BLITZ' }
S→C  live:queued { variant:'BLITZ', ratingWindow: 50, … }   (both players)
S→C  live:matched { duelId:'…', variant:'BLITZ', opponent:{…Ravi, 1000},
       host:{ line:'10 rapid true-or-false questions, 10 seconds each.
       One wrong answer breaks your streak. Good luck.' },
       questionCount:10, timeLimitMs:10000, … }
S→C  live:countdown { countdownEndsAtMs: … }
S→C  live:question { index:0, total:10, question:{ id:'q1',
       stem:'A credit card lets you spend money you do not have yet.',
       options:[{…,'True'},{…,'False'}], type:'TRUE_FALSE', … },
       deadlineMs: …, timeLimitMs:10000 }
C→S  live:answer { duelId, questionId:'q1', optionId:'opt-…' }   (Asha, +2.0 s)
S→C  live:answer-accepted { answeredCount:1, totalQuestions:10 }  (Asha only)
S→C  live:score { scores:{ playerA:{ score:150, correct:1 },
       playerB:{ score:0, correct:0 } } }                        (room)
C→S  live:answer { … }                                            (Ravi, +6.0 s, wrong)
S→C  live:reveal { correctOptionId:'opt-…', correctOptionText:'True',
       explanation:'…', myCorrect:true, myPoints:150, scores:{…} }  (Asha)
S→C  live:reveal { …, myCorrect:false, myPoints:0, scores:{…} }     (Ravi)
```

---

## 4. REST endpoints (`/api/v1/duels`)

Live play itself is WebSocket-only. These REST endpoints exist
for page loads, reconnect/resume, and clients without a socket. All
are authenticated (`JwtAuthGuard`, global) with ownership re-checked
in the service. All carry the educational disclaimer (blueprint §16).
**No new REST endpoints in Phase 6** — the four Phase 5 endpoints
gain `variant` fields:

| Method | Path                 | Notes / delta from Phase 5                                                                                                         |
| ------ | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/live/active`       | My active live duel, if any — now returns `variant` + `type` (`'BLITZ'`) + `timeLimitMs` 10000 for Blitz. `null` when none.        |
| GET    | `/live/queue/status` | My queue status: `queued`, `rating`, `waitedMs`, `ratingWindow`, `botOfferDue` — now plus `variant` (`'LIVE' \| 'BLITZ' \| null`). |
| GET    | `/live/:id/state`    | One live duel's state summary (mine only) — now returns `variant` + `type` + `timeLimitMs` for Blitz. Never answers.               |
| POST   | `/live/:id/forfeit`  | Unchanged. Forfeit my live duel. Returns `{ forfeited:true, duelId }`; the duel settles immediately.                               |

The existing `GET /duels/:id/result` and `GET /duels/history` now
return `type: 'BLITZ'` for Blitz duels (one row, both players on
it — not a Daily pair linked by `pairedDuelId`).

---

## 5. Blitz scoring and the streak rule

Scoring (`duel-scoring.ts`, `pointsForBlitzAnswer` /
`blitzStreakBonus`). The streak is the current run of consecutive
correct answers **inside this duel** (not the account's daily
streak — that is a separate Gamification streak, unchanged).

```
points = 100 (base)
       + floor(50 × (1 − timeMs / 10000))   (speed bonus, 10 s timer)
       + streakBonus
wrong or skipped = 0, and the current in-duel streak resets to 0
```

Streak bonus, on the streak AFTER this answer: +10 per
consecutive correct answer beyond the 2nd, capped at +30 per
question — streak 3 → +10, streak 4 → +20, streak 5 and beyond
→ +30. Streaks 1–2 pay no bonus. A wrong answer (or a skip)
resets the current streak to 0, so the next correct answer starts
a new streak at 1 (no bonus).

### Worked examples (pinned in unit tests)

| Answer               | Streak after | Points  | Working                |
| -------------------- | ------------ | ------- | ---------------------- |
| Correct in 0 ms      | 1            | **150** | 100 + 50 + 0           |
| Correct in 5,000 ms  | 3            | **135** | 100 + 25 + 10          |
| Correct in 10,000 ms | 5            | **130** | 100 + 0 + 30           |
| Correct in 0 ms      | 9            | **180** | 100 + 50 + 30 (capped) |
| Wrong, any streak    | 0            | **0**   | streak resets to 0     |

Engine sequence (unit-tested): streaks 1, 2, 3, reset, 1, 2, 3,
4, 5, 6 — q3 (streak 3) pays the +10 bonus, q4 (wrong) pays 0
and resets, q7 (streak 3) pays +10 again, q10 (streak 6) pays
the capped +30. Best streak for that run is 6, stored in
`DuelGameResult.bestStreak`.

Speed Quiz scoring is unchanged — it never takes a streak bonus.
Mira's simulated answers in a Blitz bot duel use the same rule
(`simulateBot` options `{ timeLimitMs, streakBonus }`), so both
sides of a Blitz duel are scored identically.

**Why the streak is a per-question bonus, not a multiplier:**
a multiplier would let one early mistake decide the whole duel
(a 2× swing on every later question). A flat +10/+20/+30 keeps
a broken streak recoverable — the duel stays live after one
wrong answer — while still rewarding consistency. The cap (+30)
keeps the maximum per question at 180, so speed still matters
(a 0 ms answer at streak 1 beats a 10 s answer at streak 5).

---

## 6. Matchmaking

- Queue: Redis sorted set per variant (§2.4). A player enters
  with `{ userId, rating, joinedAtMs, variant }`.
- Windows (docs/05 §3.3), unchanged: 0–5 s → ±50; 5–15 s → ±100;
  15–30 s → ±200; 30+ s → ±400. Nearest Rating in the window
  wins; ties break by earliest join.
- Sweep: every queue join AND every 5 s, the gateway pairs
  waiters whose windows overlap — earliest waiter first, **within
  one variant only**. A BLITZ pair never becomes a Speed Quiz
  duel.
- Bot offer: after 30 s with no human match, `live:bot-offer`.
  Accepting from a Blitz queue creates a rated Blitz duel vs Mira
  (`recordDuelVsBot` at the player's own Rating, §7) on the
  10-second timer with the streak rule — not unrated practice.
- Anti-farming: same pair max 3 rated duels/day, max 10 rated
  events/user/day, **5-minute rematch cooldown per pair per
  variant** (docs/04 §5, enforced by Ratings at settlement; the
  cooldown is additionally enforced at the rematch offer, §8 of
  docs/09). A Blitz rematch is not blocked by a recent Speed Quiz
  duel against the same player, and a rematch always replays the
  same variant.
- One queue entry per user across variants: already queued (for
  either variant) and joining again → 409 `DUEL_ALREADY_QUEUED`;
  leave the first queue before joining the other. No queueing
  while a live duel is active (409 `DUEL_LIVE_ALREADY_ACTIVE`).

---

## 7. Timers, disconnect, forfeit

| Timer            | Default | Config                                       | Behaviour                                                                                                                                                                                                        |
| ---------------- | ------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Countdown        | 3 s     | `LIVE_COUNTDOWN_MS` (shared with Speed Quiz) | 3-2-1 before question 1.                                                                                                                                                                                         |
| Per question     | 10 s    | `BLITZ_QUESTION_MS` (default 10,000)         | Server deadline; reveal at the deadline or when both players have answered (vs the bot: when the player has answered and Mira's simulated time has landed).                                                      |
| Reveal pause     | 2 s     | `LIVE_REVEAL_PAUSE_MS` (shared)              | Between a reveal and the next question.                                                                                                                                                                          |
| Disconnect grace | 15 s    | `LIVE_DISCONNECT_GRACE_MS` (shared)          | Socket drop → `live:opponent-disconnected`; reconnect inside the grace resumes the duel (current question/countdown resent, timers re-armed from Redis state); after the grace the disconnected player forfeits. |

- The client timer is display only. If a client is slow, the
  server still moves on.
- A second connection for the same user replaces the first: the old
  socket's disconnect starts the grace, the new socket's reconnect
  clears it.
- Late-join is not allowed: only the two players on the duel row
  are ever joined to its room.

---

## 8. Rating integration

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
  `mirrorOutcome` — the same stored-result shape as Phase 4/5
  (`DuelGameResult`, one row per duel per player, with per-topic
  worst-first breakdown, per-question answers + explanations,
  Rating change with a plain-words reason, XP breakdown, and
  `bestStreak`). The result page reads the stored row; it never
  recomputes stats. Winner: more points wins, then lower total
  time, else draw (same tie-break as Speed Quiz).

---

## 9. Load balancing and scaling (docs/05 §3.4 — the honest version)

Identical to Phase 5 (docs/09 §8) — Blitz adds no new scaling
concern, because it runs on the same gateway, engine, and Redis
keys (plus one more queue key):

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
  state, but a server crash mid-duel still voids the duel (§2.3).
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

## 10. Web UI (`apps/web/app/duels/blitz/`)

One page (`page.tsx`), stages: idle → queued → countdown →
playing → revealed → done. Modelled on the live page
(`apps/web/app/duels/live/page.tsx`); the differences are the
variant, the timer, and the question UI.

- **Queue screen:** waiting time ticking, current Rating window
  (±50/±100/±200/±400), bot offer after 30 s with a "Play Mira
  instead" button (the text says the bot duel is on the same
  10-second timer with the same streak rule), leave-queue button.
  The page always sends `{ variant: 'BLITZ' }` — the server
  defaults an omitted variant to LIVE, so it is never omitted.
- **Countdown:** "You vs Ravi (rated 1000)", big 3-2-1, Mira's
  Blitz intro line (from the `live:matched` host line, with the
  exact line as a fallback). The page also guards the matched
  payload: a `variant` other than `'BLITZ'` shows an error
  instead of starting the duel.
- **Question screen:** the predeclared TRUE_FALSE UI from doc 08
  §3.2, exactly — stem as a large statement card, two big buttons
  side by side, TRUE left (green tint), FALSE right (red tint),
  one tap answers (a 0.5 s confirm ring, no separate Submit).
  Thin 10-second timer bar at the top, driven by the
  `timeLimitMs` from the `live:question` payload (fallback
  10,000 ms), not a hardcoded guess. Live score bar: both
  players' names + scores (never their answers, never a streak —
  `live:score` carries no streak field, §3.2).
- **Reveal:** the same two buttons, with the correct button filled
  solid (green for TRUE, red for FALSE — the button keeps its own
  colour, filled), the player's wrong pick marked (struck through),
  and the explanation below in simple English, plus the
  correctness/points line ("Correct — +150 points." / "Wrong — 0
  points. Your streak is broken." / "No answer — time ran out.
  Your streak is broken.").
- **Result:** reuses the Phase 4/5 `DuelResultView` (stored result)
  plus Mira's host line, a forfeit notice when applicable, and a
  **prominent best-streak banner** — "Your best streak: N in a
  row" with the streak-bonus rule in plain words — because best
  streak is Blitz's signature stat. Rematch button (both players
  must ask; 5-minute cooldown per pair per variant, shown in
  plain words) and "Back to duels".
- **Disconnect:** "Your opponent lost connection — they have 15
  seconds to reconnect, or you win by forfeit."
- The hub (`/duels`) has a Myth vs Fact Blitz card (first card,
  above Speed Quiz). The page carries the educational disclaimer
  (blueprint §16).
- Mira hosts before/after only, never during a question
  (doc 08 §2.2). The web types `DuelResultResponse` /
  `DuelHistoryItem` now include `'BLITZ'` (`apps/web/lib/api.ts`)
  so a stored Blitz result renders without a type error.

---

## 11. Anti-cheat and fairness (docs/05 §5)

- Answers never leave the server before reveal.
- Server owns timing/scoring: no client `timeMs` is accepted;
  answers must be the current question, first answer only (unique
  constraint), in order. The streak is server state — a client
  cannot claim a streak it did not earn, because points and
  streaks are computed from server-graded answers only.
- One account, one socket for a rated duel; a second login during a
  duel ends the duel as a forfeit if it never reconnects in time.
- Answer-time analysis: impossibly fast correct answers on hard
  questions are NOT flagged yet — there is no flag store (ADR 0008
  §8.3). The server clock already makes fake times impossible.
- All duel results are stored with the full question set, both
  players' answers and timings, so any dispute can be replayed.

---

## 12. Testing

- **Unit (318/318 total, +21 new):** Blitz variant config
  (shape, mix sums to 10, TRUE_FALSE only, max 3/topic),
  `blitzStreakBonus` / `pointsForBlitzAnswer` incl. every worked
  example in §5, Blitz engine (10 TRUE_FALSE questions, 10 s
  timer, streak bonus +10/+20/+30, reset on wrong, `bestStreak`
  stored, bot duel on the 10 s timer with the streak rule),
  per-variant matchmaking (separate queues, one entry per user,
  sweep pairs within one variant only), gateway variant
  validation (unknown variant → `VALIDATION_FAILED`).
- **E2E (104/104; +3 new Blitz tests):** happy path (queue →
  match → 10 questions → settle + rate once, one rated event
  each), queue-status REST returns `variant: 'BLITZ'`, Blitz bot
  duel via the 30 s offer.
- **Web:** typecheck clean, lint clean (`eslint app
--max-warnings=0`), prettier clean on the new/changed files.
- **Worked examples verified:** §5 table, in unit tests; the
  Blitz e2e happy path settles with the stored result carrying
  `bestStreak`.
- **Test-infra note:** the e2e seed gains 64 TRUE_FALSE items
  (difficulties 4–5, test seed only — the production bank is
  untouched). They sit at difficulties 4–5 so the existing
  selection/coverage pins (which assert the MCQ-only difficulty
  1–3 cells) hold; the Blitz blueprint reaches them via
  nearest-difficulty fallback.

---

## 13. Manual QA checklist

- [ ] Open `/duels/blitz`: "Find an opponent" → queue screen shows waiting time + ±50 window, and the queue is the Blitz queue (check `GET /live/queue/status` returns `variant: 'BLITZ'`).
- [ ] Second player joins (Blitz queue): both see `live:matched` with the same duelId, `variant: 'BLITZ'`, `timeLimitMs: 10000`, `questionCount: 10`, Mira's Blitz intro, 3-2-1 countdown.
- [ ] A Speed Quiz waiter is never matched into a Blitz duel: queue one player for Speed Quiz and one for Blitz — neither matches; each sees only their own variant's queue.
- [ ] Question 1 arrives with `type: 'TRUE_FALSE'`, exactly 2 options (True/False), no answers in the payload (check the socket frames / response body).
- [ ] The question screen shows the statement card + TRUE (left, green) / FALSE (right, red) buttons and a thin 10-second bar; one tap answers.
- [ ] Answer out of order / twice / after the timer → ack `{ ok:false }` with a code; no crash.
- [ ] Answer both players: reveal fills the correct button solid, marks a wrong pick, shows the explanation + scores; next question follows after ~2 s.
- [ ] Play a streak: 3 correct in a row — the third question pays +10 over its speed bonus; a wrong answer after that pays 0 and the next correct answer pays no streak bonus.
- [ ] Finish all 10: both see `live:finished` with mirrored Rating changes and `bestStreak`; the result screen shows the best-streak banner; `GET /ratings/me` shows one rated event each.
- [ ] One player disconnects (close the tab / kill the socket): the other sees "reconnecting…"; reconnect within 15 s resumes the same question; after 15 s the other wins by forfeit.
- [ ] Wait 30 s in the queue alone: the bot offer appears; accepting starts a rated Blitz duel vs Mira (10 questions, 10 s each, streak rule applies to Mira too).
- [ ] Rematch right after a Blitz duel: "Rematch opens in …s" (5-minute cooldown); a Speed Quiz duel against the same player in between does NOT block the Blitz rematch (cooldown is per variant); after 5 minutes both asking creates a new Blitz duel.
- [ ] Leave mid-duel: the duel settles immediately, the leaver loses, the opponent's result is stored.
- [ ] Result page shows per-question explanations, the Rating reason in plain words, and best streak; `GET /duels/history` lists the BLITZ duel with its Rating delta.
- [ ] Join the queue with no `variant` (old client): the duel is Speed Quiz, not Blitz — the default is LIVE.

---

## 14. Limits / not verified

- Migration not applied to a live Postgres; Docker not booted; seed
  never executed against a live DB.
- Single-server only, tested. Multi-server (sticky LB + Redis
  adapter) is implemented but NOT tested end to end — see §9.
- No scheduler; no leagues; no pilot-data feed from live answers
  (`discrimination` stays null, no drift check).
- The bank holds 520 LIVE items (the 2,000-item target is still
  ahead — ADR 0006 §13 deviation carries over, ADR 0007 §8.5),
  and only **59 of them are TRUE_FALSE** — Blitz draws all 10
  questions from those 59, so a frequent Blitz player sees
  repeats sooner than a Speed Quiz player. Bank growth is deferred
  per Nishu's decision; growing TRUE_FALSE depth is the next bank
  task before Blitz is promoted heavily.
- No impossibly-fast-answer flagging (see §11).
- E2E bank seed (96 MCQ_4 items, difficulties 1–3, plus 64
  TRUE_FALSE items at difficulties 4–5) exercises the selector's
  nearest-difficulty fallback for the Blitz difficulty mix; the
  real 520-item bank has both live formats.
- Concurrent double-settle relies on the status check + unique
  `(duelId, userId)` result constraint (same posture as the
  simulator race check, ADR 0003/4).
- **Pre-existing e2e flake (not from Phase 6):** an admin test
  publishes a LIVE "What is a budget?" item; Bot/Live happy-path
  tests assert the first-question explanation matches
  `/^Because QB/` and random selection occasionally picks the
  admin item instead. Full e2e runs during Phase 6 went 102/104 →
  104/104 → 103/104 → 104/104 with zero code changes between
  runs. No Phase 6 code was changed to chase it.
