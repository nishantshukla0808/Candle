# `@candle/api` — the only API (Phase 0 skeleton)

NestJS + TypeScript backend. Owns auth, database, storage, and queues —
no BaaS (blueprint §3).

## Run it

```bash
# from the repo root
cp apps/api/.env.example apps/api/.env   # then fill in real values
docker compose up --build                # api :3001, web :3000, postgres, redis
```

Or without Docker (needs local Postgres + Redis):

```bash
npm install
npm run prisma:generate
npm run prisma:migrate            # deploy migrations
npm run dev:api
```

## Global pipeline (blueprint §9 — exact order)

1. `RequestIdMiddleware` — `X-Request-Id` on every request/response
2. Helmet — secure headers (`main.ts`)
3. CORS — allow-listed origins; credentials only for `WEB_ORIGIN` (`main.ts`)
4. `RateLimitMiddleware` — Redis fixed-window, global + strict per-prefix
5. `LoggingInterceptor` — one JSON line per request, no bodies/secrets/PII
6. `JwtAuthGuard` — verifies Bearer JWT; `@Public()` opts out, everything
   else authenticated by default
7. `RolesGuard` — `@Roles(...)` enforcement (skeleton; full RBAC in Phase 1)
8. `ValidationPipe` — DTO validation; `VALIDATION_FAILED` + per-field details
9. `TimeoutInterceptor` — per-route timeout, `@TimeoutMs(ms)` to override
10. `ResponseInterceptor` — wraps every success in the §7 envelope
11. `GlobalExceptionFilter` — every error becomes the §7 error envelope

Controllers return plain data. They never build envelopes, never touch
Prisma, never contain business-rule `if` chains.

## Feature Module Template (blueprint §5)

To add a feature, copy this shape — nothing else changes:

```
src/modules/<feature>/
  <feature>.module.ts      # wires the module; register 1 line in app.module.ts
  <feature>.controller.ts  # thin: validated input -> one service call
  <feature>.service.ts     # business logic; calls repositories only
  <feature>.repository.ts  # the ONLY Prisma touchpoint for this feature
  dto/                     # request/response DTOs (class-validator)
  <feature>.mapper.ts      # entity <-> DTO mapping (when needed)
  events/                  # emitted domain events (when needed)
  <feature>.spec.ts        # unit tests
  README.md                # purpose, endpoints, events, invariants
```

Rules:

- A module never imports another module's internals — use its public
  service interface or a domain event.
- New error codes go in `@candle/shared` + `common/errors/error-status-map.ts`.
- Core changes require an ADR in `docs/adr/`.

## Environment

All variables validated at boot (`src/config/configuration.ts`) — invalid
config crashes startup, never a request. See `.env.example` for names
(never values). Secrets never appear in code, logs, git, or bundles.

## Tests

```bash
npm run test:api        # unit (jest)
npm run test:e2e:api    # e2e — infra stubbed at the port boundary
```

Phase 0 e2e covers: envelope shape, `VALIDATION_FAILED` details,
strict vs stripped unknown props, unknown route → `NOT_FOUND`, health +
readiness, public vs protected routes (401 without token), rate-limit 429.
