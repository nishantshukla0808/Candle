# ADR 0001 — Phase 0 production skeleton

**Date:** 2026-11-01
**Status:** Accepted
**Context:** Blueprint §17 — Phase 0 builds the empty production skeleton
(config, responses, errors, auth plumbing, logging, health, Docker, CI,
docs) and proves the pipeline before any feature code exists.

## Decisions

1. **NestJS global pipeline in exact blueprint §9 order.** Middleware
   (RequestId → Helmet → CORS → RateLimit) in `AppModule.configure()` +
   `main.ts`; then `APP_INTERCEPTOR` Logging → Timeout → Response (reverse
   unwind), `APP_GUARD` JwtAuthGuard → RolesGuard, `APP_PIPE`
   ValidationPipe, `APP_FILTER` GlobalExceptionFilter.

2. **Validation split per §8.** Global pipe: `whitelist` + `transform`
   (unknown props stripped). `strictValidationPipe` with
   `forbidNonWhitelisted` for strict endpoints (auth/payments/admin),
   demonstrated on `POST /api/v1/sample/strict`. The validation
   exception factory returns `AppError` directly so the filter keeps
   per-field details.

3. **Error handling.** `AppError` is the only thrown expected-failure type.
   `GlobalExceptionFilter` maps it to the envelope; `HttpException`s map
   by status; unknown errors become `INTERNAL_ERROR` 500 with no details
   in production. Added `SERVICE_UNAVAILABLE` (503) to the catalogue for
   `/health/ready` — the blueprint's list is "examples, full list lives
   in code".

4. **Rate limiting as middleware, path-prefix config.** Redis-backed
   fixed-window, keyed by IP + user. Strict prefixes come from
   `RATE_LIMIT_STRICT_PREFIXES` (default `/api/v1/auth` — no auth routes
   exist yet; the config is ready for Phase 1). Fails OPEN on Redis
   failure with an error log: rate limiting must never take the API down.

5. **Auth is verify-only plumbing.** `JwtAuthGuard` defaults to
   authenticated; `@Public()` opts out. `TokenService` verifies HS256
   tokens; signing exists for tests and Phase 1 login. No login,
   refresh rotation, or password hashing in Phase 0.

6. **Storage behind an interface.** `StorageService` abstract class;
   `LocalStorageService` (dev only) enforces size limits, magic-byte MIME
   sniffing, UUID filenames, and path containment. S3 implementation
   plugs in for prod with no caller changes.

7. **Prisma is the single source of truth.** `User` + `RefreshToken`
   models only (auth plumbing). Migration generated via
   `prisma migrate diff --from-empty` (no live DB needed to author it);
   applied with `migrate deploy`. Repositories are the only Prisma
   touchpoints.

8. **Sample module is scaffolding, deleted in Phase 1.** It exists only
   so the pipeline is e2e-testable before real features land.

9. **E2E stubs infra at the port boundary.** `PrismaService.$queryRaw`
   and a `RedisService`-shaped adapter over `ioredis-mock` — the real
   `HealthService` and `RateLimitMiddleware` wiring is exercised.

10. **Cross-cutting providers are global modules.** `AppConfigModule`,
    `DatabaseModule` (PrismaService), and `CommonModule`
    (AppLogger/RedisService/StorageService) are `@Global()`, so feature
    modules inject them without imports. Repositories remain the only
    Prisma touchpoints.

## Consequences

- Every future feature copies the Feature Module Template
  (module/controller/service/repository/dto/mapper/events/spec/README)
  and registers one line in `AppModule`.
- Core changes require a new ADR (blueprint §2.4).
