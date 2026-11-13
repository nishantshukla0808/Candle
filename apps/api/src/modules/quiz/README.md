# Quiz module

Question bank, attempts, grading — blueprint §17.

## Endpoints (`/api/v1/quiz`)

| Method | Path                    | Auth | Notes                                                                                                                                               |
| ------ | ----------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/lessons/:id/attempts` | user | Start an attempt on the lesson's published version. Lesson must be unlocked. Questions are shuffled per attempt; options never include correctness. |
| POST   | `/attempts/:id/submit`  | user | `@Strict()` + `Idempotency-Key` required. Returns score, pass/fail, and per-question feedback with explanations.                                    |
| GET    | `/attempts/:id`         | user | My attempt (questions without answers).                                                                                                             |

## Grading

- SINGLE: exactly the one correct option selected.
- MULTI: the selected set must equal the correct set exactly.
- Skipped questions score 0. Pass mark is 70% of points.
- One transaction holds: grading, answer records, XP grant, streak
  update, badge checks, the outbox event, and the idempotency record.

## Invariants

- Attempts are always the caller's own — another user's attempt id
  returns 403 (blueprint §11), tested.
- Replays with the same `Idempotency-Key` return 409
  `IDEMPOTENCY_REPLAY` with the original result — never double-graded.
- A passed attempt on the current published version is what unlocks
  lesson completion (`getPassedAttempt` is the learning module's port).

## Layout (the Feature Module Template, blueprint §5)

- `quiz.controller.ts` — thin
- `quiz.service.ts` — attempts + grading (pure `grade()` is unit-tested)
- `quiz.repository.ts` — the ONLY file touching Prisma here
- `dto/` — `SubmitQuizDto`
- `*.spec.ts` — unit tests
