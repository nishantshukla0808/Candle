# Health module

## Endpoints

| Method | Path                   | Auth   | Purpose                                         |
| ------ | ---------------------- | ------ | ----------------------------------------------- |
| GET    | `/api/v1/health`       | public | Liveness — is the process alive?                |
| GET    | `/api/v1/health/ready` | public | Readiness — are PostgreSQL and Redis reachable? |

## Contract

- Both return the standard success envelope via `ResponseInterceptor`.
- `ready` returns `503 SERVICE_UNAVAILABLE` (enveloped) when any
  dependency is down. No internals are exposed: only `ok`/`not_ready`
  and per-dependency latencies.
- `HealthService` never throws — a failing check is data, and the
  controller maps it to the 503.
