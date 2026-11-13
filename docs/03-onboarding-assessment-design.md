# Candle — Onboarding Knowledge Assessment: System Design Spec

**Status:** SPEC ONLY — v1.0, 2026-11-02. No code, no migration.
**Rule:** Nothing is built from this document until Nishu approves it.
**Scope:** System design for the onboarding assessment feature. The visual/UI
design and Lottie animation work is being prototyped separately — this spec
covers the flow, data, scoring, and API contracts that the UI will be built
against. UX flow notes (§2) describe _what happens on each screen_, not how
it looks.

**Requirement (Nishu, 2026-11-02):** _"a complete on-boarding with some
questions so we can know the knowledge level of the user and can set the
algorithm accordingly"_ — with best-in-class UI/animation for the experience.

---

## 1. Goals and non-goals

**Goals:**

1. Measure a new user's prior finance knowledge across the Foundation
   track's topics, in ~3 minutes, with a delightful first-run experience.
2. Produce a **durable knowledge profile** (per-topic levels 1–5) that the
   future adaptive engine consumes as its initial prior.
3. Place the user at the right starting point in the track (skip what they
   already know) — real placement, not just a recommendation label.
4. Be robust against gaming, retries, and replays (idempotent, anti-farming).

**Non-goals:**

- Visual design, illustration, Lottie animation production (separate track).
- Full admin CMS CRUD for the assessment bank (seeded + versioned for v1;
  read-only admin view; full CMS is a follow-up).
- The adaptive engine itself — this spec only defines the profile contract
  it will consume (§5.4).
- Changing any Phase 1 core behavior except the one ADR-flagged waiver
  touchpoint (§8.3).

---

## 2. Onboarding UX flow

Screens, in order. Copy tone: Mira (Daily Coach) guides; plain English;
every screen carries the disclaimer footer (blueprint §16).

1. **Welcome** (first run after registration, before dashboard).
   "Let's find your starting line." Sets expectations: 12 questions,
   ~3 minutes, no grades, skipping is fine, this only decides where you
   start. CTA: _Start_ / quiet _Skip for now_.
2. **Assessment** — one question per screen, 12 total.
   - Questions are **topic-mixed and difficulty-shuffled** (not grouped by
     topic — prevents topic inference and keeps it feeling like a game).
   - Each screen: question, 4 options (SINGLE) or "select all that apply"
     (MULTI), plus a confidence row: **Know it / Unsure / Skip**.
     "Skip" is a first-class, shame-free choice.
   - Back-navigation allowed within the attempt; answers editable until
     submit. Animated progress ring (12 segments).
   - **Never shown:** correct answers, explanations, or per-question
     results — not during, not after. This is a diagnostic, not a quiz
     (anti-farming, §7).
3. **Computing** — brief transitional moment ("Building your profile…").
   Pure theater for perceived quality; the computation is instant.
4. **Results** — per-topic levels revealed one by one (staggered reveal),
   each with its level label (§4.3), then the overall level. No scores,
   no percentages — levels only. Copy frames levels as a starting line,
   never a judgment.
5. **Placement choice** — two cards: _Start where I placed_ (names the
   module) vs _Start from the beginning_. User picks; the choice is stored.
6. **Dashboard** — normal app entry from here on.

**Returning / edge behavior:**

- The flow triggers once, on first login after registration. "Skip for now"
  records the skip; a gentle nudge card appears on the dashboard until the
  assessment is completed or explicitly dismissed.
- Once placement is accepted, the flow never re-triggers. Retakes (if
  allowed, §7) happen from settings, not by re-entering onboarding.

---

## 3. Question bank design

### 3.1 Topics — mapped to the Foundation track

Topics mirror the four seeded Foundation modules 1:1 (see
`apps/api/prisma/seed.ts`), so placement maps directly onto module order:

| Topic key          | Foundation module      | Example coverage                                    |
| ------------------ | ---------------------- | --------------------------------------------------- |
| `money-basics`     | Money Basics           | functions of money, inflation, budgeting            |
| `banking-saving`   | Banking & Saving       | how banks work, saving vs investing, emergency fund |
| `markets`          | Markets, Demystified   | stocks, bonds/fixed income, risk & return           |
| `investor-mindset` | Think Like an Investor | compounding, beginner traps                         |

**Extensibility:** topic keys are strings registered per assessment version,
not a closed enum. A future track (e.g. Simulator prep) ships its own
`AssessmentVersion` with its own topic registry. Adding a topic never
requires a schema migration — only a new bank version (ADR §10.8).

### 3.2 Difficulty tiers

Every topic has exactly 3 questions, one per tier — 12 questions total:

- **Tier 1 — Recall:** "have you encountered this?" Basic definitions and
  facts. (Catches true beginners.)
- **Tier 2 — Applied:** short scenario; apply the concept once.
  (Separates the curious from the competent.)
- **Tier 3 — Judgment:** nuance or a classic trap. (Separates the competent
  from the confident.)

### 3.3 The 12-question blueprint

| #   | Topic            | Tier | Intent (illustrative)                         |
| --- | ---------------- | ---- | --------------------------------------------- |
| 1   | money-basics     | 1    | Functions of money (recall)                   |
| 2   | money-basics     | 2    | Inflation eroding idle cash (applied)         |
| 3   | money-basics     | 3    | Real vs nominal thinking (judgment)           |
| 4   | banking-saving   | 1    | What banks do with deposits (recall)          |
| 5   | banking-saving   | 2    | Saving vs investing horizon (applied)         |
| 6   | banking-saving   | 3    | Emergency-fund sizing trap (judgment)         |
| 7   | markets          | 1    | What a stock represents (recall)              |
| 8   | markets          | 2    | Bond price vs interest rates (applied)        |
| 9   | markets          | 3    | Risk-return tradeoff misconception (judgment) |
| 10  | investor-mindset | 1    | Compounding definition (recall)               |
| 11  | investor-mindset | 2    | Time-beats-timing scenario (applied)          |
| 12  | investor-mindset | 3    | "Guaranteed returns" red flag (judgment)      |

Two fully-worked examples (original content; the remaining 10 are written
to the same bar during the build phase — content work, not code):

> **Tier 1, SINGLE, topic `money-basics`:**
> "Inflation is 6% a year. What happens to ₹1,00,000 kept as cash for a
> year?" — options: _It stays worth the same_ / _It can buy about 6% less_
> ✓ / _It grows by 6%_ / _It becomes worthless_.
> Explanation (admin-only, never served): purchasing power falls as prices
> rise; cash doesn't keep up.

> **Tier 3, MULTI, topic `investor-mindset`:**
> "Which of these are red flags in an investment pitch? (Select all that
> apply)" — _Guaranteed high returns with no risk_ ✓ / _SEBI-registered
> advisor disclosing fees_ / _Pressure to invest today or miss out_ ✓ /
> _A written explanation of risks_.

All bank content is **original**, written for Candle. Fictional numbers
only. Every assessment screen carries the disclaimer: _"Educational
purpose only — this is not investment advice."_

### 3.4 Reuse the quiz module or a separate store? — DECISION: separate

**Decision:** the assessment bank lives in its own tables
(`AssessmentVersion`, `AssessmentQuestion`, `AssessmentOption`), managed by
a new `onboarding` module. It does **not** reuse the quiz module's
`Question`/`LessonVersion` tables.

**Reasoning:**

1. **Different lifecycle.** Quiz questions are summative: they test taught
   content and version with the lesson (`LessonVersion`). Assessment
   questions are diagnostic: they measure _prior_ knowledge and version
   with the assessment bank. Tying them to lesson versions would orphan
   them on every lesson republish and conflate "taught" with "known".
2. **Different side effects.** Quiz submit awards XP, marks progress, and
   gates completion. Assessment submit must do none of that per-question
   (anti-gaming, §7) — it computes a profile.
3. **Different serving contract.** Quiz serves questions bound to a lesson
   attempt; assessment serves topic-mixed, difficulty-shuffled questions
   with **no answers or explanations ever leaving the server**.
4. The only shared piece is the per-question correctness predicate
   (SINGLE = exact one correct; MULTI = exact set match) — a ~20-line pure
   function. The onboarding module implements its own `scoreAnswer`
   (confidence-weighted, §4.1), unit-tested independently. If a third
   consumer appears, extract to `common/utils` via ADR (flagged §10.9).

The bank is **seeded and versioned** like the Foundation track (idempotent
seed, published versions immutable). Admin gets a read endpoint for review
in v1; full CMS CRUD for the bank is an explicit follow-up, not v1 scope.

---

## 4. Scoring algorithm

Principled, simple, explainable. No ML in v1 — the profile is the clean
input a future adaptive model will train on.

### 4.1 Per-question scoring (with confidence)

Each answered question carries a self-reported confidence:

| Outcome                | Points                             |
| ---------------------- | ---------------------------------- |
| Correct + **Know it**  | 1.0                                |
| Correct + **Unsure**   | 0.5                                |
| Wrong (any confidence) | 0                                  |
| **Skipped**            | 0 (recorded distinctly from wrong) |

**Why confidence:** correct-by-guessing is the classic diagnostic noise.
Halving guessed-correct answers discounts luck without punishing honesty;
the prominent Skip option keeps "don't know" clean. Wrong answers score 0
regardless of confidence — overconfidence is not additionally punished in
v1 (keeps the model explainable; revisit with real data).

### 4.2 Per-topic level (1–5)

Each topic has 3 questions → max 3.0 points. Score `s` maps to level:

| Score `s`   | Level | Label        |
| ----------- | ----- | ------------ |
| `s = 0`     | 1     | Starting Out |
| `0 < s ≤ 1` | 2     | Foundations  |
| `1 < s ≤ 2` | 3     | Building     |
| `2 < s < 3` | 4     | Confident    |
| `s = 3`     | 5     | Market Ready |

**Overall level** = nearest integer of the mean of the four topic levels
(display only; placement uses per-topic levels).

### 4.3 Placement rule

Topics map to modules in track order. Let `L(t)` be the topic level:

- Find the **first topic (in track order) with `L(t) ≤ 3`** → recommend
  starting at that module. Kind: `START_HERE`.
- If **all four topics have `L(t) ≥ 4`** → the user already knows
  Foundations → kind `FAST_TRACK`: waive modules 1–3, start at module 4
  ("Think Like an Investor") as a refresher.
- Level-5-in-everything is not "done" — it's "ready for what's next";
  copy must never imply graduation.

The UI presents the recommendation; the **user chooses** (_Start where I
placed_ / _Start from the beginning_). The choice is stored (§5.3).

---

## 5. Data model

New tables only. `User` gains relations; no existing table is altered.
(Prisma sketch — the migration is written at build time, not here.)

```prisma
enum AssessmentAttemptStatus { IN_PROGRESS SUBMITTED ABANDONED }
enum AnswerConfidence { CONFIDENT GUESSING SKIPPED }
enum PlacementKind { START_HERE FAST_TRACK }
enum PlacementChoice { RECOMMENDED FROM_BEGINNING }

model AssessmentVersion {
  id          String        @id @default(uuid()) @db.Uuid
  version     Int
  trackId     String        @db.Uuid
  track       Track         @relation(fields: [trackId], references: [id], onDelete: Cascade)
  status      ContentStatus @default(DRAFT)
  publishedAt DateTime?
  createdAt   DateTime      @default(now())
  updatedAt   DateTime      @updatedAt

  questions AssessmentQuestion[]
  attempts  AssessmentAttempt[]

  @@unique([trackId, version])
  @@map("assessment_versions")
}

model AssessmentQuestion {
  id          String        @id @default(uuid()) @db.Uuid
  versionId   String        @db.Uuid
  version     AssessmentVersion @relation(fields: [versionId], references: [id], onDelete: Cascade)
  /// Topic key, e.g. "money-basics". Registry per version (§3.1).
  topicKey    String
  /// 1 = recall, 2 = applied, 3 = judgment.
  difficulty  Int
  text        String        @db.Text
  /// Admin-only. NEVER served to clients.
  explanation String        @db.Text
  kind        QuestionKind  @default(SINGLE)
  order       Int           @default(0)
  createdAt   DateTime      @default(now())

  options AssessmentOption[]

  @@index([versionId])
  @@map("assessment_questions")
}

model AssessmentOption {
  id         String  @id @default(uuid()) @db.Uuid
  questionId String  @db.Uuid
  question   AssessmentQuestion @relation(fields: [questionId], references: [id], onDelete: Cascade)
  text       String
  isCorrect  Boolean @default(false)
  order      Int     @default(0)

  @@index([questionId])
  @@map("assessment_options")
}

model AssessmentAttempt {
  id              String                  @id @default(uuid()) @db.Uuid
  userId          String                  @db.Uuid
  user            User                    @relation(fields: [userId], references: [id], onDelete: Cascade)
  versionId       String                  @db.Uuid
  version         AssessmentVersion       @relation(fields: [versionId], references: [id])
  /// Snapshot of question ids in presented (shuffled) order.
  questionIds     Json
  status          AssessmentAttemptStatus @default(IN_PROGRESS)
  startedAt       DateTime                @default(now())
  submittedAt     DateTime?
  /// Idempotency key for submit (same pattern as quiz, ADR 0002/7).
  idempotencyKey  String?                 @unique
  createdAt       DateTime                @default(now())
  updatedAt       DateTime                @updatedAt

  answers AssessmentAnswer[]
  result  AssessmentResult?

  @@index([userId])
  @@index([versionId])
  @@map("assessment_attempts")
}

model AssessmentAnswer {
  id                String           @id @default(uuid()) @db.Uuid
  attemptId         String           @db.Uuid
  attempt           AssessmentAttempt @relation(fields: [attemptId], references: [id], onDelete: Cascade)
  questionId        String           @db.Uuid
  question          AssessmentQuestion @relation(fields: [questionId], references: [id])
  selectedOptionIds Json
  confidence        AnswerConfidence
  isCorrect         Boolean
  /// 0, 0.5, or 1.0 per §4.1.
  pointsAwarded     Float            @default(0)

  @@index([attemptId])
  @@map("assessment_answers")
}

model AssessmentResult {
  id             String        @id @default(uuid()) @db.Uuid
  attemptId      String        @unique @db.Uuid
  attempt        AssessmentAttempt @relation(fields: [attemptId], references: [id], onDelete: Cascade)
  userId         String        @db.Uuid
  user           User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  /// { topicKey: { level, score, maxScore } } — see §5.4.
  topicLevels    Json
  overallLevel   Int
  placementKind  PlacementKind
  /// Module order recommended, per §4.3.
  recommendedStartModuleOrder Int
  placementChoice PlacementChoice?
  placedAt       DateTime?
  createdAt      DateTime      @default(now())

  @@index([userId])
  @@map("assessment_results")
}

/// Durable knowledge profile — THE contract the future adaptive engine
/// consumes. 1:1 with user; rewritten on each official attempt.
model UserKnowledgeProfile {
  userId      String   @id @db.Uuid
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  versionId   String   @db.Uuid
  version     AssessmentVersion @relation(fields: [versionId], references: [id])
  attemptId   String   @db.Uuid
  topicLevels Json
  overallLevel Int
  computedAt  DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@map("user_knowledge_profiles")
}

/// Granted starting position. One per user+track; single-use (§7).
model PlacementWaiver {
  userId                String   @db.Uuid
  user                  User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  trackId               String   @db.Uuid
  track                 Track    @relation(fields: [trackId], references: [id], onDelete: Cascade)
  /// Modules with order < this value are treated as unlocked.
  waivedUpToModuleOrder Int
  createdAt             DateTime @default(now())

  @@id([userId, trackId])
  @@map("placement_waivers")
}
```

`User` gains: `assessmentAttempts AssessmentAttempt[]`,
`assessmentResults AssessmentResult[]`,
`knowledgeProfile UserKnowledgeProfile?`,
`placementWaivers PlacementWaiver[]`.

### 5.4 The profile contract (adaptive-engine input)

`UserKnowledgeProfile.topicLevels` is versioned JSON — the stable shape
the future adaptive engine reads. Shape version is embedded so the engine
can evolve without breaking old profiles:

```json
{
  "shapeVersion": 1,
  "assessmentVersion": 3,
  "computedAt": "2026-11-02T12:00:00.000Z",
  "overallLevel": 3,
  "topics": {
    "money-basics": { "level": 4, "score": 2.5, "maxScore": 3.0 },
    "banking-saving": { "level": 2, "score": 1.0, "maxScore": 3.0 },
    "markets": { "level": 3, "score": 1.5, "maxScore": 3.0 },
    "investor-mindset": { "level": 2, "score": 0.5, "maxScore": 3.0 }
  },
  "placement": {
    "kind": "START_HERE",
    "recommendedStartModuleOrder": 1,
    "userChoice": "recommended"
  }
}
```

Guarantees: keys are the topic registry of the pinned assessment version;
`score` is in 0.5 steps; `maxScore` is always 3.0 in v1 (3 questions per
topic) — the engine must not assume question counts, only `score/maxScore`
ratios. `null` profile = "unknown → beginner defaults".

---

## 6. API sketch

New `onboarding` module, base `/api/v1/onboarding`. All endpoints
authenticated via the default `JwtAuthGuard` (blueprint §9); bank read is
`@Roles('ADMIN')`. Standard envelope, DTO validation, OpenAPI tags
(blueprint §§6–8).

| Method & path                           | Auth  | Description                                                                                                                                                                                         |
| --------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /assessment/start`                | user  | Idempotent start: returns existing `IN_PROGRESS` attempt (< 24 h old) or creates one. Serves 12 questions **without** correct flags or explanations.                                                |
| `POST /assessment/attempts/:id/submit`  | user  | **Requires `Idempotency-Key`.** Grades in one transaction → answers, result, profile upsert, outbox event. Replay with the same key returns the original result (blueprint §6, ADR 0002/7 pattern). |
| `POST /assessment/attempts/:id/abandon` | user  | Marks in-progress attempt abandoned (user exits mid-flow).                                                                                                                                          |
| `POST /placement/accept`                | user  | `{ choice: RECOMMENDED \| FROM_BEGINNING }`. Creates the `PlacementWaiver` (single-use per track) unless choice is `FROM_BEGINNING`.                                                                |
| `GET /profile`                          | user  | Current `UserKnowledgeProfile` (or `null`).                                                                                                                                                         |
| `GET /assessment/bank`                  | ADMIN | Bank versions + questions **with** answers/explanations (review only).                                                                                                                              |

**DTOs (sketch):**

- `SubmitAssessmentDto`: `answers: [{ questionId: UUID, selectedOptionIds: UUID[], confidence: CONFIDENT | GUESSING | SKIPPED }]` — 12 items, one per presented question; strict validation (`forbidNonWhitelisted`).
- `AcceptPlacementDto`: `{ choice: PlacementChoice }`.
- Responses: `AssessmentAttemptView` (attemptId, questions[]), `AssessmentResultView` (topicLevels, overallLevel, placement), `KnowledgeProfileView`.

**Rate limiting:** add `/api/v1/onboarding/assessment` to the strict
rate-limit prefixes (same bucket class as quiz submit — Redis-backed,
blueprint §9.4).

**New error codes** (extend the catalogue, blueprint §7):
`ASSESSMENT_NOT_FOUND (404)`, `ASSESSMENT_ALREADY_SUBMITTED (409)`,
`ASSESSMENT_RETAKE_TOO_SOON (429)`, `ASSESSMENT_ATTEMPTS_EXHAUSTED (403)`,
`PLACEMENT_ALREADY_ACCEPTED (409)`.

**Transaction boundaries** (blueprint §12): submit runs in ONE transaction —
grade answers → insert `AssessmentAnswer`s → insert `AssessmentResult` →
upsert `UserKnowledgeProfile` → write outbox event
`onboarding.assessment_submitted`. All-or-nothing. Placement accept is its
own transaction (waiver insert + result update).

---

## 7. Anti-gaming and retake policy

1. **No answers ever leave the server.** Questions are served stripped
   (no `isCorrect`, no `explanation`); results reveal levels only. There
   is nothing to farm.
2. **No per-question XP.** Correct answers grant zero XP — the assessment
   is diagnostic. One-time **50 XP "onboarding complete" bonus** on first
   accepted placement (via gamification's event subscription, idempotent
   key `onboarding:{userId}:{attemptId}`).
3. **Retakes:** max **3 submitted attempts** per assessment version;
   **7-day cooldown** between submissions (`ASSESSMENT_RETAKE_TOO_SOON`).
   The latest submitted attempt is the official one (profile recomputed).
4. **Waiver is single-use** per track: retaking after placement is accepted
   recomputes the profile but never issues a second waiver.
5. **Version pinning:** the attempt pins `versionId` at start; bank updates
   never affect in-flight attempts (same guarantee as quiz/lessonVersion).
6. Ownership checks on every read/write: a user can only touch their own
   attempts/profile (blueprint §11 — "User A cannot fetch User B's
   progress" is a test case).

---

## 8. Integration with the Learning Engine (no Phase 1 core edits, except one ADR)

### 8.1 What the onboarding module owns

Everything in §§5–6, plus a public service interface:
`OnboardingService.getWaivedUpToOrder(userId, trackId): Promise<number | null>`.

### 8.2 Event-driven side effects (blueprint §3, §5.5)

- `onboarding.assessment_submitted` → outbox → gamification grants the
  one-time 50 XP bonus (recovery-safe via the ledger's idempotency key).
- `onboarding.placement_accepted` → future analytics / adaptive engine.
- No direct calls into gamification or learning internals — events and the
  public interface only (blueprint §4).

### 8.3 The one core touch — prerequisite waiver (ADR required)

The learning module's prerequisite gate (`locked` in `getTrack`,
`prerequisiteNotCompleted` in `completeLesson`) must honor placement.
Per blueprint §2.4 / §5, this goes through an ADR. The proposed minimal
change: the gate additionally consults
`OnboardingService.getWaivedUpToOrder()` (public interface, blueprint §4)
and treats lessons in waived modules as unlocked. Guarded so it no-ops
when no waiver exists — existing behavior is byte-for-byte unchanged for
users without waivers. Waivers never revoke earned progress and never
award lesson XP: waived lessons show as "placed out", completable
optionally for full XP.

### 8.4 Module layout (plug-in pattern, blueprint §5)

```
apps/api/src/modules/onboarding/
  onboarding.module.ts
  onboarding.controller.ts      # thin — DTO in, service call, response out
  onboarding.service.ts         # flow: start/submit/accept, scoring orchestration
  scoring.service.ts            # pure scoring: §4 (heavily unit-tested)
  onboarding.repository.ts      # Prisma only
  dto/onboarding.dto.ts
  events.ts                     # event names + payload types
  onboarding.service.spec.ts / scoring.service.spec.ts
  README.md
```

Registered in `app.module.ts` (one line). No other feature file is edited
except the ADR-approved gate touch in §8.3.

---

## 9. Legal and content guardrails (blueprint §16)

- All 12 bank questions are **original Candle content** (same bar as the
  seed: no Varsity copying/scraping; fictional numbers only).
- Every assessment screen carries: _"Educational purpose only — this is
  not investment advice."_
- No personalised recommendations of any financial product; placement is
  about _where to start learning_, never what to buy.

---

## 10. ADR-worthy decisions (explicit)

| #   | Decision                                                      | Recommendation                                                                                              | Why it matters                                                                                                      |
| --- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 1   | Separate assessment question store vs reusing quiz `Question` | **Separate** (`AssessmentQuestion`)                                                                         | Different lifecycle (bank-versioned vs lesson-versioned), different side effects, different serving contract (§3.4) |
| 2   | XP for assessment answers                                     | **None per-question**; one-time 50 XP onboarding bonus                                                      | Diagnostic must not be farmable; bonus preserves game-feel                                                          |
| 3   | Answers/explanations visibility                               | **Never served** to clients                                                                                 | Anti answer-farming; core to retake integrity                                                                       |
| 4   | Confidence self-report in scoring                             | **Yes** — correct+unsure = half credit                                                                      | Discounts lucky guesses with a simple, explainable rule                                                             |
| 5   | Prerequisite waiver mechanism                                 | **Waiver via onboarding's public interface**, consulted by learning's gate                                  | Real placement without duplicating gate logic; minimal core touch                                                   |
| 6   | Core edit for the waiver                                      | **Allowed via ADR** — guarded, no-op without waiver                                                         | Only exception to "no core edits" in this feature                                                                   |
| 7   | Retake policy                                                 | 7-day cooldown, max 3 attempts, latest counts, waiver single-use                                            | Balances fairness with second chances                                                                               |
| 8   | Topic keys as strings vs enum                                 | **String keys** with per-version registry                                                                   | New topics without migrations; future tracks bring own registries                                                   |
| 9   | Grading predicate reuse                                       | **Onboarding implements its own** `scoreAnswer`; extract to `common/utils` only if a third consumer appears | Semantics differ (confidence weighting); avoids premature core abstraction                                          |
| 10  | Profile shape                                                 | **Versioned JSON** (`shapeVersion: 1`) 1:1 per user                                                         | Stable contract for the future adaptive engine                                                                      |

---

## 11. Definition of Done (per blueprint §18, adapted)

- [ ] `onboarding` module follows the template; the only core touch is the
      ADR-approved waiver lookup
- [ ] DTO validation on every endpoint; invalid input tested (incl. 11- or
      13-answer submits, bad UUIDs, duplicate submit)
- [ ] Standard envelope; new error codes in the catalogue
- [ ] Auth + ownership tests (incl. "user B cannot submit user A's attempt")
- [ ] Migration reviewed; submit transaction is all-or-nothing (rollback test)
- [ ] Idempotency: replayed submit with same key returns original result
- [ ] Anti-gaming tests: answers/explanations never in responses; retake
      cooldown enforced; waiver single-use
- [ ] Scoring unit tests: confidence matrix, level boundaries (§4.2),
      placement rule incl. FAST_TRACK
- [ ] 12 original bank questions seeded (versioned, idempotent seed)
- [ ] OpenAPI + module README + ADR(s) written
- [ ] Manual QA of the full flow against the UI prototype

---

## 12. Open questions for Nishu

1. **Mandatory or skippable?** Spec assumes first-run gate with an explicit
   "Skip for now" (nudge later). OK, or should it be required before the
   dashboard?
2. **50 XP welcome bonus** — right amount, or none at all?
3. **Retake strictness** — is 7-day cooldown / max 3 attempts the right
   feel, or more generous?
4. Should a **perfect/near-perfect** assessment unlock anything beyond
   FAST_TRACK (e.g. a "Fast Tracker" badge)? Currently: no.

---

_End of spec. Awaiting approval before any code or migration is written._
