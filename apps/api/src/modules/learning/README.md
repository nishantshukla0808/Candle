# Learning module

Tracks, lessons, completions — blueprint §17.

## Endpoints (`/api/v1/learning`)

| Method | Path                    | Auth   | Notes                                                                                 |
| ------ | ----------------------- | ------ | ------------------------------------------------------------------------------------- |
| GET    | `/tracks`               | public | Published tracks.                                                                     |
| GET    | `/tracks/:slug`         | public | Modules + lessons with `locked`/`completed` per lesson (progress when authenticated). |
| GET    | `/lessons/:id`          | public | Published content, disclaimer, quiz info, lock state.                                 |
| POST   | `/lessons/:id/complete` | user   | **Transactional completion** — requires `Idempotency-Key`.                            |

## Completion rules

Progression is linear across a track: lesson N unlocks when lesson N-1
is complete. Completing a lesson requires passing its quiz when the
published version has questions. Both are domain errors
(`PREREQUISITE_NOT_COMPLETED`), never validation errors (§8).

One transaction holds: validations, the completion row, progress,
XP grant, streak update, badge checks, the outbox event, and the
idempotency record (ADR 0002/2). Replays return 409
`IDEMPOTENCY_REPLAY` with the original result — never double-applied.

## Versioning

`Lesson` is the stable family; `LessonVersion` holds content
(`version`, DRAFT|PUBLISHED). Published versions are immutable —
edits create a new draft version. Completions pin `lessonVersionId`.

## Layout (the Feature Module Template, blueprint §5)

- `learning.controller.ts` — thin
- `learning.service.ts` — reads + the transactional completion core
- `learning.repository.ts` — the ONLY file touching Prisma here
- `*.spec.ts` — unit tests
