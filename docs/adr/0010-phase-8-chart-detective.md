# ADR 0010 — Phase 8 Chart Detective (L4)

**Date:** 2026-11-12
**Status:** Accepted (built and verified; see §11)
**Context:** docs/05-duels-system-design.md §1/§7 (build order Step 6),
docs/04-ratings-and-deployment.md (Ratings, not ELO), docs/08
(predeclared formats + characters — CHART_CHOICE §3.4, Kabir §2.2),
docs/09 + ADR 0007 (the Phase 5 live engine this step reuses),
docs/10 + ADR 0008 (the Phase 6 variant pattern), docs/12 + ADR 0009
(the Phase 7 variant pattern), ADR 0006 (the settlement pattern).
Stage 1 of this phase (format, schema, validation, seeded chart
generator, web renderer, 50 LIVE chart items) is built and verified
(378/378 unit, 113 e2e with 3 new CHART tests); this ADR covers
Stage 2 — the duel itself. The live Speed Quiz Duel (Phase 5), Myth
vs Fact Blitz (Phase 6), and Case Duel (Phase 7) are built; no Chart
Detective duel existed before this phase.

## 1. What was built

A live, rated, head-to-head Chart Detective duel (L4) on the Phase 5
live engine — parameterised by variant, not duplicated:

- Backend: `src/modules/duels/live-duel-variants.ts` (the variant
  table gains `CHART`), Chart scoring in `duel-scoring.ts` (the
  standard rule on the 30 s timer, §4; `buildGameStats` carries the
  chart + annotation into each stored per-question stat, §4),
  Chart bot simulation in `bot-simulation.ts` (`simulateChartBot` /
  `botChartTimeMs`, §5), variant-aware matchmaking
  (`live-matchmaking.service.ts`: the sweep now iterates
  `['LIVE', 'BLITZ', 'CASE', 'CHART']`), variant-aware engine
  (`live-duel-engine.service.ts`: 30 s timer, Chart grading, Chart
  reveal with the annotation, Chart rematch), the Chart reveal
  (`live-duels.gateway.ts`: no new socket event — the annotation
  rides `live:reveal`, §3), and repository support
  (`duels.repository.ts`: `findActiveLiveDuelForUser` includes
  `DuelType.CHART`; `duels.service.ts`: history + stored-result
  branches include CHART).
- Prisma: `DuelType.CHART`, migration `0010_phase8_chart_detective`
  **amended** (see §9) — no second migration for this phase, because
  0010 was never applied to a live Postgres. No new tables, no new
  index.
- Shared: `DUELS.CHART_*` tunables (count, mix, types, per-topic
  cap, 30 s timer) and `DUELS.CHART_HOST_NAME = 'Kabir'` (the host
  name, types, and timer already existed from Stage 1).
- Config: `CHART_QUESTION_MS` (default 30,000).
- Web: `apps/web/app/duels/chart/page.tsx` (queue, countdown,
  `ChartQuestion` per chart, reveal with the annotation, result +
  rematch) + a Chart Detective card on the duels hub
  (`apps/web/app/duels/page.tsx`) + `CHART` added to the web
  `DuelResultResponse` / `DuelHistoryItem` types and `chart` +
  `annotation` to `DuelPerQuestion` (`apps/web/lib/api.ts`) +
  annotated-chart display in the shared result view
  (`apps/web/app/duels/result-view.tsx`, reusing the Stage 1
  `ChartSvg` — no duplicated SVG). The Stage 1 renderer
  (`chart-question.tsx`) exports `ChartSvg` + `TREND_LABEL` for
  that reuse; its behaviour is unchanged.
- Tests: unit + e2e (see §11). Docs: `docs/13-phase-8-chart-detective.md`
  (architecture, full event contract and deltas from Phase 5/6/7,
  scoring + annotation, matchmaking, Rating, testing, manual QA),
  this ADR, module README, docs/05 + docs/08 status updates.

No Paper Trading Sprint, trading duel, league, bank growth, new
question format, or profiles/settings/community code. Those are
later steps — and bank growth is explicitly deferred per Nishu's
decision (complete all duels first, then grow the bank per duel).

## 2. The duel

**Chart Detective (L4, rated, Learning Rating).** 5 fictional
charts, 30 seconds each, same charts in the same order with the same
option order for both players, live progress (scores, not answers).
Difficulty mix {2: 1, 3: 2, 4: 2}, at most 2 charts from one topic.
Scoring is the standard MCQ_4 rule on the 30 s timer: 100 base +
up to 50 speed bonus (§4). A wrong chart read is a wrong answer —
no partial credit, because the chart is the question (doc 08 §3.4).
The winner is the player with more correct readings, then the lower
total answer time, else a draw. Host is **Kabir**: he speaks before
the duel ("5 charts, 30 seconds each. Same charts for both of you.
Read the chart, then pick the best interpretation. Good luck.") and
after it, never during a chart (doc 08 §2.2). In a Chart bot duel
the opponent is **Mira** (same as the Speed Quiz, Blitz, and Case
bot duels) — Kabir HOSTS, Mira PLAYS. Format is CHART_CHOICE only,
with its predeclared UI (doc 08 §3.4) — no new format was added, and
no other format can appear in a Chart Detective duel: the selection
blueprint passes `types: ['CHART_CHOICE']` to the bank, and the web
page renders `ChartQuestion` for every Chart question.

## 3. Transport and authority (unchanged from Phase 5/6/7, plus variant and annotation)

- One `LiveDuelsGateway` on namespace `/duels-live`, one room per
  duel (`duel:{duelId}`). The gateway is transport only. The
  server owns the clock; the client timer is display only.
  Answers carry NO `timeMs` — the engine grades from
  `server now − question start`. Correctness, points, and the
  annotation are never returned before reveal.
- **Variant.** `live:join-queue` now accepts
  `{ variant?: 'LIVE' | 'BLITZ' | 'CASE' | 'CHART' }` (default
  `'LIVE'`; an unknown variant is rejected with
  `{ ok:false, code:'VALIDATION_FAILED' }`). `live:queued` gains
  `variant`; `live:matched` gains `variant` + `timeLimitMs`
  (30000 CHART) and `questionCount` 5 for Chart; `live:question`
  carries `timeLimitMs` 30000 and
  `deadlineMs = serverNowMs + 30000`, with `question.type`
  `'CHART_CHOICE'`, 4 options (interpretations, shuffled order),
  and `chart` (title, instrument, template, axis labels, xLabels,
  series — WITHOUT the annotation) — and never `isCorrect`,
  `annotation`, or `explanation`. The join-queue and accept-bot acks
  carry `variant`.
- **No new socket event.** Chart Detective adds no event: the
  annotation is reveal-only data, and `live:reveal` is the existing
  reveal channel. A `live:reason` analogue was considered and
  rejected — there is nothing to reflect on after a chart read that
  the duel needs to record; the reveal carries everything the
  player needs to learn from the chart.
- **Chart reveal (extended).** `live:reveal` for a Chart Detective
  duel additionally carries `annotation` (the trend + highlighted
  zone from the grading row's chart, e.g.
  `{ trend: 'rising', zoneStart: 0, zoneEnd: 5 }`), alongside the
  usual `correctOptionId`, `correctOptionText`, `explanation`,
  `myCorrect`, `mySkipped`, `myPoints`, `myOptionId`, and `scores`.
  `live:score` is unchanged in shape (scores only).
- REST: `GET /live/queue/status` returns `variant`
  (`'LIVE' | 'BLITZ' | 'CASE' | 'CHART' | null`); `GET /live/active`
  and `GET /live/:id/state` return `variant` + `type` (`'CHART'`) +
  `timeLimitMs` 30000 for Chart. No new REST endpoints — the four
  Phase 5 live endpoints are variant-aware.
  `GET /duels/:id/result` and `GET /duels/history` return type
  `'CHART'`, and the stored per-question stat carries `chart` (the
  public part, no annotation) + `annotation` (shown on the result
  screen as the annotated chart).
- State lives in Redis (`live:duel:{duelId}`, JSON, 900 s TTL;
  `live:user-duel:{userId}` for reconnect lookup). Postgres is
  the source of truth after the duel ends. If Redis state is lost
  mid-duel, the duel is voided — no Rating changes (docs/05 §3.2).
- Timers live on the process that created the duel (v1, single
  server), exactly as in Phase 5 (§7).

## 4. Scoring — the Chart rule

Chart scoring (`duel-scoring.ts`, `pointsForAnswer` on the 30 s
timer — no new function, the standard rule):

```
points = 100 + speedBonus        (correct reading only)
speedBonus = floor(50 × (1 − timeMs / 30000)), floored at 0
wrong (any wrong interpretation) or skipped = 0
```

A correct reading pays at most 150, a wrong reading 0. CHART
options carry no per-option points (the bank forbids them), so
there is no partial credit to award — a wrong chart read is a
wrong answer, full stop. The winner is decided by `decideWinner`
(correct count first, then total time, else draw) — the same as
Speed Quiz and Blitz, NOT the Case points-first rule: a chart has
one right reading, so "correct count" is the whole judgement.

Worked examples (pinned in unit tests):

| Answer   | Time      | Points         |
| -------- | --------- | -------------- |
| Correct  | 0 ms      | 150 (100 + 50) |
| Correct  | 15,000 ms | 125 (100 + 25) |
| Correct  | 30,000 ms | 100 (100 + 0)  |
| Wrong    | any       | 0              |
| Skipped  | —         | 0              |

Grading uses `getItemsForGrading` (full rows with chart +
annotation), never the public view. The annotation is copied into
the reveal payload from the grading row, and the chart (public
part) + annotation are copied into each stored per-question stat
(`buildGameStats` splits the stored chart: `chart` without the
annotation, `annotation` beside it), so the result screen can draw
the annotated chart. The stored result is only ever read after the
duel ends, so the annotation in it is never a pre-reveal leak.

## 5. Matchmaking and the Chart bot

- Queue: Redis sorted set **per variant** — `live:queue:LIVE`,
  `live:queue:BLITZ`, `live:queue:CASE`, and now
  `live:queue:CHART`, member = user id, score = Learning Rating,
  plus the shared per-user entry key
  (`live:queue-entry:{userId}`, JSON: rating + join time +
  variant, 300 s TTL). A Chart waiter is never matched into a
  Speed Quiz, Blitz, or Case duel, and vice versa. **One queue
  entry per user across variants**: a user already queued for one
  variant who joins another gets 409 `DUEL_ALREADY_QUEUED`. (No
  queueing while a live duel is active: 409
  `DUEL_LIVE_ALREADY_ACTIVE`.)
- Windows widen with wait, unchanged: ±50 (0–5 s) → ±100
  (5–15 s) → ±200 (15–30 s) → ±400 (30+ s). Nearest Rating in the
  window wins; ties break by earliest join. A 5-second sweep
  pairs waiters whose windows overlap, within one variant only.
  The sweep now iterates `['LIVE', 'BLITZ', 'CASE', 'CHART']`.
- After 30 s with no human match, the server emits
  `live:bot-offer` (text unchanged). Accepting from a Chart queue
  starts a **Chart** bot duel vs Mira — rated at the player's own
  Rating, on the 30-second timer, with the same Chart scoring and
  annotation reveal — not a Speed Quiz, Blitz, or Case duel. The
  bot duel replays the variant the player queued for.
- **Chart bot simulation** (`bot-simulation.ts`,
  `simulateChartBot`, defined explicitly here because the task
  required it): Mira picks the correct interpretation with
  probability = base accuracy by the player's Learning Rating (the
  same bands as the existing Mira bot — <1100 → 0.55, 1100–1299 →
  0.65, 1300–1499 → 0.75, 1500–1699 → 0.82, 1700+ → 0.88; **no
  difficulty adjustment** — the chart's difficulty is already
  priced into which readings look tempting); otherwise she picks a
  uniform wrong interpretation. Her time is
  `12,000 + difficulty × 2,000 + uniform(0–10,000)` ms, clamped
  to 5,000–29,999 ms — slower than the quiz bot (reading a chart
  takes longer), always inside the 30 s timer. Her answers are
  priced through the same `pointsForAnswer` rule on the 30 s
  timer, so both sides are scored identically. Deterministic per
  (seed, questions, rating). **Kabir hosts the duel; Mira only
  plays it** — the host line on a Chart bot duel is Kabir's, and
  the opponent shown is Mira.
- Anti-farming, unchanged at settlement: same pair max 3 rated
  duels/day, max 10 rated events/user/day (docs/04 §5). The
  5-minute rematch cooldown is **per pair per variant**: a Chart
  rematch is not blocked by a recent Speed Quiz, Blitz, or Case
  duel against the same player, and a rematch always replays the
  same variant.

## 6. Settlement (one Rating update, once)

Unchanged from ADR 0007 §6, with no Chart difference at all: the
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
same stored-result shape as Phase 4/5, with `chart` +
`annotation` added to each per-question stat (§4). **The Chart
difference from Speed Quiz is none at settlement**: the winner
rule is the same `decideWinner` (correct first), so the only
Chart-specific code in the engine is the variant config, the
30 s timer, the bot simulation, and the annotation on reveal.

## 7. Load balancing (docs/05 §3.4 — the honest version, unchanged)

Sticky sessions are REQUIRED for the WebSocket upgrade in any
multi-server deploy. `LiveRedisAdapter` fans room messages out to
players on different servers, installed in `main.ts` only when
`WS_REDIS_ADAPTER_ENABLED=true` (default false). Single-server v1
works WITHOUT the adapter — the in-process Socket.IO server is
enough, and that is the tested configuration. The adapter does NOT
move the engine's in-process timers: a server crash mid-duel
still voids the duel. Multi-server live duels without sticky
sessions do NOT work, and this ADR does not claim otherwise.

## 8. Deviations and known limits (recorded, not hidden)

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
5. **The 2,000-item launch target is still ahead, and Chart
   Detective repeats sooner than Speed Quiz.** The production bank
   holds **620 LIVE items, of which only 50 are CHART_CHOICE**
   (Stage 1: qb-571..qb-620) — a Chart Duel draws all 5 charts
   from those 50, so a frequent Chart player sees repeats sooner
   than a Speed Quiz player (whose pool is 461 MCQ_4 + 59
   TRUE_FALSE) or a Blitz player (59 TRUE_FALSE). **Bank growth is
   deferred per Nishu's decision** (complete all duels first, then
   grow the bank per duel); the exposure rules (30-day / 3-times,
   docs/05 §2.3) still apply to the shared set, so repeats are
   throttled, not eliminated. Growing CHART_CHOICE depth is the
   next bank task before Chart Detective is promoted heavily.
6. **The annotation is reveal-only, and the stored result carries
   it.** The public question view never carries the annotation;
   the reveal and the stored per-question stat do. The stored
   result is only read after the duel ends, so this is not a leak
   — but any future consumer of stored results must not surface
   per-question stats before a duel finishes (none does today).
7. **Pre-existing e2e flake, not from Phase 8.** Full e2e runs
   during earlier phases showed 1–2 failures in unrelated
   onboarding placement tests (5-second Jest timeouts on a
   1.5-CPU VM; ADR 0009 §9.7, Stage 1 notes §Limits). Phase 8's
   full run went **116/116 clean on the first run** — no flake
   appeared this time, and no retry was needed.
8. **Pre-existing Stage 1 type error, fixed in this phase.**
   `prisma/question-bank-seed.ts` imported `ChartTemplateKey`
   from `chart-generator.ts`, which never re-exported it, so
   `npm run typecheck` failed (the seed spec pulls the seed file
   into the program). Fixed with a one-line re-export
   (`export type { ChartTemplateKey }`) in `chart-generator.ts`;
   no seed item was changed.

## 9. Migration 0010 (amended, hand-reviewed)

`0010_phase8_chart_detective` was authored in Stage 1 (the
`chart` JSONB column) and **amended in Stage 2** — not replaced
by a second migration — because it was never applied to a live
Postgres, so amending it is correct. The amendment appends one
statement to the Stage 1 file:

```sql
ALTER TYPE "DuelType" ADD VALUE 'CHART';
```

No new tables — queue and live state are Redis-only by design
(docs/05 §3.2/§3.3). No new index: the Phase 5 index on
`(type, status, createdAt)` already covers CHART lookups ("my
active CHART duel", rematch-cooldown reads), and the Phase 7
index on `(status, type, difficulty)` already covers CHART
selection. Note: `ALTER TYPE … ADD VALUE` cannot run inside a
transaction block; `prisma migrate deploy` handles enum additions
accordingly — do not hand-wrap this file in BEGIN/COMMIT. The
migration was NOT applied to a live Postgres (none on this
machine). `prisma validate` passes with `DATABASE_URL` set, and
the Prisma client was regenerated (`DuelType.CHART` confirmed in
the generated client).

## 10. Additive core touchpoints (blueprint §2.4)

The only edits outside `duels/` are additive: the shared
`DUELS.CHART_*` constants (count, mix, max per topic — host,
types, and timer already existed from Stage 1), the `CHART`
value on the `DuelType` enum, the config timer
(`CHART_QUESTION_MS`; the 3 s countdown stays the shared
`LIVE_COUNTDOWN_MS`), the `ChartTemplateKey` re-export in
`chart-generator.ts` (§8.8), and the e2e fakes / seed (18
CHART_CHOICE items at difficulties 2–4 in the test seed only —
the production bank is untouched; they mirror the Stage 1 item's
shape so the Stage 1 selection test and the Chart duel tests
hold whichever LIVE CHART item the random selection picks, and
they sit in the same (topic, difficulty) cells the CASE seed
already uses, so the coverage pin of 50 cells still holds). No
existing behaviour was changed: Speed Quiz, Blitz, Case Duel,
Bot Duel, and Daily Duel all pass unchanged, and the `LIVE`
default on `live:join-queue` means old clients that omit
`variant` still get a Speed Quiz duel.

The web step's only edits outside the new Chart page are the hub
card, the `CHART` additions to web result/history types, the
`chart` + `annotation` fields on `DuelPerQuestion`, the annotated
chart display in the shared result view, and the `ChartSvg` /
`TREND_LABEL` exports from the Stage 1 `ChartQuestion`
component. No backend code, migration, or test seed was changed
by the web step.

## 11. Verification

- Unit: **397/397** (baseline 378/31 suites; +19 new: Chart
  variant config, Chart scoring incl. the worked examples in §4
  and chart + annotation carried into the stored per-question
  stat, Chart bot simulation incl. the accuracy bands (no
  difficulty adjustment) and the 5–30 s time range, Chart
  matchmaking queue separation, gateway `live:join-queue`
  CHART acceptance, state parse keeping a CHART variant, engine
  — 5 CHART_CHOICE charts, 30 s timer, annotation in reveal,
  winner by correct count, Chart bot duel, Chart rematch).
- E2E: **116/116** (baseline 113; +3 new Chart tests: happy path
  — queue → match → 5 charts → settle + rate once, with the
  question payload carrying the chart without annotation /
  isCorrect / explanation and the reveal carrying the annotation;
  queue separation — a CHART waiter never matches a LIVE waiter;
  Chart bot duel via the 30 s offer, 5 charts vs Mira). The e2e
  seed gained 18 CHART_CHOICE items (3 topics × 3 difficulties ×
  2 copies, 4 options each) and the fakes gained CHART in
  `findActiveLiveDuelForUser`. `TEST_ENV` gained
  `CHART_QUESTION_MS: '3000'` so a 5-chart duel finishes in
  seconds. First full run clean — see §8.7.
- Web: typecheck clean, lint clean (`eslint app
  --max-warnings=0`), prettier clean on the new/changed files.
  API typecheck / lint / format clean; `prisma validate` clean.
- Worked examples verified in unit tests (see §4 table); the
  Chart e2e happy path settles with one rated event each, the
  stored result carrying `chart` + `annotation` per question.

## 12. Consequences

- Step 7 (Paper Trading Sprint, T1) inherits the live engine, the
  gateway, and the per-variant queue: it needs a trading engine
  on the Phase 2 price engine, not a new transport. A fifth
  variant is one row in `LIVE_DUEL_VARIANTS` plus its scoring
  rule — the variant table is now the extension point, proven
  four times over.
- The CHART_CHOICE bank depth (50) is the binding constraint on
  Chart Detective quality: before Chart Detective is promoted,
  grow CHART_CHOICE toward the per-cell minimums in docs/05 §2.3,
  or Chart repeats will be the first complaint (see §8.5).
- The reveal-only annotation is a reusable pattern: any future
  duel type whose question carries reveal-only visual data (a
  highlighted region, a worked step) can ride `live:reveal` +
  the stored per-question stat the same way — the public view
  stays clean, the reveal carries the extra, and the result
  screen reuses the renderer instead of duplicating it.
- Any future rating-formula change must keep the audit trail
  honest (ADR 0005/14); live settlement writes the same history
  shape as `recordDuel` / `recordDuelVsBot`.
- If crash-resume for live duels becomes a requirement, the
  timers must move out of process memory (e.g. Redis delayed
  jobs) — see §7. Until then, a crash voids the duel and no
  Rating changes.
