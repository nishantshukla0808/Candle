# Gamification module

XP, levels, streaks, badges, progress dashboard — blueprint §17, ADR 0002/2.

## Endpoints (`/api/v1/gamification`)

| Method | Path         | Auth | Notes                                              |
| ------ | ------------ | ---- | -------------------------------------------------- |
| GET    | `/dashboard` | user | My XP, level, streaks, badges, per-track progress. |

## How rewards work

Rewards are computed from domain events (`lesson.completed`,
`quiz.submitted`). The learning/quiz services build the event and call
`grantCompletionRewards` / `grantQuizRewards` **inside the same database
transaction** as the completion — attempt record, XP grant, streak update,
and badge check are atomic (blueprint §17).

The same event is also written to the outbox; the relay redelivers it to
the registered handlers as the crash-recovery path. `XpLedger.
idempotencyKey` is unique, so XP can never double-count in either path.

## Tuning (shared constants)

- `XP.LESSON_COMPLETION = 50`, `XP.QUIZ_PASS = 20`
- `LEVEL_XP_THRESHOLDS` — level N at `thresholds[N-1]` XP
- `STREAK_TIMEZONE = 'Asia/Kolkata'` — `StreakService` is the only place
  that computes calendar dates

## Badges

`first-lesson`, `streak-3`, `streak-7`, `quiz-ace` (100% quiz),
`foundation-graduate` (all Money Foundations lessons). Awarded inside the
reward transaction; re-awards are no-ops via the unique constraint.

## Layout (the Feature Module Template, blueprint §5)

- `gamification.controller.ts` — thin
- `gamification.service.ts` — reward engine + dashboard + event handlers
- `gamification.repository.ts` — the ONLY file touching Prisma here
- `streak.service.ts` — Asia/Kolkata date logic (pure, unit-tested)
- `badge.service.ts` — badge rules
- `*.spec.ts` — unit tests
