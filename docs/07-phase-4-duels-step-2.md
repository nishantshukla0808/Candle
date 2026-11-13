# Candle — Phase 4 Duels Step 2: Bot Duel (P1) + Async Daily Duel (L5)

**Date:** 2026-11-11
**Status:** Built and verified (ADR 0006). No live duels yet.
**Depends on:** Blueprint 01, Ratings design 04, Duels design 05,
Phase 3 Ratings + Question Bank (520 LIVE items, qb-001–qb-520).

Step 2 of the duels build order (docs/05 §7): prove the bank, scoring,
and Rating update with no live matchmaking risk. Step 1 (Question Bank)
is done at 520 items; Step 3 (live Speed Quiz Duel) comes next.

---

## 1. What Step 2 is (and is not)

| Duel                  | Type             | Rated?                    | Format                                                  |
| --------------------- | ---------------- | ------------------------- | ------------------------------------------------------- |
| Bot Duel (P1)         | Practice vs Mira | **No** — never            | 7 questions, 15 sec each, same set for both sides       |
| Async Daily Duel (L5) | Rated, async     | **Yes** — Learning Rating | 5 questions, same fixed set all day, 1 per user per day |

Not in this step: live WebSocket duels, matchmaking, Speed Quiz live
(L1), Myth vs Fact (L2), Case (L3), Chart Detective (L4), any trading
duel, leagues, profiles/settings/community. Those are later steps.

---

## 2. Technical architecture

### 2.1 Module map

```
apps/api/src/modules/duels/
  duels.controller.ts    — thin: 9 routes, DTO validation, OpenAPI
  duels.service.ts       — start / answer / finish / pairing /
                           settlement / bot fallback / history
  duels.repository.ts    — the ONLY file touching Prisma here
  duel-dates.ts          — IST calendar dates (pure)
  bot-simulation.ts      — seeded Mira simulation (pure)
  duel-scoring.ts        — scoring + post-game stats (pure)
  dto/duels.dto.ts       — boundary validation
  *.spec.ts              — unit tests
  README.md              — module readme

Consumed through public service interfaces only (blueprint §4):
  QuestionBankService  — selectSet / recordExposure / getItemsForGrading
  RatingsService       — recordDuel / recordDuelVsBot / getDuelOutcome /
                         getUserRatings
  GamificationService  — grantDuelRewards
```

No core file is edited except the additive touchpoints listed in
ADR 0006 §11 (shared constants/error codes, the three seams, the
module line in `app.module.ts`, e2e fakes).

### 2.2 State machine (one duel row per player attempt)

```
BOT:    IN_PROGRESS → (finish) → SETTLED
DAILY:  IN_PROGRESS → (finish) → WAITING_OPPONENT → (pair settles) → SETTLED
                                  ↘ (admin settle-unpaired) → SETTLED (vs bot)
```

- A Daily pair is **two duel rows** (one per player) linked by
  `pairedDuelId` at settlement. A Bot Duel is one row (`playerB` is
  always null; Mira's score lives in `botScore` / `botCorrect` /
  `botTotalTimeMs`).
- `WAITING_OPPONENT` means "finished, answers graded, awaiting a
  pair". Calling finish again on such a duel retries pairing — this
  is also the retry path when a settlement failed on a Ratings cap.
- `SETTLED` is terminal. Finishing a settled duel replays the stored
  result (never double-applies XP or Rating).

### 2.3 Request flow

```
start  → cap checks → selectSet (bank, exposure rules) → recordExposure
         → create Duel (questionIds + seed stored)
answer → ownership → IN_PROGRESS? → next question in order? → first
         answer only? → option belongs to question? → timeMs 0–15000?
         → grade server-side, store DuelAnswer (correctness NOT returned)
finish → grade rest as skips → BOT: simulate Mira, grant XP, store
         result (one tx) · DAILY: mark WAITING → pair? → settle (§6)
result → read stored DuelGameResult (never recompute)
```

---

## 3. Data model (migration `0006_phase4_duels_step2`)

```prisma
enum DuelType   { BOT, DAILY }
enum DuelStatus { IN_PROGRESS, WAITING_OPPONENT, SETTLED }
enum DuelOutcome { WIN, DRAW, LOSS }

model Duel {
  id, type, status, playerAId, playerBId (null — pair is via pairedDuelId),
  pairedDuelId, dailyDate (IST YYYY-MM-DD, DAILY only),
  dailySetId, questionIds (Json — bank ids in presented order),
  seed (bot seed / daily-set seed), startedAt, finishedAt,
  winnerId (null for draw, or when Mira wins a BOT duel),
  botScore, botCorrect, botTotalTimeMs, createdAt, updatedAt
  @@index([playerAId, type, createdAt])
  @@index([type, dailyDate, status])
}

model DuelAnswer {
  id, duelId, userId, questionId (FK → DuelBankItem),
  optionId (null when skipped), skipped, correct,
  timeMs (client-reported, 0–15000; null when skipped),
  points, order (0-based position), createdAt
  @@unique([duelId, userId, questionId])   // first answer only
}

model DuelDailySet {
  id, date (IST YYYY-MM-DD, @unique — one set per day),
  questionIds, seed, createdAt
}

model DuelGameResult {
  id, duelId, userId, result, score, correct, wrong, skipped,
  accuracy, avgTimeMs, fastestTimeMs, slowestTimeMs, bestStreak,
  perTopic (Json — worst-first), perQuestion (Json — with explanations),
  ratingBefore, ratingAfter, ratingDelta (null for BOT),
  ratingReason (plain words; BOT: "no Rating change — practice"),
  xpAwarded, xpBreakdown (Json — incl. the full reward summary),
  createdAt
  @@unique([duelId, userId])
}
```

---

## 4. Endpoints (`/api/v1/duels`)

All routes are authenticated (`JwtAuthGuard`, global) with ownership
re-checked in the service. All responses use the standard envelope
(blueprint §7). All carry the educational disclaimer (blueprint §16).
`timeMs` is client-reported per question; the server validates the
range and scores from it (see §5.4).

### 4.1 `POST /duels/bot/start` — start a Bot Duel

No body. Cap: 10 starts per user per IST day (409
`DUEL_BOT_DAILY_LIMIT`).

Response (201):

```json
{
  "duelId": "b09f8a85-2fef-499a-85fd-49c4b2807fd4",
  "type": "BOT",
  "date": null,
  "questions": [
    {
      "id": "…",
      "stem": "What is a budget?",
      "options": [
        { "id": "…", "text": "A plan for your money", "order": 0 },
        { "id": "…", "text": "A type of loan", "order": 1 }
      ],
      "type": "MCQ_4",
      "topic": "budgeting",
      "skill": "RECALL",
      "difficulty": 2
    }
  ],
  "opponent": { "name": "Mira", "kind": "BOT", "baseAccuracy": 0.55 },
  "startedAt": "2026-11-11T10:00:00.000Z"
}
```

Questions are public views only: **no `isCorrect`, no explanation**.
7 questions, mix 2 easy + 3 medium + 2 hard (difficulties
{2:2, 3:3, 4:2}, max 2 per topic), selected for the caller with the
bank's exposure rules (30-day / 3-times).

### 4.2 `POST /duels/bot/:id/answer` — answer the next question

Body:

```json
{ "questionId": "…", "optionId": "…", "timeMs": 4200 }
```

Rules (400/409 on violation): the duel must be `IN_PROGRESS`
(409 `DUEL_NOT_IN_PROGRESS`); the question must be the next
unanswered one, in order (400); first answer only (409 `CONFLICT`);
the option must belong to the question (400); `timeMs` must be an
integer 0–15000 (400). Correctness and points are computed
server-side and **not** returned.

Response (201):

```json
{
  "duelId": "…",
  "questionId": "…",
  "answeredCount": 3,
  "totalQuestions": 7,
  "nextQuestionId": "…"
}
```

### 4.3 `POST /duels/bot/:id/finish` — finish a Bot Duel

No body. Unanswered questions become skips. Mira is simulated from
the stored seed; XP/streaks are granted; the post-game result is
stored — all in one transaction. No Rating change ever.
Re-finishing returns the identical stored result.

Response (201) — the stored result (see §4.8 for the shape):

```json
{
  "duelId": "…",
  "type": "BOT",
  "status": "SETTLED",
  "result": "WIN",
  "score": 665,
  "opponent": { "name": "Mira", "kind": "BOT", "score": 365, "correct": 3 },
  "correct": 5,
  "wrong": 2,
  "skipped": 0,
  "accuracy": 0.714,
  "avgTimeMs": 5000,
  "fastestTimeMs": 5000,
  "slowestTimeMs": 5000,
  "bestStreak": 5,
  "perTopic": [{ "topic": "budgeting", "correct": 2, "total": 2, "accuracy": 1 }],
  "perQuestion": [
    {
      "questionId": "…",
      "stem": "…",
      "topic": "budgeting",
      "skill": "RECALL",
      "difficulty": 2,
      "selectedOptionId": "…",
      "selectedOptionText": "A plan for your money",
      "correctOptionId": "…",
      "correctOptionText": "A plan for your money",
      "correct": true,
      "skipped": false,
      "timeMs": 5000,
      "points": 133,
      "explanation": "A budget is a plan for your money."
    }
  ],
  "ratingBefore": null,
  "ratingAfter": null,
  "ratingDelta": null,
  "ratingReason": "no Rating change — practice",
  "xp": {
    "awarded": 20,
    "totalXp": 120,
    "level": 2,
    "levelUp": false,
    "currentStreak": 3,
    "newBadges": []
  },
  "finishedAt": "2026-11-11T10:05:00.000Z"
}
```

### 4.4 `GET /duels/daily/today` — today's Daily Duel (no questions)

Response (200):

```json
{
  "date": "2026-11-11",
  "questionCount": 5,
  "setReady": true,
  "myDuel": null
}
```

`myDuel` is `{ "duelId": "…", "status": "IN_PROGRESS" |
"WAITING_OPPONENT" | "SETTLED" }` once the user has started today.
The set itself is **not** returned here — it is revealed only by
starting. Reading this endpoint generates the day's set on first
read (idempotent).

### 4.5 `POST /duels/daily/start` — start today's Daily Duel

No body. One per user per IST day — a second start is 409
`DUEL_DAILY_ALREADY_PLAYED` (resume via `GET /duels/daily/today`,
not by starting again). Returns the fixed 5-question set for the
day — same ids, same order, same option order for every player
(see §6). `opponent` is `{ "name": "To be paired", "kind": "HUMAN" }`
until settlement.

### 4.6 `POST /duels/daily/:id/answer` — as §4.2, for a Daily Duel

Same body, rules, and response shape as the Bot Duel answer
endpoint. The question order is the daily set's order.

### 4.7 `POST /duels/daily/:id/finish` — finish a Daily Duel

No body. Behaviour by state:

- `IN_PROGRESS` → answers graded (rest become skips), duel marked
  `WAITING_OPPONENT`, then pairing is attempted.
- `WAITING_OPPONENT` → pairing is attempted again (the retry path
  after a failed settlement).
- `SETTLED` → the stored result is replayed.

When no opponent is waiting, the response is (201):

```json
{
  "duelId": "…",
  "type": "DAILY",
  "status": "WAITING_OPPONENT",
  "myScore": 615,
  "myCorrect": 5,
  "myTotalTimeMs": 20000,
  "totalQuestions": 5,
  "message": "Finished. Waiting for another player to finish today’s set — your result will appear when you are paired."
}
```

When a pair settles, the response is the stored result (§4.8) with
`opponent: { "name": "…", "kind": "HUMAN", "score": …, "correct": … }`
and the Rating change filled in.

### 4.8 `GET /duels/:id/result` — one duel's stored result

Response (200) when settled: the `DuelGameResult` row (§4.3 example
— `ratingBefore` / `ratingAfter` / `ratingDelta` filled in for Daily
duels, `ratingReason` in plain words, e.g.
`"You beat Ravi (rated 1000). Your Learning Rating went up by 20."`).

When not settled, the response carries the status instead of a
result:

```json
{
  "duelId": "…",
  "type": "DAILY",
  "status": "WAITING_OPPONENT",
  "myScore": 615,
  "myCorrect": 5,
  "myTotalTimeMs": 20000,
  "totalQuestions": 5,
  "message": "…"
}
```

or `{ "duelId": "…", "type": "BOT", "status": "IN_PROGRESS", "result": null }`.

### 4.9 `GET /duels/history` — my duel history

`?page=1&limit=20`, newest first, standard pagination meta. Each
item: `duelId`, `type`, `status`, `date` (IST date for Daily),
`startedAt`, `finishedAt`, `result`, `myScore`, `opponentScore`,
`opponentName`, `ratingDelta`.

### 4.10 `POST /duels/daily/settle-unpaired` — ADMIN

Body: `{ "date": "2026-11-11" }` (IST date, `YYYY-MM-DD`).
Settles every unpaired Daily Duel for that date against the Mira bot
at each player's own Rating (§7). **Only run for a date whose day has
ended (23:59 IST)** — settling today early pairs players against the
bot while others may still join. One failure (e.g. a Ratings daily
cap) skips that duel and is reported; it never aborts the batch.

Response (201):

```json
{ "date": "2026-11-11", "settled": 1, "failed": [] }
```

---

## 5. Bot algorithm, scoring, and timing

### 5.1 Scoring (one rule, both sides)

Per question: **100 base per correct answer + up to 50 speed bonus**,
`speedBonus = floor(50 × (1 − timeMs / 15000))`, floored at 0. Wrong
= 0, skipped = 0. Worked examples: correct in 0 ms → 150; correct
in 7,500 ms → 125; correct in 15,000 ms → 100.

Winner: more correct answers wins; tie → lower total answer time
wins (sum of `timeMs` over answered questions; skips add no time);
equal on both → draw. Implemented in `duel-scoring.ts`
(`pointsForAnswer`, `decideWinner`, `buildGameStats`) and shared by
the player path and the bot simulation.

### 5.2 Mira (seeded, replayable)

`bot-simulation.ts`: mulberry32 RNG keyed by an FNV-1a hash of the
duel seed (stored on the duel). Same seed + questions + player
rating ⇒ same bot result, always.

**Accuracy** (adaptive to the player's Learning Rating):

| Player Rating | Base accuracy |
| ------------- | ------------- |
| < 1100        | 0.55          |
| 1100–1299     | 0.65          |
| 1300–1499     | 0.75          |
| 1500–1699     | 0.82          |
| 1700+         | 0.88          |

Per question: `p = clamp(base − 0.08 × (difficulty − 3), 0.15, 0.97)`.

**Time per question (ms):**
`clamp(round(3000 + difficulty × 1200 + uniform(0, 6000)), 1500, 14999)`.
Mira never answers in under 1.5 s and never exceeds 15 s. Bot points
use the same scoring rule as the player.

### 5.3 XP (no new values)

`grantDuelRewards` (GamificationService): win → 20 XP (`XP.QUIZ_PASS`),
draw → 5 XP (`XP.TRADE_EXECUTED`), loss → 0 — but the streak still
counts the completion. Ledger key `duel:{duelId}:{userId}`; no outbox
event (finish-replay is the recovery path).

### 5.4 Timing honesty

In this REST step there is no live per-question timer to own:
answers carry the client-reported `timeMs`, the server validates the
range (0–15000) and scores from it, and the client timer is
display-only. A cheating client could report a fast time; that is a
known limit of the async REST format (ADR 0006/5). A server-side
timer arrives with live duels (Step 3).

---

## 6. Daily-set generation and pairing

### 6.1 The day is IST

The Daily Duel day — and the Bot Duel daily cap — are the
**Asia/Kolkata calendar date**, NOT the UTC day the Ratings module
uses for its daily caps (ADR 0005/2). 00:30 IST belongs to the new
IST day even though it is still the previous UTC day. Implemented in
`duel-dates.ts` (`kolkataDateString`, `istDayStartUtc`).

### 6.2 One fixed set per day

Seed = `daily-YYYY-MM-DD`; RNG = mulberry32 of the seed hash;
selection = `QuestionBankService.selectSet` with the daily blueprint
(5 questions, mix {2:2, 3:2, 4:1}, max 2 per topic). Stored in
`DuelDailySet` (`date` unique — the race guard for two concurrent
first players; the loser re-reads the winner's row). Every player
that day gets the same question ids in the same order, and the same
option order (options are shuffled with the same seeded RNG).

**Exposure trade-off (recorded):** the set is generated with no
per-user exclusion — the set must be identical for all players that
day. Exposure is still recorded per player at start, so the _next_
selection avoids those items. A player may therefore see a Daily
question they saw in a Bot Duel within the last 30 days.

### 6.3 Pairing and settlement

Players are paired **in order of finishing**: the earliest
finished-but-unpaired duel (`WAITING_OPPONENT`, ordered by
`finishedAt`) is the waiter. When the second player of a pair
finishes, the duel settles immediately (see §7). A player unpaired
at day end (23:59 IST) is paired against Mira at their own Rating
via `POST /duels/daily/settle-unpaired` (ADMIN, §4.10). There is no
scheduler yet — an operator or a future cron calls the endpoint
after 23:59 IST.

---

## 7. Rating integration

### 7.1 Human pair — the existing duel path, once

Settlement calls `RatingsService.recordDuel` exactly once: caller =
second finisher, opponent = waiter, result from the finisher's
perspective, idempotency key `duel:{finisherDuelId}`. The Ratings
pair/day caps (max 3 same-pair/day, max 10 rated events/user/day)
and the 5-minute rematch cooldown apply at that call. K-factor
boundary is unchanged from ADR 0005/2 (32 at 1400 and below).

**Ordering (ADR 0006/7):** the Ratings call runs _first_, before any
duel row is mutated — so a cap violation fails the settlement
cleanly (both duels stay `WAITING_OPPONENT`, nothing stored) and
re-calling finish retries the pairing. Then duel rows + both
`DuelGameResult` rows + both XP grants commit in one duels
transaction. True single-transaction settlement is impossible
without breaking Ratings ownership: `recordDuel` opens its own
transaction and accepts no transaction client, and Prisma
interactive transactions do not nest.

**Crash recovery:** if the process crashes between the Ratings call
and the duels transaction, a settlement retry detects the
already-applied rating (`IDEMPOTENCY_REPLAY`, whose details carry
the original `DuelResponse`, or `RATING_EVENT_DUPLICATE`) and
recovers the deltas from history via
`RatingsService.getDuelOutcome(userId, eventId)` instead of applying
them twice.

### 7.2 Bot fallback — `recordDuelVsBot`

The bot has no user account, so `recordDuel` cannot apply. The
fallback uses the new additive `RatingsService.recordDuelVsBot`:
only the caller is updated, with the bot fixed at the caller's own
rating (expected score 0.5 — a win always pays, a loss always
costs, symmetrically). One history row, `opponentId` null,
`opponentRating` = the caller's rating before the event. Same
guards where they apply: idempotency key `duel:{duelId}`, max 10
rated events/user/day (UTC). No pair limit, no rematch cooldown.

### 7.3 Rating reasons (plain words)

- Win: `"You beat Ravi (rated 1000). Your Learning Rating went up by 20."`
- Draw/loss: same shape, with "drew with" / "Ravi beat you" and the
  matching delta wording (up / down / did not change).
- Bot fallback: `"No other player finished today’s set, so you played it against Mira (bot) at your own Rating (1000). Your Learning Rating went up by 20."`
- Bot Duel: `"no Rating change — practice"`.

---

## 8. Anti-gaming

- Answers never leave the server before reveal (public views carry
  option id + text only).
- Server owns timing/scoring: range-checked `timeMs`, in-order,
  first-answer-only (unique constraint), server-side grading.
- Daily Duel 1/day (IST); Bot Duel 10/day (IST).
- Ratings pair/day caps + rematch cooldown at settlement; a cap
  violation fails cleanly, never double-applies.
- Duplicate finish is idempotent (stored result replay; ledger-keyed
  XP; `duel:{duelId}`-keyed Rating).

Known limits: client-reported timing (§5.4); no impossibly-fast
flagging yet; concurrent double-finish relies on the status check +
unique result constraint (same posture as the simulator race check).

---

## 9. The 2,000-item launch target (deviation)

Doc 05 §7 asks for 2,000 live items before any rated duel launches.
The bank holds **520** (the 500-item pipeline target is met, the
2,000-item target is still ahead). The rated Daily Duel launches on
the 520-item bank as a **recorded deviation** (ADR 0006 §13): the
task for this step explicitly authorises it, the exposure rules
still hold for Bot Duel selection, and the residual risk (repeat
exposure on the fixed daily set, thinner selection pool) is
documented in §6.2. Growing the bank toward 2,000 remains open work.

---

## 10. Testing

- **Unit (261/261 total, 25 suites):** duel-dates (IST/UTC boundary),
  bot-simulation (determinism, accuracy bands, time bounds),
  duel-scoring (worked scoring examples, winner rule, stats incl.
  worst-first topics), duels service (caps, answer rules, pairing /
  settlement, rating-once, cap-failure cleanliness,
  duplicate-recovery, bot fallback, daily-set determinism), ratings
  (bot win/loss symmetry at expected 0.5, replay, daily cap, outcome
  recovery).
- **E2E (97/97):** bot happy path + finish replay + XP-once, bot
  answer rules + ownership + 15 s limit, bot 10/day cap, daily happy
  path + second-player settlement + rating-once + 1/day 409, daily
  bot fallback via the admin endpoint + second settle is a no-op,
  settle-unpaired ADMIN-only.
- **Worked examples verified:** 5 correct at 5,000 ms ⇒ 5 × 133 =
  665; both players 5/5 with total times 20,000 ms vs 40,000 ms ⇒
  faster player wins +20 (K=40 provisional), slower loses −20.

---

## 11. Manual QA checklist

- [ ] Start a Bot Duel: 7 questions, no answers in the response body.
- [ ] Answer out of order → 400; answer twice → 409; answer another
      user's duel → 403; `timeMs` 15001 → 400.
- [ ] Finish a Bot Duel with 2 questions unanswered: 2 skips in the
      result; finish again → identical result; XP ledger has one row.
- [ ] Start 11 Bot Duels in a day: the 11th is 409
      `DUEL_BOT_DAILY_LIMIT`.
- [ ] `GET /duels/daily/today` shows today's IST date and no questions.
- [ ] Two users start the Daily Duel: identical question ids in
      identical order. First finisher sees `WAITING_OPPONENT`; second
      finisher settles both; both results show mirrored Rating changes;
      `GET /ratings/me` shows one rated event each.
- [ ] Start the Daily Duel twice: 409 `DUEL_DAILY_ALREADY_PLAYED`.
- [ ] One user finishes alone; `POST /duels/daily/settle-unpaired`
      (ADMIN, today's IST date) settles them vs Mira; a second call
      settles 0. A non-admin call is 403.
- [ ] Result page shows per-question explanations and the Rating
      reason in plain words; Bot Duel result shows "no Rating change —
      practice".
- [ ] `GET /duels/history` lists both duel types, newest first.

---

## 12. Limits / not verified

- Migration not applied to a live Postgres; Docker not booted; seed
  never executed against a live DB.
- No live duels yet (no gateway, matchmaking, sticky sessions, Redis
  duel state). Client-reported timing (§5.4).
- No scheduler for `settle-unpaired`; no pilot-data feed from duel
  answers (`discrimination` stays null, no drift check).
- E2E bank seed (96 items, difficulties 1–3) exercises the
  nearest-difficulty fallback for the difficulty-4 cells; the real
  520-item bank has all difficulties.
