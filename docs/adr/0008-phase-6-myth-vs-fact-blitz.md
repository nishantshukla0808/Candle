# ADR 0008 — Phase 6 Myth vs Fact Blitz (L2)

**Date:** 2026-11-12
**Status:** Accepted (built and verified; see §12)
**Context:** docs/05-duels-system-design.md §1/§7 (build order Step 4),
docs/04-ratings-and-deployment.md (Ratings, not ELO), docs/08
(predeclared formats + characters — TRUE_FALSE §3.2), docs/09 +
ADR 0007 (the Phase 5 live engine this step reuses), ADR 0006 (the
settlement pattern). The Live Speed Quiz Duel is built (Phase 5);
no second live duel type existed before this phase.

## 1. What was built

A live, rated, head-to-head Myth vs Fact Blitz (L2) on the Phase 5
live engine — parameterised by variant, not duplicated:

- Backend (built by the Phase 6 backend step, verified before this
  ADR was written): `src/modules/duels/live-duel-variants.ts` (the
  variant table: `LIVE` vs `BLITZ`), Blitz scoring in
  `duel-scoring.ts` (`pointsForBlitzAnswer` /
  `blitzStreakBonus`), Blitz-aware state (`live-duel-state.ts`:
  `variant` + per-player `streak`, `scoresOf`), variant-aware
  matchmaking (`live-matchmaking.service.ts`: one queue per
  variant), variant-aware engine (`live-duel-engine.service.ts`:
  set selection, 10 s timer, streak grading, per-variant rematch
  cooldown), and gateway/DTO/REST changes that carry `variant`
  (see §3).
- Prisma: `DuelType.BLITZ` only, migration
  `0008_phase6_myth_vs_fact_blitz` (see §10). No new tables, no
  new index: the Phase 5 index already covers BLITZ.
- Shared: `DUELS.BLITZ_*` tunables (count, mix, types, per-topic
  cap, 10 s timer, streak step/cap).
- Web (this step): `apps/web/app/duels/blitz/page.tsx` (queue,
  countdown, TRUE_FALSE question, reveal, result + rematch) + a
  Blitz card on the duels hub (`apps/web/app/duels/page.tsx`) +
  `BLITZ` added to the web `DuelResultResponse` /
  `DuelHistoryItem` types (`apps/web/lib/api.ts`).
- Tests: unit + e2e (see §12). Docs: `docs/10-phase-6-myth-vs-fact-blitz.md`
  (architecture, full event contract and deltas from Phase 5,
  scoring, matchmaking, Rating, testing, manual QA), this ADR,
  module README, docs/05 + docs/08 status updates.

No Case Duel, Chart Detective, trading duel, league, bank growth,
new question format, or profiles/settings/community code. Those
are later steps — and bank growth is explicitly deferred per
Nishu's decision (§8.5).

## 2. The duel

**Myth vs Fact Blitz (L2, rated, Learning Rating).** 10 rapid
true/false questions, 10 seconds each, same set in the same order
with the same option order for both players, live progress
(scores, not answers). Difficulty mix {2: 3, 3: 4, 4: 3}, at most
3 questions from one topic. Scoring is 100 base + up to 50 speed
bonus scaled to the 10-second timer, PLUS the in-duel streak
bonus (§5). Host is Mira: she speaks before the duel ("10 rapid
true-or-false questions, 10 seconds each. One wrong answer breaks
your streak. Good luck.") and after it, never during a question
(doc 08 §2.2). Format is TRUE_FALSE only, with its predeclared UI
(doc 08 §3.2) — no new format was added, and no other format can
appear in a Blitz duel: the selection blueprint passes
`types: ['TRUE_FALSE']` to the bank, and the web page renders the
TRUE_FALSE layout for every Blitz question.

## 3. Transport and authority (unchanged from Phase 5, plus variant)

- One `LiveDuelsGateway` on namespace `/duels-live`, one room per
  duel (`duel:{duelId}`). The gateway is transport only. The
  server owns the clock; the client timer is display only.
  Answers carry NO `timeMs` — the engine grades from
  `server now − question start`. Correctness and points are never
  returned before reveal.
- **The only transport change is the variant.** `live:join-queue`
  now accepts `{ variant?: 'LIVE' | 'BLITZ' }` (default `'LIVE'`;
  an unknown variant is rejected with
  `{ ok:false, code:'VALIDATION_FAILED' }`). `live:queued` gains
  `variant`; `live:matched` gains `variant` + `timeLimitMs`
  (15000 LIVE / 10000 BLITZ) and `questionCount` 10 for Blitz;
  `live:question` carries `timeLimitMs` 10000 and
  `deadlineMs = serverNowMs + 10000`, with `question.type`
  `'TRUE_FALSE'` and exactly 2 options (True/False, shuffled
  order). The join-queue and accept-bot acks carry `variant`.
  `live:score`, `live:reveal`, and `live:finished` are unchanged
  in shape — `live:score` still carries only
  `{ userId, score, correct }` per player (no streak field; the
  web page therefore shows scores only during play, §7 of
  docs/10). All other client events are unchanged.
- REST: `GET /live/queue/status` returns `variant`
  (`'LIVE' | 'BLITZ' | null`); `GET /live/active` and
  `GET /live/:id/state` return `variant` + `type` (`'BLITZ'`) +
  `timeLimitMs` 10000 for Blitz. No new REST endpoints.
  `GET /duels/:id/result` and `GET /duels/history` return type
  `'BLITZ'`.
- State lives in Redis (`live:duel:{duelId}`, JSON, 900 s TTL;
  `live:user-duel:{userId}` for reconnect lookup). Postgres is
  the source of truth after the duel ends. If Redis state is lost
  mid-duel, the duel is voided — no Rating changes (docs/05 §3.2).
- Timers live on the process that created the duel (v1, single
  server), exactly as in Phase 5 (§7).

## 4. Matchmaking (separate queues, same windows)

- Queue: Redis sorted set **per variant** — `live:queue:LIVE`
  and `live:queue:BLITZ`, member = user id, score = Learning
  Rating, plus the shared per-user entry key
  (`live:queue-entry:{userId}`, JSON: rating + join time +
  variant, 300 s TTL). A Speed Quiz waiter is never matched into
  a Blitz duel, and vice versa. **One queue entry per user across
  variants**: a user already queued for Speed Quiz who joins the
  Blitz queue gets 409 `DUEL_ALREADY_QUEUED` — they must leave the
  first queue before joining the other. (No queueing while a live
  duel is active: 409 `DUEL_LIVE_ALREADY_ACTIVE`.)
- Windows widen with wait, unchanged: ±50 (0–5 s) → ±100
  (5–15 s) → ±200 (15–30 s) → ±400 (30+ s). Nearest Rating in the
  window wins; ties break by earliest join. A 5-second sweep pairs
  waiters whose windows overlap, within one variant only.
- After 30 s with no human match, the server emits
  `live:bot-offer` (text unchanged). Accepting from a Blitz queue
  starts a **Blitz** bot duel vs Mira — rated at the player's own
  Rating, on the 10-second timer, with the same streak rule — not
  a Speed Quiz duel. The bot duel replays the variant the player
  queued for.
- Anti-farming, unchanged at settlement: same pair max 3 rated
  duels/day, max 10 rated events/user/day (docs/04 §5). The
  5-minute rematch cooldown is **per pair per variant**: a Blitz
  rematch is not blocked by a recent Speed Quiz duel against the
  same player, and a rematch always replays the same variant.

## 5. Scoring — the Blitz streak rule

Blitz scoring (`duel-scoring.ts`, `pointsForBlitzAnswer`):

```
points = 100 (base)
       + floor(50 × (1 − timeMs / 10000))        (speed bonus, 10 s timer)
       + streakBonus                              (see below)
wrong or skipped = 0, and the current in-duel streak resets to 0
```

Streak bonus (`blitzStreakBonus`, on the streak AFTER this
answer): +10 per consecutive correct answer beyond the 2nd,
capped at +30 per question — streak 3 → +10, streak 4 → +20,
streak 5 and beyond → +30. Streaks 1–2 pay no bonus.

Worked examples (pinned in unit tests):

| Answer               | Streak after | Points                      |
| -------------------- | ------------ | --------------------------- |
| Correct in 0 ms      | 1            | 150 (100 + 50 + 0)          |
| Correct in 5,000 ms  | 3            | 135 (100 + 25 + 10)         |
| Correct in 10,000 ms | 5            | 130 (100 + 0 + 30)          |
| Correct in 0 ms      | 9            | 180 (100 + 50 + 30, capped) |
| Wrong, any streak    | 0            | 0, streak resets to 0       |

The streak lives in the Redis duel state (`LivePlayerState.streak`,
updated at answer time: correct → +1, wrong → 0; a skip breaks
the run at settlement). Best in-duel streak is stored in
`DuelGameResult.bestStreak` (already in the shape — no new field)
and shown prominently on the Blitz result screen: it is Blitz's
signature stat. Speed Quiz scoring is unchanged — it never takes
a streak bonus. Mira's simulated answers in a Blitz bot duel use
the same rule (`simulateBot` options
`{ timeLimitMs, streakBonus }`), so both sides are scored
identically.

## 6. Settlement (one Rating update, once)

Unchanged from ADR 0007 §6: the Ratings call runs FIRST, then
duel rows + both `DuelGameResult` rows + both XP grants commit in
one duels transaction. Idempotency key `duel:{duelId}`; a re-settle
replays the stored result. Human pair: `recordDuel`; bot duel:
`recordDuelVsBot` at the player's own Rating. Forfeit: the
forfeiter loses at the normal K (ADR 0007 §8.1 deviation carries
over). Rating-cap failure at settle time settles without a Rating
(ADR 0007 §8.2). XP reuses existing values only
(`grantDuelRewards`, reason `'duel.live_completed'`): win → 20,
draw → 5, loss → 0. Post-game stats reuse `buildGameStats` /
`decideWinner` / `mirrorOutcome` — the same stored-result shape
as Phase 4/5, with `bestStreak` already in it.

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
5. **The 2,000-item launch target is still ahead, and Blitz
   repeats sooner than Speed Quiz.** The production bank holds
   520 LIVE items, of which only **59 are TRUE_FALSE** — Blitz
   draws all 10 questions from those 59, so a frequent Blitz
   player sees repeats sooner than a Speed Quiz player (whose
   pool is 461 MCQ_4 + 59 TRUE_FALSE). **Bank growth is deferred
   per Nishu's decision** (Phase 6 scope: no bank growth); the
   exposure rules (30-day / 3-times, docs/05 §2.3) still apply
   to the shared set, so repeats are throttled, not eliminated.
   Growing TRUE_FALSE depth is the next bank task before Blitz
   is promoted heavily.
6. **Pre-existing e2e flake, not from Phase 6.** An admin test
   publishes a LIVE "What is a budget?" item; Bot/Live happy-path
   tests assert the first-question explanation matches
   `/^Because QB/` and random selection occasionally picks the
   admin item instead. Full e2e runs during Phase 6 went
   102/104 → 104/104 → 103/104 → 104/104 with zero code changes
   between runs. No Phase 6 code was changed to chase it.

## 9. Anti-gaming (enforced server-side, docs/05 §5)

Unchanged from ADR 0007 §9: answers never leave the server
before reveal; the server owns timing/scoring (no client `timeMs`
is accepted in live play); answers must be the current question,
first answer only, in order; one account, one socket for a rated
duel; Ratings pair/day caps + per-variant rematch cooldown at
settlement/offer; duplicate settlement is idempotent (stored
result replay; ledger-keyed XP; `duel:{duelId}`-keyed Rating).
The streak is server state — a client cannot claim a streak it
did not earn, because points and streaks are computed from
server-graded answers only.

## 10. Migration 0008 (hand-reviewed)

`0008_phase6_myth_vs_fact_blitz`, authored via
`prisma migrate diff --from-schema-datamodel <before>
--to-schema-datamodel prisma/schema.prisma --script`
(schema-before reconstructed from the pre-change schema; no live
DB) and hand-reviewed:

```sql
ALTER TYPE "DuelType" ADD VALUE 'BLITZ';
```

No new tables — queue and live state are Redis-only by design
(docs/05 §3.2/§3.3). No new index: the Phase 5 index on
`(type, status, createdAt)` already covers BLITZ lookups ("my
active BLITZ duel", rematch-cooldown reads). Note:
`ALTER TYPE … ADD VALUE` cannot run inside a transaction block;
`prisma migrate deploy` handles enum additions accordingly — do
not hand-wrap this file in BEGIN/COMMIT. The migration was NOT
applied to a live Postgres (none on this machine).
`prisma validate` passes with `DATABASE_URL` set.

## 11. Additive core touchpoints (blueprint §2.4)

The backend step's only edits outside `duels/` are additive: the
shared `DUELS.BLITZ_*` constants, the `BLITZ` value on the
`DuelType` enum, the config timer (`BLITZ_QUESTION_MS`; the 3 s
countdown stays the shared `LIVE_COUNTDOWN_MS`), and the e2e fakes /
seed (64 TRUE_FALSE items at difficulties 4–5 in the test seed
only — the production bank is untouched; they sit at
difficulties 4–5 so the existing selection/coverage pins, which
assert the MCQ-only difficulty 1–3 cells, hold, and the Blitz
blueprint reaches them via nearest-difficulty fallback). No
existing behaviour was changed: Speed Quiz, Bot Duel, and Daily
Duel all pass unchanged, and the `LIVE` default on
`live:join-queue` means old clients that omit `variant` still get
a Speed Quiz duel.

The web step's only edits outside the new Blitz page are the hub
card and the two `BLITZ` additions to web result/history types.
No backend code, migration, or test seed was changed by the web
step.

## 12. Verification

- Unit: **318/318** (baseline 297/29 suites; +21 new: Blitz
  variant config, streak scoring incl. the worked examples in
  §5, Blitz engine — 10 TRUE_FALSE questions, 10 s timer,
  streak bonus +10/+20/+30, reset on wrong, `bestStreak`
  stored — matchmaking per-variant queues, gateway variant
  validation).
- E2E: **104/104** (baseline 101; +3 new Blitz tests: happy
  path — queue → match → 10 questions → settle + rate once;
  queue-status REST returns `variant: 'BLITZ'`; Blitz bot duel
  via the 30 s offer). See §8.6 for the pre-existing flake:
  full runs during Phase 6 went 102/104 → 104/104 → 103/104 →
  104/104 with zero code changes.
- Web: typecheck clean, lint clean (`eslint app
--max-warnings=0`), prettier clean on the new/changed files.
  API typecheck / lint / format clean; `prisma validate` clean.
- Worked examples verified in unit tests (see §5 table); the
  Blitz e2e happy path settles with one rated event each and the
  stored result carrying `bestStreak`.

## 13. Consequences

- Step 5 (Case Duel, L3) inherits the live engine, the gateway,
  and the per-variant queue: it needs the CASE_CHOICE format
  renderer + rubric scoring + bank depth, not a new transport.
  A third variant is one row in `LIVE_DUEL_VARIANTS` plus its
  scoring rule — the variant table is now the extension point.
- The TRUE_FALSE bank depth (59) is the binding constraint on
  Blitz quality: before Blitz is promoted, grow TRUE_FALSE
  toward the per-cell minimums in docs/05 §2.3, or Blitz repeats
  will be the first complaint (see §8.5).
- Any future rating-formula change must keep the audit trail
  honest (ADR 0005/14); live settlement writes the same history
  shape as `recordDuel` / `recordDuelVsBot`.
- If crash-resume for live duels becomes a requirement, the
  timers must move out of process memory (e.g. Redis delayed
  jobs) — see §7. Until then, a crash voids the duel and no
  Rating changes.
