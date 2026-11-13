# Candle — Duels System Design

**Date:** 2026-11-11
**Status:** Step 1 DONE (Question Bank, 620 LIVE items), Step 2 BUILT
(Bot Duel P1 + Async Daily Duel L5 — docs/07-phase-4-duels-step-2.md,
ADR 0006), Step 3 BUILT (Live Speed Quiz Duel L1 —
docs/09-phase-5-live-speed-quiz-duel.md, ADR 0007), Step 4 BUILT
(Myth vs Fact Blitz L2 — docs/10-phase-6-myth-vs-fact-blitz.md,
ADR 0008), Step 5 BUILT (Case Duel L3 —
docs/12-phase-7-case-duel.md, ADR 0009), and Step 6 BUILT
(Chart Detective L4 — docs/13-phase-8-chart-detective.md,
ADR 0010), Step 7 BUILT (Paper Trading Sprint T1 —
docs/14-phase-9-paper-trading-sprint.md, ADR 0011), Step 8 BUILT
(Crisis Duel T2 — docs/15-phase-10-crisis-duel.md, ADR 0012), and
Step 9 PARTIALLY BUILT (Weekly Portfolio Battle T3 + Leagues —
docs/16-phase-11-weekly-portfolio-battle.md, ADR 0013; tournaments
deferred), and Step 10 BUILT (Friend Challenge — the last duel —
docs/17-phase-12-friend-challenge.md, ADR 0014). All 10 duel types
in the catalogue are built.
**Depends on:** Blueprint 01, Ratings design 04 (Ratings, not ELO),
Phase 1 Learning Engine + Quiz, Phase 2 Simulator.

**User decision recorded 2026-11-11:** Nishu likes all duel types.
Build every type, one by one, properly. No shortcuts, no half duels.

---

## 1. The duel catalogue (all of them)

All duels are 3–5 minutes, unless stated. All use fictional data only.
No real tickers, no real advice.

### Learning duels (change Learning Rating)

| #   | Duel               | Format                                                                                                                                                     | Rated?         |
| --- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| L1  | Speed Quiz Duel    | 7 questions, 15 sec each, same questions, live progress bar. Correct + fast scores more.                                                                   | Yes            |
| L2  | Myth vs Fact Blitz | 10 rapid true/false, 10 sec each. One wrong answer breaks the streak multiplier.                                                                           | Yes            |
| L3  | Case Duel          | Same real-life case (salary, goal, risky offer). Pick the best action + one-line reason. Scored on judgement, with a rubric, not just one textbook answer. | Yes            |
| L4  | Chart Detective    | Same fictional chart. Identify trend, risk, and safest next step.                                                                                          | Yes            |
| L5  | Daily Duel (async) | Same 5 questions that day. Play any time, result revealed when both finish.                                                                                | Yes, 1 per day |

### Trading duels (change Trading Rating)

| #   | Duel                    | Format                                                                                                      | Rated?             |
| --- | ----------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------ |
| T1  | Paper Trading Sprint    | 15 min, same fictional market, same starting cash. Winner is best risk-adjusted return, not highest return. | Yes (short season) |
| T2  | Crisis Duel             | Simulated crash mid-duel. Smallest loss + calmest decisions wins.                                           | Yes                |
| T3  | Weekly Portfolio Battle | 1 week, same market. The rated trading season from doc 04.                                                  | Yes                |

### Practice (never rated)

| #   | Duel             | Format                                                                                                      |
| --- | ---------------- | ----------------------------------------------------------------------------------------------------------- |
| P1  | Bot Duel vs Mira | Same formats as L1/L2, opponent is a bot with adaptive difficulty. For learning the format, no Rating risk. |

Friend Challenge (labelled P2 in earlier drafts) is NOT a practice
duel and is not in the table above: it is a start-mode for any rated
format (LIVE / BLITZ / CASE / CHART / SPRINT / CRISIS) — a direct
invite link, a chosen opponent, rematch button — and it is **rated
by default** (ADR 0014 §3, which supersedes the earlier "Rating
changes only if both opt into rated mode" line: the invite shows
both players' Ratings, so accepting with the stakes visible IS the
opt-in; there is no unrated toggle). **BUILT, Phase 12**
(docs/17-phase-12-friend-challenge.md, ADR 0014).

**Build order is section 7, not the table order.** The bank comes first.

---

## 2. Question bank — where questions come from, and how users never see repeats

This is the core problem Nishu named: a duel is only interesting if
the questions are different every time. A small bank kills retention
in two weeks.

### 2.1 Sources (in priority order)

1. **Original curriculum, written for Candle.** The Phase 1 Foundation
   track is the seed. Every lesson maps to a topic in the bank.
   No copied Varsity text, no scraping. Varsity is a topic reference
   only (see Blueprint §16 and the legal check).
2. **Admin CMS authoring (Phase 1 CMS, extended).** Content authors
   write items in the CMS, with a two-person review: author → fact
   checker → publisher. No item goes live with one person's approval.
3. **Template-generated variants (the scale engine).** See 2.4.
   One good template can make hundreds of different questions.
4. **AI-assisted drafting, human-owned.** An AI may draft a question
   from a topic + difficulty + template. A human must fact-check,
   edit, and publish it. AI output is never published directly,
   and AI output is never trained on copied Varsity text.
5. **Community submissions (much later, Phase 5+).** Users submit
   questions, moderators review, authors get XP. Not in v1 — it needs
   moderation, spam, and quality controls first.

### 2.2 Taxonomy — every item carries this metadata

```
topic:        stocks | mutual-funds | budgeting | tax-basics |
              risk | compounding | banking | insurance | ...
skill:        recall | calculation | judgement | chart-reading |
              scenario | risk-assessment
type:         mcq-4 | true-false | case-choice | chart-choice |
              numeric | ordering
difficulty:   1 (easy) to 5 (hard), calibrated, see 2.5
language:     en (v1), hi later
sourceLesson: lessonId or null
explanation:  required, 1–3 short sentences, in simple English
status:       draft | review | pilot | live | retired
version:      integer, never edit a live item in place — publish a new version
```

A duel never asks for "a random question". It asks for a **blueprint**:
e.g. Speed Quiz Duel = 7 items, 2 easy + 3 medium + 2 hard, at most
2 from the same topic, at least 3 different skills.

### 2.3 Size targets (so repeats do not happen)

A user playing 3 duels a day sees about 21 questions a day.
In 90 days that is about 1,900 questions. So:

- **v1 launch target: 2,000 live items**, balanced across topics
  and difficulties. Minimum 50 live items per (topic × difficulty) cell.
- **Mature target: 20,000+ live items**, mostly from templates (2.4).
- **Exposure control:** an item can be shown to the same user at most
  once in 30 days, and at most 3 times in total before it is rested.
  The selector enforces this; the UI never has to.
- **Duel set rule:** the two players in one duel always get the
  **same** set, in the same order, so the duel is fair. Different
  duels get different sets.

If a cell falls below its minimum, that duel type is disabled for
that topic/difficulty until authors refill it. A thin bank is a
product bug, not a user problem.

### 2.4 Template variants — how the bank scales without writing 20,000 questions by hand

Many finance questions are the same skill with different numbers.
Write the skill once as a template, generate the numbers.

Example — compounding template:

> "You invest ₹{principal} at {rate}% per year. After {years} years,
> about how much do you have, ignoring tax?"

Randomised: principal from {10000, 25000, 50000}, rate from {6, 8, 10, 12},
years from {3, 5, 10}. One template = 36 different questions, all with
a computed correct answer and computed distractors (e.g. simple-interest
answer, no-compounding answer).

Same idea for:

- Budget cases: randomised salary, rent, goal, and deadline.
- Chart Detective: a seeded random-walk chart with a known trend
  and volatility regime, generated from a seed both players share.
- Trading Sprint / Crisis: the Phase 2 deterministic price engine,
  with a duel seed, so both players see the **identical** market.

Templates are code-reviewed like any other code, and every generated
variant is still validated (answer is computable, distractors are
plausible, numbers are sane) before it can go live.

### 2.5 Difficulty calibration (IRT, in plain words)

Each item has a difficulty, not a guess. Calibration works in stages:

1. **Author estimate:** author sets difficulty 1–5 when writing.
2. **Pilot:** new items are shown only in unrated practice / bot duels.
   After at least 50 answers, the real difficulty is measured:
   what fraction of users at each Rating got it right.
3. **Calibrated:** difficulty is set from the pilot data, using
   Item Response Theory (IRT): an item's difficulty is the ability
   level at which about half of users answer correctly, and its
   discrimination is how well it separates stronger from weaker users.
   In adaptive testing, the next question is chosen to match the
   user's estimated ability, because that question gives the most
   information about them.
4. **Drift check:** every month, items whose correct-rate moved
   sharply (e.g. a rule changed, or the item leaked) are flagged
   for review or retirement.

This is why the bank is a system, not a spreadsheet: items are
measured, not just written.

### 2.6 Selection algorithm (server-side, at match time)

1. Matchmaking fixes the duel type and the average Rating of the
   two players.
2. The server builds a blueprint (topics, skills, difficulties)
   for that duel type.
3. It queries live items matching the blueprint, excluding:
   items either player has seen in the last 30 days, items in
   the same duel already, retired items, and items below the
   pilot threshold for rated duels.
4. It picks stratified-random: correct difficulty mix, topic cap,
   skill mix. If a cell is short, it falls back to the nearest
   difficulty, never to a repeat.
5. The full set (questions + options, **without answers**) is stored
   as the duel's set in Redis + Postgres. Answers stay on the server
   until the duel ends.
6. If selection fails (bank too thin), the duel is not started.
   The user gets "No duel available right now, try a practice duel",
   not a broken or repeated duel.

---

## 3. Live duels — architecture

### 3.1 The state machine (one per duel, server is the authority)

```
QUEUED → MATCHED → COUNTDOWN (3-2-1) → IN_PROGRESS
  → REVEAL (per question) → FINISHED → RATED (Rating update, once)
```

- The server owns the timer. The client timer is display only.
  If a client is slow, the server still moves on.
- Answers are sent as `{ duelId, questionId, answerId, clientTimeMs }`.
  The server checks: is this duel live, is this question current,
  is this the first answer for this question, is it in time.
  Late, duplicate, or out-of-order answers are rejected.
- Scoring is computed on the server after each question, then
  broadcast to both players. The client never computes its own score.
- Disconnect: 15-second grace. Reconnect resumes the same duel.
  After 15 seconds, the disconnected player forfeits that duel,
  and the other player wins by forfeit (Rating still updates, with
  a smaller K, so a dropped connection is not a free win).

### 3.2 Transport: WebSocket gateway (NestJS + Socket.IO)

- One `DuelsGateway` in a new `duels` module. HTTP REST stays for
  creating/joining async duels and for history; WebSocket is for
  live play only.
- Auth: JWT in the Socket.IO handshake, verified the same way as
  HTTP. No anonymous live duels.
- Rooms: one room per duel (`duel:{duelId}`). Events are small
  JSON: `duel:matched`, `duel:question`, `duel:answer-result`,
  `duel:score`, `duel:finished`. No question answers are ever
  emitted to a client before reveal.
- State lives in **Redis** (duel state, timers, scores), not in
  server memory. Postgres is the source of truth after the duel
  ends. If a server crashes mid-duel, another server can resume
  the duel from Redis. If Redis is lost, the duel is voided and
  no Rating changes — a void is always safer than a wrong Rating.

### 3.3 Matchmaking

- Queue: Redis sorted set per duel type, keyed by Rating.
  A player enters with `{ userId, rating, duelType, country, joinedAt }`.
- Matching window widens with wait time, so nobody waits forever:
  - 0–5 sec: opponent within ±50 Rating
  - 5–15 sec: within ±100
  - 15–30 sec: within ±200
  - 30+ sec: within ±400, or Bot Duel offer
- After 30 seconds with no human match, offer the Bot Duel
  (Mira, matched to the player's Rating) instead of making the
  user wait. A fast bot duel is better retention than a long queue.
- Friend Challenge bypasses the queue: direct invite, both must
  accept, Rating range is shown before accepting so a 1000 player
  is not tricked into a 1900 match.
- Anti-farming: same pair cannot play more than 3 rated duels
  per day; a rematch has a 5-minute cooldown; rated duels per
  user per day are capped (proposal: 10) so Rating cannot be
  farmed by volume.
- Async Daily Duel: no queue. The set is fixed for the day,
  both players play when they want, result is computed when
  both finish. This is the retention-safe duel for low-traffic
  hours.

### 3.4 Load balancing and scaling (the part that must be right from day one)

WebSocket connections are persistent and stateful. Normal HTTP
round-robin load balancing breaks them.

- **Sticky sessions are required.** A client must always hit the
  same server process for the life of its connection, or the
  WebSocket upgrade fails. This is a load-balancer setting
  (cookie-based affinity, not just IP hash, because many users
  share one IP behind NAT).
- **Redis adapter for fan-out.** With Socket.IO, the Redis adapter
  lets a message to a room reach players on different servers.
  The adapter is a pub/sub fan-out, not a database — duel state
  still lives in Redis keys + Postgres, as in 3.2.
- **Horizontal scaling:** add more API servers behind the load
  balancer; no code change. One server handles roughly 10,000–
  30,000 concurrent connections depending on message rate;
  scale out before that, and monitor connection count per node.
- **Separate concerns:** the WebSocket gateway, the HTTP API, and
  the matchmaking worker are separate processes in production,
  so a duel spike cannot slow down lesson loading, and vice versa.
- **Graceful drain:** when a server is removed, stop sending it
  new connections, tell its clients to reconnect, and let Redis
  state resume their duels. No dropped duels on deploy.
- **Backpressure:** if Redis or the DB is slow, matchmaking
  slows down (longer queue, bot offer sooner) instead of
  accepting duels it cannot finish. A slow duel is better than
  a broken duel.

### 3.5 Loading and performance targets

- Match found: p95 under 15 seconds at normal traffic, bot offer
  at 30 seconds.
- Question delivery: under 200 ms after the previous reveal.
- Answer result: under 300 ms.
- Duel set is generated **at match time**, not at question time,
  so there is no DB query in the middle of a duel. The only live
  writes are scores in Redis; Postgres writes happen once, at
  duel end, in one transaction (duel result + Rating update +
  XP + history).
- Frontend preloads the duel screen and the first question's
  layout while the countdown runs, so the first question feels
  instant.

---

## 4. Retention model (how duels keep users coming back, without dark patterns)

Retention is a loop, not a notification spam cannon.

**Daily loop (2–3 minutes):**
Daily Duel (async, 1 rated per day) → streak → XP → a small
reward chest. Miss a day, the streak resets, but the Rating does
not — losing a streak should sting a little, losing a Rating
for missing a day would be unfair.

**Weekly loop:**
Weekly League: users are grouped into a league of 30 by Rating.
Top 3 are promoted, bottom 3 demoted, every Monday. League
position is shown on the dashboard all week. Weekly Portfolio
Battle is the trading version of the same loop.

**Season loop (quarterly):**
Season Rating (doc 04 soft reset) + season title + badge.
A new season is a reason to return, and a reason for a lapsed
user to come back without being at the bottom forever.

**Social loop:**
Rematch button after every duel (one tap, no re-queue),
Friend Challenge link, and a "Beat my score" share for async
duels. No Rating is ever sold, no pay-to-win, no paid rematch
advantage. Paid Pro may give more practice duels or more
league entries, never a Rating boost.

**What we measure (targets for Phase 3 launch):**

- Duel completion rate: > 85% (started duels that finish).
- Match wait p95: < 15 sec.
- D1 retention after first duel: > 40%, D7: > 20%.
- Repeat rate: median user plays 3+ duels in their first week.
- Question repeat complaints: zero — enforced by exposure control,
  not by hoping the bank is big enough.

**What we will not do:** no infinite push notifications, no
"your friend is beating you" anxiety spam, no streak-freeze
sold as a trap. Retention that relies on fear is not a product
Nishu wants to build.

---

## 5. Anti-cheat and fairness

- Answers never leave the server before reveal.
- One account, one device session for a rated duel; a second
  login during a duel ends the duel as a forfeit.
- Answer-time analysis: impossibly fast correct answers on
  hard questions are flagged for review, not auto-banned.
- No copy-paste, no tab-switch detection as a punishment in v1
  (it is unreliable on mobile). The timer and the server-side
  set are the main defences.
- All duel results are stored with the full question set, both
  players' answers and timings, so any dispute can be replayed.

---

## 6. Data model (new tables, additive only)

```
duel_question_bank: id, topic, skill, type, difficulty (calibrated),
  language, sourceLessonId, status, version, exposureCount,
  correctRate, createdBy, reviewedBy, publishedAt

duel_question: id, bankId, version, stem, options (JSON),
  correctOptionId (server only), explanation, templateId, parameters

duel_template: id, skill, topic, templateText, parameterSchema,
  answerFormula, distractorRules, status

duel: id, type, mode (live | async | bot | friend), status,
  playerAId, playerBId, questionSetId, seed, startedAt, endedAt,
  winnerId, season

duel_answer: id, duelId, userId, questionId, answerId, correct,
  timeMs, points, createdAt

user_question_exposure: userId, bankId, lastSeenAt, seenCount
  (enforces the 30-day / 3-times rule)

matchmaking_queue: Redis sorted set, not a Postgres table
duel_state: Redis hash, not a Postgres table
```

Rating tables are in doc 04 (`user_ratings`, `rating_history`).

---

## 7. Build order — one by one

Each step is a complete, tested module. No step starts until the
previous step is reviewed.

1. **Question Bank + CMS + selection engine.** No duel UI yet.
   Bank schema, authoring, review workflow, pilot + calibration,
   template engine, selection algorithm, exposure tracking.
   Seed target: 500 live items to prove the pipeline, then grow
   to 2,000 before any rated duel launches.
   **Status: DONE — 620 LIVE items (qb-001–qb-620), 62 per topic
   (ADR 0005 §15), plus 50 CASE_CHOICE items (Phase 7 Stage 1) and 50
   CHART_CHOICE items (Phase 8 Stage 1). The 2,000-item target is still ahead; the rated
   Daily Duel launches on the 520-item bank as a recorded deviation
   (ADR 0006 §13).**
2. **Bot Duel (P1) + Async Daily Duel (L5).** Proves the bank,
   scoring, and Rating update with no live matchmaking risk.
   **Status: BUILT — docs/07-phase-4-duels-step-2.md, ADR 0006.**
3. **Speed Quiz Duel (L1, live).** The first live duel. WebSocket
   gateway, matchmaking, sticky sessions, Redis state.
   **Status: BUILT — docs/09-phase-5-live-speed-quiz-duel.md,
   ADR 0007 (2026-11-12).**
4. **Myth vs Fact Blitz (L2).** Same live engine, new question type.
   **Status: BUILT — docs/10-phase-6-myth-vs-fact-blitz.md,
   ADR 0008 (2026-11-12).** 10 rapid TRUE_FALSE questions, 10 sec
   each, streak scoring (+10/+20/+30, cap +30), separate BLITZ
   queue, Mira host. Bank depth is the known limit: only 59
   TRUE_FALSE items live (docs/10 §14).
5. **Case Duel (L3).** New rubric scoring, new CMS type.
   **Status: BUILT — docs/12-phase-7-case-duel.md,
   ADR 0009 (2026-11-12).** 5 CASE_CHOICE cases, 45 sec each,
   option points (100/50/0) + speed bonus ≤ 20, winner by points,
   reason window 10 s (`live:reason` + `live:reason-window`),
   separate CASE queue, Kabir host. Bank depth is the known
   limit: only 50 CASE_CHOICE items live (docs/12 §11).
6. **Chart Detective (L4).** Seeded chart generation, shared seed.
   **Status: BUILT — docs/13-phase-8-chart-detective.md,
   ADR 0010 (2026-11-12).** 5 CHART_CHOICE charts, 30 sec each,
   standard live scoring (100 + ≤ 50 speed bonus), winner by
   correct count, annotation on reveal, separate CHART queue,
   Kabir host. Bank depth is the known limit: only 50 CHART_CHOICE
   items live (docs/13 §11).
7. **Paper Trading Sprint (T1).** Duel market from the Phase 2
   price engine, risk-adjusted scoring.
   **Status: BUILT — docs/14-phase-9-paper-trading-sprint.md,
   ADR 0011 (2026-11-12).** 15-minute live sprint, same fictional
   market for both players (same 6 instruments, same minute-bucketed
   prices, virtual ₹100,000 each), BUY/SELL/HOLD, winner by
   risk-adjusted return (not highest return), own sprint queue on
   the Trading Rating, Mira bot after 30 s, Tara host. A sprint
   needs no question bank.
8. **Crisis Duel (T2).** Crash injection, drawdown scoring.
   **Status: BUILT — docs/15-phase-10-crisis-duel.md,
   ADR 0012 (2026-11-12).** 15-minute live crisis duel, a variant of
   the sprint engine (not a second engine): same fictional market for
   both players (same 6 instruments, same minute-bucketed prices,
   virtual ₹100,000 each), BUY/SELL/HOLD, plus a seeded crash at
   minute 7–10 (all 6 instruments fall ~12% over 3 minutes, then
   recover ~5%), winner by crisis risk-adjusted return (the sprint
   score with the loss branch dividing instead of multiplying, so a
   calm loss beats a panicked one), own crisis queue on the Trading
   Rating, Mira bot after 30 s (sells everything to cash on the first
   crash tick, stays in cash), Tara host. A crisis duel needs no
   question bank.
9. **Weekly Portfolio Battle (T3) + Leagues + Tournaments.**
   Season, league promotion/demotion, weekly tournament bracket.
   **Status: PARTIALLY BUILT — docs/16-phase-11-weekly-portfolio-battle.md,
   ADR 0013 (2026-11-13).** One-week seasons (Mon 00:00 IST–Sun
   23:59 IST), leagues of 30 seeded by Trading Rating, top 3
   promoted / bottom 3 demoted every Monday, Trading Rating vs the
   index, REST trading, manual ADMIN settlement. **Tournaments
   (single-elimination brackets) deferred** — a second competition
   format needing its own seeding/match/scheduling design.

If the bank in step 1 is thin, steps 3–9 wait. A duel with
repeated questions is worse than no duel.

---

## 8. Definition of Done (per duel type)

- [ ] Bank coverage for that type meets the minimum per cell
- [ ] Selection never repeats a question for a user in 30 days (tested)
- [ ] Live duel completes under the latency targets in 5
- [ ] Matchmaking finds a match or offers a bot in 30 sec (tested)
- [ ] Rating updates once, in one transaction, with idempotency (tested)
- [ ] Disconnect / reconnect / forfeit paths tested
- [ ] Anti-cheat checks in section 5 tested
- [ ] Module README + OpenAPI + ADR updated
- [ ] No core file edited without an ADR

---

## Approval

Approve this design and the next step is **Step 1 only**:
the Question Bank. No duel UI, no live gateway yet — just the
bank, the CMS workflow, and the selection engine, seeded and
tested, so every duel after it is built on real variety.
