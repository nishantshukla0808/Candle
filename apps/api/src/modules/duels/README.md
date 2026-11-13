# Duels module

Bot Duel (P1, unrated) + Async Daily Duel (L5, rated) — docs/05-duels-system-design.md §1/§7 Step 2, docs/07-phase-4-duels-step-2.md, ADR 0006. **No live duels here** — no WebSocket gateway, no matchmaking, no Speed Quiz live. Those arrive in Step 3.

## Endpoints (`/api/v1/duels`)

| Method | Path                     | Auth  | Notes                                                                               |
| ------ | ------------------------ | ----- | ----------------------------------------------------------------------------------- |
| POST   | `/bot/start`             | user  | Start a Bot Duel vs Mira (7 questions, 15 sec each). 10/day (IST).                  |
| POST   | `/bot/:id/answer`        | user  | Answer the next question (in order, first answer only, `timeMs` 0–15000).           |
| POST   | `/bot/:id/finish`        | user  | Finish: Mira simulated from the stored seed; XP/streak only, never a Rating change. |
| GET    | `/daily/today`           | user  | Today's Daily Duel (IST date) — set status, no questions.                           |
| POST   | `/daily/start`           | user  | Start today's fixed 5-question set. 1/day (IST) — second start is 409.              |
| POST   | `/daily/:id/answer`      | user  | As the Bot Duel answer endpoint, for a Daily Duel.                                  |
| POST   | `/daily/:id/finish`      | user  | Finish: settles immediately when paired, otherwise waits for an opponent.           |
| POST   | `/daily/settle-unpaired` | ADMIN | Settle a day's unpaired Daily Duels vs the bot. Only after 23:59 IST for that date. |
| GET    | `/history`               | user  | My duel history, newest first.                                                      |
| GET    | `/:id/result`            | user  | Stored post-game result (or waiting / in-progress status).                          |

Every endpoint carries the educational disclaimer (blueprint §16).
Answers never leave the server before reveal: start/answer responses
carry option id + text only, never `isCorrect` or the explanation.

## Scoring (one rule, both sides)

Per question: 100 base per correct answer + up to 50 speed bonus
(`floor(50 × (1 − timeMs/15000))`, floored at 0). Wrong = 0, skipped
= 0. Winner: more correct answers wins; tie → lower total answer
time wins; equal on both → draw. Implemented in `duel-scoring.ts`
(`pointsForAnswer`, `decideWinner`, `buildGameStats`) and shared by
the player path and the bot simulation.

## Mira (seeded, replayable)

`bot-simulation.ts`: mulberry32 keyed by an FNV-1a hash of the duel
seed. Same seed + questions + player rating ⇒ same bot result.
Base accuracy by the player's Learning Rating: <1100 → 0.55,
1100–1299 → 0.65, 1300–1499 → 0.75, 1500–1699 → 0.82, 1700+ → 0.88.
Per question: `clamp(base − 0.08 × (difficulty − 3), 0.15, 0.97)`.
Time per question (ms):
`clamp(round(3000 + difficulty × 1200 + uniform(0, 6000)), 1500, 14999)`.

## Daily Duel (IST day, fixed set, pairing)

- The day is the **Asia/Kolkata calendar date** (`duel-dates.ts`) —
  not the UTC day Ratings caps use (ADR 0005/2). The Bot Duel cap
  (10/day) is also counted on the IST day.
- The set is generated once per date (seed `daily-YYYY-MM-DD`,
  stored in `DuelDailySet`, `date` unique): 5 questions, mix
  {2:2, 3:2, 4:1}, max 2 per topic. Every player that day gets the
  same questions in the same order, including the same option order.
  The set is generated with no per-user exclusion (it must be
  identical for all players); exposure is still recorded per player
  at start.
- Pairing is in order of finishing: the earliest
  `WAITING_OPPONENT` duel is the waiter. The second finisher settles
  the pair immediately. A player unpaired at day end is settled
  against Mira at their own Rating via `POST /daily/settle-unpaired`
  (ADMIN, after 23:59 IST for that date; no scheduler yet).

## Rating integration

- Human pair: `RatingsService.recordDuel` exactly once, caller =
  second finisher, idempotency key `duel:{finisherDuelId}`. Pair/day
  caps and the 5-minute rematch cooldown apply at that call.
- Bot fallback: `RatingsService.recordDuelVsBot` — only the caller
  updates, bot fixed at the caller's own rating (expected 0.5), key
  `duel:{duelId}`.
- Ordering (ADR 0006/7): Ratings first (a cap failure fails cleanly,
  both duels stay waiting), then duel rows + both `DuelGameResult`
  rows + both XP grants in one duels transaction. A crash between the
  two is recovered on a settlement retry via `IDEMPOTENCY_REPLAY` /
  `RATING_EVENT_DUPLICATE` + `RatingsService.getDuelOutcome`.

## XP (no new values)

`grantDuelRewards`: win → 20 XP (`XP.QUIZ_PASS`), draw → 5 XP
(`XP.TRADE_EXECUTED`), loss → 0 — but the streak still counts the
completion. Ledger key `duel:{duelId}:{userId}`; no outbox event
(finish-replay is the recovery path).

## Post-game stats (stored, never recomputed)

`DuelGameResult` (one row per duel per player): result, score,
accuracy, correct/wrong/skipped, avg/fastest/slowest time, best
streak, per-topic breakdown (worst-first), per-question answers +
explanations, Rating change with a plain-words reason (Daily only;
Bot: "no Rating change — practice"), XP breakdown. The result page
reads this row.

## Anti-gaming (enforced server-side, docs/05 §5)

- Answers never leave the server before reveal.
- Server owns timing/scoring: range-checked `timeMs`, in-order,
  first-answer-only (unique constraint), server-side grading.
- Daily Duel 1/day (IST); Bot Duel 10/day (IST).
- Ratings pair/day caps + rematch cooldown at settlement.
- Duplicate finish is idempotent (stored result replay; ledger-keyed
  XP; `duel:{duelId}`-keyed Rating).

Known limits: client-reported `timeMs` is trusted within range in
the REST Bot/Daily steps; live duels (Phase 5) use a server-side
timer and accept no `timeMs` at all. No impossibly-fast flagging yet.

## Live Speed Quiz Duel (L1, rated) — Phase 5 (ADR 0007, docs/09)

WebSocket gateway (NestJS + Socket.IO, namespace `/duels-live`),
Redis matchmaking + Redis duel state, server-authoritative timers
and scores. 7 questions, 15 s each, same set/order/option order for
both players (one `selectSet` call, both user ids, one seeded RNG).
Host: Mira — speaks before/after, never during a question.
Formats: MCQ_4 + TRUE_FALSE only (doc 08 §4).

- `live-duel-state.ts` — pure state types, Redis keys, window
  helpers (`windowForWait`, `botOfferDue`), scores (no I/O)
- `live-matchmaking.service.ts` — Redis queue: sorted set
  `live:queue:LIVE` (score = Learning Rating) + per-user entry key;
  windows ±50 → ±100 → ±200 → ±400; 5 s sweep; bot offer after 30 s
- `live-duel-engine.service.ts` — match creation, countdown,
  question timers, server-clock grading, reveal, disconnect grace
  (15 s) / forfeit, settlement (Ratings-first, `duel:{duelId}`
  idempotency, both `DuelGameResult` rows, XP), rematch
- `live-duels.gateway.ts` — transport only: JWT handshake auth,
  DTO validation, rooms (`duel:{duelId}`), one socket per user
- `live-redis.adapter.ts` — optional Socket.IO Redis adapter
  (multi-server fan-out; `WS_REDIS_ADAPTER_ENABLED`, off by default)
- `dto/live-duels.dto.ts` — socket payload validation

REST (authenticated, ownership-checked): `GET /duels/live/active`,
`GET /duels/live/queue/status`, `GET /duels/live/:id/state`,
`POST /duels/live/:id/forfeit`. Full event contract with payload
examples: docs/09 §3.

Timers (config): `LIVE_QUESTION_MS` 15000, `LIVE_COUNTDOWN_MS`
3000, `LIVE_DISCONNECT_GRACE_MS` 15000, `LIVE_REVEAL_PAUSE_MS` 2000. Live state TTL 900 s, queue entry TTL 300 s.

Settlement deviations (ADR 0007 §8): forfeit uses the normal K
(no smaller-K path in Ratings); a Rating-cap failure at settle
still stores the result + XP with the Rating unchanged and a
plain-words reason; rematch cooldown (5 min) is enforced at the
rematch offer. Single-server v1 is the tested configuration;
multi-server needs sticky LB + Redis adapter (§8 of docs/09) and
is NOT verified end to end.

### Friend Challenge (Phase 12, ADR 0014, docs/17)

The challenge module (`modules/friend-challenge/`) starts LIVE /
BLITZ / CASE / CHART duels by calling `LiveDuelEngine.createLiveDuel`
directly — matchmaking skipped, pair already chosen. The duel it
creates is a normal live duel of that variant: same set selection,
same timers, same settlement, same rematch. The play pages resume
it via `GET /duels/live/active`; `activeDuelSummary` also returns
the opponent's Rating so a resumed page shows it.

## Myth vs Fact Blitz (L2, rated) — Phase 6

Same live engine, parameterised by variant — no second gateway, no
second engine (`live-duel-variants.ts`: `LIVE` vs `BLITZ`).

- **Shape:** 10 rapid TRUE_FALSE questions, 10 s each
  (`BLITZ_QUESTION_COUNT`, `BLITZ_QUESTION_TIME_LIMIT_MS` 10000,
  config `BLITZ_QUESTION_MS`), same set/order/option order for both
  players, Mira hosts before/after only. Difficulty mix {2:3, 3:4,
  4:3}, max 3 per topic.
- **Scoring** (`duel-scoring.ts`): 100 base + speed bonus scaled to
  the 10 s timer (`floor(50 × (1 − timeMs/10000))`), PLUS the
  in-duel streak bonus: +10 per consecutive correct answer beyond
  the 2nd (streak 3 → +10, 4 → +20, 5+ → +30 capped). A wrong answer
  resets the current streak to 0. Speed Quiz scoring is unchanged.
  Best in-duel streak is stored in `DuelGameResult.bestStreak`
  (already in the shape — no new field).
- **Matchmaking:** one Redis queue per variant (`live:queue:LIVE`,
  `live:queue:BLITZ`) — a Speed Quiz waiter is never matched into a
  Blitz duel. Same windows (±50 → ±100 → ±200 → ±400), 5 s sweep,
  Mira bot offer after 30 s (rated vs Mira at own Rating, on the
  10 s timer with the streak rule), same pair/day caps at
  settlement. `live:join-queue` takes `{ variant: 'LIVE' | 'BLITZ' }`
  (default LIVE); `live:queued` / `live:matched` carry `variant`;
  `live:matched` and `live:question` carry `timeLimitMs` (15000 /
  10000). Queue-status and active-duel REST return `variant` too.
- **Rematch:** replays the same variant; the 5-minute cooldown is
  per pair per variant.
- **Bot:** Mira is simulated on the 10 s timer with the same streak
  rule (`simulateBot` options `{ timeLimitMs, streakBonus }`), so
  both sides of a Blitz duel are scored identically.
- **Prisma:** `DuelType.BLITZ`, migration
  `0008_phase6_myth_vs_fact_blitz` (enum value only — the Phase 5
  `(type, status, createdAt)` index already covers BLITZ lookups;
  queue/live state stay Redis-only).
- **E2E seed:** 64 TRUE_FALSE items (difficulties 4–5) in the test
  seed only — the production bank is untouched. They sit at
  difficulties 4–5 so the existing selection/coverage pins (which
  assert the MCQ-only difficulty 1–3 cells) hold; the Blitz
  blueprint reaches them via nearest-difficulty fallback.
- **Web UI:** `apps/web/app/duels/blitz/page.tsx` (queue →
  countdown → TRUE_FALSE question → reveal → result + rematch,
  modelled on the live page; always sends
  `{ variant: 'BLITZ' }`, reads `timeLimitMs` from the
  `live:question` payload) + a Blitz card on the duels hub.
  The live score bar shows scores only: `live:score` carries
  `{ userId, score, correct }` per player and **no streak field**
  (`scoresOf`), so no in-duel streak is shown for either player;
  `bestStreak` is shown prominently on the result screen from the
  stored result. Full contract: docs/10 §3, ADR 0008.

## Case Duel (L3, rated) — Phase 7 Stage 2

Same live engine, parameterised by variant — no third gateway, no
third engine (`live-duel-variants.ts`: `LIVE` vs `BLITZ` vs `CASE`).

- **Shape:** 5 CASE_CHOICE cases, 45 s each
  (`CASE_QUESTION_COUNT`, `CASE_QUESTION_TIME_LIMIT_MS` 45000,
  config `CASE_QUESTION_MS`), same cases/order/option order for
  both players, Kabir hosts before/after only. Difficulty mix
  {2:1, 3:2, 4:2}, max 2 per topic.
- **Scoring** (`duel-scoring.ts`): `pointsForCaseAnswer` =
  option points (100 best / 50 second-best / 0 other) + speed
  bonus `floor(20 × (1 − timeMs/45000))`, floored at 0. Best max
  120, second-best max 70, harmful 0; skipped = 0. **Winner by
  points** (`decideWinnerByPoints`): more points wins, then lower
  total answer time, else draw — not by correct count. `correct`
  still counts best actions only. The rubric is copied into each
  stored per-question stat (`buildGameStats`).
- **Reason window** (`live-duel-engine.service.ts`): the action is
  the answer, graded on the 45 s timer. After both players have
  answered (or the timer expires — no extension), a reason window
  of up to 10 s (config `CASE_REASON_WINDOW_MS`) opens:
  `live:reason-window` is emitted, and the reveal is postponed
  until both answering players have submitted/skipped a reason
  OR 10 s pass, whichever comes first. `live:reason`
  (`LiveReasonSocketDto`: `duelId`, `questionId`, `reason` ≤ 80
  chars, null = skip) stores the reason on the `DuelAnswer` row
  (`reason String?`, migration 0009 amended — see ADR 0009 §10);
  a missing reason is null, never a lost answer. Reasons are
  NEVER scored. The bot's reason is null and never blocks the
  window. `live:reveal` for Case additionally carries `rubric`,
  `optionPoints`, `pointsBreakdown` (plain words), `myOptionId`,
  `myPoints`, and `myReason` (never the opponent's reason).
  Grading uses `getItemsForGrading`, never the public view.
- **Matchmaking:** one Redis queue per variant (`live:queue:LIVE`,
  `live:queue:BLITZ`, `live:queue:CASE`) — a Case waiter is never
  matched into Speed Quiz/Blitz. Same windows (±50 → ±100 →
  ±200 → ±400), 5 s sweep, Mira bot offer after 30 s (rated vs
  Mira at own Rating, on the 45 s timer with the same Case rule),
  same pair/day caps at settlement. `live:join-queue` takes
  `{ variant: 'LIVE' | 'BLITZ' | 'CASE' }` (default LIVE);
  `live:queued` / `live:matched` carry `variant`; `live:matched`
  and `live:question` carry `timeLimitMs` (45000 CASE).
  Queue-status and active-duel REST return `variant` too.
- **Rematch:** replays the same variant; the 5-minute cooldown is
  per pair per variant.
- **Bot:** Mira is simulated on the 45 s timer with the same Case
  rule (`simulateCaseBot`): best action with probability = base
  accuracy by the player's Learning Rating (<1100 → 0.55,
  1100–1299 → 0.65, 1300–1499 → 0.75, 1500–1699 → 0.82, 1700+ →
  0.88; no difficulty adjustment); otherwise second-best with
  probability 0.8 of the remainder, else a 0-point option; time
  `20000 + difficulty×5000 + uniform(0–15000)` ms, clamped
  5000–44999 ms; no reason. Both sides are scored identically.
- **Prisma:** `DuelType.CASE` + `DuelAnswer.reason`, migration
  `0009_phase7_case_duel` **amended** (never applied to a live
  Postgres, so amending is correct — no second migration). No new
  index: the Phase 5 `(type, status, createdAt)` index already
  covers CASE lookups; queue/live state stay Redis-only.
- **E2E seed:** 18 CASE_CHOICE items (3 topics × 3 difficulties ×
  2 copies, 3 options each, mirroring the Stage 1 item's shape)
  in the test seed only — the production bank holds 50 CASE
  items (qb-521..qb-570). The generic selection test is pinned
  to `types: ['MCQ_4', 'TRUE_FALSE']` because CASE items have 3
  options, not 4.
- **Web UI:** `apps/web/app/duels/case/page.tsx` (queue →
  countdown → `CaseQuestion` → reason window → reveal → result +
  rematch, modelled on the Blitz page; always sends
  `{ variant: 'CASE' }`, reads `timeLimitMs` from the
  `live:question` payload) + a Case Duel card first on the duels
  hub. The page sends `live:answer` the moment an action is
  picked (`CaseQuestion.onActionPicked`) and `live:reason` when
  the player picks a chip or skips. The shared result view shows
  the rubric per question and words a second-best pick as "Not
  the best action" (not "wrong"). Full contract: docs/12 §3,
  ADR 0009.

## Chart Detective (L4, rated) — Phase 8 Stage 2

Same live engine, parameterised by variant — no fourth gateway, no
fourth engine (`live-duel-variants.ts`: `LIVE` vs `BLITZ` vs `CASE`
vs `CHART`). No new socket event.

- **Shape:** 5 CHART_CHOICE charts, 30 s each
  (`CHART_QUESTION_COUNT`, `CHART_QUESTION_TIME_LIMIT_MS` 30000,
  config `CHART_QUESTION_MS`), same charts/order/option order for
  both players, Kabir hosts before/after only. Difficulty mix
  {2:1, 3:2, 4:2}, max 2 per topic. The question payload carries
  `chart` (title, instrument, template, axis labels, xLabels,
  series) WITHOUT the annotation, never `isCorrect` or
  `explanation`.
- **Scoring** (`duel-scoring.ts`): the standard live rule on the
  30 s timer (`pointsForAnswer` — no new function): 100 base +
  `floor(50 × (1 − timeMs/30000))`, floored at 0; wrong or skipped
  = 0. No partial credit — CHART options carry no points (the bank
  forbids them). **Winner by correct count** (`decideWinner`):
  more correct readings wins, then lower total answer time, else
  draw — same as LIVE/BLITZ, NOT the Case points-first rule.
  Grading uses `getItemsForGrading`, never the public view.
- **Annotation (reveal-only):** `live:reveal` for Chart
  additionally carries `annotation` (trend + highlighted zone,
  from the grading row's chart), so the page can highlight the
  trend line / risk zone. The chart (public part) + annotation are
  copied into each stored per-question stat (`buildGameStats`
  splits them), so the result screen draws the annotated chart.
  The annotation is never in the public question view.
- **Matchmaking:** one Redis queue per variant (`live:queue:LIVE`,
  `live:queue:BLITZ`, `live:queue:CASE`, `live:queue:CHART`) — a
  Chart waiter is never matched into Speed Quiz/Blitz/Case. Same
  windows (±50 → ±100 → ±200 → ±400), 5 s sweep, Mira bot offer
  after 30 s (rated vs Mira at own Rating, on the 30 s timer with
  the same Chart rule), same pair/day caps at settlement.
  `live:join-queue` takes
  `{ variant: 'LIVE' | 'BLITZ' | 'CASE' | 'CHART' }` (default
  LIVE); `live:queued` / `live:matched` carry `variant`;
  `live:matched` and `live:question` carry `timeLimitMs` (30000
  CHART). Queue-status and active-duel REST return `variant` too.
- **Rematch:** replays the same variant; the 5-minute cooldown is
  per pair per variant.
- **Bot:** Mira is simulated on the 30 s timer with the same Chart
  rule (`simulateChartBot` + `botChartTimeMs`): correct with
  probability = base accuracy by the player's Learning Rating
  (<1100 → 0.55, 1100–1299 → 0.65, 1300–1499 → 0.75, 1500–1699 →
  0.82, 1700+ → 0.88; **no difficulty adjustment**); otherwise a
  uniform wrong interpretation; time
  `12000 + difficulty×2000 + uniform(0–10000)` ms, clamped
  5000–29999 ms (slower than the quiz bot — reading a chart takes
  longer). Kabir hosts; Mira only plays. Both sides are scored
  identically.
- **Prisma:** `DuelType.CHART`, migration
  `0010_phase8_chart_detective` **amended** (never applied to a
  live Postgres, so amending is correct — no second migration).
  No new index: the Phase 5 `(type, status, createdAt)` index
  already covers CHART lookups; queue/live state stay Redis-only.
- **E2E seed:** 18 CHART_CHOICE items (3 topics × 3 difficulties ×
  2 copies, mirroring the Stage 1 item's shape — instrument
  'Meadow Foods', template STEADY_RISE, series
  [100, 104, 109, 113, 118, 124]) in the test seed only — the
  production bank holds 50 CHART items (qb-571..qb-620). They sit
  in the same (topic, difficulty) cells the CASE seed already
  uses, so the coverage pin of 50 cells still holds.
- **Web UI:** `apps/web/app/duels/chart/page.tsx` (queue →
  countdown → `ChartQuestion` → reveal with the annotation →
  result + rematch, modelled on the Case page; always sends
  `{ variant: 'CHART' }`, reads `timeLimitMs` from the
  `live:question` payload) + a Chart Detective card first on the
  duels hub. The shared result view renders the annotated chart
  per question via the Stage 1 `ChartSvg` (no duplicated SVG).
  Full contract: docs/13 §3, ADR 0010.

## Layout (the Feature Module Template, blueprint §5)

- `duels.controller.ts` — thin
- `duels.service.ts` — start / answer / finish / pairing / settlement
- `duels.repository.ts` — the ONLY file touching Prisma here
- `duel-dates.ts` — IST calendar dates (pure)
- `bot-simulation.ts` — seeded Mira simulation (pure)
- `duel-scoring.ts` — scoring + post-game stats (pure)
- `live-duel-state.ts` — live state types + keys + window helpers (pure)
- `live-duel-variants.ts` — variant configs: LIVE (7×15 s, MCQ_4+TRUE_FALSE) vs BLITZ (10×10 s, TRUE_FALSE only) vs CASE (5×45 s, CASE_CHOICE only) vs CHART (5×30 s, CHART_CHOICE only) (pure)
- `live-matchmaking.service.ts` — Redis queue
- `live-duel-engine.service.ts` — live duel lifecycle + settlement
- `live-duels.gateway.ts` — Socket.IO transport only
- `live-redis.adapter.ts` — optional multi-server fan-out
- `dto/live-duels.dto.ts` — socket payload validation
- `*.spec.ts` — unit tests
