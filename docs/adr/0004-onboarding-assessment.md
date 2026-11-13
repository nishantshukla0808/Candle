# ADR 0004 — Onboarding Knowledge Assessment

- **Status:** Accepted
- **Date:** 2026-11-02
- **Context:** docs/03-onboarding-assessment-design.md (spec APPROVED as-is by Nishu, 2026-11-02)

## 1. What was built

A new `onboarding` NestJS module implementing the approved spec: a 12-question
diagnostic assessment (4 topics × 3 difficulty tiers) served at login, grading
knowledge levels 1–5 per topic, and placing the user at the right module of the
Foundations track via a single-use `PlacementWaiver`.

- `src/modules/onboarding/` — controller (6 routes), service, repository
  (Prisma-only, tx-aware), pure `scoring.service`, DTOs, events, README.
- Prisma: 8 models (`AssessmentVersion/Question/Option/Attempt/Answer/Result`,
  `UserKnowledgeProfile`, `PlacementWaiver`), 4 enums, migration
  `0004_onboarding_assessment` (generated via `prisma migrate diff`,
  hand-reviewed).
- Web: `/onboarding` (welcome), `/onboarding/assessment` (one-question-per-screen),
  `/onboarding/result` (levels reveal + placement choice), dashboard nudge card,
  login redirects to `/onboarding`.

## 2. Deliberate deviation from the spec

**Bonus idempotency key is per-user, not per-attempt.** The spec (§6.3) sketches
`onboarding:{userId}:{attemptId}` as the XP idempotency key, but the spec's own
§7 allows up to 3 attempts while §6.3 requires the 50 XP bonus to be one-time.
A per-attempt key would re-grant the "one-time" bonus when a user retakes and
re-accepts. The implementation uses `onboarding:{userId}` so the stated
requirement (one-time bonus) holds under the stated retake policy.

## 3. The learning-gate touch (spec §8.3 — the one allowed core edit)

The prerequisite gate in `learning.service` consults onboarding's public
interface `getWaivedUpToOrder(userId, trackId): Promise<number | null>`:

- `getTrack`: modules with `order < waivedUpTo` render unlocked.
- `completeLesson`: the linear-progression check is skipped when the previous
  lesson's module order is below the waived threshold.
- Guarded to no-op without a waiver: when `getWaivedUpToOrder` returns null,
  both code paths are byte-for-byte the old behavior (verified by the
  pre-existing learning e2e tests, which run without any waiver).

New repository method on the learning side: `getLessonModuleOrder(lessonId)`.

Type-only touch in `gamification.service`: the new `OnboardingAssessmentSubmittedPayload`
widened the `DomainEventPayload` union, so the four outbox-recovery handlers now
narrow with `as` casts. No runtime behavior change.

## 4. Opportunistic auth on public routes (enabler for §8.3)

`GET /learning/tracks/:slug` is `@Public()`, and `JwtAuthGuard` previously
returned early on public routes without attaching `req.user` — so even a
signed-in caller got `user === undefined` and the waiver could never apply to
the track read. The guard now attaches the user when a _valid_ Bearer token is
presented on a public route; absent/invalid tokens are ignored and the route
stays public. No behavior change for anonymous callers; no new failure mode.

## 5. Anti-gaming posture (spec §5, §11)

- Questions are served without `isCorrect`, `explanation`, or `topicKey`;
  results reveal levels only, never scores or correct answers.
- No per-question XP; the 50 XP bonus flows through the gamification event
  pattern (`onboarding.placement_accepted` → idempotent grant + outbox relay
  recovery).
- Retake policy enforced server-side: 7-day cooldown, max 3 submitted attempts,
  latest attempt counts; waiver is single-use per track.
- Every assessment surface (API descriptions, web pages) carries the
  disclaimer "Educational purpose only — this is not investment advice."

## 6. Verification

- Unit: 94/94 (15 suites), incl. 24 new scoring tests (confidence matrix,
  level boundaries, placement incl. FAST_TRACK).
- E2E: 15 new onboarding tests (start/resume, submit grading, idempotent
  replay, payload rejection, cross-user forbidden, cooldown/exhaustion,
  single-use waiver, bonus-once, gate waived/unwaived, admin bank RBAC) —
  full suite green, no regressions.
- typecheck / lint / format / web build clean.

## 7. Consequences

- The assessment bank is versioned (`AssessmentVersion`); publishing a v2 is a
  seed change, and in-flight v1 attempts keep grading against v1.
- `UserKnowledgeProfile.topicLevels` JSON is the input contract for the future
  adaptive-learning phase — documented in the module README.
- The opportunistic-auth behavior is global to public routes; any future
  public route automatically gains personalized fields for token callers.
