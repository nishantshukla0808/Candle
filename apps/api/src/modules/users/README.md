# Users module

Profile + avatar — blueprint §4/§10/§11.

**Phase 13 (ADR 0015):** the profile itself moved to the `profiles`
module. `GET /me`, `PATCH /me`, and `GET /:id` stay on this
controller's routes but **delegate to `ProfilesService`** — see
`src/modules/profiles/README.md` for the visibility rules, career
title, duel history, and simulator showcase. This module keeps only
avatar handling.

## Endpoints (`/api/v1/users`)

| Method | Path          | Auth   | Notes                                                                                                                        |
| ------ | ------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/me`         | user   | Full owner profile (delegates to profiles).                                                                                  |
| PATCH  | `/me`         | user   | `@Strict()` — display name + bio only. **Country is locked** (ADR 0015 §2): `countryCode` is rejected at the boundary.       |
| POST   | `/me/avatar`  | user   | Multipart image upload; validated by magic bytes via `StorageService` (§10). Old avatar deleted after the new one is stored. |
| GET    | `/me/avatar`  | user   | Stream my avatar.                                                                                                            |
| GET    | `/:id`        | public | Public profile, privacy-filtered server-side (delegates to profiles).                                                        |
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
- `users.service.ts` — avatar handling + delegation to `ProfilesService`
- `users.repository.ts` — the ONLY file touching Prisma for users
- `dto/` — `UpdateProfileDto`
- `*.spec.ts` — unit tests
