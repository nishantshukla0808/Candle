# Users module

Profile + avatar — blueprint §4/§10/§11.

## Endpoints (`/api/v1/users`)

| Method | Path          | Auth   | Notes                                                                                                                        |
| ------ | ------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/me`         | user   | Full private profile.                                                                                                        |
| PATCH  | `/me`         | user   | `@Strict()` — update display name.                                                                                           |
| POST   | `/me/avatar`  | user   | Multipart image upload; validated by magic bytes via `StorageService` (§10). Old avatar deleted after the new one is stored. |
| GET    | `/me/avatar`  | user   | Stream my avatar.                                                                                                            |
| GET    | `/:id`        | public | Public profile only — no email, no hashes.                                                                                   |
| GET    | `/:id/avatar` | public | Stream a public avatar.                                                                                                      |

## Invariants

- `passwordHash` is never selected or returned by any repository method.
- Ownership by construction: mutations are on `/me` — there is no
  user-id parameter to tamper with (blueprint §11).
- Avatar policy (size, MIME allow-list) lives in config; enforcement
  lives in `StorageService` (§10). Filenames are UUIDs; paths are
  contained under the storage root.
- Services never import Prisma directly.

## Layout (the Feature Module Template, blueprint §5)

- `users.controller.ts` — thin: parse input, call one service method
- `users.service.ts` — business logic, calls the repository only
- `users.repository.ts` — the ONLY file touching Prisma for users
- `dto/` — `UpdateProfileDto`
- `*.spec.ts` — unit tests
