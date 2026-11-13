# Onboarding module

Knowledge assessment — docs/03-onboarding-assessment-design.md (ADR 0004).

A ~3-minute diagnostic shown once after registration: 12 questions across
the 4 Foundation topics (3 difficulty tiers each), self-reported confidence
per question, then per-topic knowledge levels (1–5) and a real placement —
the user starts where the assessment placed them, or from the beginning.

Diagnostic, not summative: questions are served WITHOUT correct flags or
explanations, results reveal levels only, and correct answers grant no XP.
Educational purpose only — this is not investment advice (blueprint §16).

## Endpoints (`/api/v1/onboarding`)

| Method | Path                               | Auth  | Notes                                                                                                                              |
| ------ | ---------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/assessment/start`                | user  | Idempotent start: resumes a fresh in-progress attempt when one exists. Enforces the retake policy (max 3 submits, 7-day cooldown). |
| POST   | `/assessment/attempts/:id/submit`  | user  | **Transactional submit** — requires `Idempotency-Key`. Exactly 12 answers, one per presented question.                             |
| POST   | `/assessment/attempts/:id/abandon` | user  | Marks an in-progress attempt abandoned (exiting mid-flow).                                                                         |
| POST   | `/placement/accept`                | user  | Accepts placement (`RECOMMENDED` / `FROM_BEGINNING`). Single-use per track. Grants the one-time 50 XP bonus.                       |
| GET    | `/profile`                         | user  | Current knowledge profile, or `null` when never assessed.                                                                          |
| GET    | `/assessment/bank`                 | ADMIN | Bank versions with answers and explanations (review only).                                                                         |

## Scoring (spec §4)

`scoring.service.ts` is pure and heavily unit-tested:

- Correctness: `SINGLE` = exactly the one correct option; `MULTI` = exact
  set match. Empty selection is never correct.
- Points: correct + `CONFIDENT` = 1.0; correct + `GUESSING` = 0.5;
  wrong (any confidence) = 0; `SKIPPED` = 0, recorded distinctly.
- Per-topic level from a 0–3 score: `0 → 1`, `(0,1] → 2`, `(1,2] → 3`,
  `(2,3) → 4`, `3 → 5`. Overall level = rounded mean of the four levels.
- Placement: first topic (track order) with level ≤ 3 → `START_HERE` at
  that module order; all topics ≥ 4 → `FAST_TRACK` (waive modules 0–2,
  start at module order 3).

## Anti-gaming (spec §7)

- Answers and explanations never leave the server — not in start, not in
  submit responses, not in results. Levels only.
- No per-question XP. One-time `XP.ONBOARDING_BONUS` (50 XP) on first
  accepted placement, idempotent by ledger key `onboarding:{userId}`.
- Retakes: max 3 submitted attempts per bank version, 7-day cooldown
  between submits, latest counts. The placement waiver is single-use per
  track — retakes recompute the profile but never re-issue a waiver.
- Attempts pin the bank version at start; bank updates never affect
  in-flight attempts.

## Transactions (spec §6)

- Submit runs in ONE transaction: grading → answers → result → knowledge
  profile upsert → outbox event `onboarding.assessment_submitted`. Replays
  return 409 `IDEMPOTENCY_REPLAY` with the original result.
- Placement accept runs in ONE transaction: result choice (+ optional
  waiver) → profile choice patch → 50 XP bonus → outbox event
  `onboarding.placement_accepted`.

## Learning-engine integration (ADR 0004/5)

The only core touch: the learning module's prerequisite gate consults
`OnboardingService.getWaivedUpToOrder(userId, trackId)` (public interface,
blueprint §4). Modules with `order < waivedUpToModuleOrder` unlock; the
check no-ops when the user holds no waiver, so existing behavior is
unchanged. Waived lessons show as "placed out" and remain completable for
full XP (the quiz gate still applies).

## Profile contract (spec §5.4)

`UserKnowledgeProfile.topicLevels` is versioned JSON (`shapeVersion: 1`):
per-topic `{ level, score, maxScore }`, overall level, and placement
`{ kind, recommendedStartModuleOrder, userChoice }`. This is the stable
input the future adaptive engine consumes. `null` profile = beginner
defaults.

## Layout (the Feature Module Template, blueprint §5)

- `onboarding.controller.ts` — thin
- `onboarding.service.ts` — flow: start/submit/abandon/accept/profile
- `scoring.service.ts` — pure grading (no NestJS, no DB)
- `onboarding.repository.ts` — the ONLY file touching Prisma here
- `dto/onboarding.dto.ts` — boundary validation
- `events.ts` — domain event names + payload types
- `*.spec.ts` — unit tests
