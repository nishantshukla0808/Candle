# Candle — Production System Design Blueprint

**Status:** DESIGN ONLY — v1.0, 2026-10-27
**Rule:** No code is written from this document until it is approved.
**Clean slate:** There is no Candle codebase yet. The only prior artefact is
the original idea document (`candle_finance_platform_plan.docx`). Nothing
from that POC is carried over as code.

This blueprint **supersedes** the POC assumptions in these ways:
- No Clash of Clans theme or characters.
- No BaaS (no Supabase / Firebase). Candle owns its APIs.
- No copied Zerodha Varsity content. Original curriculum only, unless
  Zerodha gives written permission (see Legal Guardrails).
- No character animation work yet. Animation is deferred until after
  the system is designed and Feature 1 is complete.

---

## 1. Product in one paragraph

Candle is a professional, gamified financial-learning platform for youth
and beginners. Short learning sessions, quizzes, streaks, a risk-free
trading simulator, ELO-style skill ratings, community, and (later)
mentorship. The world is **The Exchange**, a professional finance
district, not a fantasy kingdom. Progression is a career ladder:
Intern → Analyst → Strategist → Risk Manager → Portfolio Manager →
Market Expert.

Mentor cast (original, to be visually designed later):
Mira (Daily Coach), Kabir (Analyst), Tara (Risk Guardian),
Dev (Patient Builder), Anaya (Portfolio Architect), Rey (Frontier Explorer).

## 2. Design principles (non-negotiable)

1. **Clean files, one job per file.** No god files, no god services,
   no business logic in controllers, no SQL in controllers, no
   validation scattered through services.
2. **Boundary first.** Everything untrusted (HTTP body, query, params,
   files, headers, webhooks) is validated at the boundary and never
   re-trusted inside.
3. **Standard shapes everywhere.** One response envelope, one error
   catalogue, one pagination shape, one logging shape.
4. **Core never edits for a feature.** A new feature is a new module
   that plugs into core. Core changes only through a documented
   Architecture Decision Record (ADR).
5. **Fail safe and fail loud in dev, fail safe and fail quiet in prod.**
   No stack traces, secrets, or internal details leak to clients.
6. **Every feature is done only when it is documented, tested,
   migrated, and observable** (see Definition of Done, section 12).

## 3. Technology decisions

| Layer | Choice | Why |
|---|---|---|
| Web frontend | Next.js + TypeScript + Tailwind CSS | SSR/SEO for lessons, strong typing, same language as backend |
| API backend | NestJS + TypeScript | Built-in modules, dependency injection, pipes (validation), guards (auth/RBAC), interceptors (response/logging), exception filters (errors). This is the natural home for the middleware/response/validation standards below |
| Database | PostgreSQL + Prisma | ACID transactions (essential for XP, streaks, simulator ledger), typed queries, migrations only |
| Cache / queues | Redis | Sessions/rate limits, cache, job queue, leaderboard sorted sets |
| File storage | Storage abstraction over S3-compatible storage (local disk only in dev) | Prod storage can change without touching business code |
| Jobs / events | In-app event emitter + Postgres outbox in v1, dedicated broker later | Reliable events without premature infrastructure |
| Infra | Docker + Docker Compose (dev), Docker images + CI/CD (prod) | Same environment everywhere, reproducible builds |
| Docs | OpenAPI (auto-generated from NestJS), Markdown ADRs, README per module | Documentation is generated or co-located, not an afterthought |

No BaaS is used for auth, database, or storage. Auth, storage, and
queues are all owned by Candle's own services.

## 4. Repository structure (the extensibility contract)

```
candle/
  apps/
    api/                 # NestJS backend, the only API
    web/                 # Next.js frontend
  packages/
    shared/              # Shared types, error codes, constants ONLY
                         # (no business logic, no secrets)
  docs/
    01-system-design-blueprint.md   # this file
    adr/                 # one file per major decision
    api/                 # generated OpenAPI, kept in sync by CI
```

Backend structure — every feature follows the same template:

```
apps/api/src/
  main.ts                # bootstrap ONLY: config, global pipes/filters
  app.module.ts          # module registry ONLY (see section 5)
  config/                # validated env config, one file per concern
  common/
    decorators/          # @CurrentUser, @Roles, @Public, etc.
    dto/                 # PaginationDto, IdParamDto (shared inputs)
    errors/              # AppError, ErrorCode catalogue
    filters/             # GlobalExceptionFilter (one place)
    guards/              # JwtAuthGuard, RolesGuard, PermissionsGuard
    interceptors/        # ResponseInterceptor, LoggingInterceptor
    middleware/          # RequestId, Helmet, CORS, RateLimit wiring
    pipes/               # ValidationPipe config (one place)
    responses/           # ApiResponse<T>, PaginatedResponse<T>
    services/            # Logger, Storage, Mail, Queue (infrastructure only)
    utils/               # pure helpers, no I/O
  modules/
    auth/                # Feature Module Template (see section 5)
    users/
    learning/            # Feature 1
    gamification/        # Feature 1 (XP, streaks, levels)
    # Future modules plug in here, untouched core:
    # simulator/, rating/, community/, mentorship/, analytics/
  database/
    prisma/schema.prisma # one schema, split by model comments, never hand-edited SQL
    migrations/          # Prisma migrations ONLY, never manual DB edits
```

Rules:
- A controller is thin: parse input (already validated), call one
  service method, return a response object. No `if` chains of business rules.
- A service holds business logic and calls repositories only.
- A repository holds Prisma access only. No other file touches Prisma.
- A module never imports another module's internals. It uses that
  module's public service interface or a domain event.

## 5. Adding a future feature (the plug-in pattern)

To add a feature, e.g. Simulator, a developer does exactly this and
nothing else:

1. Copy the Feature Module Template:
   `module / controller / service / repository / dto / mapper / events / *.spec.ts / README.md`
2. Register the module in `app.module.ts` (one line).
3. Add Prisma models + one migration.
4. Add its DTOs, error codes, and OpenAPI tags.
5. Emit domain events (`user.xp_earned`, `lesson.completed`) instead
   of calling other features directly, where cross-feature effects exist.
6. Add tests and docs for that module only.

No existing feature file is edited to "make room" for a new one.
If a change truly needs core, it goes through an ADR first.

## 6. API design

- Base path: `/api/v1` — versioned from day one. Breaking changes
  create `/api/v2`, never silently change v1.
- Resource naming: plural nouns, kebab-case paths, e.g.
  `GET /api/v1/learning/tracks`, `POST /api/v1/learning/lessons/:id/complete`.
- No verbs in paths except explicit actions (`/complete`, `/attempt`).
- Pagination: `?page=1&limit=20&sort=createdAt:desc`, capped at 100.
  Response always carries `meta: { page, limit, total, totalPages }`.
- Filtering/sorting: allow-listed fields only. Unknown fields are
  rejected by validation, never passed to the database.
- Idempotency: `Idempotency-Key` header required for POSTs that
  create money-like or XP-like effects (complete lesson, submit quiz,
  place simulated order). Replays return the original result, never
  double-apply.
- Time: all timestamps UTC in storage and API; frontend converts to
  the user's timezone (Asia/Kolkata by default for Indian users).
  Streaks are calculated in the user's timezone, in one dedicated
  service, never in scattered date code.

## 7. Response classes (one envelope, always)

Success:

```json
{
  "success": true,
  "data": { "...": "..." },
  "meta": { "page": 1, "limit": 20, "total": 120 },
  "requestId": "req_01...",
  "timestamp": "2026-10-27T16:30:00.000Z"
}
```

Error:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Human-readable message, safe to show",
    "details": [{ "field": "email", "issue": "Must be a valid email" }]
  },
  "requestId": "req_01...",
  "timestamp": "2026-10-27T16:30:00.000Z"
}
```

Implementation:
- `ApiResponse<T>` and `PaginatedResponse<T>` in `common/responses/`.
- `ResponseInterceptor` wraps every success. Controllers never build
  envelopes by hand.
- `GlobalExceptionFilter` maps every error to the envelope and to
  the error catalogue. Unknown errors become `INTERNAL_ERROR` (HTTP 500)
  with no details in prod.
- Error catalogue (examples, full list lives in code):
  `VALIDATION_FAILED (400)`, `UNAUTHORIZED (401)`, `FORBIDDEN (403)`,
  `NOT_FOUND (404)`, `CONFLICT (409)`, `RATE_LIMITED (429)`,
  `FILE_TOO_LARGE (413)`, `UNSUPPORTED_FILE_TYPE (415)`,
  `IDEMPOTENCY_REPLAY (409, returns original)`, `INTERNAL_ERROR (500)`.

## 8. Input validation (boundary, strict, typed)

Stack: NestJS `ValidationPipe` + `class-validator` / `class-transformer`
DTOs, configured once globally:

- `whitelist: true` — unknown properties are stripped.
- `forbidNonWhitelisted: true` — unknown properties are rejected in
  strict endpoints (auth, payments-like, admin).
- `transform: true` — query strings become typed numbers/booleans.
- Every DTO declares: type, required/optional, min/max length,
  format (email, UUID, enum), and custom validators where needed.
- Path params and query params have their own DTOs. No raw
  `req.query` or `req.params` access in services.
- Validation failures return `VALIDATION_FAILED` with per-field details.
- Business rules (e.g. "lesson already completed", "prerequisite not
  met") are NOT validation errors — they are domain errors with their
  own codes, thrown by services, mapped by the filter.
- Frontend mirrors the same rules with shared DTO types, but the
  backend is the authority. Frontend validation is UX only, never security.

## 9. Middleware / pipeline (exact order)

NestJS global pipeline, in order, for every request:

1. **RequestIdMiddleware** — generates/propagates `X-Request-Id`,
   attached to logs and responses.
2. **Helmet** — secure HTTP headers.
3. **CORS** — allow-listed origins only, credentials only for the
   Candle web origin. No wildcard with credentials.
4. **RateLimit** — global + stricter per-route limits (auth, quiz
   submit, uploads). Redis-backed, keyed by IP + user.
5. **LoggingInterceptor** — structured JSON log per request
   (method, path, status, duration, requestId, userId). No bodies
   with passwords, tokens, or PII in logs.
6. **JwtAuthGuard** — verifies access token, attaches user.
   Public routes marked `@Public()` explicitly; everything else is
   authenticated by default.
7. **RolesGuard / PermissionsGuard** — `@Roles('ADMIN')`,
   `@Permissions('content:publish')`. No role checks inside services
   as the only check; guards are the gate, services re-check ownership.
8. **ValidationPipe** — DTO validation (section 8).
9. **TimeoutInterceptor** — sane per-route timeouts.
10. **ResponseInterceptor** — wraps success envelope (section 7).
11. **GlobalExceptionFilter** — catches everything, maps to envelope.

Other middleware, applied where relevant only:
- **AuditMiddleware** for admin/content actions: who, what, before/after
  summary, IP, timestamp — stored in an append-only audit table.
- **FileUploadInterceptor** (section 10) on upload routes only.
- **CacheInterceptor** on safe GET routes only, never on personalised
  progress data without a user-scoped key.

## 10. File handling (strict, abstracted, private by default)

- `StorageService` interface, two implementations: local (dev only)
  and S3-compatible (prod). Business code never touches disk or S3 directly.
- Validation, in order, before any storage:
  1. Size limit per file type (e.g. avatar 2 MB, lesson media 10 MB).
  2. MIME type sniffed from file bytes, not from extension or client header.
  3. Extension allow-list matched to sniffed MIME.
  4. Filename discarded; stored name is `uuid + safe extension`.
  5. No user-controlled paths, no `../`, no absolute paths.
  6. Virus/malware scan hook in prod (pluggable scanner; upload is
     quarantined until cleared for user-visible content).
- Access: files are private by default. Access is via short-lived
  signed URLs issued only after an ownership/permission check.
  No public bucket, no predictable URLs.
- Processing: images resized/converted in a job, never synchronously
  in the upload request. Originals retained only if needed.
- Cleanup: orphaned uploads (uploaded but never attached) are
  deleted by a scheduled job. Deletes are soft in DB + hard in
  storage only after a grace period.
- Lesson media, avatars, and mentor assets each have their own
  bucket prefix and size/type policy. Policies live in config, not
  in controller code.

## 11. Security (production checklist, enforced by code + CI)

- Passwords: Argon2id hashing, never MD5/SHA/plain. Minimum length
  and breach-aware policy, no maximum that truncates silently.
- Tokens: short-lived access JWT (15 min), rotating refresh tokens
  in httpOnly, Secure, SameSite cookies. Refresh reuse = revoke the
  whole token family and force re-login.
- Secrets: environment variables validated at boot (config schema
  fails fast if missing/invalid). No secrets in code, git, logs, or
  frontend bundles. `.env.example` lists names only, never values.
- Injection: Prisma parameterised queries only. No raw SQL with
  string interpolation. No `eval`, no dynamic code from user input.
- XSS/CSRF: React escapes by default; API never returns unsanitised
  HTML from user content. Cookie-based refresh tokens use SameSite
  + CSRF token for state-changing cookie routes.
- Auth hardening: login rate limiting + progressive delay, generic
  "invalid credentials" message (no user-enumeration), account
  lockout/alert on repeated failures, email verification and
  password-reset tokens that are single-use, hashed, and expiring.
- Authorisation: every read/write checks ownership or role.
  "User A cannot fetch User B's progress by changing an ID" is a
  test case, not an assumption.
- Headers/transport: HTTPS only in prod (HSTS), Helmet, secure cookies.
- Data protection: minimise PII, encrypt sensitive fields at rest
  where needed, DPDP (India) aligned privacy notice, consent, data
  export/delete flows designed in, not bolted on.
- Dependencies: lockfile committed, automated vulnerability scanning
  in CI, no unpinned installs in Docker images.
- Backups: nightly DB backups + tested restore procedure, documented
  in the runbook before launch.

## 12. Database and transactions

- Prisma schema is the single source of truth. Migrations are
  generated, reviewed, and applied in order. Never edit the database
  by hand in any environment.
- Every model has: `id (UUID)`, `createdAt`, `updatedAt`,
  plus `deletedAt` where soft delete applies.
- Money-like and XP-like effects run in a single DB transaction:
  e.g. lesson completion = attempt record + XP grant + streak update
  + badge check, all committed together or all rolled back.
- Idempotency keys are stored with their original response so
  replays are safe.
- Indexes are declared deliberately for: user progress lookups,
  leaderboard queries, lesson ordering, audit queries. No N+1:
  repositories batch with `include`/`select` deliberately, and
  query count is a review point in PRs.
- No business logic in DB triggers. The database enforces integrity
  (constraints, foreign keys); the application enforces rules.

## 13. Logging, observability, configuration

- Structured JSON logs, one line per event, with `requestId`,
  `userId` (where available), `module`, `level`. No secrets/PII.
- Health endpoints: `/health` (liveness) and `/health/ready`
  (DB + Redis reachable). No health endpoint exposes internals.
- Metrics (later, via the same pattern): request latency, error rate
  per module, queue depth. Added as an interceptor, not per controller.
- Config: `config/` validates every env var at boot with a schema.
  Missing/invalid config crashes at boot in every environment —
  never halfway through a user request.

## 14. Testing and quality gates (CI blocks merges on failure)

- Unit tests: services, validators, streak/XP math, rating math.
- Integration tests: API + real test DB + Redis, covering auth,
  validation, RBAC, idempotency, and transaction rollback.
- E2E tests: Feature 1 happy path + main failure paths.
- Lint + format + strict TypeScript (`strict: true`, no `any` in
  new code without justification in review).
- No `console.log` in production code. Logger only.
- PR template requires: what changed, migration (if any), tests,
  docs updated, security checklist ticked.

## 15. Documentation required (part of Definition of Done)

Every module ships with:
- `README.md` in its folder: purpose, endpoints, events, invariants.
- OpenAPI annotations on every controller (auto-generated docs).
- ADR in `docs/adr/` for any decision that changes architecture,
  security, or data shape.
- This blueprint updated when a principle changes — the blueprint
  is living, not a one-time document.

## 16. Legal guardrails (must be in the product, not just in docs)

- Original curriculum only. Varsity is a topic reference, never a
  source to copy, scrape, or train on, unless Zerodha gives written
  permission. See the Varsity terms check in the design discussion.
- Education, not advice: no personalised buy/sell recommendations,
  no entry/exit targets, no return promises. Mentors give general
  education unless separately SEBI-registered for advice.
- Simulator: virtual money only, clearly labelled, fictional or
  clearly simulated tickers in v1. Real tickers only after legal
  review and market-data licensing review.
- Every lesson and simulator screen carries a short disclaimer:
  educational purpose only, not investment advice.
- Terms, Privacy Policy, and disclaimer pages are required before
  any public launch. Legal counsel review is a launch gate, not
  a post-launch task.

## 17. Build order (approved scope)

**Phase 0 — Core skeleton (no business feature yet):**
config validation, response/error system, auth guard skeleton,
logging, health checks, CI, Docker, docs. This proves the pipeline
before any feature code exists.

**Phase 1 — Feature 1, completed properly (Learning Engine):**
Auth + Users, Learning (tracks/modules/lessons, original Foundation
content), Quiz Engine, Gamification (XP, levels, streaks, badges),
Progress Dashboard, Admin CMS for content. All of sections 6–14
applied to this feature, end to end.

**Phase 2+ — Plug-in features, in order, each as a new module:**
Simulator → ELO Rating → Community → Mentorship → Analytics /
Adaptive Learning. Each phase reuses Phase 0/1 core unchanged.

Explicitly deferred: character Lottie animation, mobile apps,
AI learning assistant, real market data, payments.

## 18. Definition of Done (any feature, no exceptions)

- [ ] Module follows the template; no core file edited without an ADR
- [ ] DTO validation on every endpoint; invalid input tested
- [ ] Standard response envelope on every endpoint
- [ ] Auth + RBAC + ownership checks tested (including negative cases)
- [ ] File handling (if any) follows section 10
- [ ] Migration reviewed and applied; transaction boundaries correct
- [ ] Unit + integration + E2E tests passing in CI
- [ ] OpenAPI + module README + blueprint/ADR updated if needed
- [ ] Logs, requestId, and error codes verified; no secrets in logs
- [ ] Manual QA checklist for the feature completed

---

## Approval

Approve this blueprint and I will start with **Phase 0 only**:
the empty, production-grade skeleton (config, responses, errors,
auth plumbing, logging, Docker, CI) — no business feature code yet.
After Phase 0 is reviewed, Phase 1 (Learning Engine) begins.
