# Candle — Phase 1: Gamified Learning Engine

Gamified financial-learning platform for youth/beginners. This repo is at
**Phase 1** (blueprint §17): auth + users, the learning track system with
the original Money Foundations track, quiz engine, gamification (XP,
levels, IST streaks, badges), and the admin CMS — all verified end to end
(see `docs/adr/0002-phase-1-learning-engine.md`).

- Design: [`docs/01-system-design-blueprint.md`](docs/01-system-design-blueprint.md)
- Approved decisions: [`docs/02-approval-decision-sheet.md`](docs/02-approval-decision-sheet.md)
- Architecture records: [`docs/adr/`](docs/adr/)

## Layout

```
candle/
  apps/api/        # NestJS backend — the only API
  apps/web/        # Next.js frontend
  packages/shared/ # types, error codes, constants ONLY (no logic, no secrets)
  docs/            # blueprint, ADRs, generated API docs (later)
  .github/         # CI — lint, format, typecheck, tests, builds
```

## Quick start

Prerequisites: Docker (Docker Desktop on Windows/Mac, Docker Engine +
Compose plugin on Linux).

```bash
cp apps/api/.env.example apps/api/.env   # then edit the file:
#   JWT_SECRET — required, min 32 chars. Generate:  openssl rand -base64 48
#   ADMIN_SEED_EMAILS — optional. The email you register with gets the
#                       ADMIN role (needed for the content CMS).
# (never commit .env)

docker compose up --build
```

On first boot the `api` container runs `prisma migrate deploy` and then
the idempotent DB seed, which loads the Money Foundations track, its
lessons, quiz questions, and badge definitions. Re-running the seed is
safe — it never overwrites published content.

- Web: http://localhost:3000 (skeleton)
- API health: http://localhost:3001/api/v1/health
- API docs (Swagger UI — easiest way to try the API):
  http://localhost:3001/api/docs

Try it: in Swagger UI, `POST /api/v1/auth/register` (use your
`ADMIN_SEED_EMAILS` address), then `POST /api/v1/auth/login`, then
explore the learning/quiz/gamification endpoints. Authorization is via
the access token; the refresh token arrives as an httpOnly cookie.

## Quality gates (CI blocks merges on failure)

`npm run format:check` · `npm run lint` · `npm run typecheck` ·
`npm run test` · `npm run test:e2e:api` · `npm run build`

Strict TypeScript (`strict: true`), no `any` without justification,
no `console.log` in production code (Logger service only).

## What's next

Phase 2 (trading simulator, ELO ratings, community, mentorship) starts
only after explicit approval — see the decision sheet.
