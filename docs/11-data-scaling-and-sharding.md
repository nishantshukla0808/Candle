# Candle — Data Scaling, Partitioning, and Sharding Design

**Date:** 2026-11-12
**Status:** DESIGN ONLY — no code, migration, or seed is changed by
this document. It is the plan Nishu asked for: how Candle handles
a big database properly, with system-design efficiency principles
applied where they are actually needed.
**Depends on:** Blueprint 01 (PostgreSQL + Prisma, Redis, outbox,
idempotency), Ratings doc 04, Duels doc 05, Phase 4 doc 07,
Phase 5 doc 09, Phase 6 doc 10, Profiles/Community doc 06,
`apps/api/prisma/schema.prisma` (read in full, 2026-11-12).

**The one-line answer:** do not shard now. Candle today has 520
bank items and zero production users. The correct order is:
indexes + retention first, then partitioning + read replicas,
then — only when a single Postgres primary can no longer keep
up — sharding, with the shard key decided per table in §4.
Sharding early is the most expensive mistake on this list: it
breaks joins, transactions, and unique constraints, and it cannot
be undone by deleting code.

---

## 0. Assumptions behind every number in this doc

All row estimates use one stated workload model, so anyone can
re-derive them. If real traffic differs, re-measure — do not
argue from these numbers.

- **Registered users:** 10,000 / 100,000 / 1,000,000 (the three
  columns in §1).
- **Monthly active users (MAU): 30% of registered.** So 3,000 /
  30,000 / 300,000 active users per month.
- **One active user per month, on average:** 8 duels (mixed
  Bot / Daily / Live / Blitz), 3 lesson quizzes, 8 simulator
  orders, 30 XP-earning events, 5 rated events (the rest of the
  duels are practice or bot duels), 50 newly-seen bank items.
- **One duel, on average:** 7 questions (Bot/Live) or 5 (Daily)
  or 10 (Blitz) — modelled as 7 answers and 1 result row per
  player, 2 result rows per human-vs-human duel.
- **Future social (doc 06, not built yet):** 20% of active users
  send 30 chat messages/month; 5% write 2 community posts/month
  and 10 comments/month.
- **Row sizes (approximate, including row overhead):**
  `DuelAnswer` ~150 B, `RatingHistory` ~200 B, `XpLedger` ~120 B,
  `SimOrder` ~200 B, `Duel` ~400 B, `DuelGameResult` ~8 KB
  (its `perQuestion` JSON carries stems, options, and explanations
  for every question — this is the single biggest storage driver
  in the whole schema, see §1.3), `ChatMessage` ~300 B.

These are planning numbers, not measurements. §7 defines the
metrics that replace them with real data.

---

## 1. Data inventory — every table, grouped by growth

### 1.1 The inventory (all 42 models in `schema.prisma`)

**A. Hot / write-heavy — these decide whether the database survives**

| Table | Growth driver | Rows / month at 10k / 100k / 1M users | Rows / year at 1M | Main queries |
|---|---|---|---|---|
| `DuelAnswer` | 7 answers × 8 duels × MAU | 168k / 1.7M / 17M | ~200M | `WHERE duelId = ? AND userId = ?` (live grading, settlement); `WHERE questionId = ?` (pilot calibration) |
| `DuelGameResult` | 1 row per player per duel | 24k / 240k / 2.4M | ~29M | `WHERE userId = ? ORDER BY createdAt DESC` (history, last-5-per-type, doc 06); `WHERE duelId = ?` (result page) |
| `XpLedger` | ~30 XP events × MAU | 90k / 900k / 9M | ~108M | `WHERE userId = ? ORDER BY createdAt DESC` (ledger view, replay); unique `idempotencyKey` |
| `RatingHistory` | 5 rated events × MAU | 15k / 150k / 1.5M | ~18M | `WHERE userId = ? AND kind = ? ORDER BY createdAt DESC` (explain my Rating); unique `(userId, eventId)` |
| `SimOrder` | 8 orders × MAU | 24k / 240k / 2.4M | ~29M | `WHERE portfolioId = ? ORDER BY createdAt DESC` (order history) |
| `UserQuestionExposure` | 50 newly-seen items × MAU, capped by bank size | 150k / 1.5M / 15M new rows/mo until the cap bites | capped (see §1.3) | `WHERE userId = ? AND lastSeenAt > now-30d` (selection exclusion) |
| `QuizAttempt` + `AttemptAnswer` | 3 quizzes × MAU; ~10 answers each | 9k + 90k / 90k + 900k / 900k + 9M | ~11M answers | `WHERE userId = ?`, `WHERE attemptId = ?` |
| `AuditLog` | every admin/content action | small at first, grows with moderators | — | `WHERE entityType = ? AND entityId = ?`, `WHERE actorId = ?` |
| `OutboxEvent` | every cross-service event | ~1 per duel settle + rating change | — | `WHERE processedAt IS NULL ORDER BY createdAt` (relay) |

**B. Cold / read-heavy — big in rows, small in writes, served from
cache or a replica**

| Table | Growth driver | Rows at 1M users | Main queries |
|---|---|---|---|
| `DuelBankItem` + `DuelBankOption` | content, not users | 2,000 at launch → 20,000+ mature (+ ~4 options each) | `WHERE status = LIVE AND topic = ? AND difficulty = ?` (selection, §2.1); read-heavy, tiny write rate |
| `Lesson` / `LessonVersion` / `Question` / `QuestionOption` | content | hundreds | `WHERE lessonVersionId = ?`, `WHERE lessonId = ? AND status = PUBLISHED` |
| `AssessmentVersion` / `AssessmentQuestion` / `AssessmentOption` | content | tens per version | `WHERE versionId = ?` |
| `Track` / `LearningModule` | content | tens | `WHERE trackId = ? ORDER BY "order"` |
| `SimInstrument` | content | 6 (fictional tickers) | `WHERE active = true` — fits in memory, cache it |
| `Badge` | content | tens | `WHERE slug = ?` |
| `DuelDailySet` | 1 row per day | 365 / year | `WHERE date = ?` (unique) |
| `DuelBankTemplate` | content | tens | `WHERE key = ?` |

**C. Small / one-row-per-user — never the scaling problem, but
the most-joined tables (so they must stay fast)**

| Table | Rows at 1M users | Notes |
|---|---|---|
| `User` | 1M | `email` unique; every user-owned query starts here |
| `UserStats` | 1M (1:1) | denormalised counters — see §3, hot counters move to Redis first |
| `UserRating` | 2M (2 kinds × user) | `(kind, rating)` index feeds leaderboard rebuilds |
| `UserKnowledgeProfile` | 1M (1:1) | rewritten per assessment, not appended |
| `SimPortfolio` | 1M (1:1, lazy) | row-locked on every trade — see §6 |
| `SimHolding` | ≤ 6M (≤6 instruments × user) | composite PK `(portfolioId, instrumentId)` |
| `UserLessonProgress` | users × lessons (≤ ~200 lessons) | composite PK `(userId, lessonId)`; bounded |
| `LessonCompletion` | users × lessons completed | unique `(userId, lessonId)` |
| `UserBadge` | users × badges earned | composite PK `(userId, badgeId)` |
| `RefreshToken` | ~2–3 per user | indexed by `userId`, `familyId`; expired rows must be pruned |
| `EmailToken` | transient | expired rows must be pruned |
| `IdempotencyRecord` | transient (TTL'd) | `expiresAt` index exists — prune by it, see §2.4 |
| `PlacementWaiver` | ≤ users × tracks | composite PK `(userId, trackId)` |
| `AssessmentAttempt` / `AssessmentResult` | ~1–3 per user | 1 official attempt + retakes (max 3, 7-day cooldown) |

**D. Future tables (doc 06 — designed, not built yet). Their
growth is estimated here so the schema is not a surprise later.**

| Future table | Growth driver | Rows / month at 1M users | Main queries |
|---|---|---|---|
| `ChatMessage` | 20% of MAU × 30 msg | 1.8M | `WHERE chatId = ? ORDER BY createdAt DESC` (cursor pagination); `chatId = "dm:{smaller}:{larger}"` |
| `Friendship` | 2 rows per accepted friend pair | small | `WHERE userId = ? AND status = ACCEPTED` |
| `Follow` | follows | small | `WHERE followerId = ?` / `WHERE followingId = ?` |
| `ChatRead` | 1 row per (chat, user) | small | `WHERE chatId = ? AND userId = ?` |
| `Community` | admin-seeded | 6 at launch | `WHERE slug = ?` |
| `CommunityMember` | joins | small | `WHERE communityId = ? AND userId = ?` |
| `CommunityPost` | 5% of MAU × 2 | 30k | `WHERE communityId = ? ORDER BY createdAt DESC` (New feed); feed ranking (§5.4 of doc 06) |
| `PostVote` | votes | ~10× posts | unique `(postId, userId)`; `WHERE postId = ?` for score |
| `PostComment` | 5% of MAU × 10 | 150k | `WHERE postId = ? ORDER BY createdAt` |
| `PollVote` | votes | ~posts | unique `(postId, userId)` |
| `PostReport` | reports | small | moderation queue `WHERE status = OPEN ORDER BY createdAt` |
| `SavedPost` | saves | small | unique `(userId, postId)` |
| `UserPrivacySettings` / `UserSettings` | 1 row per user | 1M each | `WHERE userId = ?` (every profile/settings read) |
| `NotificationPreference` | ~12 types × user | 12M at 1M users | `WHERE userId = ? AND type = ?` |
| `LoginEvent` | logins | ~2–4M / month | `WHERE userId = ? ORDER BY createdAt DESC LIMIT 20`, 90-day retention |
| `BlockedUser` | blocks | small | unique `(blockerId, blockedId)` |

### 1.2 The ranking: what gets big first

At 1M registered users, in order of yearly row growth:

1. **`DuelAnswer` — ~200M rows/year.** The biggest table by rows.
   Small rows, but relentless: every duel writes 7–20 of them.
2. **`XpLedger` — ~108M rows/year.** Append-only, never updated,
   never deleted in v1. The second-biggest table — and the one
   most likely to be forgotten until it is 100 GB.
3. **`DuelGameResult` — ~29M rows/year, but ~230 GB/year of
   storage** at ~8 KB per row. The biggest table by *bytes*, not
   rows, because `perQuestion` JSON duplicates stems, options,
   and explanations for every question of every duel.
4. **`SimOrder` — ~29M rows/year.** Steady, predictable, one
   portfolio at a time.
5. **`RatingHistory` — ~18M rows/year.** Audit trail; must never
   be deleted casually (it is how a Rating is explained).
6. **`UserQuestionExposure` — capped, but the cap is large**
   (see §1.3).
7. **`ChatMessage` (future) — ~22M rows/year at 1M users.**
   Only after doc 06 chat ships; not a v1 problem.

Everything else is at most a few million rows at 1M users and is
not a scaling concern before Phase C.

### 1.3 Three hidden monsters (call them out now, not at 1M users)

**Monster 1 — `DuelGameResult.perQuestion` JSON (~8 KB/row).**
At 2.4M results/month this is ~19 GB/month, ~230 GB/year, and
it is almost all duplicated text: the same stem, the same 4
options, and the same explanation, copied into every player's
result for every duel. Worse, doc 06 (decided 2026-11-12) says a
profile shows only the **last 5 games of each duel type** —
so after 5 games, older detail rows are never shown on a profile
at all. The fix is in §2.4 (archive the detail, keep a slim hot
summary), not in buying a bigger disk.

**Monster 2 — `UserQuestionExposure` has a per-user cap equal to
the bank size.** At a 2,000-item bank, one heavy user can hold
2,000 exposure rows; at a 20,000-item mature bank, 20,000 rows.
At 300,000 monthly active users that is a theoretical 600M–6B
rows — except the 30-day rule makes most of them reusable, so
the *live* set per user is only the items seen in the last 30
days (about 50–150 rows). The table must therefore be pruned
by age (§2.4), and exhausted items (seen 3 times, rested
forever) must move out of this table into a compact form (§2.4,
the rested-set design). If it is never pruned, it becomes the
biggest table in the database by accident.

**Monster 3 — `XpLedger` never stops growing and is never read
in full.** Nobody pages through 3 years of XP events. It is an
audit log wearing a ledger's clothes. It needs a retention rule
(§2.4): hot rows (last 90 days) in Postgres, older rows in cold
archive, with `UserStats.totalXp` as the authoritative balance —
never `SUM(xp_ledger)` over the whole table.

---

## 2. What to do NOW (Phase A — v1, single Postgres)

No sharding. No new infrastructure. These are the changes that
buy the most headroom for the least risk, and they are all safe
to do on a live single Postgres.

### 2.1 Indexes that must exist (and the ones that must not)

**Rule:** every query in §1 must be served by an index, and every
index must be justified by a query. An index on a write-heavy
table costs a write on every insert — `DuelAnswer` with 6 indexes
is slower than `DuelAnswer` with 3.

**Already correct (do not touch):**
`User.email` (unique), `UserRating (kind, rating)`,
`RatingHistory (userId, kind, createdAt)` and `(userId, createdAt)`,
`DuelBankItem (status, topic, difficulty)` and `(status, skill)`,
`Duel (playerAId, type, createdAt)`, `(type, dailyDate, status)`,
`(type, status, createdAt)`, `DuelAnswer` unique
`(duelId, userId, questionId)` + `(duelId, userId)`,
`DuelGameResult` unique `(duelId, userId)` + `(userId, createdAt)`,
`SimOrder (portfolioId, createdAt)`,
`UserQuestionExposure (userId, lastSeenAt)`,
`XpLedger (userId)`, `LessonCompletion` unique `(userId, lessonId)`.

**Add now (Phase A, each with a named query it serves):**

| Index | Serves |
|---|---|
| `DuelAnswer (questionId, createdAt)` | pilot calibration: "who answered this item, and how did they do?" — today this is a full scan |
| `XpLedger (userId, createdAt DESC)` | ledger history pages; today only `(userId)` exists, so ordering is a sort |
| `QuizAttempt (userId, createdAt DESC)` | "my recent quizzes" |
| `SimPortfolio (userId)` | already unique on `userId` — verify, do not duplicate |
| `AuditLog (createdAt DESC)` | admin "recent actions" — today only `(entityType, entityId)` and `(actorId)` exist |
| `OutboxEvent (processedAt, createdAt)` | already exists — verify the relay uses it, and that `processedAt IS NULL` is the hot path |
| `Duel (winnerId, createdAt)` — only if a "duels I won" query is added; do not add speculatively | — |
| Future `ChatMessage (chatId, createdAt DESC)` | chat history, cursor pagination (§2.3) |
| Future `CommunityPost (communityId, createdAt DESC)` and `(communityId, score)` | New feed and Top feed |
| Future `PostComment (postId, createdAt)` | comment threads |
| Future `LoginEvent (userId, createdAt DESC)` | last-20-logins, 90-day retention |

**Do not add:** single-column indexes on every foreign key
"just in case" (each one is paid for on every insert into a hot
table); indexes on low-cardinality columns alone (`status`,
`type` — only as the *first* column of a composite that matches
a real query); expression indexes before a slow query proves
they are needed.

**Use `CREATE INDEX CONCURRENTLY`** for every index added to a
table that already has rows. A normal `CREATE INDEX` locks
writes. This is the single most common self-inflicted outage
in Postgres, and it is entirely avoidable.

### 2.2 Partitioning vs plain indexes — the decision for Phase A

**Decision: plain indexes now; partitioning in Phase B (§3).**
Reason: partitioning a table that has 100,000 rows buys nothing
and costs a migration, a primary-key change, and Prisma friction
(§8.3). Indexes serve every query in §1 until a hot table passes
~10M rows (§3 triggers). The one exception is a table whose
*deletion* pattern is time-based: if a table is pruned by age,
partitioning by month turns a slow `DELETE … WHERE createdAt < …`
(which locks and bloats) into a fast `DROP TABLE` of a whole
month. That is the real reason to partition — cheap deletion,
not faster reads. See §3 for the partition design, ready to
apply when the trigger fires.

### 2.3 Pagination — cursor, never offset, on big tables

Blueprint §6 specifies `?page=1&limit=20`. That is fine for
small tables (tracks, lessons, communities). **It is wrong for
big tables.** `OFFSET 1,000,000 LIMIT 20` still reads 1,000,020
rows and throws 1,000,000 away — and it gets slower the further
back a user pages, which is exactly what duel history and chat
do.

**Rule (Phase A, enforce in code review):**
- Hot tables (`DuelGameResult`, `DuelAnswer`, `XpLedger`,
  `RatingHistory`, `SimOrder`, future `ChatMessage`,
  `CommunityPost`): **keyset (cursor) pagination only** —
  `WHERE (createdAt, id) < (cursorCreatedAt, cursorId)
  ORDER BY createdAt DESC, id DESC LIMIT 20`.
  The cursor is an opaque token, never a page number.
- Small tables (content, settings, friends list): offset
  pagination is acceptable, capped at 100 per page.
- The doc 06 last-5-per-type rule makes this cheap: duel
  history is `WHERE userId = ? AND type = ? ORDER BY
  createdAt DESC LIMIT 5` — a single index lookup, no
  pagination at all. The full-history endpoint must not exist
  just because the table has the rows.

### 2.4 Retention and archival rules (decided now, enforced by jobs)

Every hot table gets a written retention rule. "Keep everything
forever" is not a rule — it is a disk purchase plan.

| Table | Hot window | After the window | Enforcement |
|---|---|---|---|
| `DuelGameResult` | 90 days (full row, incl. `perQuestion`) | Move `perQuestion` JSON to cold archive (S3-compatible object storage, keyed by `duelId:userId`); keep a slim hot row: `duelId, userId, type, result, score, correct, accuracy, ratingDelta, xpAwarded, createdAt` | Nightly job; the result page reads hot first, archive on demand |
| `DuelAnswer` | 90 days in hot table | Archive to cold storage (one file per month, Parquet/JSONL); keep the aggregate counts (`correctRate`, `pilotAnswers`) on `DuelBankItem` — the calibration data, not the raw rows | Monthly job; disputes after 90 days replay from archive |
| `RatingHistory` | Keep 2 years hot | Archive older rows to cold storage; never delete the audit trail, only move it | Yearly job; replay-from-history must know to read the archive |
| `XpLedger` | 90 days hot | Archive; `UserStats.totalXp` is the balance of record | Monthly job |
| `UserQuestionExposure` | 30-day window is live; rows older than 90 days with `seenCount < 3` are **deleted** (the item is reusable anyway) | Rows with `seenCount = 3` (rested forever) move to a compact rested set: one Redis set per user, `rested:{userId}`, members = item ids — a set lookup, not a row per item. If Redis is lost, the rested set is rebuilt from the archive, and the worst case is one repeated question, not data loss | Weekly job |
| `SimOrder` | 1 year hot | Archive older orders; portfolio value is derived from `SimHolding` + current prices, not from replaying orders | Yearly job |
| `QuizAttempt` / `AttemptAnswer` | 1 year hot | Archive; `LessonCompletion` is the durable record | Yearly job |
| `AuditLog` | 1 year hot | Archive; admin audit is a legal record, never hard-deleted without a decision | Yearly job |
| `OutboxEvent` | 7 days after `processedAt` | Delete processed rows older than 7 days; unprocessed rows older than 24h alert (§7) | Daily job |
| `IdempotencyRecord` | Until `expiresAt` | Delete by `expiresAt` (index exists) | Daily job |
| `RefreshToken` / `EmailToken` | Until expiry/revocation | Delete expired rows | Daily job |
| Future `ChatMessage` | 1 year after last message in the chat (doc 06 §2.6) | Archive, then delete; reported messages kept until the report closes | Monthly job |
| Future `LoginEvent` | 90 days (doc 06 §2.2) | Delete | Daily job |
| Future `CommunityPost` (deleted) | 30 days for appeal (doc 06 §2.6) | Hard-delete after 30 days | Daily job |

**Archival is not deletion.** Every archive job writes to cold
storage *first*, verifies the write (row count + checksum),
and only then deletes from Postgres. A job that deletes before
verifying is a data-loss bug, not an optimisation.

### 2.5 Avoiding N+1 (the cheapest performance win in the codebase)

Blueprint §12 already says it; this doc makes it a rule with
teeth:

- Repositories batch with `include`/`select` deliberately.
  A duel result page must not issue one query per question to
  fetch stems — `DuelGameResult.perQuestion` already carries
  them, which is *why* the JSON is denormalised (and why it is
  expensive, §1.3 — the trade-off is explicit, not accidental).
- Leaderboard top-100 comes from **one** Redis `ZREVRANGE`,
  never one query per user to fetch display names — display
  names are fetched in a single `WHERE id IN (…)` batch.
- A feed page fetches posts, then authors, then vote counts in
  three batched queries, never N+1.
- **Review gate:** any PR that adds a loop containing a
  repository call is rejected until the loop is batched. Query
  count per request is a review point (Blueprint §12) — and in
  Phase B it becomes a logged metric (§7).

### 2.6 UUIDs — the quiet index problem

Every id today is `uuid()` — UUIDv4, random. Random ids insert
at random positions in every B-tree index, which causes page
splits and index bloat on hot tables (`DuelAnswer`,
`XpLedger`, `RatingHistory`). This is not a problem at 10,000
rows. It is a real problem at 100M rows.

**Decision (Phase B, not Phase A):** new high-write tables use
time-ordered ids — UUIDv7, generated in the application
(never `gen_random_uuid()` in the DB, so the value is known
before insert and works with idempotency keys). Existing tables
keep UUIDv4; migrating existing ids is never worth it. This
single change makes hot-table inserts mostly-append-only, which
is the cheapest index optimisation available.

### 2.7 What NOT to shard yet — and why premature sharding hurts

- **Sharding breaks the things Candle relies on most:**
  cross-shard joins (a duel joins two users, a bank item, and a
  rating), cross-shard transactions (duel settlement updates
  two users' Ratings in one transaction — doc 04 §5), and
  global unique constraints (`email` unique, `(userId, eventId)`
  unique in `RatingHistory`, `(duelId, userId)` unique in
  `DuelGameResult`). Each of these needs a workaround (§4.4),
  and each workaround is a new bug class.
- **Sharding does not fix bad queries.** A missing index on a
  sharded table is still a missing index, now on N shards.
  A `SELECT … OFFSET 1000000` on a sharded table is still slow,
  now N times.
- **Sharding is a one-way door in practice.** Re-sharding,
  un-sharding, and moving a table between shard schemes are all
  multi-week projects with downtime risk. Partitioning and
  replicas are reversible in a day.
- **The numbers do not justify it yet.** A single well-tuned
  Postgres primary handles ~5,000–10,000 writes/second and
  tables of 100M+ rows with partitioning. Candle at 1M users
  (§1) writes roughly 600–800 rows/second at peak (17M
  `DuelAnswer`/month ≈ 6.5/s average, ~65/s at 10× peak;
  all hot tables together ≈ 60/s average, ~600/s peak).
  That is two orders of magnitude below the sharding trigger
  (§3). The database is not the bottleneck; the bottleneck, if
  any, will be a missing index or an N+1 first.

---

## 3. Scaling ladder — triggers, not vibes

Each phase has a **numeric trigger**. When the trigger fires,
the phase starts. Until it fires, the phase does not start —
"we might need it" is not a trigger.

| Phase | What changes | Trigger (any one fires it) | What it buys |
|---|---|---|---|
| **A — now** | Indexes (§2.1), cursor pagination (§2.3), retention jobs (§2.4), N+1 gate (§2.5) | Already triggered — this is v1 | Headroom to ~10M rows per hot table |
| **B — partition + replicas** | Monthly RANGE partitions on hot tables (§3.1); 1–2 read replicas; PgBouncer; hot counters to Redis (§3.2); leaderboard denormalisation (§3.3); UUIDv7 for new hot tables (§2.6) | Any hot table > **10M rows** OR > **50 GB** OR p95 read latency > **300 ms** for 7 days OR primary CPU > **70%** sustained for 7 days OR write rate > **1,000 rows/s** sustained | Headroom to ~100M rows per hot table; reads scale horizontally; old months drop in seconds |
| **C — shard** | Application-level sharding by the keys in §4; Citus as the fallback (§4.5) | Single primary write rate > **5,000 rows/s** sustained OR any hot table > **100M rows** OR > **500 GB** OR vertical scaling exhausted (largest practical VPS) OR a single table's index no longer fits in RAM | Writes scale horizontally; no single primary is a bottleneck |

**Read replicas — the details:**
- Replicas serve: leaderboards (top-100 rebuilds), duel history,
  community feeds, admin analytics, calibration queries. They
  never serve: Rating updates, simulator trades, duel settlement,
  idempotency checks, or any read-after-write (a user who just
  finished a duel must see their new Rating from the primary —
  replication lag of even 1 second is a visible bug here).
- **Rule:** every repository method declares `readFromReplica:
  true | false`. Default is `false` (primary). A method may opt
  into the replica only if stale data is acceptable for that
  read. This is a code-level decision per query, not a config
  flag that flips all reads at once.
- Replica lag is a monitored metric (§7): alert if lag > 5 s,
  page if lag > 30 s, and automatically route reads back to the
  primary while lag is high (fail back to correct, not to fast).

### 3.1 Partitioning design (Phase B, ready to apply)

Partition by **month of `createdAt`** (`RANGE` on a `createdAt`
month key). Monthly, not daily (too many partitions to manage)
and not yearly (a year partition is too big to drop cheaply).

| Table | Partition key | Why monthly works |
|---|---|---|
| `DuelAnswer` | `createdAt` | Retention is 90 days (§2.4) — dropping 3 old months is one `DROP TABLE` each |
| `RatingHistory` | `createdAt` | 2-year hot window — 24 partitions, drop the oldest |
| `XpLedger` | `createdAt` | 90-day hot window |
| `SimOrder` | `createdAt` | 1-year hot window |
| `AuditLog` | `createdAt` | 1-year hot window |
| `OutboxEvent` | `createdAt` | 7-day window — weekly partitions are fine here |
| Future `ChatMessage` | `createdAt` | 1-year window, but see §4 — chat is sharded by `chatId` in Phase C, and partitioning is per-shard then |
| Future `LoginEvent` | `createdAt` | 90-day window |

**Prisma implication (decide now, pay later):** native
partitioned tables require the primary key to include the
partition key. `DuelAnswer` today has `id` as its PK; a
partitioned `DuelAnswer` needs PK `(id, createdAt)` (or
`(createdAt, id)`). Prisma supports composite ids, but every
repository query that looks a row up by `id` alone must then
also carry `createdAt` — which is why this is a Phase B code
change (§8), not a DBA-only change. The alternative — keep the
table unpartitioned and rely on BRIN indexes on `createdAt`
(BRIN is tiny and fast for time-ordered data) plus archival —
is acceptable if the team prefers to avoid the PK change; the
decision is recorded here so it is made deliberately, not
discovered mid-migration.

### 3.2 Hot counters to Redis (Phase B)

`UserStats` (totalXp, streaks) and `DuelBankItem.exposureCount`
/ `pilotAnswers` / `pilotCorrect` are counters updated on
every event. At high write rates, updating a counter row in
Postgres on every duel answer is a row-lock contention point
(two players, one item, one counter row).

**Rule:** counters live in Redis (`INCR` / `HINCRBY`) during
play, and are flushed to Postgres periodically (every 5 minutes,
and on duel settlement). Postgres remains the source of truth
for the *flushed* value; Redis is the source of truth for the
*last 5 minutes*. If Redis is lost, counters are rebuilt from
Postgres + a replay of recent events (§5) — the counters are
recomputed, never guessed.

### 3.3 Leaderboard denormalisation (Phase B)

Leaderboards already live in Redis sorted sets (doc 04 §7:
`global` and `country:<code>`, top 100 cached, full ranks on
demand). At 1M users a sorted set of 1M members is ~100 MB in
Redis — fine. What changes in Phase B:

- **Rank for a single user** is `ZREVRANK` — O(log N), cheap.
  Never compute a rank by scanning Postgres.
- **Percentile** needs the total count — cache the count per
  scope in Redis, updated on the same flush as the counter (§3.2).
- **Top-100 lists** are cached as a single JSON blob per scope
  with a 60-second TTL, rebuilt from the sorted set — the
  leaderboard endpoint must never hit Postgres on the hot path.
- **Country leaderboards:** country is locked at signup
  (doc 06, decided 2026-11-12), so a user's country set almost
  never changes — no cross-country migration problem. The one
  exception is the legacy `countryCodeChangedAt` path; a country
  change (if it ever exists) removes the user from the old
  country's set and adds them to the new one in the same
  transaction as the profile update.

---

## 4. Sharding design (Phase C — only when §3 triggers fire)

### 4.1 The first decision: there is no single global shard key

A single shard key (e.g. "shard everything by `userId`") fails
because Candle's data has **three different natural keys**:

- **User-owned data** shards by `userId`: `XpLedger`,
  `RatingHistory`, `UserLessonProgress`, `LessonCompletion`,
  `SimPortfolio` / `SimOrder` / `SimHolding` (via `userId`,
  through the portfolio), `QuizAttempt`, `AssessmentAttempt`,
  future `UserSettings`, `NotificationPreference`, `LoginEvent`,
  `Friendship`, `BlockedUser`.
- **Duel data** shards by `duelId`: `Duel`, `DuelAnswer`,
  `DuelGameResult`. A duel involves two users; sharding it by
  either player's `userId` puts the other player's rows on the
  wrong shard and breaks the settlement transaction (which
  updates both players' Ratings and both result rows atomically).
  Sharding by `duelId` keeps the whole duel — both players'
  answers, both result rows — on one shard, so settlement is a
  single-shard transaction.
- **Content data does not shard at all:** `DuelBankItem`,
  `Lesson`, `Question`, `Track`, `SimInstrument`, `Badge` are
  small, read-heavy, and needed by every shard. They are
  **replicated to every shard** (reference tables) or served
  from a shared read replica. Sharding the question bank by
  topic would be a mistake: a duel needs items from many topics
  at once.
- **Community data** shards by `communityId` (`CommunityPost`,
  `PostComment`, `PostVote`, `PollVote`): a post's comments and
  votes live with the post. **Skew warning:** the 6 seeded
  communities will not grow evenly — "Ask Mira" will be far
  hotter than "Insurance Basics". Hash-sharding by
  `communityId` does not fix skew if one community is 80% of
  traffic; the fix is read replicas + caching for hot
  communities (§3), not finer sharding.
- **Chat data** shards by `chatId` (`ChatMessage`, `ChatRead`):
  `chatId = "dm:{smallerUserId}:{largerUserId}"`, so both
  participants' messages for one chat live on one shard. A
  user's chat *list* (all their chats) is a scatter-gather
  query — or, better, a per-user chat-list summary kept on the
  user's shard (§4.4).

**Shard-key table (the decision, in one place):**

| Table / group | Shard key | Shard count driver |
|---|---|---|
| `User`, `UserStats`, `UserRating`, `UserKnowledgeProfile`, `UserPrivacySettings`, `UserSettings` | `userId` | 1 row per user |
| `XpLedger`, `RatingHistory`, `QuizAttempt`, `AttemptAnswer`, `AssessmentAttempt`, `AssessmentAnswer`, `UserLessonProgress`, `LessonCompletion`, `UserBadge`, `UserQuestionExposure` | `userId` | per-user event volume |
| `SimPortfolio`, `SimHolding`, `SimOrder` | `userId` (via portfolio) | per-user trade volume |
| `Duel`, `DuelAnswer`, `DuelGameResult` | `duelId` | per-duel volume |
| `DuelDailySet` | not sharded (1/day) | tiny |
| `DuelBankItem`, `DuelBankOption`, `DuelBankTemplate`, `Lesson*`, `Question*`, `Track`, `SimInstrument`, `Badge` | replicated (reference data) | content size |
| `ChatMessage`, `ChatRead` | `chatId` | per-chat volume |
| `Friendship`, `Follow`, `BlockedUser` | `userId` (requester side; friendship rows exist in both directions, doc 06 §4.7) | per-user social graph |
| `CommunityPost`, `PostComment`, `PostVote`, `PollVote`, `PostReport`, `SavedPost` | `communityId` (posts/comments/votes) / `userId` (saved posts) | per-community volume |
| `AuditLog`, `OutboxEvent`, `IdempotencyRecord` | not sharded by user — see §4.4 | operational |

### 4.2 Hash vs range sharding

**Decision: consistent hashing on the shard key, not range
sharding.**

- **Range sharding** (e.g. users A–M on shard 1, N–Z on shard 2)
  is simple to explain and terrible in practice: new users
  cluster at the end of the range, one shard gets hot, and
  rebalancing means moving a contiguous range (a big, live
  migration).
- **Hash sharding** (`shard = hash(shardKey) mod N`) spreads
  users evenly, including new users. The cost is that range
  queries ("all users created in March") become scatter-gather
  — but Candle has almost no such queries; nearly every query
  is keyed by `userId` or `duelId`.
- **Consistent hashing** (hash ring, virtual nodes) is the
  variant to use: when a shard is added, only ~1/N of keys move,
  not half the data. The router (§4.5) owns the ring; the
  application never computes `hash % N` inline.

**Number of shards:** start with **4 shards** (not 2 — 2 shards
buys too little headroom to justify the migration; not 16 —
16 shards means 16 connections pools, 16 backups, 16 things to
monitor, for a team that has never operated one shard).
Doubling (4 → 8 → 16) is the growth path.

### 4.3 Cross-shard queries — avoided first, handled second

The design rule is: **a request touches one shard if at all
possible.** The queries that threaten this, and the answer for
each:

| Cross-shard query | How it is avoided / handled |
|---|---|
| Duel settlement (2 users' Ratings + 2 result rows) | Avoided: duel data shards by `duelId`; the settlement transaction runs on the duel's shard, and the Rating updates are routed there too — the Rating rows for both players are *also* written on the duel shard in a `RatingShardMirror`… no. **Honest answer:** Ratings cannot live on both the user shard and the duel shard. Decision: **Rating updates stay on the user's shard**, and duel settlement becomes a **two-phase flow**: (1) settle the duel on the duel shard (answers, results, XP), (2) apply Rating updates per player on each player's shard, each guarded by the same idempotency key `duel:{duelId}`. If step 2 fails for one player, it is retried from the outbox (§6) — the duel is settled, the Rating catches up, and the user sees "Rating updating" rather than a wrong Rating. This is the one place where eventual consistency is accepted for Ratings, and only for the cross-shard case — single-shard Ratings stay transactional. |
| "My duel history" (last 5 per type, doc 06) | Avoided: `DuelGameResult` is **dual-written** — the full row on the duel shard, and a **slim summary row** (`duelId, userId, type, result, score, ratingDelta, createdAt`) on the player's user shard. History reads hit the user shard only. The summary is written via the outbox (§6), so it can lag by seconds, never be lost. |
| Leaderboards (global + per-country) | Avoided: leaderboards live in **Redis sorted sets**, not in Postgres (§3.3). A global leaderboard is a single sorted set; sharding Postgres does not shard the leaderboard. |
| Daily Duel pairing (two strangers, same day's set) | Avoided: the daily set is reference data (replicated), and pairing is by finish order — the pair is formed in Redis, and the settlement flow above handles the two shards. |
| Friend lookup ("is X my friend?") | Avoided: `Friendship` rows exist in both directions (doc 06 §4.7), so the check is one row on the requester's shard. |
| "My feed" (posts from communities I joined + users I follow) | Handled: feed is a **scatter-gather with a cap** — query the (few) community shards the user follows, take top 20 per shard, merge and sort in the API, cache the merged page for 60 s. The user follows a handful of communities, not hundreds, so the fan-out is bounded. |
| Admin / analytics ("all duels today") | Handled: analytics reads from a **separate analytics replica** fed by logical replication from all shards (or from the archived cold store, §2.4). Admin queries never run against a live shard. |
| Search across users (by name/email) | Handled: a dedicated search index (or a single `user_directory` reference table on the router, replicated) — never a scatter-gather over all shards for a login. **Login by email must never scatter-gather:** the router keeps a small `email → userId → shard` directory (replicated, cached in Redis). |

### 4.4 What breaks if you shard wrong

| Breaks | Why | The fix (decide before sharding) |
|---|---|---|
| Global `UNIQUE(email)` | Two shards can both accept the same email | Email uniqueness is enforced at the router directory (§4.3), with a unique constraint on the directory table itself |
| `UNIQUE(userId, eventId)` in `RatingHistory` | The constraint is per-shard, so a duplicate event on two shards is not caught | Idempotency is enforced by the idempotency key living on the *user's* shard, checked before the Rating write (§6) |
| `UNIQUE(duelId, userId)` in `DuelGameResult` | Same as above | Enforced on the duel shard (the full row lives there) |
| Foreign keys across shards | Postgres cannot enforce a FK to a row on another shard | FKs become **application-level checks** at write time (does this `userId` exist? does this `bankItemId` exist?) plus periodic reconciliation jobs that report orphans. Reference data (bank items) is replicated, so its FKs still work locally |
| `JOIN` across shards | No single query can join them | Denormalise at write time (store the display name on the result row, not just the user id) or batch-fetch by id from the right shard |
| `COUNT(*)` / `SUM()` across all users | Becomes a scatter-gather over N shards | Pre-computed counters (§3.2) — counts are never computed live at scale |
| Distributed transactions (2PC) | Slow, fragile, and a single shard outage blocks all writes | Do not use 2PC. Use the outbox + idempotent retry pattern (§6) instead — at-least-once delivery with exactly-once *effect* |
| `SERIAL` / sequences | Per-shard sequences collide | All ids are UUIDs already (Blueprint §12) — this is one decision that already pays off. Never introduce a sequence in a sharded table |

### 4.5 How sharding is implemented with Prisma (the honest part)

**Prisma does not natively shard.** There is no
`prisma.$shard()` and no declarative sharding in the schema.
Three approaches exist; the decision is:

**Chosen: application-level routing.**
- A `ShardRouter` in the repository layer maps a shard key →
  a `PrismaClient` (one client per shard, each with its own
  `DATABASE_URL`, e.g. `DATABASE_URL_SHARD_0…3`).
- Every repository method takes the shard key as an argument
  (it already takes `userId` / `duelId` — the router hashes
  that, it does not change the service interface).
- The router owns the consistent-hash ring (§4.2) and the
  `email → shard` directory.
- **Cost:** every repository gets a shard parameter; every test
  that touches the DB gets a fake router. This is real work —
  budget a full phase for it, not a weekend.
- **Benefit:** explicit, testable, no hidden distributed
  planner, and it works with the existing Prisma models
  unchanged (the schema is the same on every shard).

**Fallback: Citus (Postgres extension).**
- Citus distributes tables from a coordinator node and keeps
  SQL (including joins on the distribution column) working.
  Prisma talks to the coordinator as if it were one Postgres.
- **Cost:** Citus is an extension to install, operate, and
  upgrade; distributed tables have their own restrictions
  (unique constraints must include the distribution column;
  some queries are not supported and fall back to slow
  coordinator execution); the team must learn Citus behaviour
  to debug it.
- **When to prefer it:** if the team would rather operate one
  Citus cluster than write and maintain a router, and if the
  cross-shard joins in §4.3 prove too painful in the router
  design. Revisit this decision at the Phase C trigger — do
  not decide it now, when there is no data to decide with.

**Not chosen: manual sharding by table-splitting in the
application without a router** (e.g. "users A–M go to DB 1"
hard-coded in services). That is range sharding with the
reasons in §4.2, plus the routing logic scattered across
services where it cannot be tested or changed in one place.

### 4.6 Re-sharding plan (4 → 8 shards)

1. Add 4 new empty shards; update the ring so ~half the keys
   move (consistent hashing moves ~1/N per added shard — with
   virtual nodes, roughly half the keyspace rebalances over
   the whole operation, in small batches).
2. **Dual-write** moved keys to both old and new shard for a
   cutover window; backfill historical rows in batches of
   1,000 by key range, during low-traffic hours.
3. Verify row counts per key on both shards; switch reads to
   the new shard per key; switch writes; stop dual-write.
4. Drop the moved data from the old shard.
5. **Rollback:** the old shard still has the data until step 4,
   so a failed cutover is a config change back, not a restore.
   Never drop the source data in the same deploy as the
   cutover.
6. Estimated effort: 2–4 weeks for the first re-shard,
   including the dual-write code, the backfill job, and the
   verification. This is why the shard count starts at 4, not
   2 — re-sharding twice is worse than starting with enough
   shards.

---

## 5. Redis — what lives there vs Postgres

Redis is fast, volatile, and not a database. The rule is:
**Redis holds anything that can be rebuilt from Postgres, or
anything whose loss is survivable. Postgres holds everything
else.**

| Data | Lives in | Why | If Redis is lost |
|---|---|---|---|
| Matchmaking queues (`live:queue:LIVE`, `live:queue:BLITZ`) | Redis sorted sets | Ephemeral by nature; a queue is meaningless after a restart | Players re-join the queue. No Rating, no money, no history is lost |
| Live duel state (`live:duel:{id}`, `live:user-duel:{userId}`, `live:rematch:{id}`) | Redis (TTL 900 s) | Per-second updates; Postgres cannot do this cheaply | The duel is **voided**, no Rating changes (doc 09 §2.2 — a void is always safer than a wrong Rating) |
| Leaderboards (sorted sets, top-100 cache) | Redis | Sorted sets are the right data structure; Postgres `ORDER BY rating LIMIT 100` on 1M rows is not | Rebuilt from `UserRating` in Postgres (`rebuildLeaderboards`, already exists in `RatingsService`) |
| Rate limits | Redis | Counters with TTL | Limits reset (fail open, briefly) — acceptable, and safer than failing closed and locking all users out |
| Sessions / refresh-token metadata | Redis (cache) + Postgres (source of truth) | Fast lookup; Postgres `RefreshToken` is the authority | Rebuilt from Postgres; users stay logged in |
| Hot counters (§3.2) | Redis, flushed to Postgres every 5 min | Write-rate relief | Rebuilt from Postgres + replay of the last 5 minutes of events from the outbox |
| `rested:{userId}` exposure sets (§2.4) | Redis sets | Compact, per-user | Rebuilt from the exposure archive; worst case is one repeated question |
| Feed / profile caches | Redis, TTL 60 s | Read relief | Cache miss → read Postgres. Nothing is lost |
| `email → shard` directory (§4.3) | Redis (cache) + a Postgres directory table (source of truth) | Login must be fast | Rebuilt from the directory table |

**What never lives only in Redis:** Ratings, XP balances,
simulator cash/holdings, duel results, idempotency keys,
user profiles, chat messages, community posts. If it cannot
be rebuilt, it is not in Redis alone.

**Redis persistence:** enable AOF (append-only file) with
`everysec` fsync for the leaderboard/counter Redis, so a
restart loses at most 1 second of counter data. The live-duel
Redis can run without persistence (its data is voided on loss
anyway) — but run it as a **separate Redis instance** from the
leaderboard Redis, so a live-duel spike cannot evict
leaderboard data, and a leaderboard rebuild cannot slow a
live duel.

---

## 6. Consistency and correctness — where strong, where eventual

### 6.1 Strong consistency required (single Postgres transaction, no exceptions)

| Operation | Transaction boundary | Why it cannot be eventual |
|---|---|---|
| Rating update | `UserRating` row + `RatingHistory` row + idempotency key, one transaction (doc 04 §5) | A Rating that moves without its audit row is unexplainable; a Rating that moves twice is corruption |
| Simulator trade | `SimPortfolio.cash` + `SimHolding` + `SimOrder`, one transaction, portfolio row locked (`SELECT … FOR UPDATE`) | Cash and holdings must never disagree, even for a millisecond — a concurrent trade reading stale cash is a negative balance |
| Lesson completion | attempt + XP grant + streak + badge check, one transaction (Blueprint §12) | Partial completion (XP without the completion, or vice versa) is a support ticket |
| Duel settlement (single-shard case) | Ratings + both `DuelGameResult` rows + both XP grants, one transaction (docs 07/09 §7) | The result page, the Rating, and the XP must agree |
| XP grant | `XpLedger` row (unique `idempotencyKey`) + `UserStats` update, one transaction | Double XP is the easiest bug to create and the hardest to explain |
| Friend accept | both directions' `Friendship` rows, one transaction | One direction without the other is a half-friendship |

### 6.2 Eventual consistency is fine (and cheaper)

| Data | Why eventual is fine | Lag budget |
|---|---|---|
| Leaderboards / ranks / percentiles | A rank that is 5 seconds stale is invisible to a user | < 60 s |
| `UserStats` counters (totalXp, streaks) | Derived from the ledger; a 5-minute flush delay (§3.2) is invisible | < 5 min |
| Feed ranking / post scores | A vote that takes 10 seconds to move a post is invisible | < 60 s |
| `DuelBankItem` calibration (`correctRate`, `discrimination`) | Computed from pilot data in batches, never live | nightly |
| Community `memberCount` | A count that is off by one for a minute is invisible | < 5 min |
| Notification delivery | A push that arrives 30 seconds late is fine | < 5 min |
| Duel-history summary rows (§4.3 dual-write) | The full result is already stored; the summary is a read optimisation | < 60 s |
| Cross-shard Rating catch-up (§4.3) | Only in the sharded case; the duel is settled, the Rating follows | < 5 min, with "Rating updating" shown |

### 6.3 Outbox pattern (already in the schema — use it properly)

`OutboxEvent` exists (Blueprint §3) with `type`, `payload`,
`processedAt`, `attempts`. The rules that make it work:

- **Write the outbox row in the same transaction as the
  business change.** An event written in a separate transaction
  can be lost (business committed, event not written) or
  duplicated (event written, business rolled back). Same
  transaction or it does not count.
- **The relay is at-least-once.** It may deliver an event twice
  (crash after delivery, before marking processed). Every
  consumer must therefore be **idempotent**: keyed by the
  event id, with the same unique-key guards as §6.1.
  At-least-once delivery + idempotent consumers = exactly-once
  *effect*. This is the pattern that replaces distributed
  transactions in §4.4.
- **Poison events:** after 5 failed attempts, an event goes to
  a dead-letter state (a `failedAt` + `lastError` — add these
  columns in Phase B) and alerts (§7). It is never retried
  forever, and never silently dropped.
- **Retention:** processed events older than 7 days are deleted
  (§2.4). An outbox table that is never pruned becomes a hot
  table by accident.

### 6.4 How a duel settlement survives a crash (the worked example)

The settlement order is already decided in docs 07/09 §7 and is
repeated here because it is the correctness-critical path:

1. Ratings first, with idempotency key `duel:{duelId}`.
   If this step succeeds and the process crashes, a retry sees
   `RATING_EVENT_DUPLICATE` / `IDEMPOTENCY_REPLAY` and replays
   the stored outcome instead of applying it twice.
2. Then, in one duels transaction: duel rows + both
   `DuelGameResult` rows + both XP grants.
3. Then the outbox events: leaderboard update, history-summary
   dual-write (§4.3), notification.
4. **Crash between 1 and 2:** the Rating moved, the duel rows
   did not. Recovery is a re-settle: the duel is still
   `IN_PROGRESS`/`WAITING_OPPONENT`, the Rating call replays
   idempotently, and step 2 runs. The user sees the duel as
   "settling" until it completes — never as a win without a
   Rating, and never as a Rating without a win.
5. **Crash between 2 and 3:** the duel is settled, the
   leaderboard is stale. The outbox relay retries the events.
   Leaderboards catch up within a minute (§6.2).
6. **Redis lost mid-duel:** the duel is voided, no Rating
   changes (doc 09 §2.2). This is the only crash path that
   loses a duel — and it loses it cleanly, by design.

---

## 7. Backups, migrations at scale, and monitoring

### 7.1 Backups

- **Nightly full backup** (`pg_basebackup` or the host's
  managed backup) + **continuous WAL archiving** (PITR —
  point-in-time recovery). A nightly backup alone means up to
  24 hours of lost duels; WAL archiving means minutes.
- **Restore drill: quarterly, timed, documented.** A backup
  that has never been restored is a hope, not a backup. The
  drill restores to a staging database, runs the test suite
  against it, and records the restore time (the RTO — recovery
  time objective). Target RTO: under 1 hour; RPO (recovery
  point objective): under 5 minutes (WAL archiving).
- **Per-shard backups in Phase C:** each shard is backed up
  independently, on the same schedule. A restore of one shard
  must not require restoring all of them.
- **Cold archive (§2.4) is not a backup.** Archive files in
  object storage are versioned and checksummed, but they do
  not replace a database backup — they are for old rows, not
  for disaster recovery.

### 7.2 Migrations at scale (online, no downtime)

- **Expand → migrate → contract.** Never rename or drop a
  column in the same deploy that stops writing it. Step 1:
  add the new column/table (nullable or with a safe default).
  Step 2: deploy code that writes both old and new. Step 3:
  backfill the old rows in batches. Step 4: deploy code that
  reads the new. Step 5: drop the old — in a later release.
- **Backfill in batches:** `WHERE id > $lastId ORDER BY id
  LIMIT 1000`, with a pause between batches, during
  low-traffic hours. A single `UPDATE … WHERE …` over 100M
  rows locks the table and bloats it; a batched backfill does
  neither.
- **`ADD COLUMN … DEFAULT` is a trap in older Postgres:**
  adding a column with a non-null default rewrites the whole
  table (Postgres 11+ avoids the rewrite, but the backfill
  still costs I/O). Prefer: add nullable → backfill in
  batches → set `NOT NULL`.
- **Indexes: `CREATE INDEX CONCURRENTLY`, always** (§2.1).
  Never in the same migration as a table rewrite.
- **Partitioning (§3.1) is itself a migration:** create the
  partitioned table, dual-write, backfill, cut over, drop the
  old table — the same pattern as §4.6, at smaller scale.
  Budget a maintenance window for the cutover, even if the
  design says zero-downtime; the first time, assume something
  will need a human.
- **Prisma migrations stay the source of truth** (Blueprint
  §12). Partitioning and sharding DDL that Prisma cannot
  express goes in a reviewed SQL migration file in the same
  `migrations/` folder, with a comment saying why Prisma
  could not generate it — never a hand-run `psql` command
  that leaves no record.

### 7.3 Monitoring — metrics and alerts (the list, not a vibe)

| Metric | Alert threshold | Why |
|---|---|---|
| Table size per hot table (`pg_total_relation_size`) | > 50 GB (Phase B trigger) / > 500 GB (Phase C trigger) | The scaling ladder (§3) runs on this |
| Row count per hot table | > 10M (Phase B) / > 100M (Phase C) | Same |
| Index bloat (`pgstattuple` or `pg_bloat_check`) | index > 2× its expected size | Bloat is the silent killer of hot tables; fix with `REINDEX CONCURRENTLY` |
| Slow queries (`pg_stat_statements`, p95 per query) | any query p95 > 300 ms for 7 days | Phase B trigger; usually a missing index or an N+1 |
| Autovacuum lag (dead tuples, `n_dead_tup`) | dead tuples > 10% of live tuples on a hot table | Dead tuples slow every scan; tune autovacuum per table (hot tables need aggressive settings, not the defaults) |
| Connection pool usage (PgBouncer) | > 80% of pool for 10 minutes | Pool exhaustion is a full outage that looks like a database outage |
| Replication lag (replicas) | > 5 s warn, > 30 s page | §3 — reads route back to primary while lag is high |
| Redis memory usage | > 80% of maxmemory | Eviction of leaderboard/counter data; add memory or a separate instance (§5) |
| Redis key count by prefix (`live:*`, `leaderboard:*`) | sudden 10× change | A runaway queue or a leak (keys without TTL) |
| Outbox unprocessed age | oldest unprocessed event > 5 min warn, > 30 min page | §6.3 — events are the cross-service glue; a stuck relay is a silent failure |
| Duel settlement failures | any `RATING_EVENT_DUPLICATE` storm or settle retry rate > 1% | §6.4 — settlement is the correctness-critical path |
| Backup age / last successful restore drill | backup older than 25 hours; drill older than 120 days | §7.1 |
| Disk usage | > 70% warn, > 85% page | WAL archiving + growth (§1) fill disks faster than expected |
| Cache hit ratio (`pg_stat_database.blks_hit`) | < 99% on the primary | The working set no longer fits in RAM — the earliest sign that partitioning or a bigger instance is due |

**Dashboards:** one page per hot table (size, rows, p95 of its
top 3 queries, bloat, dead tuples), one page for Redis (memory,
keys by prefix, evictions), one page for the scaling ladder
(current value vs trigger for every trigger in §3). If the
trigger values are not on a dashboard, the triggers do not
exist.

---

## 8. Phased rollout plan

### Phase A — now (no sharding)

**Trigger:** already met — this is v1.
**Work:**
- Add the indexes in §2.1 (with `CREATE INDEX CONCURRENTLY`).
- Cursor pagination on hot tables (§2.3); keep offset pagination
  only on small tables.
- Retention/archive jobs in §2.4 (nightly/weekly/monthly/daily
  as listed), with verify-before-delete.
- N+1 review gate (§2.5).
- `pg_stat_statements` enabled; the §7 dashboard built.
**Code changes:** repository methods only (indexes, pagination
cursors, archive jobs). No schema redesign, no new infrastructure.
**Exit criteria:** every query in §1 is index-served (verified
with `EXPLAIN ANALYZE`, not assumed); retention jobs run and
are logged; no hot table grows without a retention rule.

### Phase B — partitioning + replicas

**Trigger:** any trigger in §3, row B (hot table > 10M rows or
> 50 GB, p95 > 300 ms for 7 days, CPU > 70% for 7 days, or
writes > 1,000 rows/s).
**Work:**
- Monthly RANGE partitions on the tables in §3.1 (PK change to
  include `createdAt` — §3.1, Prisma implication).
- 1–2 read replicas; repository methods declare
  `readFromReplica` (§3); replica-lag failback.
- PgBouncer in transaction mode; Prisma `connection_limit`
  lowered per instance (today there is no pooler config at all
  — the default Prisma pool per API instance, multiplied by N
  instances, is what exhausts Postgres first).
- Hot counters to Redis with 5-minute flush (§3.2).
- Leaderboard denormalisation (§3.3): top-100 cache, cached
  counts, `ZREVRANK` for single-user rank.
- UUIDv7 for new high-write tables (§2.6).
- Outbox dead-letter columns (`failedAt`, `lastError`).
**Code changes:** repository layer (partition-aware PKs,
replica flag, counter flush), config (pooler, replica URLs),
archive jobs (partition drops instead of deletes). Services
do not change — the repository is the seam (Blueprint §4).
**Exit criteria:** old months drop in seconds; p95 back under
200 ms; replica lag under 5 s; counters survive a Redis restart
(rebuild test).

### Phase C — sharding

**Trigger:** any trigger in §3, row C (writes > 5,000 rows/s,
hot table > 100M rows or > 500 GB, or vertical scaling
exhausted).
**Work:**
- Build the `ShardRouter` (§4.5): consistent-hash ring, 4
  shards, `email → shard` directory, one `PrismaClient` per
  shard.
- Apply the shard keys in §4.1, table by table, in this order:
  user-owned tables first (simplest, one key), duel tables
  second (the settlement flow in §4.3), community/chat third
  (skew-prone, needs the most care). Reference tables are
  replicated, not sharded.
- Dual-write + backfill + cutover per §4.6, one table group at
  a time, with rollback (old shard kept until verified).
- Cross-shard patterns from §4.3: dual-written duel-history
  summaries, outbox-driven Rating catch-up, Redis leaderboards,
  scatter-gather feed with a cap, analytics replica.
- Per-shard backups, per-shard monitoring (§7).
**Code changes:** every repository method gains a shard key
parameter; services pass the key they already have (`userId` /
`duelId`); tests gain a fake router. This is the biggest code
change in the document — budget a full phase, and do not start
it until the trigger fires.
**Exit criteria:** no request touches more than 2 shards except
the bounded feed fan-out; settlement correctness tests pass
with a shard killed mid-settlement (the outbox retry recovers
it); re-shard drill (4 → 8) rehearsed on staging.

---

## 9. What this doc does not decide (needs real traffic)

- **The exact row counts in §1** are estimates from the
  workload model in §0. Real traffic will differ — the
  monitoring in §7 exists to replace these with measurements.
  In particular, the duels-per-user-per-month (8) and the
  chat adoption rate (20%) are guesses; if active users play
  20 duels a month instead of 8, `DuelAnswer` hits Phase B
  in months, not years.
- **Whether Citus or application-level routing wins (§4.5).**
  Decided at the Phase C trigger, with real query patterns in
  hand — not now.
- **The partition key granularity (§3.1).** Monthly is the
  default; if a single month of `DuelAnswer` exceeds 50 GB,
  weekly partitions are the answer — that is a measurement,
  not a design choice.
- **Redis instance sizing.** Leaderboard memory at 1M users is
  estimated at ~100 MB; real usage depends on how many scopes
  (countries) exist and how much is cached. Measure, then size.
- **Whether `DuelGameResult.perQuestion` should be normalised**
  (store question ids + answers, re-join stems at read time)
  instead of archived (§2.4). Archival is chosen because the
  result page must never N+1 (§2.5) and the last-5 rule makes
  old detail nearly worthless; if storage turns out cheaper
  than the archive complexity, revisit.
- **The connection-pool numbers.** PgBouncer pool size and
  Prisma `connection_limit` depend on the number of API
  instances and the Postgres `max_connections` of the chosen
  host — set them from the host's numbers at deploy time, not
  from this doc.

---

## 10. Decisions (summary — the list to approve)

1. **No sharding now.** Phase A (indexes, cursor pagination,
   retention) is the work for v1.
2. **Shard keys (Phase C):** `userId` for user-owned data,
   `duelId` for duel data, `chatId` for chat, `communityId`
   for community data, reference data replicated, never sharded.
3. **Hash sharding (consistent hashing), 4 shards to start,**
   doubling to 8 then 16. Not range sharding.
4. **Application-level routing** is the chosen sharding
   approach; Citus is the named fallback, decided at the
   Phase C trigger.
5. **Partitioning (Phase B):** monthly RANGE partitions on
   `createdAt` for `DuelAnswer`, `RatingHistory`, `XpLedger`,
   `SimOrder`, `AuditLog`, `OutboxEvent`, future `ChatMessage`
   and `LoginEvent`.
6. **Retention:** 90 days hot for duel results/answers/XP,
   2 years for Rating history, 1 year for simulator orders and
   quiz attempts, 90 days for login events, 7 days for
   processed outbox events — archive first, verify, then delete.
7. **Duel history shows the last 5 per type** (doc 06) — the
   hot query is a single `LIMIT 5` lookup, and old detail is
   archived, not kept hot.
8. **Redis holds only rebuildable data** (queues, live duel
   state, leaderboards, counters, caches). Postgres holds
   everything that cannot be rebuilt. Redis loss voids a live
   duel and rebuilds everything else.
9. **Strong consistency** for Ratings, simulator balances, XP,
   and duel settlement (single transaction + idempotency key);
   **eventual consistency** for leaderboards, counters, feeds,
   and cross-shard Rating catch-up.
10. **Phase triggers are numeric** (§3): Phase B at 10M rows /
    50 GB / p95 > 300 ms / CPU > 70% / 1,000 writes/s;
    Phase C at 5,000 writes/s / 100M rows / 500 GB / vertical
    scaling exhausted.
