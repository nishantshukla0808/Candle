# ADR 0002 — Phase 1 Gamified Learning Engine

**Date:** 2026-11-01
**Status:** Accepted
**Context:** Blueprint §17 — Phase 1 builds the Gamified Learning Engine end
to end: Auth + Users, Learning (Foundation track), Quiz Engine, Gamification
(XP/levels/streaks/badges), Progress Dashboard, Admin CMS. ADR 0001 decision 8
requires deleting the `sample` scaffolding module in Phase 1.

## Decisions

1. **Password hashing: Argon2id via `hash-wasm`.** Blueprint §11 requires
   Argon2. `hash-wasm` is a pure-WebAssembly implementation — no native
   build toolchain needed, identical algorithm parameters (m=64MB, t=3, p=1).
   Policy: minimum 12 characters + character-class complexity + a built-in
   common-password denylist (breach-aware, blueprint §11).

2. **XP is granted from domain events, applied in the completion
   transaction, idempotent by key.** `lesson.completed` and
   `quiz.submitted` events carry everything the reward computation needs.
   The completion service runs ONE transaction (validations, completion row,
   progress, XP ledger, streak, badges, outbox row — blueprint §17). The
   same handler (`GamificationService.handleLessonCompleted` /
   `handleQuizSubmitted`) is registered on the outbox relay as the recovery
   path. `XpLedger.idempotencyKey` is unique, so double application is
   impossible in either path.

3. **In-app emitter + Postgres outbox (blueprint §3).** `EventBus` (simple
   typed emitter) is the in-process port; `OutboxEvent` rows are written in
   the same transaction as the domain change; `OutboxRelayService` claims
   rows (`FOR UPDATE SKIP LOCKED`) on a poll interval and dispatches them.
   Controllers may `await outboxRelay.drain()` when the response must
   include post-event state. Handlers must be idempotent.

4. **Lesson versioning.** `Lesson` is the stable family (module, order);
   `LessonVersion` holds content (`version`, `status` DRAFT|PUBLISHED).
   Published versions are immutable — edits create a new DRAFT version
   copied from the latest published. Questions belong to a `LessonVersion`.
   Completions pin `lessonVersionId`. Quiz gating uses the current
   published version.

5. **Track/LearningModule versioning asymmetry (documented).** Tracks and
   modules carry a simple `status` DRAFT|PUBLISHED flag; only lessons and
   questions get full version rows. Rationale: ordering/structure changes
   rarely need historical pinning, while lesson content and quiz questions
   do (completions and attempts pin them).

6. **Quiz gating for completion.** Completing a lesson requires a passed
   quiz attempt on its current published version when the version has
   published questions. Missing prerequisite (previous lesson incomplete)
   and missing quiz pass are domain errors (`PREREQUISITE_NOT_COMPLETED`),
   never validation errors (blueprint §8).

7. **Idempotency.** `Idempotency-Key` header is REQUIRED on lesson
   completion and quiz submit. `IdempotencyRecord` (key+userId unique,
   24h TTL) stores the original response. Replays return 409
   `IDEMPOTENCY_REPLAY` with the original result in `data` — never
   double-apply (blueprint §6).

8. **Streaks in Asia/Kolkata, one service.** `StreakService` is the only
   place that computes calendar dates, via `Intl.DateTimeFormat` with
   `timeZone: 'Asia/Kolkata'`. Dates stored as `YYYY-MM-DD` strings.

9. **Repository transactions.** Repository methods accept an optional
   Prisma transaction client (`TxClient`); services orchestrate
   `$transaction` blocks. Repositories remain the only Prisma touchpoints
   (blueprint §4). This is additive — no Phase 0 core file is modified
   except `app.module.ts` (one-line registrations) and additive config.

10. **Admin bootstrap.** `ADMIN_SEED_EMAILS` (comma-separated) grants the
    ADMIN role at registration. No other promotion path exists in Phase 1.
    All admin mutations write an append-only `AuditLog` row
    (actor, action, entity, before/after, IP, timestamp).

11. **Sample module deleted.** ADR 0001/8. Its e2e coverage is replaced by
    Phase 1 feature e2e.

12. **E2E strategy without a live DB.** This VM has no Postgres/Docker.
    Feature e2e overrides repositories with in-memory fakes AT THE PORT
    BOUNDARY (same pattern as ADR 0001/9) — controllers, guards, pipes,
    interceptors, filters, and services run for real. `prisma migrate`
    cannot be executed here; migration SQL is authored via
    `prisma migrate diff` and reviewed by hand.

13. **Module cycles via forwardRef.** Learning ⇄ Gamification (completion
    rewards vs. dashboard progress) and Learning ⇄ Quiz (quiz-pass gate
    vs. published-version reads) are genuine domain cycles; Quiz →
    Gamification is one-directional. All cross-module calls go through
    the modules' PUBLIC service interfaces only (blueprint §4) —
    forwardRef is NestJS's standard mechanism for this.

14. **CORS `Idempotency-Key` allowlist.** Lesson completion and quiz
    submission require an `Idempotency-Key` header; without adding it to
    `allowedHeaders` in `main.ts`, the browser preflight would reject the
    web client. Cookie parsing (`cookie-parser`) and this CORS header are
    the only two core-pipeline changes in Phase 1.

15. **Auth/optional-DTO validation fix.** `RegisterDto.displayName` was
    missing `@IsOptional()`, so absent optional values failed
    `class-validator` under `forbidNonWhitelisted`. Every optional DTO
    property MUST carry `@IsOptional()` — added to the validation
    checklist.

16. **jest moduleNameMapper stub for `@nestjs/swagger`.** The package
    ships ESM-only, which breaks the CJS jest transform; the stub
    (`test/swagger-stub.js`) exports no-op decorators that MUST return
    `undefined` from property decorators, or TS `__decorate` treats the
    return value as a descriptor and corrupts class-validator metadata.

17. **Admin UI needs.** Two read endpoints added during web work:
    `GET /admin/tracks/:id` (content tree for the CMS) and
    `GET /admin/lessons/:id/questions` (questions on the draft version;
    uses get-or-create draft semantics like the draft editor).

## Consequences

- Every Phase 1 module copies the Feature Module Template and registers
  one line in `AppModule`.
- XP/streak/badge logic lives ONLY in the gamification module; learning
  and quiz call into it with the transaction client.
- The web app consumes the same envelopes; no separate BFF.
- **Core change (blueprint §2.4):** `cookie-parser` middleware added in
  `main.ts` — refresh tokens travel in httpOnly cookies, so the API must
  parse them. No other core pipeline file is modified for Phase 1.
