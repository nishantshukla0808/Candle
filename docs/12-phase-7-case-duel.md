# Candle — Phase 7 Case Duel (L3)

**Date:** 2026-11-12
**Status:** Built and verified (ADR 0009). The third live duel.
**Depends on:** Blueprint 01, Ratings design 04, Duels design 05,
Phase 4 doc 07, formats/characters doc 08, Phase 5 doc 09, Phase 6
doc 10, ADR 0007, ADR 0008.

Step 5 of the duels build order (docs/05 §7): the third live duel.
It reuses the Phase 5 live engine, gateway, matchmaking, timers,
and settlement path — parameterised by variant — and adds only
what Case Duel needs: a variant config, CASE_CHOICE-only
selection, a 45-second timer, the Case scoring rule (option points

- speed bonus, winner by points), and the reason window. No new
  transport, no new table, no new question format (CASE_CHOICE was
  built in Stage 1 of this phase), no bank growth.

Stage 1 of Phase 7 (already built and verified: 332/332 unit,
107/107 e2e) delivered the CASE_CHOICE format itself — Prisma
fields (`DuelBankItem.context`, `DuelBankItem.rubric`,
`DuelBankOption.points`, `DuelBankOption.consequence`),
`validateCaseChoice`, the public view (which hides points,
`isCorrect`, rubric, and explanation), the web renderer
(`apps/web/app/duels/case-question.tsx`), and 50 LIVE case items
(qb-521..qb-570). Stage 2, this document, is the duel itself.

---

## 1. What Step 5 is (and is not)

| Duel           | Type              | Rated?                    | Format                                                                                           |
| -------------- | ----------------- | ------------------------- | ------------------------------------------------------------------------------------------------ |
| Case Duel (L3) | Live head-to-head | **Yes** — Learning Rating | 5 real-life money cases, 45 sec each, same cases, pick the best action + a reason, rubric-scored |

Not in this step: Chart Detective (L4), any trading duel,
leagues/tournaments, Friend Challenge, profiles/settings/
community, bank growth. Those are later steps.

**Format (doc 08 §3.3, binding):** Case Duel = CASE_CHOICE only,
with its predeclared UI (doc 08 §3.3) and 45-second timer. No new
question format was added, and no other format can appear in a
Case Duel — the selection blueprint passes
`types: ['CASE_CHOICE']` to the bank, and the web page renders
`CaseQuestion` for every Case question.

**Host:** Kabir (doc 08 §2.2). He speaks before the duel ("5
cases, 45 seconds each. Same cases for both of you. Pick the best
action. Good luck.") and after it (a result line + the Rating
change in plain words + one practise-next suggestion). He never
speaks during a case, and he never reveals an answer while a
timer is running. In a Case bot duel the opponent is Mira (same
as the Speed Quiz and Blitz bot duels); Kabir still hosts.

---

## 2. Technical architecture

### 2.1 What was reused from Phase 5/6, and what is new

**Reused unchanged** — one gateway, one engine, one settlement
path (docs/09 §2.1/§2.2, docs/10 §2.1):

| Piece             | File                                            | Reused how                                                                                                                                          |
| ----------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| WebSocket gateway | `live-duels.gateway.ts`                         | Same namespace `/duels-live`, same auth, same rooms, same handlers — gains one new handler, `live:reason` (§3)                                      |
| Live engine       | `live-duel-engine.service.ts`                   | Same state machine, timers, grading, reveal, disconnect/forfeit, settlement, rematch — parameterised by the variant config + the reason window (§4) |
| Matchmaking       | `live-matchmaking.service.ts`                   | Same windows, same 5 s sweep, same 30 s bot offer — run per variant queue (`live:queue:CASE`)                                                       |
| State helpers     | `live-duel-state.ts`                            | Same keys, same `scoresOf`, same window helpers — state gains per-question `reasons` + `reasonDeadlineMs`                                           |
| Rating path       | `RatingsService.recordDuel` / `recordDuelVsBot` | Same idempotency key `duel:{duelId}`, same XP values, same stored-result shape (+ `rubric` per question)                                            |
| Redis adapter     | `live-redis.adapter.ts`                         | Same optional multi-server fan-out, same limits (single-server tested)                                                                              |
| Web patterns      | `apps/web/app/duels/blitz/page.tsx`             | The Case page models the Blitz page's stages, socket handling, and result/rematch flow; the question screen is the Stage 1 `CaseQuestion` component |

**New in this step:**

| Piece             | File                                                    | What it does                                                                                                                                                                                                                           |
| ----------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Variant config    | `live-duel-variants.ts`                                 | `CASE` row: `DuelType.CASE`, 5 questions, 45,000 ms, `types: ['CASE_CHOICE']`, mix `{2:1, 3:2, 4:2}`, max 2 per topic, host Kabir + intro line                                                                                         |
| Case scoring      | `duel-scoring.ts`                                       | `pointsForCaseAnswer` (option points + speed bonus) and `decideWinnerByPoints` (points, then total time, else draw); `buildGameStats` copies the rubric into each per-question stat                                                    |
| Reason window     | `live-duel-engine.service.ts`                           | `submitReason`, `closeQuestionForAnswers`, `openReasonWindow`, `allReasonsIn`; the question timer closes the case for answers, the reason timer postpones the reveal (§4)                                                              |
| Reason event      | `live-duels.gateway.ts` + `dto/live-duels.dto.ts`       | `live:reason` handler + `LiveReasonSocketDto` (`duelId`, `questionId`, `reason` ≤ 80 chars, null = skip)                                                                                                                               |
| Case bot          | `bot-simulation.ts`                                     | `simulateCaseBot` + `botCaseTimeMs`: best action by Rating band, second-best with probability 0.8 of the remainder, else a 0-point action; time 20,000 + difficulty × 5,000 + uniform(0–15,000) ms, clamped 5,000–44,999 ms; no reason |
| Reason storage    | `duels.repository.ts`                                   | `updateAnswerReason`; `createAnswer` persists `reason ?? null`; `findActiveLiveDuelForUser` includes `DuelType.CASE`                                                                                                                   |
| Schema            | `prisma/schema.prisma` + migration 0009 (amended)       | `DuelType.CASE`; `DuelAnswer.reason String?`                                                                                                                                                                                           |
| Shared constants  | `packages/shared/src/constants.ts`                      | `DUELS.CASE_*` tunables (count, mix, types, per-topic cap, 45 s timer, points 100/50/0, speed-bonus max 20, reason window 10 s, host Kabir)                                                                                            |
| Config            | `apps/api/src/config/configuration.ts` + `.env.example` | `CASE_QUESTION_MS` (default 45,000), `CASE_REASON_WINDOW_MS` (default 10,000)                                                                                                                                                          |
| Web page          | `apps/web/app/duels/case/page.tsx`                      | Queue → countdown → `CaseQuestion` → reason window → reveal → result + rematch; sends `live:answer` on action pick and `live:reason` on reason/skip                                                                                    |
| Renderer delta    | `apps/web/app/duels/case-question.tsx`                  | `onActionPicked` (send the action at once) + `pointsBreakdown` / `myReason` on the reveal                                                                                                                                              |
| Result view delta | `apps/web/app/duels/result-view.tsx` + `lib/api.ts`     | Rubric display per question; second-best wording ("Not the best action — you picked 'X' (+N points). Best action: 'Y'."); `CASE` in result/history types, `rubric` on `DuelPerQuestion`                                                |

### 2.2 Data flow (one case, end to end)

1. Both players join `live:queue:CASE` (or accept the Mira bot
   after 30 s). Matchmaking pairs them; the engine selects 5
   CASE_CHOICE items via the blueprint (mix {2:1, 3:2, 4:2}, max
   2 per topic) and stores the public views + the grading rows
   in the Redis duel state.
2. Countdown (3 s, shared `LIVE_COUNTDOWN_MS`). Then the engine
   sends `live:question` (public view only: stem, context,
   options with consequences — never points, `isCorrect`,
   rubric, or explanation) with `deadlineMs = serverNowMs +
45,000` and arms the 45 s question timer.
3. A player picks an action. The web page sends `live:answer`
   at once (after the renderer's 0.5 s confirm). The engine
   grades from the grading rows (`getItemsForGrading`):
   `pointsForCaseAnswer(option.points, timeMs, 45,000)`, stores
   the answer row with `reason: null`, and emits `live:score`
   (scores only).
4. When both players have answered — or the 45 s timer fires —
   the engine closes the case for answers and opens the reason
   window (§4): it emits `live:reason-window` with
   `reasonDeadlineMs` and arms the 10 s reason timer.
5. Each player who answered sends `live:reason` (a chip, or
   `null` to skip). The engine stores the reason on the answer
   row. When every answering player has a reason entry, or the
   10 s expire, the engine reveals: `live:reveal` with the
   rubric, the explanation, the per-option points, and the
   points breakdown in plain words (§3).
6. After the 5th reveal, the engine settles (§8): Ratings first
   (`recordDuel` / `recordDuelVsBot`, idempotency key
   `duel:{duelId}`), then duel rows + both `DuelGameResult` rows
   - XP in one transaction, then `live:finished` + the rematch
     offer.

## 3. WebSocket event contract — full, with deltas from Phase 5/6

Namespace `/duels-live`, one room per duel (`duel:{duelId}`).
The server owns the clock; the client timer is display only.
Answers carry NO `timeMs`. Correctness, points, and the rubric
are never returned before reveal.

### Client → server

| Event              | Payload                            | Ack                                                      | Notes                                                                                                                                                                                                                                                      |
| ------------------ | ---------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `live:join-queue`  | `{ variant: 'CASE' }`              | `{ ok, variant: 'CASE', queuePosition?, ratingWindow? }` | `variant` is always sent explicitly (the server defaults an omitted variant to `LIVE`). Unknown variant → `{ ok: false, code: 'VALIDATION_FAILED' }`.                                                                                                      |
| `live:leave-queue` | `{}`                               | `{ ok }`                                                 | —                                                                                                                                                                                                                                                          |
| `live:accept-bot`  | `{}`                               | `{ ok, opponent: 'BOT', variant: 'CASE' }`               | Only after the 30 s `live:bot-offer`.                                                                                                                                                                                                                      |
| `live:answer`      | `{ duelId, questionId, optionId }` | `{ ok, accepted, points? }`                              | The action. Sent the moment it is picked — never wait for the reason step. First answer only, current question only, before the 45 s deadline.                                                                                                             |
| `live:reason`      | `{ duelId, questionId, reason }`   | `{ ok, submitted }`                                      | **New.** `reason` is a chip string (max 80 chars) or `null` (explicit skip). Accepted only inside the open reason window (§4); otherwise `VALIDATION_FAILED` (no window open / already revealed) or `CONFLICT` (duplicate while the window is still open). |
| `live:leave-duel`  | `{ duelId }`                       | `{ ok }`                                                 | Counts as a loss (forfeit).                                                                                                                                                                                                                                |
| `live:rematch`     | `{ duelId }`                       | `{ ok, matched?, reason?, retryAfterMs? }`               | 5-minute cooldown, per pair per variant (`REMATCH_COOLDOWN` + `retryAfterMs` when too soon).                                                                                                                                                               |

### Server → client

| Event                                                      | Payload                                                                                                                                                                                                                                                                 | Notes                                                                                                                                                                                                                   |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `live:queued`                                              | `{ variant: 'CASE', ratingWindow, queuePosition? }`                                                                                                                                                                                                                     | —                                                                                                                                                                                                                       |
| `live:queue-left`                                          | `{}`                                                                                                                                                                                                                                                                    | —                                                                                                                                                                                                                       |
| `live:bot-offer`                                           | `{}`                                                                                                                                                                                                                                                                    | After 30 s with no human match.                                                                                                                                                                                         |
| `live:matched`                                             | `{ duelId, variant: 'CASE', opponent: { displayName, rating, kind }, host: { name: 'Kabir', line }, questionCount: 5, timeLimitMs: 45000, countdownEndsAtMs }`                                                                                                          | Host line is Kabir's intro (§1).                                                                                                                                                                                        |
| `live:countdown`                                           | `{ countdownEndsAtMs }`                                                                                                                                                                                                                                                 | 3 s.                                                                                                                                                                                                                    |
| `live:question`                                            | `{ duelId, index, total: 5, question: { id, type: 'CASE_CHOICE', stem, context, options: [{ id, text, consequence, order }] }, deadlineMs, timeLimitMs: 45000, serverNowMs }`                                                                                           | 3 options. `context` is the case numbers table. Never `points`, `isCorrect`, `rubric`, or `explanation`. A reconnect inside a reason window resends the question with `reasonDeadlineMs`.                               |
| `live:score`                                               | `{ scores: { playerA: { userId, score, correct }, playerB: { userId, score, correct } \| null } }`                                                                                                                                                                      | Scores only — no answers, no streak, no reasons.                                                                                                                                                                        |
| `live:answer-accepted`                                     | `{ questionId, index }`                                                                                                                                                                                                                                                 | Correctness arrives only at reveal.                                                                                                                                                                                     |
| `live:reason-window`                                       | `{ duelId, index, reasonDeadlineMs }`                                                                                                                                                                                                                                   | **New.** Emitted when the window opens. The web page shows a "share your reason" notice until the reveal.                                                                                                               |
| `live:reveal`                                              | `{ duelId, index, questionId, correctOptionId, correctOptionText, explanation, rubric, optionPoints: [{ optionId, text, points }], pointsBreakdown, myCorrect, mySkipped, myOptionId, myPoints, myReason, scores }`                                                     | **Extended for Case.** `rubric` is the grading rubric line by line; `pointsBreakdown` is plain words ("Best action +100, your action +50 — second-best"); `myReason` is the player's own reason (never the opponent's). |
| `live:opponent-disconnected` / `live:opponent-reconnected` | `{ userId }`                                                                                                                                                                                                                                                            | 15 s grace, then forfeit (§7).                                                                                                                                                                                          |
| `live:rematch-requested`                                   | `{ duelId, userId }`                                                                                                                                                                                                                                                    | —                                                                                                                                                                                                                       |
| `live:finished`                                            | `{ duelId, type: 'CASE', result, score, opponent, correct, wrong, skipped, accuracy, avgTimeMs, fastestTimeMs, slowestTimeMs, bestStreak, perTopic, perQuestion, ratingBefore, ratingAfter, ratingDelta, ratingReason, xp, finishedAt, host: { name: 'Kabir', line } }` | Same stored-result shape as Phase 4/5; each `perQuestion` entry carries `rubric`.                                                                                                                                       |
| `live:error`                                               | `{ message, code? }`                                                                                                                                                                                                                                                    | —                                                                                                                                                                                                                       |

## 4. REST endpoints (`/api/v1/duels`)

No new REST endpoints. The four Phase 5 live endpoints are
variant-aware and their OpenAPI descriptions now mention Case
Duel (CASE):

| Endpoint                 | Case behaviour                                                                   |
| ------------------------ | -------------------------------------------------------------------------------- |
| `GET /live/queue/status` | Returns `variant: 'CASE'` while queued for a Case Duel (`null` when not queued). |
| `GET /live/active`       | Returns the active CASE duel (type `'CASE'`, `timeLimitMs` 45000) or `null`.     |
| `GET /live/:id/state`    | Returns the CASE duel state (`variant: 'CASE'`, `timeLimitMs` 45000).            |
| `POST /live/:id/forfeit` | Forfeits a CASE duel the same way as LIVE/BLITZ.                                 |
| `GET /:id/result`        | Returns type `'CASE'`; each `perQuestion` entry carries `rubric`.                |
| `GET /history`           | Returns Case Duels with type `'CASE'`.                                           |

## 5. CASE_CHOICE format + renderer (Stage 1, summarised)

The format and its rules were built in Stage 1 of this phase
(see the Stage 1 handoff, `/tmp/case-stage1-notes.md`, and doc 08
§3.3); this section summarises what the duel relies on.

- **Schema:** `DuelBankItem.context Json?` (labelled case
  numbers, ≥2 entries with ≥2 carrying a number),
  `DuelBankItem.rubric String? @db.Text` (required, ≥2
  lines/sentences), `DuelBankOption.points Int @default(0)`,
  `DuelBankOption.consequence String?` (required, non-empty).
  Points are exactly one 100 / at most one 50 / rest 0, and the
  correct option must be the 100. Skills are JUDGEMENT /
  SCENARIO / RISK_ASSESSMENT only; difficulty 2–4 only; stem 3–5
  short lines; distinct option texts; no buy/sell recommendation
  for a real security (whole-word match).
- **Public view:** carries `context` + per-option `consequence`
  but NEVER `points`, `isCorrect`, rubric, or explanation.
  Grading must use `getItemsForGrading` (full rows with points
  and rubric).
- **Renderer** (`apps/web/app/duels/case-question.tsx`): renders
  only when `question.type === 'CASE_CHOICE'`; 45 s timer bar,
  case card + numbers table, action cards with consequences,
  0.5 s confirm, optional reason step (3 chips — 'Safest for my
  goal', 'Best long-term value', 'Fits my budget' — + Skip; the
  reason step adds 10 s to the display deadline), reveal (best
  green, wrong pick red, rubric line by line, explanation). No
  host dialogue inside. Stage 2 added `onActionPicked` (called
  when the confirm completes and the reason step opens, so the
  live page can send the action at once) and `pointsBreakdown` /
  `myReason` on the reveal. A test page exists at
  `/duels/case-test` (labelled "not a duel").

## 6. Scoring + rubric, with worked examples

Case scoring (`duel-scoring.ts`, `pointsForCaseAnswer`):

```
points = optionPoints + speedBonus
optionPoints = stored per-option points (100 best / 50 second-best / 0 other)
speedBonus   = floor(20 × (1 − timeMs / 45000)), floored at 0
wrong (0-point action) or skipped = 0
```

Best action max 120, second-best max 70, harmful 0. Reason chips
are NEVER scored — recorded with the answer only.

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

**Winner** (`decideWinnerByPoints`): more points wins, then
lower total answer time, else a draw. A player who picks the
second-best action five times (5 × ~69 = 345) beats a player who
picks the best action twice (2 × ~119 = 238), even though the
second player has more "correct" answers. That is deliberate:
Case Duel grades judgement, not recall. The stored
`DuelGameResult.correct` still counts best actions only.

**Rubric:** every CASE_CHOICE item carries a rubric (≥2 lines).
At reveal the server sends it line by line, plus the explanation
and the per-option points breakdown in plain words, e.g. "Best
action +100, your action +50 — second-best". The rubric is also
copied into each stored per-question stat, so the result screen
shows it under each case. The result screen never calls a
second-best pick "wrong": it reads "Not the best action — you
picked 'X' (+N points). Best action: 'Y'."

## 7. The reason window (binding rule)

The action is the answer, graded on the 45 s timer. After BOTH
players have answered (or the timer expires — no extension
then), there is a reason window of up to 10 s: reveal is
postponed until both players have submitted/skipped a reason OR
10 s after the second answer, whichever comes first. A missing
reason is stored as null, never a lost answer.

Implementation notes (ADR 0009 §4 has the full decision):

- The window opens when the case closes for answers — both
  players answered, or the 45 s deadline fires. The 45 s answer
  deadline is NOT extended: late actions are still rejected.
- It closes when every player who answered has a reason entry
  (chip string, or explicit null skip), or 10 s after it opened,
  whichever comes first. A player who never answered needs no
  reason. The bot's reason is null from the start and never
  blocks the window. If nobody answered, the window opens and
  reveals immediately.
- Storage: `DuelAnswer.reason String?`, `null` = skipped or
  never given. The answer row is created at answer time with
  `reason: null`; `live:reason` updates it via
  `repo.updateAnswerReason` (throws if no answer row exists).
- State: `reasons: Record<userId, Record<questionIndex, reason>>`
  and `reasonDeadlineMs: number | null` on the Redis duel state;
  pre-Phase 7 states parse with both defaulted.
- Client: the page sends `live:answer` the moment an action is
  picked (`onActionPicked`) and `live:reason` when the player
  picks a chip or skips (`onAnswer`). The renderer's +10 s is
  display only; the server owns the real deadline.
- Reconnect inside a reason window re-arms the reason timer and
  resends the question with `reasonDeadlineMs`.

## 8. Matchmaking

- One Redis queue per variant: `live:queue:LIVE`,
  `live:queue:BLITZ`, `live:queue:CASE`. A Case waiter is never
  matched into a Speed Quiz or Blitz duel, and vice versa. One
  queue entry per user across variants (joining a second queue
  while queued returns 409 `DUEL_ALREADY_QUEUED`); no queueing
  while a live duel is active (409 `DUEL_LIVE_ALREADY_ACTIVE`).
- Windows widen with wait, unchanged: ±50 (0–5 s) → ±100
  (5–15 s) → ±200 (15–30 s) → ±400 (30+ s). Nearest Rating in
  the window wins; ties break by earliest join. A 5-second sweep
  pairs waiters whose windows overlap, within one variant only;
  the sweep iterates `['LIVE', 'BLITZ', 'CASE']`.
- After 30 s with no human match, the server emits
  `live:bot-offer`. Accepting from a Case queue starts a Case
  bot duel vs Mira — rated at the player's own Rating, on the
  45-second timer, with the same Case scoring and rubric.
- **Case bot** (`simulateCaseBot`): Mira picks the best action
  with probability = base accuracy by the player's Learning
  Rating (<1100 → 0.55, 1100–1299 → 0.65, 1300–1499 → 0.75,
  1500–1699 → 0.82, 1700+ → 0.88; no difficulty adjustment);
  otherwise the second-best action with probability 0.8 of the
  remainder, else a uniform 0-point action. Her time is
  `20,000 + difficulty × 5,000 + uniform(0–15,000)` ms, clamped
  to 5,000–44,999 ms. She submits no reason (null). Her answers
  are priced through the same `pointsForCaseAnswer` rule.
  Deterministic per (seed, questions, rating).
- Anti-farming at settlement: same pair max 3 rated duels/day,
  max 10 rated events/user/day (docs/04 §5). The 5-minute
  rematch cooldown is per pair per variant; a rematch always
  replays the same variant.

## 9. Timers, disconnect, forfeit

Same as Phase 5/6: 3 s countdown, 45 s per case (config
`CASE_QUESTION_MS`, default 45,000), 10 s reason window (config
`CASE_REASON_WINDOW_MS`, default 10,000), a short reveal pause
(shared `LIVE_REVEAL_PAUSE_MS`), 15 s disconnect grace then
forfeit (the forfeiter loses at the normal K), reconnect to the
same room (state lookup via `live:user-duel:{userId}`), no
late-join. The question timer routes through
`closeQuestionForAnswers` (which opens the reason window for
CASE and reveals directly for LIVE/BLITZ); the reveal-early
path does the same. If Redis state is lost mid-duel, the duel is
voided — no Rating changes.

## 10. Rating integration

Same as Phase 5/6, with the Case winner rule (§6) as the only
difference: the Ratings call runs FIRST (`recordDuel` for a
human pair, `recordDuelVsBot` for a bot duel, at the player's own
Rating), then duel rows + both `DuelGameResult` rows + both XP
grants commit in one duels transaction. Idempotency key
`duel:{duelId}`; a re-settle replays the stored result. XP:
win → 20, draw → 5, loss → 0 (`grantDuelRewards`, reason
`'duel.live_completed'`). Forfeit: the forfeiter loses at the
normal K. Rating-cap failure at settle time settles without a
Rating (ADR 0007 §8.2 carries over).

## 11. Bank growth summary (Stage 1)

The production bank holds **50 LIVE CASE_CHOICE items**
(qb-521..qb-570): 5 per topic across 10 topics; difficulties
2:15 / 3:20 / 4:15; skills JUDGEMENT 20 / SCENARIO 20 /
RISK_ASSESSMENT 10. The bank is thin: a Case Duel draws all 5
cases from those 50, so a frequent Case player sees repeats
sooner than a Speed Quiz player (461 MCQ_4 + 59 TRUE_FALSE) or a
Blitz player (59 TRUE_FALSE). The exposure rules (30-day /
3-times, docs/05 §2.3) still apply, so repeats are throttled,
not eliminated. Growing CASE_CHOICE depth is the next bank task
before Case Duel is promoted heavily (Nishu's order: complete
all duels first, then grow the bank per duel). The 2,000-item
launch target is still ahead (570 LIVE total).

## 12. Load balancing and scaling (docs/05 §3.4 — the honest version)

Same as Phase 5/6 (ADR 0009 §8): sticky sessions are REQUIRED
for the WebSocket upgrade in any multi-server deploy;
`LiveRedisAdapter` fans room messages out, installed only when
`WS_REDIS_ADAPTER_ENABLED=true` (default false). Single-server
v1 works WITHOUT the adapter and is the tested configuration.
The adapter does NOT move the engine's in-process timers: a
server crash mid-duel still voids the duel. Multi-server live
duels without sticky sessions do NOT work.

## 13. Web UI (`apps/web/app/duels/case/`)

`apps/web/app/duels/case/page.tsx`, modelled on the Blitz page's
stages and socket handling:

- Stages: idle → queued → countdown → playing → revealed →
  done. Joins `{ variant: 'CASE' }` explicitly; guards that the
  matched payload has `variant === 'CASE'` (otherwise an error).
- Kabir hosts before/after only (fallback intro: "5 cases, 45
  seconds each. Same cases for both of you. Pick the best action.
  Good luck."). The 45 s timer comes from `timeLimitMs` in the
  `live:question` payload.
- Renders the Stage 1 `CaseQuestion` component for every
  `CASE_CHOICE` question: case card + numbers table, action
  cards with consequences, 45 s timer bar, reason step (3 chips
  - Skip), reveal (best green, wrong pick red, rubric line by
    line, explanation, points breakdown, own reason).
- Sends `live:answer` on action pick (`onActionPicked`) and
  `live:reason` on reason/skip (`onAnswer`). Listens for
  `live:reason-window` and shows a "share your reason" notice
  while the window is open. Live score bar shows scores only.
- Bot offer after 30 s ("Play Mira instead", same 45 s timer,
  same rubric rule). Disconnect notice (15 s grace). Result via
  the shared `DuelResultView` (extended with the rubric display,
  §2.1) + Kabir's host line + rematch (5-min cooldown, per
  pair per variant) + "Back to duels". Educational disclaimer
  (`DuelsDisclaimer`) at the foot.
- The duels hub (`apps/web/app/duels/page.tsx`) gained a Case
  Duel card, first in the list.

## 14. Anti-cheat and fairness (docs/05 §5)

Unchanged from Phase 5/6, plus the reason rule: answers never
leave the server before reveal; the server owns timing/scoring
(no client `timeMs` is accepted in live play); the rubric,
points, and explanation are never sent before reveal; answers
must be the current question, first answer only, in order; a
reason must belong to an answered question inside the open
reason window (no reason without an answer, no duplicate, no
late reason); the reason is never scored, so there is nothing to
game by choosing a chip; one account, one socket for a rated
duel; Ratings pair/day caps + per-variant rematch cooldown at
settlement/offer; duplicate settlement is idempotent (stored
result replay; ledger-keyed XP; `duel:{duelId}`-keyed Rating).

## 15. Testing

- **Unit: 355/355** (baseline 332/30 suites; +23 new). Case
  variant config (5, 45,000, `['CASE_CHOICE']`, mix
  `{2:1,3:2,4:2}`, max 2/topic, host Kabir, intro line); Case
  scoring worked examples (§6) + `decideWinnerByPoints` (five
  second-best picks beat two best picks; time tie-break; draw)
  - rubric carried into the stored per-question stat; Case bot
    simulation (determinism; time in [5000, 44999] and slower on
    harder cases; points ≤ 120, non-correct ≤ 70; best-action rate
    near 0.55 over 5,000 simulated cases at rating 1000;
    stronger player faces sharper Mira); Case queue separation
    (a CASE waiter never matches LIVE/BLITZ); gateway
    (`live:reason` validation: bad UUID rejected, 81-char reason
    rejected, valid chip delegates, null = explicit skip);
    engine (duel creation + Kabir matched payload + 45 s deadline;
    answer after 45 s rejected; scoring + reason flow; reason
    window rejections; window-expiry reveal with reasons left
    null; winner-by-points; Case bot duel; Case rematch replays
    CASE).
- **E2E: 110/110** (baseline 107; +3 new). Case happy path —
  queue → match (variant CASE, 5 cases, host Kabir) → 5 cases
  (`CASE_CHOICE`, 3 options, context present, no `isCorrect` /
  points / rubric in the question payload) → A best every time,
  B second-best every time → both submit reasons (A a chip, B
  null) → reveal carries rubric + points breakdown → settle +
  rate once (ratingDelta 20, one rated event each, type
  `'CASE'` in result/history); reasons verified on the stored
  `DuelAnswer` rows. Case queue separation (CASE waiter never
  matches a LIVE waiter; second CASE waiter pairs; LIVE waiter
  stays queued). Case bot duel via the 30 s offer (accept Mira,
  play 5 cases, settle, one rated event).
- **E2E seed + fakes:** 18 CASE_CHOICE items (3 topics × 3
  difficulties × 2 copies, 3 options each — best 100 /
  second-best 50 / 0-point — with context, rubric, and
  consequences) in the test seed only; `FakeDuelsRepository`
  gained `updateAnswerReason` and CASE in
  `findActiveLiveDuelForUser`. `TEST_ENV` gained
  `CASE_QUESTION_MS: '3000'` and `CASE_REASON_WINDOW_MS:
'2000'` so a 5-case duel finishes in seconds. Two seed
  collisions were found and fixed during the runs: the new
  4-option items broke the Stage 1 selection test (which pins
  3 options), so the seed was aligned to the Stage 1 item's
  3-option shape; the generic selection test (which pins 4
  options) was then pinned to `types: ['MCQ_4', 'TRUE_FALSE']`.
- **Web:** typecheck clean, lint clean (`eslint app
--max-warnings=0`), prettier clean on the new/changed files.
  API typecheck / lint / format clean; `prisma validate` clean.

## 16. Manual QA checklist

- [ ] Join the Case queue from two accounts: matched payload
      shows variant CASE, 5 cases, 45 s, host Kabir with the intro
      line; countdown 3 s; first case renders the case card, the
      numbers table, and 3 action cards with consequences.
- [ ] Pick an action fast: it is sent at once (no waiting for
      the reason step); the reason step opens; pick a chip — the
      reveal shows the rubric line by line, the explanation, the
      points breakdown in plain words, and your own reason.
- [ ] Pick the second-best action: the reveal says "second-best"
      and pays 50 + speed; the result screen says "Not the best
      action" (not "wrong") and shows the rubric.
- [ ] Answer, then let the 10 s reason window expire without a
      reason: the case still reveals, the answer still counts, and
      the stored reason is null.
- [ ] Skip the reason explicitly: same as above, reason null.
- [ ] Wait out the 45 s timer without answering: the case is
      graded a skip (0 points); the reason window opens and reveals
      immediately (no 10 s wait).
- [ ] Queue alone for 30 s: the Mira bot offer appears; accept
      it — the bot duel runs 5 cases on the 45 s timer with the
      rubric, and settles rated once.
- [ ] Disconnect mid-duel: the opponent sees the 15 s notice;
      reconnect within it to resume the same room; after 15 s the
      duel forfeits.
- [ ] Rematch within 5 minutes of a Case Duel against the same
      player: the cooldown message appears with the wait time; a
      rematch after a Speed Quiz Duel against the same player is not
      blocked.
- [ ] Mobile (360 px): the case card, numbers table, action
      cards, reason chips, and reveal all fit without overflow;
      buttons are tappable.
- [ ] The duels hub shows the Case Duel card first; the result
      screen shows the rubric under each case.

## 17. Limits / not verified

- Migration 0009 NOT applied to a live Postgres; Docker not
  booted; seed never executed against a live DB; single-server
  is the tested configuration (multi-server sticky LB + Redis
  adapter implemented but not tested end to end).
- The production bank holds only 50 CASE_CHOICE items (§11):
  Case Duel repeats sooner than Speed Quiz or Blitz. No live
  duels, matchmaking, or scheduler runs exist yet.
- The e2e seed's 18 CASE items and the Stage 1 item share one
  stem/context/rubric shape, so the e2e happy path cannot tell
  which item was served — the assertions accept either
  explanation. The production bank has 50 distinct cases.
- The reason window is enforced server-side; a client that
  sends a reason after the reveal loses the reason (the answer
  stands). No reason analytics exist yet (chips are recorded,
  not aggregated).
