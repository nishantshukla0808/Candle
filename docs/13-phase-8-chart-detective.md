# Candle — Phase 8 Chart Detective (L4)

**Date:** 2026-11-12
**Status:** Built and verified (ADR 0010). The fourth live duel.
**Depends on:** Blueprint 01, Ratings design 04, Duels design 05,
Phase 4 doc 07, formats/characters doc 08, Phase 5 doc 09, Phase 6
doc 10, Phase 7 doc 12, ADR 0007, ADR 0008, ADR 0009.

Step 6 of the duels build order (docs/05 §7): the fourth live duel.
It reuses the Phase 5 live engine, gateway, matchmaking, timers,
and settlement path — parameterised by variant — and adds only
what Chart Detective needs: a variant config, CHART_CHOICE-only
selection, a 30-second timer, the standard live scoring rule on
that timer, and the chart annotation on reveal (and in the stored
per-question stat). No new transport, no new table, no new socket
event, no new question format (CHART_CHOICE was built in Stage 1
of this phase), no bank growth.

Stage 1 of Phase 8 (already built and verified: 378/378 unit,
113 e2e with 3 new CHART tests) delivered the CHART_CHOICE format
itself — the Prisma field (`DuelBankItem.chart` JSONB), the seeded
chart generator (deterministic, mulberry32 + FNV-1a), the template
registry (`CHART_TEMPLATES`, 5 templates), `validateChartChoice`,
the public view (which strips the annotation), the web renderer
(`apps/web/app/duels/chart-question.tsx` — an inline SVG line
chart with a highlighted zone), and 50 LIVE chart items
(qb-571..qb-620). Stage 2, this document, is the duel itself.

---

## 1. What Step 6 is (and is not)

| Duel                 | Type              | Rated?                    | Format                                                                                        |
| -------------------- | ----------------- | ------------------------- | --------------------------------------------------------------------------------------------- |
| Chart Detective (L4) | Live head-to-head | **Yes** — Learning Rating | 5 fictional charts, 30 sec each, same charts, read the chart and pick the best interpretation |

Not in this step: Paper Trading Sprint (T1), any other trading
duel, leagues/tournaments, Friend Challenge, profiles/settings/
community, bank growth. Those are later steps.

**Format (doc 08 §3.4, binding):** Chart Detective =
CHART_CHOICE only, with its predeclared UI (doc 08 §3.4) and
30-second timer. No new question format was added, and no other
format can appear in a Chart Detective duel — the selection
blueprint passes `types: ['CHART_CHOICE']` to the bank, and the
web page renders `ChartQuestion` for every Chart question.

**Host:** Kabir (doc 08 §2.2). He speaks before the duel ("5
charts, 30 seconds each. Same charts for both of you. Read the
chart, then pick the best interpretation. Good luck.") and after
it (a result line + the Rating change in plain words + one
practise-next suggestion). He never speaks during a chart, and he
never reveals an answer while a timer is running. In a Chart bot
duel the opponent is Mira (same as the Speed Quiz, Blitz, and
Case bot duels); Kabir still hosts.

---

## 2. Technical architecture

### 2.1 What was reused from Phase 5/6/7, and what is new

**Reused unchanged** — one gateway, one engine, one settlement
path (docs/09 §2.1/§2.2, docs/10 §2.1, docs/12 §2.1):

| Piece             | File                                            | Reused how                                                                                                                                           |
| ----------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| WebSocket gateway | `live-duels.gateway.ts`                         | Same namespace `/duels-live`, same auth, same rooms, same handlers — no new handler at all (§3)                                                      |
| Live engine       | `live-duel-engine.service.ts`                   | Same state machine, timers, grading, reveal, disconnect/forfeit, settlement, rematch — parameterised by the variant config (§4, §7)                  |
| Matchmaking       | `live-matchmaking.service.ts`                   | Same windows, same 5 s sweep, same 30 s bot offer — run per variant queue (`live:queue:CHART`)                                                       |
| State helpers     | `live-duel-state.ts`                            | Same keys, same `scoresOf` — state parse keeps the CHART variant instead of defaulting to LIVE                                                       |
| Rating path       | `RatingsService.recordDuel` / `recordDuelVsBot` | Same idempotency key `duel:{duelId}`, same XP values, same stored-result shape (+ `chart` + `annotation` per question)                               |
| Redis adapter     | `live-redis.adapter.ts`                         | Same optional multi-server fan-out, same limits (single-server tested)                                                                               |
| Web patterns      | `apps/web/app/duels/case/page.tsx`              | The Chart page models the Case page's stages, socket handling, and result/rematch flow; the question screen is the Stage 1 `ChartQuestion` component |

**New in this step:**

| Piece             | File                                                    | What it does                                                                                                                                                                                               |
| ----------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Variant config    | `live-duel-variants.ts`                                 | `CHART` row: `DuelType.CHART`, 5 questions, 30,000 ms, `types: ['CHART_CHOICE']`, mix `{2:1, 3:2, 4:2}`, max 2 per topic, host Kabir + intro line                                                          |
| Chart scoring     | `duel-scoring.ts`                                       | The standard rule on the 30 s timer (`pointsForAnswer`, no new function) + `decideWinner` (correct count first — same as LIVE/BLITZ); `buildGameStats` splits chart/annotation into each per-question stat |
| Chart bot         | `bot-simulation.ts`                                     | `simulateChartBot` + `botChartTimeMs`: correct by Rating band, else a uniform wrong interpretation; time 12,000 + difficulty × 2,000 + uniform(0–10,000) ms, clamped 5,000–29,999 ms                       |
| Annotation carry  | `live-duel-engine.service.ts`                           | Reveal payload gains `chartExtras.annotation` (from the grading row); per-question stats gain `chart` (public part) + `annotation`                                                                         |
| Repository        | `duels.repository.ts`                                   | `findActiveLiveDuelForUser` includes `DuelType.CHART`; `duels.service.ts` history + stored-result branches include CHART                                                                                   |
| Schema            | `prisma/schema.prisma` + migration 0010 (amended)       | `DuelType.CHART` (the `chart` JSONB column was Stage 1)                                                                                                                                                    |
| Shared constants  | `packages/shared/src/constants.ts`                      | `DUELS.CHART_*` tunables (count, mix, per-topic cap — host, types, and timer already existed from Stage 1)                                                                                                 |
| Config            | `apps/api/src/config/configuration.ts` + `.env.example` | `CHART_QUESTION_MS` (default 30,000)                                                                                                                                                                       |
| Web page          | `apps/web/app/duels/chart/page.tsx`                     | Queue → countdown → `ChartQuestion` → reveal with the annotation → result + rematch                                                                                                                        |
| Result view delta | `apps/web/app/duels/result-view.tsx` + `lib/api.ts`     | Annotated chart display per question (reuses the Stage 1 `ChartSvg` + `TREND_LABEL`); `CHART` in result/history types, `chart` + `annotation` on `DuelPerQuestion`                                         |

### 2.2 Data flow (one chart, end to end)

1. Both players join `live:queue:CHART` (or accept the Mira bot
   after 30 s). Matchmaking pairs them; the engine selects 5
   CHART_CHOICE items via the blueprint (mix {2:1, 3:2, 4:2}, max
   2 per topic) and stores the public views + the grading rows
   in the Redis duel state.
2. Countdown (3 s, shared `LIVE_COUNTDOWN_MS`). Then the engine
   sends `live:question` (public view only: stem, options, and
   `chart` — title, instrument, template, axis labels, xLabels,
   series — WITHOUT the annotation, never `isCorrect` or
   `explanation`) with `deadlineMs = serverNowMs + 30,000` and
   arms the 30 s question timer.
3. A player picks an interpretation. The web page sends
   `live:answer` at once. The engine grades from the grading
   rows (`getItemsForGrading`): `pointsForAnswer(correct, timeMs,
30,000)`, stores the answer row, and emits `live:score`
   (scores only).
4. When both players have answered — or the 30 s timer fires —
   the engine reveals: `live:reveal` with the annotation (the
   trend + highlighted zone from the grading row), the correct
   option, the explanation, and the scores (§3).
5. After the 5th reveal, the engine settles (§10): Ratings first
   (`recordDuel` / `recordDuelVsBot`, idempotency key
   `duel:{duelId}`), then duel rows + both `DuelGameResult` rows
   - XP in one transaction, then `live:finished` + the rematch
     offer.

## 3. WebSocket event contract — full, with deltas from Phase 5/6/7

Namespace `/duels-live`, one room per duel (`duel:{duelId}`).
The server owns the clock; the client timer is display only.
Answers carry NO `timeMs`. Correctness, points, and the
annotation are never returned before reveal.

### Client → server

| Event              | Payload                            | Ack                                                       | Notes                                                                                                                                                 |
| ------------------ | ---------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `live:join-queue`  | `{ variant: 'CHART' }`             | `{ ok, variant: 'CHART', queuePosition?, ratingWindow? }` | `variant` is always sent explicitly (the server defaults an omitted variant to `LIVE`). Unknown variant → `{ ok: false, code: 'VALIDATION_FAILED' }`. |
| `live:leave-queue` | `{}`                               | `{ ok }`                                                  | —                                                                                                                                                     |
| `live:accept-bot`  | `{}`                               | `{ ok, opponent: 'BOT', variant: 'CHART' }`               | Only after the 30 s `live:bot-offer`.                                                                                                                 |
| `live:answer`      | `{ duelId, questionId, optionId }` | `{ ok, accepted, points? }`                               | The action. Sent the moment it is picked. First answer only, current question only, before the 30 s deadline.                                         |
| `live:leave-duel`  | `{ duelId }`                       | `{ ok }`                                                  | Counts as a loss (forfeit).                                                                                                                           |
| `live:rematch`     | `{ duelId }`                       | `{ ok, matched?, reason?, retryAfterMs? }`                | 5-minute cooldown, per pair per variant (`REMATCH_COOLDOWN` + `retryAfterMs` when too soon).                                                          |

### Server → client

| Event                                                      | Payload                                                                                                                                                                                                                                                                  | Notes                                                                                                                                                                              |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `live:queued`                                              | `{ variant: 'CHART', ratingWindow, queuePosition? }`                                                                                                                                                                                                                     | —                                                                                                                                                                                  |
| `live:queue-left`                                          | `{}`                                                                                                                                                                                                                                                                     | —                                                                                                                                                                                  |
| `live:bot-offer`                                           | `{}`                                                                                                                                                                                                                                                                     | After 30 s with no human match.                                                                                                                                                    |
| `live:matched`                                             | `{ duelId, variant: 'CHART', opponent: { displayName, rating, kind }, host: { name: 'Kabir', line }, questionCount: 5, timeLimitMs: 30000, countdownEndsAtMs }`                                                                                                          | Host line is Kabir's intro (§1).                                                                                                                                                   |
| `live:countdown`                                           | `{ countdownEndsAtMs }`                                                                                                                                                                                                                                                  | 3 s.                                                                                                                                                                               |
| `live:question`                                            | `{ duelId, index, total: 5, question: { id, type: 'CHART_CHOICE', stem, options: [{ id, text, order }], chart: { title, instrument, template, xLabel, yLabel, xLabels, series } }, deadlineMs, timeLimitMs: 30000, serverNowMs }`                                        | 4 options. Never `isCorrect`, `annotation`, or `explanation`.                                                                                                                      |
| `live:score`                                               | `{ scores: { playerA: { userId, score, correct }, playerB: { userId, score, correct } \| null } }`                                                                                                                                                                       | Scores only — no answers, no streak.                                                                                                                                               |
| `live:answer-accepted`                                     | `{ questionId, index }`                                                                                                                                                                                                                                                  | Correctness arrives only at reveal.                                                                                                                                                |
| `live:reveal`                                              | `{ duelId, index, questionId, correctOptionId, correctOptionText, explanation, annotation, myCorrect, mySkipped, myOptionId, myPoints, scores }`                                                                                                                         | **Extended for Chart.** `annotation` is the trend + highlighted zone (e.g. `{ trend: 'rising', zoneStart: 0, zoneEnd: 5 }`), so the page can highlight the trend line / risk zone. |
| `live:opponent-disconnected` / `live:opponent-reconnected` | `{ userId }`                                                                                                                                                                                                                                                             | 15 s grace, then forfeit (§9).                                                                                                                                                     |
| `live:rematch-requested`                                   | `{ duelId, userId }`                                                                                                                                                                                                                                                     | —                                                                                                                                                                                  |
| `live:finished`                                            | `{ duelId, type: 'CHART', result, score, opponent, correct, wrong, skipped, accuracy, avgTimeMs, fastestTimeMs, slowestTimeMs, bestStreak, perTopic, perQuestion, ratingBefore, ratingAfter, ratingDelta, ratingReason, xp, finishedAt, host: { name: 'Kabir', line } }` | Same stored-result shape as Phase 4/5; each `perQuestion` entry carries `chart` + `annotation`.                                                                                    |
| `live:error`                                               | `{ message, code? }`                                                                                                                                                                                                                                                     | —                                                                                                                                                                                  |

## 4. REST endpoints (`/api/v1/duels`)

No new REST endpoints. The four Phase 5 live endpoints are
variant-aware and their OpenAPI descriptions now mention Chart
Detective (CHART):

| Endpoint                 | Chart behaviour                                                                              |
| ------------------------ | -------------------------------------------------------------------------------------------- |
| `GET /live/queue/status` | Returns `variant: 'CHART'` while queued for a Chart Detective duel (`null` when not queued). |
| `GET /live/active`       | Returns the active CHART duel (type `'CHART'`, `timeLimitMs` 30000) or `null`.               |
| `GET /live/:id/state`    | Returns the CHART duel state (`variant: 'CHART'`, `timeLimitMs` 30000).                      |
| `POST /live/:id/forfeit` | Forfeits a CHART duel the same way as LIVE/BLITZ/CASE.                                       |

## 5. CHART_CHOICE format + generator (Stage 1, summarised)

Stage 1 (full detail in the Stage 1 handoff notes
`/tmp/chart-stage1-notes.md` and doc 08 §3.4):

- **Shape (binding).** `DuelBankItem.chart` is
  `{ title, instrument, template, xLabel, yLabel, xLabels[6],
series[6], annotation: { trend: 'rising' | 'falling' | 'flat' |
'volatile', zoneStart: 0..5, zoneEnd: 0..5 } }`. The public view
  strips the annotation; grading uses `getItemsForGrading`
  (full rows with annotation).
- **Templates (5).** STEADY_RISE (rising, 0–5),
  VOLATILE_FLAT (volatile, min→max swing), SHARP_FALL_RECOVERY
  (volatile, 0–2), STEADY_FALL (falling, 0–5), SPIKE_THEN_FALL
  (volatile, peak ±1). Ten items per template in the seed bank.
- **Generator.** `chart-generator.ts`: deterministic (mulberry32
  - FNV-1a) — the same (seed, template) always builds the same
    chart, so a seeded chart is reproducible and testable.
- **Validation (binding).** Skill CHART_READING only,
  difficulty 2–4, exactly 4 options / exactly 1 correct, NO
  per-option points, explanation 1–3 sentences, no real-ticker
  names, no buy-sell tips.
- **Renderer.** `apps/web/app/duels/chart-question.tsx`: an
  inline SVG line chart with a highlighted zone
  (`ChartSvg` + `TREND_LABEL`, exported for reuse by the result
  view), plus the 4 interpretation options and the reveal state.
  A `/duels/chart-test` page exists for the standalone renderer.
- **Bank.** 50 LIVE items (qb-571..qb-620), 5 per topic,
  difficulties 2:15 / 3:20 / 4:15, skill CHART_READING.

## 6. Scoring + annotation, with worked examples

Chart scoring (`duel-scoring.ts`, the standard rule on the
30 s timer — no new function):

```
points = 100 + speedBonus        (correct reading only)
speedBonus = floor(50 × (1 − timeMs / 30000)), floored at 0
wrong (any wrong interpretation) or skipped = 0
```

A correct reading pays at most 150, a wrong reading 0.
CHART options carry no per-option points (the bank forbids
them), so there is no partial credit — a wrong chart read is a
wrong answer, full stop.

| Answer  | Time      | Points         |
| ------- | --------- | -------------- |
| Correct | 0 ms      | 150 (100 + 50) |
| Correct | 15,000 ms | 125 (100 + 25) |
| Correct | 30,000 ms | 100 (100 + 0)  |
| Wrong   | any       | 0              |
| Skipped | —         | 0              |

**Winner** (`decideWinner`): more correct readings wins, then
lower total answer time, else a draw — the same as Speed Quiz
and Blitz, NOT the Case points-first rule: a chart has one right
reading, so "correct count" is the whole judgement. (The worked
example is pinned in the unit tests: A 3 correct × ~148 beats B
2 correct × ~149, despite B being faster.)

**Annotation:** every CHART_CHOICE item carries an annotation
(the trend + the zone to highlight). At reveal the server sends
it alongside `correctOptionId`, `correctOptionText`, and the
explanation, so the page can highlight the trend line / risk
zone on the chart. The annotation is also copied into each
stored per-question stat (`chart` without the annotation +
`annotation` beside it), so the result screen draws the
annotated chart under each chart. The stored result is only ever
read after the duel ends, so the annotation in it is never a
pre-reveal leak.

## 7. The annotation (reveal-only)

The annotation is reveal-only data, and `live:reveal` is the
existing reveal channel — Chart Detective adds no socket event.
The rules:

- The annotation lives only in the grading row
  (`getItemsForGrading`), never in the public question view.
  A player who inspects the `live:question` payload sees the
  chart (title, instrument, template, axis labels, xLabels,
  series) and nothing else — the trend and the highlighted zone
  are not in it.
- The engine copies the annotation into the reveal payload from
  the grading row at reveal time, and into the stored
  per-question stat at settle time. There is no annotation
  storage of its own — it is a field of the bank item's chart.
- The web page passes the annotation to `ChartQuestion`'s reveal
  state (trend label + highlighted zone), and the result view
  renders the annotated chart per question from the stored
  `chart` + `annotation`. The SVG is rendered once, by the
  shared `ChartSvg` — the reveal and the result view do not
  duplicate it.

## 8. Matchmaking

- One Redis queue per variant: `live:queue:LIVE`,
  `live:queue:BLITZ`, `live:queue:CASE`, and now
  `live:queue:CHART`. A Chart waiter is never matched into a
  Speed Quiz, Blitz, or Case duel, and vice versa. One queue
  entry per user across variants (joining a second queue while
  queued returns 409 `DUEL_ALREADY_QUEUED`); no queueing while a
  live duel is active (409 `DUEL_LIVE_ALREADY_ACTIVE`).
- Windows widen with wait, unchanged: ±50 (0–5 s) → ±100
  (5–15 s) → ±200 (15–30 s) → ±400 (30+ s). Nearest Rating in
  the window wins; ties break by earliest join. A 5-second sweep
  pairs waiters whose windows overlap, within one variant only;
  the sweep iterates `['LIVE', 'BLITZ', 'CASE', 'CHART']`.
- After 30 s with no human match, the server emits
  `live:bot-offer`. Accepting from a Chart queue starts a Chart
  bot duel vs Mira — rated at the player's own Rating, on the
  30-second timer, with the same Chart scoring and annotation
  reveal.
- **Chart bot** (`simulateChartBot`): Mira picks the correct
  interpretation with probability = base accuracy by the
  player's Learning Rating (<1100 → 0.55, 1100–1299 → 0.65,
  1300–1499 → 0.75, 1500–1699 → 0.82, 1700+ → 0.88; **no
  difficulty adjustment** — the chart's difficulty is already
  priced into which readings look tempting); otherwise she picks
  a uniform wrong interpretation. Her time is
  `12,000 + difficulty × 2,000 + uniform(0–10,000)` ms, clamped
  to 5,000–29,999 ms — slower than the quiz bot (reading a
  chart takes longer), always inside the 30 s timer. Her answers
  are priced through the same `pointsForAnswer` rule on the 30 s
  timer. Deterministic per (seed, questions, rating). **Kabir
  hosts the duel; Mira only plays it.**
- Anti-farming at settlement: same pair max 3 rated duels/day,
  max 10 rated events/user/day (docs/04 §5). The 5-minute
  rematch cooldown is per pair per variant; a rematch always
  replays the same variant.

## 9. Timers, disconnect, forfeit

Same as Phase 5/6/7: 3 s countdown, 30 s per chart (config
`CHART_QUESTION_MS`, default 30,000), a short reveal pause
(shared `LIVE_REVEAL_PAUSE_MS`), 15 s disconnect grace then
forfeit (the forfeiter loses at the normal K), reconnect to the
same room (state lookup via `live:user-duel:{userId}`), no
late-join. The question timer and the reveal-early path both
reveal with the annotation (§7). If Redis state is lost
mid-duel, the duel is voided — no Rating changes.

## 10. Rating integration

Same as Phase 5/6/7, with the Chart winner rule (§6) as the only
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

The production bank holds **50 LIVE CHART_CHOICE items**
(qb-571..qb-620): 5 per topic across 10 topics; difficulties
2:15 / 3:20 / 4:15; skill CHART_READING; 10 items per template.
The bank is thin: a Chart Duel draws all 5 charts from those
50, so a frequent Chart player sees repeats sooner than a
Speed Quiz player (461 MCQ_4 + 59 TRUE_FALSE) or a Blitz player
(59 TRUE_FALSE). The exposure rules (30-day / 3-times, docs/05
§2.3) still apply, so repeats are throttled, not eliminated.
Growing CHART_CHOICE depth is the next bank task before Chart
Detective is promoted heavily (Nishu's order: complete all duels
first, then grow the bank per duel). The 2,000-item launch target
is still ahead (620 LIVE total).

## 12. Load balancing and scaling (docs/05 §3.4 — the honest version)

Same as Phase 5/6/7 (ADR 0010 §7): sticky sessions are REQUIRED
for the WebSocket upgrade in any multi-server deploy;
`LiveRedisAdapter` fans room messages out, installed only when
`WS_REDIS_ADAPTER_ENABLED=true` (default false). Single-server
v1 works WITHOUT the adapter and is the tested configuration.
The adapter does NOT move the engine's in-process timers: a
server crash mid-duel still voids the duel. Multi-server live
duels without sticky sessions do NOT work.

## 13. Web UI (`apps/web/app/duels/chart/`)

`apps/web/app/duels/chart/page.tsx`, modelled on the Case page's
stages and socket handling:

- Stages: idle → queued → countdown → playing → revealed →
  done. Joins `{ variant: 'CHART' }` explicitly; guards that the
  matched payload has `variant === 'CHART'` (otherwise an error).
- Kabir hosts before/after only (fallback intro: "5 charts, 30
  seconds each. Same charts for both of you. Read the chart,
  then pick the best interpretation. Good luck."). The 30 s timer
  comes from `timeLimitMs` in the `live:question` payload.
- Renders the Stage 1 `ChartQuestion` component for every
  `CHART_CHOICE` question: SVG line chart with the highlighted
  zone, 4 interpretation options, 30 s timer bar; the reveal
  passes the annotation, `correctOptionId`, `correctOptionText`,
  `explanation`, and `myOptionId` (correct pick green, wrong
  pick red, trend label + zone highlight).
- Sends `live:answer` the moment an option is picked. Live
  score bar shows scores only.
- Bot offer after 30 s ("Play Mira instead", same 30 s timer,
  same annotation rule). Disconnect notice (15 s grace). Result
  via the shared `DuelResultView` (extended with the annotated
  chart per question, §2.1) + Kabir's host line + rematch
  (5-min cooldown, per pair per variant) + "Back to duels".
  Educational disclaimer (`DuelsDisclaimer`) at the foot.
- The duels hub (`apps/web/app/duels/page.tsx`) gained a Chart
  Detective card, first in the list.

## 14. Anti-cheat and fairness (docs/05 §5)

Unchanged from Phase 5/6/7: answers never leave the server
before reveal; the server owns timing/scoring (no client
`timeMs` is accepted in live play); the annotation, correctness,
and explanation are never sent before reveal; answers must be
the current question, first answer only, in order; one account,
one socket for a rated duel; Ratings pair/day caps +
per-variant rematch cooldown at settlement/offer; duplicate
settlement is idempotent (stored result replay; ledger-keyed XP;
`duel:{duelId}`-keyed Rating).

## 15. Testing

- **Unit: 397/397** (baseline 378/31 suites; +19 new). Chart
  variant config (5, 30,000, `['CHART_CHOICE']`, mix
  `{2:1,3:2,4:2}`, max 2/topic, host Kabir, intro line); Chart
  scoring worked examples (§6) + `decideWinner` (correct count
  first — 3 correct beats 2 correct despite the faster player)
  - chart + annotation carried into the stored per-question
    stat; Chart bot simulation (determinism; times in [5000,
    29999] and slower on harder charts and slower than the quiz
    bot; points ≤ 150; correct rate near base 0.55 at rating 1000
    with no difficulty adjustment — d2 vs d4 rates within 0.05;
    stronger player faces sharper Mira); Chart queue separation
    (a CHART waiter never matches LIVE/BLITZ/CASE); gateway
    (`live:join-queue` CHART acceptance, Kabir host); engine
    (duel creation + Kabir matched payload + 30 s deadline;
    answer after 30 s rejected; scoring + annotation in reveal;
    winner by correct count; Chart bot duel; Chart rematch
    replays CHART).
- **E2E: 116/116** (baseline 113; +3 new). Chart happy path —
  queue → match (variant CHART, 5 charts, host Kabir) → 5 charts
  (question payload carries `chart` without `annotation` /
  `isCorrect` / `explanation`, `timeLimitMs` 3000) → A correct
  every time, B wrong every time → reveal carries the annotation
  - explanation → settle + rate once (ratingDelta 20, one rated
    event each, type `'CHART'` in result/history; stored
    per-question stats carry `chart` + `annotation`). Chart queue
    separation (CHART waiter never matches a LIVE waiter; second
    CHART waiter pairs; LIVE waiter stays queued). Chart bot duel
    via the 30 s offer (accept Mira, play 5 charts, settle, one
    rated event). First full run clean — no flake this time.
- **E2E seed + fakes:** 18 CHART_CHOICE items (3 topics × 3
  difficulties × 2 copies, mirroring the Stage 1 item's shape —
  instrument 'Meadow Foods', template STEADY_RISE, series
  [100, 104, 109, 113, 118, 124]) in the test seed only; they sit
  in the same (topic, difficulty) cells the CASE seed already
  uses, so the coverage pin of 50 cells still holds.
  `FakeDuelsRepository` gained CHART in
  `findActiveLiveDuelForUser`. `TEST_ENV` gained
  `CHART_QUESTION_MS: '3000'` so a 5-chart duel finishes in
  seconds. No seed collisions: the Stage 1 selection test and
  the Chart duel tests both hold whichever LIVE CHART item the
  random selection picks.
- **Web:** typecheck clean, lint clean (`eslint app
--max-warnings=0`), prettier clean on the new/changed files.
  API typecheck / lint / format clean; `prisma validate` clean.
- **Fixes found during the build (pre-existing).** The Stage 1
  seed file imported `ChartTemplateKey` from
  `chart-generator.ts`, which never re-exported it, so API
  typecheck failed — fixed with a one-line re-export (no seed
  item changed). The gateway's `emitMatched` read the host from
  `variantConfig(state.variant)`, which threw on a stub state
  without a variant; it now reads the host from the matched
  payload (`engine.matchedPayload(state, id).host.name`, with
  the `DUELS.BOT_NAME` fallback) — same behaviour in production
  (the matched payload already carries the variant host).

## 16. Manual QA checklist

- [ ] Join the Chart queue from two accounts: matched payload
      shows variant CHART, 5 charts, 30 s, host Kabir with the
      intro line; countdown 3 s; first chart renders the SVG
      line chart, the highlighted zone area, and 4 interpretation
      options.
- [ ] Pick an interpretation fast: it is sent at once; the
      reveal shows the trend label, the highlighted zone, the
      correct interpretation, and the explanation.
- [ ] Pick a wrong interpretation: the reveal marks your pick
      red, the correct one green, and shows the annotation.
- [ ] Wait out the 30 s timer without answering: the chart is
      graded a skip (0 points); the reveal still shows the
      annotation.
- [ ] Queue alone for 30 s: the Mira bot offer appears; accept
      it — the bot duel runs 5 charts on the 30 s timer with
      the annotation reveal, and settles rated once.
- [ ] Disconnect mid-duel: the opponent sees the 15 s notice;
      reconnect within it to resume the same room; after 15 s the
      duel forfeits.
- [ ] Rematch within 5 minutes of a Chart Detective duel against
      the same player: the cooldown message appears with the
      wait time; a rematch after a Speed Quiz Duel against the
      same player is not blocked.
- [ ] Mobile (360 px): the chart, options, and reveal all fit
      without overflow; buttons are tappable.
- [ ] The duels hub shows the Chart Detective card first; the
      result screen shows the annotated chart under each chart.

## 17. Limits / not verified

- Migration 0010 NOT applied to a live Postgres; Docker not
  booted; seed never executed against a live DB; single-server
  is the tested configuration (multi-server sticky LB + Redis
  adapter implemented but not tested end to end).
- The production bank holds only 50 CHART_CHOICE items (§11):
  Chart Detective repeats sooner than Speed Quiz or Blitz. No
  live duels/matchmaking yet on a live DB; no live rating events
  yet.
- TRUE_FALSE live rendering was code-reviewed but not e2e-
  exercised (Phase 5 limit, carries over — unrelated to Chart).
- The pre-existing e2e timeout flake in unrelated onboarding
  tests (ADR 0009 §9.7) did not appear in Phase 8's full run
  (116/116 first run clean), but it is a load/timing artifact of
  the 1.5-CPU VM, not a Chart issue — if it reappears, re-run
  those tests in isolation and record it honestly.
