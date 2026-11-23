# Auth module

Phase 1 authentication — blueprint §11, ADR 0002/1.

## Endpoints (`/api/v1/auth`, all `@Public()` + `@Strict()`)

| Method | Path               | Notes                                                                                                                                    |
| ------ | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/register`        | Argon2id hash, email verification required. `ADMIN_SEED_EMAILS` grants ADMIN.                                                            |
| POST   | `/verify-email`    | Single-use hashed expiring token (24h).                                                                                                  |
| POST   | `/login`           | Progressive delay on failure; generic "invalid credentials"; requires verified email. Sets the refresh cookie, returns the access token. |
| POST   | `/refresh`         | Rotates the refresh cookie; reuse of a rotated token revokes the whole family.                                                           |
| POST   | `/logout`          | Revokes the presented refresh token; clears the cookie.                                                                                  |
| POST   | `/password/forgot` | Always 200 — never reveals whether the email is registered.                                                                              |
| POST   | `/password/reset`  | Single-use hashed expiring token (1h); revokes all refresh families.                                                                     |

## Invariants

- Raw tokens are never stored — only SHA-256 hashes (`email_tokens`,
  `refresh_tokens`). Raw passwords never leave `PasswordService`.
- Password policy: configurable minimum (default 12) + upper/lower/digit/
  symbol + common-password denylist. Failures are `VALIDATION_FAILED`
  with per-field details (never the rejected password value).
- Refresh cookies: httpOnly, `Secure` in production, `SameSite=Lax`,
  path `/api/v1/auth`.
- These routes sit under the strict rate-limit prefix (`/api/v1/auth`).
- **Phase 13 (ADR 0015 §6/§8):** login/refresh record the User-Agent
  on the refresh-token family (`RefreshToken.userAgent`) so the
  settings session list can label devices. Login inside the 30-day
  deletion grace **cancels the deletion**; past the grace the login
  fails generically. `AuthModule` now also exports `AuthRepository`,
  `PasswordService`, and `RefreshTokenService` for the settings
  module (sessions + password change); `TokenService` is still the
  export the global `JwtAuthGuard` uses.

## Dev note

Email delivery doesn't exist in Phase 1, so non-production responses
include the raw verification/reset token (clearly labeled). Production
never returns it — check the server logs instead.
