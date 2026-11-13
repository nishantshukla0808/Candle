# `@candle/web` — Phase 0 skeleton

Next.js + TypeScript + Tailwind frontend (blueprint §3).

## Phase 0 scope

A single page that proves the web app can reach the API: it calls
`GET <NEXT_PUBLIC_API_URL>/api/v1/health` and renders the standard
success envelope (§7).

## Develop

```bash
npm run dev:web      # from the repo root (port 3000)
```

Set `NEXT_PUBLIC_API_URL` (see `.env.example`) to point at the API.

## Conventions (from here on)

- All API calls go through a typed client using `@candle/shared`
  envelope types. The backend is the authority; frontend validation
  is UX only, never security (blueprint §8).
- No secrets in this app. `NEXT_PUBLIC_*` values are public by definition.
