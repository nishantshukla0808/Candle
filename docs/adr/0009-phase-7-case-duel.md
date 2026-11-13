# ADR 0009 — Phase 7 Case Duel (L3)

**Date:** 2026-11-12
**Status:** Accepted (built and verified; see §12)
**Context:** docs/05-duels-system-design.md §1/§7 (build order Step 5),
docs/04-ratings-and-deployment.md (Ratings, not ELO), docs/08
(predeclared formats + characters — CASE_CHOICE §3.3, Kabir §2.2),
docs/09 + ADR 0007 (the Phase 5 live engine this step reuses),
docs/10 + ADR 0008 (the Phase 6 variant pattern), ADR 0006 (the
settlement pattern). Stage 1 of this phase (format, schema,
validation, web renderer, 50 LIVE case items) is built and verified
(332/332 unit, 107/107 e2e); this ADR covers Stage 2 — the duel
itself. The live Speed Quiz Duel (Phase 5) and Myth vs Fact Blitz
(Phase 6) are built; no Case Duel existed before this phase.

## 1. What was built

A live, rated, head-to-head Case Duel (L3) on the Phase 5 live
engine — parameterised by variant, not duplicated:

- Backend: `src/modules/duels/live-duel-variants.ts` (the variant
  table gains `CASE`), Case scoring in `duel-scoring.ts`
  (`pointsForCaseAnswer` / `decideWinnerByPoints`, §5), Case-aware
  state (`live-duel-state.ts`: per-question `reasons` +
  `reasonDeadlineMs`, §4), Case bot simulation in
  `bot-simulation.ts` (`simulateCaseBot` / `botCaseTimeMs`, §6),
  variant-aware matchmaking (`live-matchmaking.service.ts`: the
  sweep now iterates `['LIVE', 'BLITZ', 'CASE']`), variant-aware
  engine (`live-duel-engine.service.ts`: 45 s timer, Case grading,
  the reason window, Case reveal, winner-by-points settlement,
  Case rematch), the `live:reason` socket event
  (`live-duels.gateway.ts` + `LiveReasonSocketDto`, §3), and
  repository support for the reason column
  (`duels.repository.ts`: `updateAnswerReason`, §4).
- Prisma: `DuelType.CASE` and `DuelAnswer.reason String?`,
  migration `0009_phase7_case_duel` **amended** (see §10) — no
  second migration for this phase, because 0009 was never applied
  to a live Postgres. No new tables, no new index.
- Shared: `DUELS.CASE_*` tunables (count, mix, types, per-topic
  cap, 45 s timer, points 100/50/0, speed-bonus max 20, reason
  window 10 s) and `DUELS.CASE_HOST_NAME = 'Kabir'`.
- Config: `CASE_QUESTION_MS` (default 45,000) and
  `CASE_REASON_WINDOW_MS` (default 10,000).
- Web: `apps/web/app/duels/case/page.tsx` (queue, countdown,
  `CaseQuestion` per case, reason window, reveal, result +
  rematch) + a Case Duel card on the duels hub
  (`apps/web/app/duels/page.tsx`) + `CASE` added to the web
  `DuelResultResponse` / `DuelHistoryItem` types and `rubric` to
  `DuelPerQuestion` (`apps/web/lib/api.ts`) + rubric display and
  the second-best wording in the shared result view
  (`apps/web/app/duels/result-view.tsx`). The Stage 1 renderer
  (`case-question.tsx`) gained `onActionPicked` (send the action
  at once) and `pointsBreakdown` / `myReason` on the reveal.
- Tests: unit + e2e (see §12). Docs: `docs/12-phase-7-case-duel.md`
  (architecture, full event contract and deltas from Phase 5/6,
  scoring + rubric, matchmaking, Rating, testing, manual QA),
  this ADR, module README, docs/05 + docs/08 status updates.

No Chart Detective, trading duel, league, bank growth, new
question format, or profiles/settings/community code. Those are
later steps — and bank growth is explicitly deferred per Nishu's
decision (complete all duels first, then grow the bank per duel).

## 2. The duel

**Case Duel (L3, rated, Learning Rating).** 5 real-life money
cases, 45 seconds each, same cases in the same order with the same
option order for both players, live progress (scores, not
answers). Difficulty mix {2: 1, 3: 2, 4: 2}, at most 2 cases from
one topic. Scoring is option points (100 best / 50 second-best /
0 other) plus a speed bonus of up to 20 (§5). The winner is the
player with more points, then the lower total answer time, else a
draw. Host is **Kabir**: he speaks before the duel ("5 cases, 45
seconds each. Same cases for both of you. Pick the best action.
Good luck.") and after it, never during a case (doc 08 §2.2).
Format is CASE_CHOICE only, with its predeclared UI (doc 08
§3.3) — no new format was added, and no other format can appear
in a Case Duel: the selection blueprint passes
`types: ['CASE_CHOICE']` to the bank, and the web page renders
`CaseQuestion` for every Case question.

## 3. Transport and authority (unchanged from Phase 5/6, plus variant and reason)

- One `LiveDuelsGateway` on namespace `/duels-live`, one room per
  duel (`duel:{duelId}`). The gateway is transport only. The
  server owns the clock; the client timer is display only.
  Answers carry NO `timeMs` — the engine grades from
  `server now − question start`. Correctness, points, and the
  rubric are never returned before reveal.
- **Variant.** `live:join-queue` now accepts
  `{ variant?: 'LIVE' | 'BLITZ' | 'CASE' }` (default `'LIVE'`;
  an unknown variant is rejected with
  `{ ok:false, code:'VALIDATION_FAILED' }`). `live:queued` gains
  `variant`; `live:matched` gains `variant` + `timeLimitMs`
  (45000 CASE) and `questionCount` 5 for Case; `live:question`
  carries `timeLimitMs` 45000 and
  `deadlineMs = serverNowMs + 45000`, with `question.type`
  `'CASE_CHOICE'`, 3 options (best / second-best / 0-point,
  shuffled order), `context` (the case numbers table), and a
  per-option `consequence` — and never `points`, `isCorrect`,
  `rubric`, or `explanation`. The join-queue and accept-bot acks
  carry `variant`.
- **Reason event (new).** `live:reason` carries
  `{ duelId, questionId, reason }`, validated by
  `LiveReasonSocketDto` (both ids UUID v4; `reason` optional,
  string, max 80 chars; `null` = an explicit skip). The ack is
  `{ ok, submitted }` or an error ack. The server accepts a reason
  only inside the open reason window (§4); anything else is
  rejected (`VALIDATION_FAILED` before the window opens or after
  the reveal, `CONFLICT` for a duplicate while the window is
  still open).
- **Reason window event (new).** `live:reason-window` carries
  `{ duelId, index, reasonDeadlineMs }` and is emitted to the
  room when the window opens (see §4). A reconnect inside a
  reason window re-arms the reason timer and resends the
  question with `reasonDeadlineMs`.
- **Case reveal (extended).** `live:reveal` for a Case Duel
  additionally carries `rubric` (the grading rubric, line by
  line), `optionPoints` (`[{ optionId, text, points }]` for every
  action), `pointsBreakdown` (plain words, e.g. "Best action
  +100, your action +50 — second-best"), `myOptionId`,
  `myPoints`, and `myReason` — never the opponent's reason.
  `live:score` is unchanged in shape (scores only).
- REST: `GET /live/queue/status` returns `variant`
  (`'LIVE' | 'BLITZ' | 'CASE' | null`); `GET /live/active` and
  `GET /live/:id/state` return `variant` + `type` (`'CASE'`) +
  `timeLimitMs` 45000 for Case. No new REST endpoints — the four
  Phase 5 live endpoints are variant-aware.
  `GET /duels/:id/result` and `GET /duels/history` return type
  `'CASE'`, and the stored per-question stat carries `rubric`
  (shown on the result screen).
- State lives in Redis (`live:duel:{duelId}`, JSON, 900 s TTL;
  `live:user-duel:{userId}` for reconnect lookup). Postgres is
  the source of truth after the duel ends. If Redis state is lost
  mid-duel, the duel is voided — no Rating changes (docs/05 §3.2).
- Timers live on the process that created the duel (v1, single
  server), exactly as in Phase 5 (§7).

## 4. The reason window (the binding rule, and how it was implemented)

**The rule (from the task, recorded here as the decision):**
the action is the answer, graded on the 45 s timer. After BOTH
players have answered (or the timer expires — no extension then),
there is a reason window of up to 10 s: reveal is postponed
until both players have submitted/skipped a reason OR 10 s after
the second answer, whichever comes first. A missing reason is
stored as null, never a lost answer. Reason chips are NEVER
scored — recorded with the answer only.

**Interpretation (decided while building, because the task
phrasing left the exact boundary open):** the window opens when
the case closes for answers — both players answered, or the 45 s
deadline fires. The 45 s answer deadline is NOT extended: late
actions are still rejected, and the window is only for reasons.
It closes when every player who answered has a reason entry (a
chip string, or an explicit null skip), or 10 s after it opened,
whichever comes first. A player who never answered needs no
reason. The bot's reason is null from the start and never blocks
the window. If nobody answered, the window opens and reveals
immediately (no 10 s wait) — there is nothing to wait for.

**Storage:** `DuelAnswer.reason String?` (migration 0009, §10),
`null` = skipped or never given. The answer row is created at
answer time with `reason: null`; `live:reason` updates it via
`repo.updateAnswerReason` (which throws if no answer row exists
— a reason without an answer is impossible). The in-memory state
carries `reasons: Record<userId, Record<questionIndex, reason>>`
and `reasonDeadlineMs: number | null`; pre-Phase 7 states parse
with both defaulted (`reasons = {}`, `reasonDeadlineMs = null`).

**Client contract:** the web page sends `live:answer` the moment
an action is picked (`CaseQuestion.onActionPicked`, after its
0.5 s confirm) and `live:reason` when the player picks a chip or
skips (`CaseQuestion.onAnswer`). The renderer adds 10 s to its
display deadline when the reason step opens (doc 08 §3.3) — that
is display only; the server owns the real deadline.

## 5. Scoring — the Case rule

Case scoring (`duel-scoring.ts`, `pointsForCaseAnswer`):

```
points = optionPoints + speedBonus
optionPoints = the stored per-option points (100 best / 50 second-best / 0 other)
speedBonus   = floor(20 × (1 − timeMs / 45000)), floored at 0
wrong (0-point action) or skipped = 0
```

So the best action pays at most 120, the second-best at most 70,
a harmful action 0. The winner is decided by
`decideWinnerByPoints`: more points wins, then lower total answer
time, else a draw — **not** by correct count. A player who picks
the second-best action five times (5 × ~69 = 345) beats a player
who picks the best action twice (2 × ~119 = 238), even though the
second player has more "correct" answers. That is deliberate:
Case Duel grades judgement, not recall, and the stored
`DuelGameResult.correct` still counts best actions only — the
result screen says so ("Not the best action — you picked 'X'
(+N points). Best action: 'Y'.") instead of calling a
second-best pick "wrong".

Worked examples (pinned in unit tests):

| Answer             | Time      | Points         |
| ------------------ | --------- | -------------- |
| Best action        | 0 ms      | 120 (100 + 20) |
| Best action        | 22,500 ms | 110 (100 + 10) |
| Best action        | 45,000 ms | 100 (100 + 0)  |
| Second-best action | 0 ms      | 70 (50 + 20)   |
| Second-best action | 22,500 ms | 60 (50 + 10)   |
| Second-best action | 45,000 ms | 50 (50 + 0)    |
| 0-point action     | any       | 0              |
| Skipped            | —         | 0              |

Grading uses `getItemsForGrading` (full rows with points and
rubric), never the public view. The rubric is copied into each
stored per-question stat (`buildGameStats` carries
`item.rubric ?? null`), so the result screen can show it.

## 6. Matchmaking and the Case bot

- Queue: Redis sorted set **per variant** — `live:queue:LIVE`,
  `live:queue:BLITZ`, and now `live:queue:CASE`, member = user
  id, score = Learning Rating, plus the shared per-user entry key
  (`live:queue-entry:{userId}`, JSON: rating + join time +
  variant, 300 s TTL). A Case waiter is never matched into a
  Speed Quiz or Blitz duel, and vice versa. **One queue entry per
  user across variants**: a user already queued for one variant
  who joins another gets 409 `DUEL_ALREADY_QUEUED`. (No queueing
  while a live duel is active: 409 `DUEL_LIVE_ALREADY_ACTIVE`.)
- Windows widen with wait, unchanged: ±50 (0–5 s) → ±100
  (5–15 s) → ±200 (15–30 s) → ±400 (30+ s). Nearest Rating in the
  window wins; ties break by earliest join. A 5-second sweep
  pairs waiters whose windows overlap, within one variant only.
  The sweep now iterates `['LIVE', 'BLITZ', 'CASE']`.
- After 30 s with no human match, the server emits
  `live:bot-offer` (text unchanged). Accepting from a Case queue
  starts a **Case** bot duel vs Mira — rated at the player's own
  Rating, on the 45-second timer, with the same Case scoring and
  rubric — not a Speed Quiz or Blitz duel. The bot duel replays
  the variant the player queued for.
- **Case bot simulation** (`bot-simulation.ts`,
  `simulateCaseBot`, defined explicitly here because the task
  required it): Mira picks the best action with probability =
  base accuracy by the player's Learning Rating (the same bands
  as the existing Mira bot — <1100 → 0.55, 1100–1299 → 0.65,
  1300–1499 → 0.75, 1500–1699 → 0.82, 1700+ → 0.88; **no
  difficulty adjustment**); otherwise she picks the second-best
  action with probability 0.8 of the remainder, else a uniform
  0-point action. Her time is
  `20,000 + difficulty × 5,000 + uniform(0–15,000)` ms, clamped
  to 5,000–44,999 ms — slower on harder cases, always inside the
  45 s timer. She submits no reason (null). Her answers are
  priced through the same `pointsForCaseAnswer` rule, so both
  sides are scored identically. Deterministic per
  (seed, questions, rating).
- Anti-farming, unchanged at settlement: same pair max 3 rated
  duels/day, max 10 rated events/user/day (docs/04 §5). The
  5-minute rematch cooldown is **per pair per variant**: a Case
  rematch is not blocked by a recent Speed Quiz or Blitz duel
  against the same player, and a rematch always replays the same
  variant.

## 7. Settlement (one Rating update, once)

Unchanged from ADR 0007 §6, with one Case difference: the
Ratings call runs FIRST, then duel rows + both `DuelGameResult`
rows + both XP grants commit in one duels transaction.
Idempotency key `duel:{duelId}`; a re-settle replays the stored
result. Human pair: `recordDuel`; bot duel: `recordDuelVsBot`
at the player's own Rating. Forfeit: the forfeiter loses at the
normal K (ADR 0007 §8.1 deviation carries over). Rating-cap
failure at settle time settles without a Rating (ADR 0007 §8.2).
XP reuses existing values only (`grantDuelRewards`, reason
`'duel.live_completed'`): win → 20, draw → 5, loss → 0.
Post-game stats reuse `buildGameStats` / `mirrorOutcome` — the
same stored-result shape as Phase 4/5, with `rubric` added to
each per-question stat (§3). **The Case difference is the
winner rule only:** `settleDuel` uses `decideWinnerByPoints`
(points, then total time) for CASE and `decideWinner` (correct
first) for LIVE/BLITZ. The stored `correct` count still means
"best actions picked".

## 8. Load balancing (docs/05 §3.4 — the honest version, unchanged)

Sticky sessions are REQUIRED for the WebSocket upgrade in any
multi-server deploy. `LiveRedisAdapter` fans room messages out to
players on different servers, installed in `main.ts` only when
`WS_REDIS_ADAPTER_ENABLED=true` (default false). Single-server v1
works WITHOUT the adapter — the in-process Socket.IO server is
enough, and that is the tested configuration. The adapter does NOT
move the engine's in-process timers: a server crash mid-duel
still voids the duel. Multi-server live duels without sticky
sessions do NOT work, and this ADR does not claim otherwise.

## 9. Deviations and known limits (recorded, not hidden)

1. **Forfeit Rating uses the normal K, not a smaller K** (ADR 0007
   §8.1, carries over — `RatingsService` has no smaller-K path).
2. **Rating-cap failure at settle time settles without a Rating**
   (ADR 0007 §8.2, carries over).
3. **No impossibly-fast-answer flagging yet** (doc 05 §5, ADR 0007
   §8.3, carries over): the server clock makes fake times
   impossible, but sub-300 ms correct answers on hard questions
   are not flagged — there is still no flag store.
4. **No scheduler, no leagues, no pilot-data feed** (unchanged
   from ADR 0006/14 and ADR 0007 §8.4).
5. **The 2,000-item launch target is still ahead, and Case Duel
   repeats sooner than Speed Quiz.** The production bank holds
   **570 LIVE items, of which only 50 are CASE_CHOICE** (Stage 1:
   qb-521..qb-570) — a Case Duel draws all 5 cases from those 50,
   so a frequent Case player sees repeats sooner than a Speed
   Quiz player (whose pool is 461 MCQ_4 + 59 TRUE_FALSE) or a
   Blitz player (59 TRUE_FALSE). **Bank growth is deferred per
   Nishu's decision** (complete all duels first, then grow the
   bank per duel); the exposure rules (30-day / 3-times, docs/05
   §2.3) still apply to the shared set, so repeats are throttled,
   not eliminated. Growing CASE_CHOICE depth is the next bank
   task before Case Duel is promoted heavily.
6. **The reason window is a server-side delay, not a client
   countdown.** The web page shows a "share your reason" notice
   while the window is open, but the 10 s is enforced by the
   engine timer; a client that never sends a reason simply gets
   `null` stored. A client that sends a reason after the reveal
   gets `VALIDATION_FAILED` — the reason is lost, the answer is
   not.
7. **Pre-existing e2e flake, not from Phase 7.** An admin test
   publishes a LIVE "What is a budget?" item; Bot/Live happy-path
   tests assert the first-question explanation matches
   `/^Because QB/` and random selection occasionally picks the
   admin item instead. Full e2e runs during Phase 6 went
   102/104 → 104/104 → 103/104 → 104/104 with zero code changes
   between runs. Phase 7 runs went 108/110 → 109/110 → 110/110;
   the two failures in the first two runs were real test-seed
   collisions from this phase's own new seed items (fixed by
   aligning the seed shape and pinning the generic selection
   test to the quiz formats — see docs/12 §10), not the flake.

## 10. Migration 0009 (amended, hand-reviewed)

`0009_phase7_case_duel` was authored in Stage 1 (schema, context,
rubric, points, consequence) and **amended in Stage 2** — not
replaced by a second migration — because it was never applied to
a live Postgres, so amending it is correct. The amendment
appends two statements to the Stage 1 file:

```sql
ALTER TYPE "DuelType" ADD VALUE 'CASE';
ALTER TABLE "duel_answers" ADD COLUMN "reason" TEXT;
```

No new tables — queue and live state are Redis-only by design
(docs/05 §3.2/§3.3). No new index: the Phase 5 index on
`(type, status, createdAt)` already covers CASE lookups ("my
active CASE duel", rematch-cooldown reads), and `reason` is read
only with its answer row. Note: `ALTER TYPE … ADD VALUE`
cannot run inside a transaction block; `prisma migrate deploy`
handles enum additions accordingly — do not hand-wrap this file
in BEGIN/COMMIT. The migration was NOT applied to a live Postgres
(none on this machine). `prisma validate` passes with
`DATABASE_URL` set, and the Prisma client was regenerated
(`DuelType.CASE` confirmed in the generated client).

## 11. Additive core touchpoints (blueprint §2.4)

The only edits outside `duels/` are additive: the shared
`DUELS.CASE_*` constants, the `CASE` value on the `DuelType`
enum, the `reason` column on `DuelAnswer`, the config timers
(`CASE_QUESTION_MS`, `CASE_REASON_WINDOW_MS`; the 3 s countdown
stays the shared `LIVE_COUNTDOWN_MS`), and the e2e fakes / seed
(18 CASE_CHOICE items at difficulties 2–4 in the test seed only
— the production bank is untouched; they mirror the Stage 1
item's 3-option shape and context so the Stage 1 selection test
and the Case duel tests hold whichever LIVE CASE item the random
selection picks, and the generic selection test is pinned to
`types: ['MCQ_4', 'TRUE_FALSE']` for the same reason). No
existing behaviour was changed: Speed Quiz, Blitz, Bot Duel, and
Daily Duel all pass unchanged, and the `LIVE` default on
`live:join-queue` means old clients that omit `variant` still get
a Speed Quiz duel.

The web step's only edits outside the new Case page are the hub
card, the `CASE` additions to web result/history types, the
`rubric` field on `DuelPerQuestion`, the rubric display + the
second-best wording in the shared result view, and the
`onActionPicked` / `pointsBreakdown` / `myReason` additions to
the Stage 1 `CaseQuestion` component. No backend code, migration,
or test seed was changed by the web step.

## 12. Verification

- Unit: **355/355** (baseline 332/30 suites; +23 new: Case
  variant config, Case scoring incl. the worked examples in §5
  and winner-by-points, Case bot simulation incl. the accuracy
  bands and the 5–45 s time range, Case matchmaking queue
  separation, gateway `live:reason` validation, engine — 5
  CASE_CHOICE cases, 45 s timer, scoring + reason flow, window
  expiry with reasons left null, winner-by-points, Case bot
  duel, Case rematch).
- E2E: **110/110** (baseline 107; +3 new Case tests: happy path
  — queue → match → 5 cases → settle + rate once, with a
  second-best answer paying 50 + speed and reasons stored
  (chip for A, null for B); queue separation — a CASE waiter
  never matches a LIVE waiter; Case bot duel via the 30 s offer,
  5 cases vs Mira). The e2e seed gained 18 CASE_CHOICE items
  (3 topics × 3 difficulties × 2 copies, 3 options each) and the
  fakes gained `updateAnswerReason` + CASE in
  `findActiveLiveDuelForUser`. See §9.7 for the two seed
  collisions found and fixed during the runs.
- Web: typecheck clean, lint clean (`eslint app
--max-warnings=0`), prettier clean on the new/changed files.
  API typecheck / lint / format clean; `prisma validate` clean.
- Worked examples verified in unit tests (see §5 table); the
  Case e2e happy path settles with one rated event each, the
  stored result carrying `rubric` per question, and the stored
  answer rows carrying the submitted reasons.

## 13. Consequences

- Step 6 (Chart Detective, L4) inherits the live engine, the
  gateway, and the per-variant queue: it needs the CHART_CHOICE
  format renderer + its scoring rule + bank depth, not a new
  transport. A fourth variant is one row in
  `LIVE_DUEL_VARIANTS` plus its scoring rule — the variant table
  is now the extension point, proven three times over.
- The CASE_CHOICE bank depth (50) is the binding constraint on
  Case Duel quality: before Case Duel is promoted, grow
  CASE_CHOICE toward the per-cell minimums in docs/05 §2.3, or
  Case repeats will be the first complaint (see §9.5).
- The reason window is a reusable pattern: any future duel type
  that wants a post-answer reflection step can reuse
  `live:reason` + `reasonDeadlineMs` + the window machinery
  (open on close-for-answers, reveal on all-in or expiry) without
  touching the answer path — but it must decide, as this ADR
  did, whether the window can ever extend the answer deadline
  (here: never).
- Any future rating-formula change must keep the audit trail
  honest (ADR 0005/14); live settlement writes the same history
  shape as `recordDuel` / `recordDuelVsBot`.
- If crash-resume for live duels becomes a requirement, the
  timers must move out of process memory (e.g. Redis delayed
  jobs) — see §8. Until then, a crash voids the duel and no
  Rating changes.
