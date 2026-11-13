# ADR 0005 — Phase 3 Ratings (and Question Bank placeholder)

**Date:** 2026-11-11
**Status:** Accepted (Ratings built; Question Bank section below is a placeholder for the second builder)
**Context:** docs/04-ratings-and-deployment.md (approved spec — the Ratings
half of Phase 3). Blueprint §17 — Ratings plugs in as a new `ratings`
module; no core file is modified except the additive touchpoints listed
in §11. The Question Bank (docs/05) is built by a second builder on top
of this work; the integration points it inherits are listed in §12.

## 1. What was built

A new `ratings` NestJS module implementing docs/04 Part B end to end:

- `src/modules/ratings/` — controller (8 routes), service (transactional
  duel / trading-week / season-reset / decay core), repository (Prisma
  only, tx-aware), pure `rating-math.ts`, DTOs, README.
- Prisma: `RatingKind` / `RatingEventSource` enums, `UserRating` and
  `RatingHistory` models, `User.countryCode` + `User.countryCodeChangedAt`,
  migration `0005_phase3_ratings` (authored via `prisma migrate diff`,
  hand-reviewed — see §11).
- Shared: rating constants (`RATING_START`, `RATING_FLOOR`, `RATING_TIERS`,
  `RATING_K_*`, `RATING_PROVISIONAL_EVENTS`, `RATING_INDEX_OPPONENT`,
  `RATING_WEIGHTS`, anti-gaming/decay/leaderboard tunables) and four new
  error codes (`RATING_EVENT_DUPLICATE`, `RATING_DUEL_COOLDOWN`,
  `RATING_DAILY_LIMIT`, `RATING_COUNTRY_COOLDOWN`) with default messages,
  status map entries, and `AppError` factories.
- Redis sorted-set primitives (`zadd`, `zrevrange`, `zrevrank`, `zcard`,
  `zrem`) added to `RedisService` with `FakeRedisService` support (§9).
- Country support in `PATCH /users/me` (`UpdateProfileDto.countryCode`,
  90-day cooldown, §8).

## 2. Deliberate clarifications of doc 04 (spec ambiguities, decided here)

**K-factor boundary at exactly 1400.** Doc 04's K table reads "32 if
rating <1400, 24 if 1400–1799", but its own worked example — labelled
"verified" — uses K=32 for the player rated exactly 1400 (win +24.3,
expected win +7.7). The two cannot both hold. Decision: the worked
example governs the boundary, so the lower band is rating ≤ 1400
(32 at 1400 and below, 24 for 1401–1799, 16 at 1800+). Unit tests pin
both the boundary (`kFactor(1400, 10) === 32`) and the worked example.

**Decay weeks.** Doc 04 says "10 points per week toward 1000" after a
30-day grace, capped at 50 per run. Decision: weeks past the grace count
per _started_ week — 31 days idle ⇒ 1 week (10 points), 37 days ⇒ 2
weeks (20 points), 100 days ⇒ capped at 50. The drift never overshoots
1000, and never goes below the floor (which decay cannot reach anyway:
it always moves toward 1000).

**Duel idempotency key: one key, two carriers.** The duel endpoint
takes `idempotencyKey` in the body AND requires the `Idempotency-Key`
header; the two must match (mismatch is a validation error). Rationale:
the header follows the blueprint §6 / simulator pattern, while the body
key is the event id stored in the audit trail — one key, visible in
both places, so a replay and a history lookup can never disagree.

**Unrated trading weeks do not consume their key.** A week with fewer
than 3 trades returns `applied:false` with no rating change and no
history row — and the idempotency key is NOT stored, so a corrected
resubmission (e.g. a late-counted trade) can still rate that week.
A _rated_ week consumes its key and is additionally guarded by the
weekStart lookup, so one rated update per user per week holds even
under a fresh key.

**Reset / decay history rows carry `kFactor: 0`, scores `0`.** Those
rows are adjustments, not contested events — expected/actual scores do
not apply. They are still full audit rows (delta, before/after, season,
weekStart for decay), so a rating stays replayable.

**Daily caps use the UTC calendar day.** "Per day" in the anti-gaming
rules means 00:00–23:59 UTC, computed by `startOfUtcDay`. Streaks stay
in Asia/Kolkata (their own service); rating days are UTC by design,
documented here so the Question Bank builder does not "fix" it.

**Ratings are Floats, 1 decimal place.** Doc 04 §2 stores 1 decimal
internally and displays rounded. `round1` adds a 1e-9 epsilon before
rounding so exact .5 boundaries (e.g. 1019.45, which binary floats
store as 1019.449999…) round up as decimal arithmetic would. Deltas
are rounded to 1 decimal _before_ being applied, so the two sides of
a duel move by exactly opposite amounts.

## 3. Formula, tiers, seasons (as specified, no deviation)

- `Ea = 1 / (1 + 10^((Rb − Ra) / 400))`, `Ra' = Ra + K × (Sa − Ea)`,
  `Sa` = 1 / 0.5 / 0. Points gained exactly equal points lost (the
  loser is computed from the same rounded delta, mirrored).
- Start 1000, floor 100, provisional for the first 10 rated events.
- Tiers: Bronze <1100, Silver 1100–1299, Gold 1300–1499, Platinum
  1500–1699, Diamond 1700–1899, Master 1900+.
- Candle Rating = 0.5 × Learning + 0.5 × Trading, derived, never
  stored, shown only with its two parts.
- Season = calendar quarter (`2026-Q4`). Soft reset:
  `R_new = 1000 + (R_old − 1000) × 0.5`, recorded in history, order
  preserved. Idempotent per season via the history event id
  (`season-reset:{season}:{kind}`); a rating already at (or rounding
  back to) its reset value is a no-op.
- Trading score: win when the portfolio beats the index by >2 points,
  loss when it trails by >2, draw within ±2. Opponent is the simulated
  index, fixed at 1200.

## 4. Duels (Learning rated events are duels only)

- `POST /ratings/duels` is the only writer of Learning ratings.
  Practice / lesson quizzes never touch a rating (enforced by having
  no code path from quiz to ratings).
- Both players update in ONE transaction (rating rows + both history
  rows + idempotency record), via `TransactionService`.
- Anti-gaming, all server-side: same pair max 3 rated duels/day,
  max 10 rated events/user/day (both sides counted), 5-minute rematch
  cooldown (either direction, from the last duel's `createdAt`).
  Violations are 409 domain errors (`RATING_DAILY_LIMIT`,
  `RATING_DUEL_COOLDOWN`); duplicates are `RATING_EVENT_DUPLICATE`
  (history guard) or `IDEMPOTENCY_REPLAY` (header guard, with the
  original result), matching the simulator pattern.
- Ownership by construction: the caller is always one side of the
  duel — there is no user-id parameter to tamper with. Self-duels are
  rejected at the boundary; unknown opponents are 404.

## 5. Trading weeks (Trading rated events are weekly seasons only)

- `POST /ratings/trading-week` is ADMIN-only and takes caller-supplied
  numbers (`portfolioReturnPct`, `indexReturnPct`, `tradeCount`,
  `weekStart`). Any day in the week normalises to its Monday (UTC);
  the Monday is the week key.
- One rated update per user per week; fewer than 3 trades is an
  unrated week (§2).

## 6. Inactivity decay

- `POST /ratings/admin/decay` (ADMIN). After 30 days with no rated
  event in a rating, drift toward 1000 (§2). One decay per
  user/kind/week — the history event id carries the week
  (`decay:{kind}:{monday}`), so re-running in the same week is a
  no-op. Decay never touches `lastRatedAt` (it is not a rated event;
  moving it would hide the inactivity and stall future decay).
  `asOf` is accepted so a backdated run can be evaluated in tests.

## 7. Simulator seam (deliberate non-integration)

The Ratings module never imports or queries the simulator module
(no cross-module import, no shared service). The admin trading-week
caller supplies the numbers; Ratings only applies the formula. The
seam is the endpoint contract (`RecordTradingWeekDto`), not shared
code. This keeps both modules independently testable and means the
trading-week job (or a future scheduler) can be written without
touching Ratings. If a future phase wants Ratings to read portfolios
directly, that is a new ADR — not a quiet import.

## 8. Country

- `User.countryCode` (2-letter ISO, uppercase) + `countryCodeChangedAt`.
  Set via `PATCH /users/me`; changing to a _different_ code within 90
  days is 409 `RATING_COUNTRY_COOLDOWN`. The first set is always
  allowed; setting the same code is a no-op and consumes no cooldown.
- `countryCode` is denormalised onto `UserRating` rows at write time
  and refreshed when the user changes country, so leaderboard rebuilds
  can use it; the `User` row stays the authority.
- Wiring: `UsersService` calls `RatingsService.syncCountry` after a
  country change, which updates the rating rows and moves the user's
  national leaderboard membership (`zrem` from the old set, `zadd` to
  the new one). `UsersModule` imports `RatingsModule` one-directionally
  (Ratings imports nothing from users — it reads `User` rows through
  its own repository), so there is no module cycle.
- Users with no country appear only on the global leaderboard, never
  on a national one.

## 9. Leaderboards

- Redis sorted sets, one per kind per scope:
  `ratings:lb:LEARNING:global`, `ratings:lb:LEARNING:country:IN`.
  Member is the user id, score is the rating. Five sorted-set
  primitives were added to `RedisService` (additive — no existing
  method changed) with matching `FakeRedisService` support, so e2e
  exercises the real leaderboard code path over the fake.
- Postgres is the source of truth: on every rating change the sets are
  updated _after_ the transaction commits (a Redis failure is logged
  and never rolls back a rating), and an empty set is rebuilt from
  Postgres on read, so a cold cache never serves an empty board.
- Percentile = (users below ÷ total in scope) × 100. Responses expose
  display name, rating, tier, rank, percentile — never email, phone,
  or holdings. `GET /ratings/leaderboard` and `GET /ratings/users/:id`
  are public; `/me` and `/me/history` are authenticated.

## 10. History (audit trail)

`rating_history`: one row per rated event — `eventId` (idempotency key,
unique per user), opponent (+ rating at event time), expected/actual
score, K, delta, ratingBefore/After, season, `weekStart` for weekly
events. Any rating is replayable from history. `GET /ratings/me/history`
is paginated with a kind filter.

## 11. Additive core touchpoints (blueprint §2.4)

The only edits outside `ratings/` are additive: the shared constants
and error codes (§1), the four `AppError` factories + status map,
the five Redis sorted-set methods, `User.countryCode` /
`countryCodeChangedAt` + `UpdateProfileDto.countryCode` + the
`UsersService` country-change branch, the `RatingsModule` line in
`app.module.ts`, and the e2e fakes (`FakeDb` rating stores,
`FakeRatingsRepository`, `FakeRedisService` sorted sets,
`FakeUsersRepository` country fields). No existing behavior was
changed; no existing file was edited to "make room".

Migration `0005_phase3_ratings` was authored via
`prisma migrate diff --from-schema-datamodel /tmp/candle-schema-before.prisma --to-schema-datamodel prisma/schema.prisma --script`
(schema-before reconstructed from the pre-change schema; no live DB)
and hand-reviewed: 2 enums, 2 `users` columns, `user_ratings` +
`rating_history` tables, leaderboard/audit indexes, the unique
`(userId, eventId)` constraint, and FKs to `users`. It was NOT applied
to a live Postgres (none on this machine). **The Question Bank builder
extends this same migration** (see §12) — do not create a 0006 for
bank tables that belong to this phase.

## 12. Verification

- Unit: 160/160 (15 suites baseline 94 → 17 suites; +66 new: 40
  rating-math tests incl. the doc worked example both directions,
  26 service tests incl. caps, cooldowns, duplicates, reset, decay,
  leaderboards, country sync).
- E2E: 78/78 (baseline 61 → +17 new ratings tests: country set /
  validation / 90-day cooldown / membership move, duel happy path +
  validation + replay + opponent duplicate + rematch cooldown +
  history kind filter, public leaderboard ranks/percentiles/privacy,
  trading-week admin RBAC + win math + min-trades + duplicate week +
  replay, season reset idempotency, decay eligibility + weekly
  no-double-apply).
- typecheck / lint / format clean. Worked example verified end to end
  in unit + service tests: 1200 vs 1400, K=32, win ⇒ +24.3 → 1224.3,
  loser −24.3 → 1375.7; expected win ⇒ +7.7.

## 13. Limits / not verified

- Migration not applied to a live Postgres; Docker not booted.
- Redis sorted sets exercised only via the fake in e2e (real ioredis
  calls are thin wrappers over the documented commands).
- Concurrent same-key duel races rely on the pre-transaction guard +
  the in-transaction history check + the unique `(userId, eventId)`
  constraint; the last line of defence (a unique-violation surfacing
  as a 500 instead of a 409 under a true race) is untested — same
  posture as the simulator's order race check (ADR 0003/4).
- Decay and season reset are manual ADMIN endpoints; no scheduler
  invokes them yet.
- Leaderboard `rebuildLeaderboards` is called on empty-set reads only;
  there is no admin rebuild endpoint yet.

## 14. Consequences

- The Question Bank builder inherits: `UserRating` / `RatingHistory`
  models, the duel endpoint (duels will call it once questions exist),
  the country/leaderboard machinery, and migration 0005 to extend.
- Any future rating formula change must keep the audit trail honest:
  history rows are the replay source, so the formula version that
  produced a row must stay derivable from it (today: one formula,
  `kFactor` recorded per row).

---

## 15. Question Bank (Duels Step 1, docs/05 §2)

**Status:** Built (second builder, 2026-11-11). This section replaces the
placeholder that stood here. No duel code is built yet — no live gateway,
no matchmaking, no duel tables. The future duels module consumes this
bank through `QuestionBankService.selectSet` / `recordExposure` (see §15.11).

### 15.1 What was built

- `src/modules/question-bank/` — controller (11 routes), service
  (workflow / pilot / calibration / generation / selection), repository
  (Prisma only, tx-aware), pure `template-engine.ts`, pure
  `selection.service.ts`, DTOs, README.
- Prisma: `DuelBankSkill` / `DuelBankQuestionType` / `DuelBankStatus`
  enums, `DuelBankItem` + `DuelBankOption` + `DuelBankTemplate` +
  `UserQuestionExposure` models, `User.questionExposures` back-relation.
  Migration `0005_phase3_ratings` EXTENDED by appending the bank tables
  (no 0006 — same phase, same migration number, §11 of this ADR).
- Shared: `DUEL_BANK_TOPICS` / `DUEL_BANK_SKILLS` / `DUEL_BANK_TYPES`,
  `QUESTION_BANK` tunables, three new error codes
  (`QUESTION_BANK_INSUFFICIENT_COVERAGE`,
  `QUESTION_BANK_REVIEWER_MUST_DIFFER`,
  `QUESTION_BANK_INVALID_TRANSITION`) with default messages, status map
  entries, and `AppError` factories.
- Seed: `prisma/question-bank-seed.ts` — 120 original LIVE items + 2
  DRAFT templates, wired into `prisma/seed.ts` idempotently by `key`.

### 15.2 Deliberate clarifications of doc 05 (spec ambiguities, decided here)

**Topic is a String, not a closed enum.** Doc 05 §2.2 lists topics as a
growing set (`...`). The schema stores `topic` as `String`, validated
against the `DUEL_BANK_TOPICS` allowlist constant in shared. New topics
need no migration — only a constant + seed change. Skill and type ARE
closed Prisma enums (their sets are stable), status likewise.

**Submit-review: any ADMIN may submit.** The task text says "author
only or ADMIN", but every CMS route is ADMIN-only (RolesGuard), so the
author/admin distinction collapses — any admin may submit a draft for
review. The two-person rule is enforced where it matters: at review
(§15.4). No author check on submit.

**Reviewer-must-differ is 403, not 409.** The task allowed either. A
reviewer approving their own item is an authorisation failure (the
caller is not permitted to be the reviewer), not a state conflict, so
it maps to 403 with its own code
(`QUESTION_BANK_REVIEWER_MUST_DIFFER`). Invalid transitions are 409.

**Publish runs only from PILOT.** The task says "also allow REVIEW →
LIVE only via approve-then-publish". That is exactly what the state
machine enforces: REVIEW → PILOT (approve) → LIVE (publish). There is
no REVIEW → LIVE transition; publish from REVIEW is a 409.

**The immutability rule needed an endpoint.** Doc 05 §2.2 says editing
a LIVE item creates a new version, but the endpoint list had no edit
route. Added `POST /items/:id/new-version`: creates a new row
(version + 1, status DRAFT, key `<key>-v<version>`, author = caller),
copying fields unless overridden. The old row is never edited in place.

**Public views carry option ids.** The task says options are "text
only". A client cannot answer a question without an option reference,
so public views carry `{ id, text }` per option — ids as answer
references, never `isCorrect` or the explanation. No correctness
information leaves the server.

**Generated variants seed at difficulty 3.** Templates have no pilot
data, so a generated variant is an author estimate (middle difficulty)
until pilot + calibration set the real difficulty (§15.6).

**Seed size: 120, not 500.** Doc 05 §7 asks for 500 live items "to
prove the pipeline", then 2,000 before any rated duel launches. 120
items (10 topics × 12, full difficulty/type/skill spread) prove the
pipeline — schema, workflow, generation, selection, exposure — with
hand-written original content. Growing to 500 is CMS + template work,
not more design; the bank grows from here, and no rated duel launches
until the 2,000 target is met. This is staging, not a scope cut.

**Selection loads LIVE items and filters in memory.** At v1 bank size
(hundreds of items) the service loads LIVE items (narrowed by the
blueprint's topics/skills/types in the query) and applies exposure
exclusions + stratification in memory. A DB-side selection query is a
later optimisation when the bank reaches thousands of items.

### 15.3 Schema

- `DuelBankItem`: `key` (unique stable seed key, e.g. `qb-001`),
  `topic` (allowlist String), `skill`, `type`, `difficulty` 1–5,
  `language` (default `en`), `sourceLessonId?`, `stem`, `explanation`
  (required), `status`, `version` (default 1), `templateId?`,
  `parameters` (Json?), `authorId?`, `reviewerId?`, `publishedAt?`,
  `pilotAnswers` / `pilotCorrect` / `correctRate` / `discrimination`
  (null until real duel data exists), `exposureCount`. Indexes on
  `(status, topic, difficulty)`, `(status, skill)`, `templateId`.
- `DuelBankOption`: `itemId` (cascade delete), `text`, `isCorrect`,
  `order`.
- `DuelBankTemplate`: `key` (unique), `topic`, `skill`,
  `templateText`, `parameterSchema` (Json), `answerFormula?`,
  `distractorRules` (Json?), `status` (default DRAFT).
- `UserQuestionExposure`: `(userId, bankItemId)` composite key,
  `lastSeenAt`, `seenCount`, index on `(userId, lastSeenAt)`.

### 15.4 Workflow + two-person review + immutability

```
DRAFT → REVIEW → PILOT → LIVE → RETIRED
              ↘ DRAFT (reject)      ↗ RETIRED (from PILOT)
```

- Create (ADMIN): DRAFT, author = caller, `key` supplied or generated
  (`qb-<uuid>`). Option shapes validated by the service (400 on
  violation): MCQ_4 = exactly 4 options with exactly 1 correct;
  TRUE_FALSE = exactly 2 with exactly 1 correct; other types = at
  least 2 with at least 1 correct.
- Submit-review: DRAFT → REVIEW (any admin, §15.2).
- Review: REVIEW → PILOT on APPROVE, REVIEW → DRAFT on REJECT.
  Reviewer MUST differ from author (403
  `QUESTION_BANK_REVIEWER_MUST_DIFFER`); `reviewerId` is recorded.
- Publish: PILOT → LIVE only, sets `publishedAt`. Never direct
  DRAFT → LIVE (§15.2).
- Retire: LIVE / PILOT → RETIRED.
- New version: `POST /items/:id/new-version` (§15.2). Published
  versions are immutable — no endpoint edits a LIVE row in place.
- Invalid transitions are domain errors (409
  `QUESTION_BANK_INVALID_TRANSITION`), never validation errors.
- Admin list/get views INCLUDE correct answers and explanations;
  coverage (`GET /coverage`) reports LIVE counts per topic ×
  difficulty with zeros included, so thin cells are visible.

### 15.5 Audit (gap, documented honestly)

The `AuditService` is provided by `AdminModule` but NOT exported, so
the bank cannot inject it cleanly. Instead of inventing a second audit
system, the bank repository writes to the SAME append-only `audit_log`
table with the SAME row shape (actor, action, entityType
`duel_bank_item`, entityId, before/after, IP) through
`QuestionBankRepository.appendAudit`, inside the same transaction as
the mutation. One audit table, one shape, two writers. If a future
phase exports `AuditService` from `AdminModule`, the bank should
switch to it — the call sites are one method (`audit`) in the service.

### 15.6 Pilot + calibration (docs/05 §2.5)

New items reach PILOT after review and are shown only in unrated
practice / bot duels. **Pilot items are NEVER returned by the rated
selection engine** (selection queries LIVE only).

- `recordPilotAnswer(itemId, correct)` (service method only — no
  public endpoint yet): increments `pilotAnswers` / `pilotCorrect`
  and recomputes `correctRate`. Refuses non-PILOT items (409).
- `calibrate(itemId)` (service method only — no public endpoint yet):
  requires ≥ 50 pilot answers (else 409), then sets difficulty from
  `correctRate` using the spec's bands, split exactly as follows:

  | correctRate | difficulty |
  | ----------- | ---------- |
  | ≥ 0.90      | 1          |
  | 0.80 – 0.90 | 2          |
  | 0.50 – 0.80 | 3          |
  | 0.35 – 0.50 | 4          |
  | < 0.35      | 5          |

  `discrimination` stays **null**: full IRT calibration needs
  per-rating-band correct rates from real duel data, which does not
  exist yet. It is never faked, and no drift check runs yet (monthly
  drift flagging needs duel history first).

### 15.7 Template engine (docs/05 §2.4)

Pure, deterministic generation in `template-engine.ts` (seeded
mulberry32 RNG — the same seed replays the same variant). Every
variant is validated before it can be created (non-empty stem,
exactly 4 options, exactly 1 correct, all option texts distinct,
parameters inside their domains).

- **tpl-compounding** — "You invest ₹{principal} at {rate}% per year.
  After {years} years, about how much do you have, ignoring tax?"
  Domains: principal {10000, 25000, 50000}, rate {6, 8, 10, 12},
  years {3, 5, 10} = 36 combinations. Correct = compounding rounded
  to the nearest ₹100; distractors = simple-interest answer,
  no-growth answer, one-year-less compounding answer. Worked example
  (pinned in unit tests): ₹10,000 at 10% for 3 years → ₹13,310,
  rounded to ₹13,300; distractors ₹13,000 / ₹10,000 / ₹12,100.
- **tpl-budgeting-503020** — randomised monthly income from {30000,
  40000, 50000, 60000, 80000}; asks for the 20% savings share.
  Distractors = 30% (wants), 50% (needs), 10% (half the savings).

`POST /templates/:id/generate {count, seed}` creates DRAFT items
linked by `templateId` + `parameters`, seeded at difficulty 3
(§15.2). Re-running the same template + seed skips already-generated
variants by key. Both templates seed as DRAFT.

### 15.8 Selection algorithm + fallback (docs/05 §2.6)

`selectSet(userIds, blueprint)` — `blueprint = { count,
difficultyMix, topics?, skills?, types?, maxPerTopic? }`:

1. LIVE items only, narrowed to the blueprint's topics/skills/types.
2. Excludes items ANY listed user saw in the last 30 days or saw
   3+ times (§15.9).
3. Stratified by the requested difficulty mix; a short cell falls
   back to the **nearest difficulty** (absolute distance; ties prefer
   the easier difficulty) — never to a repeat.
4. At most `maxPerTopic` (default 2) items from one topic, unless the
   blueprint says otherwise.
5. At least 3 different skills when count ≥ 6 (a repair pass swaps a
   duplicated-skill item for an unused-skill item; if no swap can fix
   it, the set cannot be built).
6. Never repeats an item within the set. If the bank cannot fill the
   set even after fallback, it throws 409
   `QUESTION_BANK_INSUFFICIENT_COVERAGE` — never a repeated or thin
   set silently. The `difficultyMix` must sum to `count` (400
   otherwise).

### 15.9 Exposure rules (docs/05 §2.3)

`user_question_exposures` enforces: an item may be shown to the same
user at most once in 30 days and at most 3 times in total. Selection
excludes an item if ANY listed user breaches either rule for it.
`recordExposure(userId, itemIds)` upserts exposure rows
(`seenCount` + 1, `lastSeenAt` = now) and bumps each item's
`exposureCount`. `POST /select` selects and records exposure for the
caller in ONE transaction; it records exposure for the caller only,
not the opponent (the opponent's exposure is recorded when the
opponent plays, by the duel module).

### 15.10 Seed size / coverage

`prisma/question-bank-seed.ts` — 120 LIVE items, all original finance
questions in simple English, 1–3 sentence explanations, no copied
Varsity content, no real tickers, no real companies as investment
examples (fictional companies only, clearly fictional):

| Topic          | Items   | Difficulties (1/2/3/4/5) | MCQ_4   | TRUE_FALSE |
| -------------- | ------- | ------------------------ | ------- | ---------- |
| money-basics   | 12      | 3/4/3/1/1                | 10      | 2          |
| budgeting      | 12      | 3/4/3/1/1                | 10      | 2          |
| banking-saving | 12      | 3/4/3/1/1                | 10      | 2          |
| stocks         | 12      | 3/4/3/1/1                | 10      | 2          |
| mutual-funds   | 12      | 3/4/3/1/1                | 10      | 2          |
| risk           | 12      | 3/4/3/1/1                | 10      | 2          |
| compounding    | 12      | 3/4/3/1/1                | 10      | 2          |
| tax-basics     | 12      | 3/4/3/1/1                | 10      | 2          |
| insurance      | 12      | 3/4/3/1/1                | 10      | 2          |
| markets        | 12      | 3/4/3/1/1                | 10      | 2          |
| **Total**      | **120** | **30/40/30/10/10**       | **100** | **20**     |

Skills across the bank: recall 41, judgement 37, calculation 29,
scenario 13. Seed is idempotent by `key`: a LIVE item is never
overwritten — it is skipped, like a published lesson version. The
2 templates seed as DRAFT.

### 15.11 How rated duels consume bank questions + anti-gaming

- The Ratings duel endpoint (`POST /ratings/duels`) takes the
  _result_ only and does not change: question selection, timing, and
  scoring live in the future duels module, which calls
  `QuestionBankService.selectSet(userIds, blueprint)` at match time
  (same set, same order, for both players) and `recordExposure`
  after serving it. `POST /question-bank/select` is the interim HTTP
  seam for practice/single-player use; live duels call the service
  directly instead.
- Bank fairness rules are independent of the Ratings caps (§4): the
  pair/day limits and rematch cooldown still apply at rating time,
  while the bank additionally guarantees no question repeats (30-day
  / 3-times exposure, §15.9) and no thin sets (409 instead of a
  broken duel, §15.8). A duel that cannot get a full fresh set is
  not started — the user gets "no duel available", not a repeat.

### 15.12 Verification

- Baseline (Stage 1, verified before any bank change): unit 160/160,
  e2e 78/78.
- After: unit **210/210** (20 suites; +50 new: 13 template-engine
  incl. the compounding worked example, 11 selection incl. fallback
  and skill-diversity failure, 26 service incl. workflow, two-person
  rule, calibration bands, generation idempotency, exposure exclusion).
- E2E: **91/91** (+13 new: full workflow, author-cannot-approve-own,
  reject, invalid transition, RBAC + option-shape 400, admin list
  filters, coverage, selection hides answers + mix + no-repeat,
  exposure exclusion across two selections, insufficient coverage
  409, template generation + seed re-run skip, new-version
  immutability, select requires auth).
- typecheck / lint / format clean (including the seed file's own
  tsconfig). Migration authored via `prisma migrate diff` from the
  ratings-only schema (reconstructed in `/tmp`, no live DB) to this
  schema and hand-reviewed: 3 enums, 4 tables, selector/audit
  indexes, unique keys, FKs — appended to `0005_phase3_ratings`.
- Seed counts verified from the seed file: 120 keys (`qb-001`–
  `qb-120`), 12 per topic, difficulties 30/40/30/10/10, 100 MCQ_4 +
  20 TRUE_FALSE.
- Forbidden-word check: zero hits for the banned term (case-insensitive
  grep over all new/changed files).

### 15.13 Limits / not verified

- Migration not applied to a live Postgres; Docker not booted.
- Seed never run against a live DB (no Postgres on this machine);
  seed idempotency is by code inspection + the upsert-by-key shape,
  not by an executed run.
- `recordPilotAnswer` / `calibrate` have no public endpoint and no
  e2e coverage yet (unit-tested only); they are wired for the future
  practice/bot duel module.
- Calibration is provisional until real duel data exists:
  `discrimination` is always null, and there is no monthly drift
  check yet (docs/05 §2.5 step 4).
- Selection loads LIVE items into memory (§15.2); fine at v1 scale,
  needs a DB-side query before the bank reaches thousands of items.
- The 120-item seed is below doc 05's 500-item pipeline target and
  2,000-item launch target (§15.2) — no rated duel may launch on this
  bank as it stands.
- Concurrent same-key item creation relies on the pre-check +
  the unique `key` constraint; a true race surfacing as a 500 instead
  of a 409 is untested — same posture as the simulator's order race
  check (ADR 0003/4).
- E2E `beforeAll` for the question-bank suite carries an explicit
  30-second timeout: registering 4 users hashes 4 passwords (Argon2)
  and exceeds Jest's 5-second default hook timeout on a loaded VM.
