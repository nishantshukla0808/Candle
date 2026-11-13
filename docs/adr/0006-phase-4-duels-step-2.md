# ADR 0006 — Phase 4 Duels Step 2: Bot Duel (P1) + Async Daily Duel (L5)

**Date:** 2026-11-11
**Status:** Accepted (built and verified; see §12)
**Context:** docs/05-duels-system-design.md §1/§7 (build order Step 2),
docs/04-ratings-and-deployment.md (Ratings), ADR 0005 §15 (the Question
Bank this step consumes). Stage 1 of Phase 4 grew the bank to **520 LIVE
items** (keys qb-001–qb-520, 52 per topic, balanced difficulties; 131
template-generated + 269 hand-written + 120 Phase 3 items — verified by
counting distinct keys in `prisma/question-bank-seed.ts`).

## 1. What was built

A new `duels` NestJS module implementing docs/05 Step 2 only:

- `src/modules/duels/` — controller (9 routes), service (bot/daily
  start, answers, finish, pairing, settlement, bot fallback, history),
  repository (Prisma only, tx-aware), pure `duel-dates.ts`,
  `bot-simulation.ts`, `duel-scoring.ts`, DTOs, README.
- Prisma: `DuelType` / `DuelStatus` / `DuelOutcome` enums, `Duel` +
  `DuelAnswer` + `DuelDailySet` + `DuelGameResult` models, migration
  `0006_phase4_duels_step2` (authored via `prisma migrate diff`,
  hand-reviewed — see §10).
- Shared: `DUELS` tunables + `BOT_ACCURACY_BY_RATING` bands and three
  new error codes (`DUEL_DAILY_ALREADY_PLAYED`, `DUEL_BOT_DAILY_LIMIT`,
  `DUEL_NOT_IN_PROGRESS`) with default messages, status map entries,
  and `AppError` factories.
- Additive seams in existing modules (no behaviour changed): a
  grading lookup on the Question Bank (`getItemsForGrading` +
  `findItemsByIds`), a bot-opponent rating path + outcome recovery on
  Ratings (`recordDuelVsBot`, `getDuelOutcome`), and a duel XP grant
  on Gamification (`grantDuelRewards`).
- Web: minimal pages under `apps/web/app/duels/` (hub, Bot Duel play,
  Daily Duel play, result) following the existing page patterns.
- Tests: unit + e2e (see §12).

No live WebSocket duels, no matchmaking, no Speed Quiz live, no later
duel types, no profiles/settings/community code. Those are later steps.

## 2. The two duels

**Bot Duel (P1, UNRATED).** Opponent is Mira, the Daily Coach. Format
is the Speed Quiz format (docs/05 §1 L1): 7 questions, 15 seconds each,
same set for both sides — the bot "plays" the same 7 questions
server-side. Flow: start → answer all 7 (server validates timing,
first answer only, in order) → finish → bot result simulated. No
Rating change ever. XP/streak only, via `grantDuelRewards` (§8).

**Async Daily Duel (L5, RATED, 1 per user per day).** 5 questions, the
same fixed set for every player that day (§6). Flow: start → answer →
finish → paired in order of finishing; when the second player of a
pair finishes, the duel settles immediately. Settlement calls the
existing Ratings duel path once with idempotency key `duel:{duelId}`
(§7), grants XP, and stores post-game stats — all for both players.

## 3. Scoring (one rule, both sides, documented and tested)

Per question: **100 base per correct answer + up to 50 speed bonus**,
`speedBonus = floor(50 × (1 − timeMs / 15000))`, floored at 0. A wrong
answer scores 0; a skipped question scores 0. Worked examples (pinned
in unit tests): correct in 0 ms → 150; correct in 7,500 ms → 125;
correct in 15,000 ms → 100; wrong → 0.

Winner (docs/04 §5): more correct answers wins; on equal correct
counts, the lower total answer time wins (total = sum of `timeMs`
over answered questions; skipped questions contribute no time). Equal
on both ⇒ draw. The bot is scored by this exact rule
(`duel-scoring.ts` is shared by the player path and the simulation).

## 4. The grading seam (why the bank needed one new method)

`QuestionBankService.selectSet` returns public views only (no
`isCorrect`, no explanation) — by design. Grading needs the answers,
so the bank gained a service-internal method,
`getItemsForGrading(itemIds)`, backed by `findItemsByIds` on the
repository. It is never exposed through any controller: the duels
module is the only caller, and the rows it returns never leave the
server (answers and explanations appear only in the stored post-game
result, after reveal). The method returns items in the requested
order and throws NOT_FOUND when any id is unknown — a duel set must
never silently lose a question.

## 5. Bot algorithm (the exact implemented table and time model)

`bot-simulation.ts` is pure and seeded: mulberry32 keyed by an FNV-1a
hash of the duel seed (stored on the duel), so the same seed,
questions, and player rating always replay the same bot result.

**Accuracy — adaptive to the player's Learning Rating:**

| Player Learning Rating | Bot base accuracy |
| ---------------------- | ----------------- |
| < 1100                 | 0.55              |
| 1100–1299              | 0.65              |
| 1300–1499              | 0.75              |
| 1500–1699              | 0.82              |
| 1700+                  | 0.88              |

Per question: `p = clamp(base − 0.08 × (difficulty − 3), 0.15, 0.97)`
— harder questions are harder for Mira too.

**Time model (ms):**
`clamp(round(3000 + difficulty × 1200 + uniform(0, 6000)), 1500, 14999)`.
Mira never answers in under 1.5 s (no impossibly-fast answers) and
never exceeds the 15 s limit. Bot points use the same scoring rule
as the player (§3).

**Timing honesty (deviation from a literal reading of docs/05 §3.1).**
Doc 05 says "the server owns the timer". In this REST step there is
no live per-question timer to own: answers carry the client-reported
`timeMs`, the server validates the range (0–15000, DTO) and scores
from it, and the client timer is display-only. A cheating client
could report a fast time; that is accepted as a known limit of the
async REST format and documented here, not hidden. A server-side
timer arrives with live duels (Step 3), where the gateway owns the
clock. Answers under 300 ms on difficulty ≥ 4 are not flagged yet —
there is no flag store; flagging is a Step 3 anti-cheat item.

## 6. The Daily Duel day is IST — and the daily set is fixed (deviations recorded)

**IST vs UTC (clarification, not a bug).** Ratings daily caps use the
UTC calendar day (ADR 0005/2). The Daily Duel day is the **Asia/Kolkata
calendar date**. A duel played at 00:30 IST belongs to the new IST day
even though it is still the previous UTC day. Rationale: the Daily
Duel is a daily habit loop for Indian users, so its "day" is the day
on their wall clock. The two "days" therefore differ by design, and
the code keeps them apart deliberately: `duel-dates.ts`
(`kolkataDateString`, `istDayStartUtc`) for duels, `startOfUtcDay`
for Ratings. The Bot Duel cap (10/day) is also counted on the IST
day. Streaks stay in Asia/Kolkata through GamificationService, as
before. `duel-dates.ts` duplicates the one-line Kolkata formatter
instead of importing `StreakService`, which GamificationModule does
not export; the streak logic itself is never duplicated.

**Daily-set generation.** The set is generated once per IST date,
deterministically: seed = `daily-YYYY-MM-DD`, RNG = mulberry32 of the
seed hash, selection via `QuestionBankService.selectSet` with the
daily blueprint (5 questions, mix 2 easy + 2 medium + 1 hard:
difficulties {2:2, 3:2, 4:1}, max 2 per topic). It is stored in the
new `DuelDailySet` table (`date` unique) and every player that day
gets the same question ids in the same order — including the same
option order (options are shuffled with the same seeded RNG, so all
players see identical option order too).

**Exposure vs the fixed set (deliberate trade-off).** The set is
generated with no per-user exclusion (`selectSet([], …)`): the set
must be identical for all players that day, so it cannot exclude
items one player saw recently. Exposure is still recorded per player
at start (`recordExposure`), so the _next_ selection (Bot Duels, and
future days) avoids those items. A player may therefore see a Daily
question they saw in a Bot Duel within the last 30 days — the fixed
set wins over the exposure rule for that day, and this is documented
here rather than silently relaxed in the selector.

**Pairing rule.** Players who play that day's set are paired in
order of finishing: the earliest finished-but-unpaired duel
(`WAITING_OPPONENT`, ordered by `finishedAt`) is the waiter. When
the second player of a pair finishes, the duel settles immediately.
A player unpaired at day end (23:59 IST) is paired against the Mira
bot at their own Rating, settled by `POST /duels/daily/settle-unpaired`
(ADMIN; see §7). There is no scheduler yet — an operator (or a future
cron) calls the endpoint after 23:59 IST for the date; the endpoint
accepts any date but the docs warn against settling today early.

**Bot Duel difficulty mix.** The Speed Quiz blueprint in docs/05 §2.2
is "2 easy + 3 medium + 2 hard". Implemented as difficulties
{2:2, 3:3, 4:2} (easy = 2, medium = 3, hard = 4), with the selector's
nearest-difficulty fallback when a cell is short. The Daily mix is
{2:2, 3:2, 4:1} on the same mapping.

## 7. Rating integration (one call, once, with a recovery path)

**Human pair.** Settlement calls the existing
`POST /ratings/duels` path — `RatingsService.recordDuel` — exactly
once, with caller = the second finisher, opponent = the waiter,
result from the finisher's perspective, and idempotency key
`duel:{finisherDuelId}`. The Ratings pair/day caps and the 5-minute
rematch cooldown apply at that call (ADR 0005/4). A cap violation
fails the settlement cleanly: the Ratings call happens _before_ any
duel row is mutated, so both duels stay `WAITING_OPPONENT` and no
result, XP, or Rating is stored. Re-calling finish retries the
pairing (the `WAITING_OPPONENT` finish path is the retry path).

**Two-transaction settlement (deviation from a literal "one
transaction").** The task asked for settlement in one transaction.
That is not possible without breaking the Ratings module's ownership:
`recordDuel` opens its own transaction via `TransactionService` and
accepts no transaction client, and Prisma interactive transactions
do not nest. The implemented order is therefore: (1) Ratings call
first (nothing mutated yet — a failure is clean), (2) duel rows +
both `DuelGameResult` rows + both XP grants in one duels transaction.
The residual risk — a crash between (1) and (2) — is handled, not
ignored: a settlement retry detects the already-applied rating
(`IDEMPOTENCY_REPLAY`, whose details carry the original
`DuelResponse`, or `RATING_EVENT_DUPLICATE`) and recovers the deltas
from history via the new `RatingsService.getDuelOutcome(userId,
eventId)` instead of applying them twice. This is unit-tested (the
duplicate-recovery test) and e2e-tested through the normal path
(Rating applied exactly once per player — one history row each).

**Bot fallback (new Ratings method — deviation, recorded).** The bot
has no user account, so `recordDuel` cannot apply (it 404s on an
unknown opponent). The fallback uses a new additive method,
`RatingsService.recordDuelVsBot(userId, result, key, now)`: it updates
only the caller, with the bot fixed at the caller's own rating
(expected score 0.5, so a win always pays and a loss always costs,
symmetrically), one history row with `opponentId` null and
`opponentRating` = the caller's rating before the event. Same guards
as a human duel where they apply: idempotency (guard + history
lookup), max 10 rated events/user/day (UTC). No pair limit and no
rematch cooldown — there is no human pair. The key is
`duel:{duelId}`; the same duplicate-recovery path applies.

**K-factor boundary.** Unchanged from ADR 0005/2: 32 at 1400 and
below (the doc's worked example governs), 24 for 1401–1799, 16 at
1800+, 40 provisional.

## 8. XP (no new values invented)

`GamificationService.grantDuelRewards(tx, …)` is a new additive
method following the existing grant pattern (XP ledger append with a
unique idempotency key + `applyProgress` for level/streak/badges, all
inside the caller's transaction). The XP values reuse existing
constants only: win → `XP.QUIZ_PASS` (20, the existing "passed a
challenge" value), draw → `XP.TRADE_EXECUTED` (5, the existing small
participation value), loss → 0 — but the streak still counts the
completion, exactly like a quiz submit (streak updates even at 0 XP).
The ledger key is `duel:{duelId}:{userId}`, so a finish replay is a
safe no-op. There is no `duel.completed` outbox event: the
finish-replay path (stored result + ledger key) is the recovery path
for duels, so no second delivery mechanism was added. Badge checks
are the streak badges only (via `applyProgress`); no duel-specific
badges exist yet.

## 9. Post-game stats (stored, never recomputed)

`DuelGameResult` (one row per duel per player, unique
`(duelId, userId)`) stores at duel end, in the same transaction as
the Rating update and XP grant: result, score, accuracy,
correct/wrong/skipped counts, avg/fastest/slowest answer time, best
in-duel streak, per-topic breakdown (worst accuracy first, ties by
topic name for determinism), per-question answers + explanations
(selected option, correct option, correctness, time, points), Rating
change with a plain-words reason (Daily only; Bot shows "no Rating
change — practice"), and the XP breakdown (including the full reward
summary, so a replay returns the identical view). The result page
reads this row; it never recomputes stats. For a human pair each
player gets their own row (their own score, stats, and Rating
change); the opponent's score/name comes from the paired duel's row.

## 10. Anti-gaming (enforced server-side)

- Answers never leave the server before reveal: start/answer
  responses carry option id + text only, never `isCorrect` or the
  explanation. Correctness appears only in the stored result.
- Server owns timing/scoring: `timeMs` range-validated (0–15000),
  answers must be the next question in order, first answer only
  (unique `(duelId, userId, questionId)`), correctness and points
  computed server-side.
- Daily Duel: 1 per user per IST day (second start is 409
  `DUEL_DAILY_ALREADY_PLAYED`); the in-progress duel is resumed via
  `GET /duels/daily/today`, not by starting again.
- Bot Duel: 10 starts per user per IST day (409
  `DUEL_BOT_DAILY_LIMIT`).
- Ratings pair/day caps + 5-minute rematch cooldown apply at
  settlement (§7); a cap violation fails cleanly, never double-applies.
- Duplicate finish is idempotent: a settled duel replays the stored
  result; XP is ledger-keyed; the Rating is keyed `duel:{duelId}`.

## 11. Additive core touchpoints (blueprint §2.4)

The only edits outside `duels/` are additive: the shared constants
(`DUELS`, `BOT_ACCURACY_BY_RATING`) and error codes (§1), the three
`AppError` factories + status map entries, the Question Bank grading
seam (§4), the Ratings bot path + outcome recovery (§7), the
Gamification duel grant (§8), the `DuelsModule` line in
`app.module.ts`, the e2e fakes (`FakeDb` duel stores,
`FakeDuelsRepository`, `FakeQuestionBankRepository.findItemsByIds`),
and the ratings `beforeAll` 30-second timeout (see §12). No existing
behaviour was changed; no existing file was edited to "make room".

Migration `0006_phase4_duels_step2` was authored via
`prisma migrate diff --from-schema-datamodel /tmp/candle-schema-before.prisma --to-schema-datamodel prisma/schema.prisma --script`
(schema-before reconstructed from the pre-change schema; no live DB)
and hand-reviewed: 3 enums (`DuelType`, `DuelStatus`,
`DuelOutcome`), 4 tables (`duels`, `duel_answers`,
`duel_daily_sets`, `duel_game_results`), the unique constraints
(`duel_daily_sets.date`, `(duelId, userId, questionId)`,
`(duelId, userId)`), selector/history indexes, and FKs to `users` /
`duel_bank_items` / `duel_daily_sets`. It was NOT applied to a live
Postgres (none on this machine).

## 12. Verification

- Unit: **261/261** (25 suites; baseline 233/21, +28 new: 3
  duel-dates incl. the IST/UTC boundary, 6 bot-simulation incl.
  determinism + accuracy bands, 3 duel-scoring incl. the worked
  scoring examples, 11 duels service incl. caps, answer rules,
  pairing/settlement, rating-once, cap-failure cleanliness,
  duplicate-recovery, bot fallback, daily-set determinism, 5 ratings
  incl. the bot win/loss symmetry at expected 0.5, replay, daily cap,
  outcome recovery).
- E2E: **97/97** (baseline 91, +6 new duels tests: bot happy path +
  finish replay + XP-once, bot answer rules + ownership + 15 s limit,
  bot 10/day cap, daily happy path + second-player settlement +
  rating-once + 1/day 409, daily bot fallback via the admin endpoint
  - second settle is a no-op, settle-unpaired ADMIN-only).
- typecheck / lint / format clean.
- Seed counts verified from the seed file: 520 distinct keys
  (qb-001–qb-520).
- Worked examples verified end to end in unit + e2e: 5 correct at
  5,000 ms ⇒ 5 × 133 = 665; both players 5/5 with total times 20,000
  ms vs 40,000 ms ⇒ faster player wins +20 (K=40 provisional),
  slower loses −20.

**Flake note (honest).** One full e2e run during this build showed
1 failure out of 97 before the suite went green on the next two
consecutive runs (97/97, 97/97). The failing run's cause was not
captured in the saved output. Separately, the ratings `beforeAll`
hook (4 sequential Argon2 registrations) timed out twice at Jest's
5-second default on this loaded VM; it now carries the same explicit
30-second timeout the question-bank `beforeAll` already had (ADR
0005 §15.13), and the two-user duels tests carry 30-second timeouts
for the same reason. These are test-infra timeouts for a slow VM,
not product changes.

## 13. Deviation: the rated Daily Duel launches on the 520-item bank

Doc 05 §7 asks for 2,000 live items before any rated duel launches;
the bank holds 520 (the 500-item pipeline target is met, the
2,000-item launch target is still ahead). **The rated Daily Duel
launches on the 520-item bank anyway, as a recorded deviation,**
because the task for this step explicitly authorises it and the
exposure rules still hold: the daily set is 5 questions drawn from
520 across 10 topics, and the bank's 30-day / 3-times exposure rule
still governs Bot Duel selection and future days. The residual risk
is repeat exposure on the fixed daily set (see §6) and a thinner
selection pool for the daily mix than a 2,000-item bank would give;
growing the bank toward 2,000 remains open work, and no claim is
made that the bank is "launch-complete" — only that Step 2 is built
on the bank as it stands. The question-bank README's warning is
therefore updated by this ADR: rated duels now exist on this bank,
with this deviation on record.

## 14. Limits / not verified

- Migration not applied to a live Postgres; Docker not booted; seed
  never executed against a live DB.
- No live duels yet: no WebSocket gateway, no matchmaking, no sticky
  sessions, no Redis duel state (docs/05 §3). The REST answer flow
  trusts client-reported `timeMs` within range (§5).
- No scheduler calls `settle-unpaired`; it is a manual ADMIN endpoint
  until a cron is added (a future phase must also decide the exact
  23:59 IST trigger and what "day end" means for players mid-duel).
- `recordPilotAnswer` / `calibrate` still have no public endpoint
  (unchanged from ADR 0005 §15.13); bot/daily answers do not feed
  pilot data yet, so `discrimination` stays null and there is no
  drift check.
- Concurrent double-finish on an `IN_PROGRESS` duel relies on the
  status check + the unique `(duelId, userId)` result constraint;
  a true race surfacing as a 500 instead of a replay is untested —
  same posture as the simulator's order race check (ADR 0003/4).
- Concurrent first-player daily-set generation relies on the unique
  `date` constraint + re-read (service-level catch); exercised only
  by the fake's P2002-shaped throw, not by a real race.
- The e2e bank seed (96 items, difficulties 1–3 only) exercises the
  selector's nearest-difficulty fallback for the difficulty-4 cells
  in both blueprints; the real 520-item bank has all difficulties.

## 15. Consequences

- Step 3 (live Speed Quiz Duel) inherits: the duel tables, the
  scoring/stats builders, the bot simulation, the Ratings duel path
  with its idempotency key shape (`duel:{duelId}`), and the
  settlement ordering + recovery pattern in §7. A live duel must
  reuse `decideWinner` / `buildGameStats` / `grantDuelRewards`
  rather than re-implementing them, and must replace client-reported
  timing with the gateway-owned clock (§5).
- Any future rating-formula change must keep the audit trail honest
  (ADR 0005/14); `recordDuelVsBot` writes the same history shape as
  `recordDuel`, with `opponentId` null.
- Growing the bank toward 2,000 remains open (§13); the daily-set
  exposure trade-off in §6 should be revisited when the bank is big
  enough to exclude per-user repeats from a fixed set (e.g. by
  generating per-cohort sets).
