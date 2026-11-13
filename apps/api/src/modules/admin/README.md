# Admin module

Content management CMS — blueprint §15/§17.

## Access

Every route requires the `ADMIN` role (`@Roles('ADMIN')`, enforced by
RolesGuard). Every endpoint is `@Strict()`. Every mutation writes an
append-only audit row: actor, action, entity, before/after, IP, timestamp.

## Endpoints (`/api/v1/admin`)

| Method       | Path                       | Notes                                                   |
| ------------ | -------------------------- | ------------------------------------------------------- |
| POST/PATCH   | `/tracks`, `/tracks/:id`   | Create/update (draft).                                  |
| POST         | `/tracks/:id/publish`      | Draft → published.                                      |
| GET          | `/tracks`                  | All tracks, including drafts.                           |
| GET          | `/tracks/:id`              | Full content tree (modules → lessons → latest version). |
| POST/PATCH   | `/modules`, `/modules/:id` | Same pattern for modules.                               |
| POST         | `/modules/:id/publish`     | Publish a module.                                       |
| POST         | `/lessons`                 | Creates the lesson family + draft v1.                   |
| GET/PATCH    | `/lessons/:id/draft`       | Get-or-create / edit the draft version.                 |
| POST         | `/lessons/:id/publish`     | Publishes the draft — immutable afterwards.             |
| GET          | `/lessons/:id/versions`    | Version history.                                        |
| GET          | `/lessons/:id/questions`   | Questions on the draft version (get-or-create draft).   |
| POST         | `/lessons/:id/questions`   | Add a question to the draft version.                    |
| PATCH/DELETE | `/questions/:id`           | Edit/delete draft-version questions only.               |
| GET          | `/audit-log`               | Paginated, append-only.                                 |

## Versioning (ADR 0002/4)

Published lesson versions are **immutable**. Editing a published lesson
creates a new DRAFT version copied from it (questions copied too);
publishing freezes it. Completions and quiz attempts pin the version
they ran against, so published history is never rewritten.

Tracks and modules use a simple DRAFT|PUBLISHED status (no version rows).

## Question rules

- SINGLE: exactly one correct option. MULTI: at least one.
- Options are replaced wholesale on update.

## Layout (the Feature Module Template, blueprint §5)

- `admin.controller.ts` — thin, RBAC + strict
- `admin.service.ts` — versioning rules + audit fan-out
- `admin.repository.ts` — the ONLY file touching Prisma here
- `audit.service.ts` — append-only audit writer
- `dto/` — admin DTOs
- `*.spec.ts` — unit tests
