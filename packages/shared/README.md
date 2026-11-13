# `@candle/shared`

Shared contracts for the Candle monorepo — **types, error codes, and
constants only**. No business logic, no secrets, no I/O.

Both `apps/api` and `apps/web` depend on this package so the response
envelope (§7) and error catalogue can never drift between frontend and
backend.

## Contents

- `src/error-codes.ts` — the `ErrorCode` catalogue and client-safe default messages
- `src/responses.ts` — `ApiResponse<T>`, `PaginatedResponse<T>` envelope types
- `src/constants.ts` — API version, pagination caps, header names, timeouts,
  sensitive-field list for log redaction

## Rules

1. Nothing in this package may import from `apps/*`.
2. No runtime secrets or environment-specific values.
3. Adding a new error code is a contract change — update the API's
   status-code map (`apps/api/src/common/errors/error-status-map.ts`) in
   the same PR and note it in an ADR if it changes architecture.
