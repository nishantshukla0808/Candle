# Simulator module

Risk-free trading simulator — blueprint §17 (Phase 2).

Virtual money only, fictional tickers only (blueprint §16). Every
endpoint and screen carries the educational disclaimer.

## Endpoints (`/api/v1/simulator`)

| Method | Path           | Auth   | Notes                                                                            |
| ------ | -------------- | ------ | -------------------------------------------------------------------------------- |
| GET    | `/instruments` | public | Fictional instruments with current simulated prices.                             |
| GET    | `/portfolio`   | user   | Virtual cash + holdings valued at simulated prices + total equity. Lazy-creates. |
| POST   | `/orders`      | user   | **Transactional order** — requires `Idempotency-Key`. Fills immediately.         |
| GET    | `/orders`      | user   | Paginated order history, newest first (`{ items, meta }`).                       |

## Order rules

- `BUY`: cost = price × quantity must be ≤ virtual cash, else
  `INSUFFICIENT_FUNDS` (409). Holding upserted with weighted-average cost.
- `SELL`: holding quantity must cover the sale, else
  `INSUFFICIENT_HOLDINGS` (409). Proceeds credited; holding deleted at zero.
- Unknown/inactive instrument → `NOT_FOUND`. All three are domain
  errors (blueprint §8), never validation errors.
- One transaction holds: validations, cash move, holding update, order
  row, XP grant, outbox event, idempotency record (ADR 0003/4). Replays
  return 409 `IDEMPOTENCY_REPLAY` with the original result.

## Price engine

`price-engine.ts` — deterministic simulated prices (ADR 0003/2):
`base · exp(drift·t + Σ ampᵢ·sin(freqᵢ·t + phaseᵢ))`, minute-bucketed,
seeded per symbol. Pure function; no I/O, no randomness, no market data.

## Events

Executed trades emit `trade.executed`; the gamification module grants
`XP.TRADE_EXECUTED` (5 XP) idempotently, in-transaction and via the
outbox-relay recovery path (ADR 0003/5).

## Money

`Prisma.Decimal` everywhere; `DECIMAL(18,2)` columns (quantities
`DECIMAL(18,6)`); wire format is fixed-2dp strings (ADR 0003/6).

## Layout (the Feature Module Template, blueprint §5)

- `simulator.controller.ts` — thin
- `simulator.service.ts` — reads + the transactional order core
- `simulator.repository.ts` — the ONLY file touching Prisma here
- `price-engine.ts` — pure simulated price model
- `dto/simulator.dto.ts` — boundary validation
- `*.spec.ts` — unit tests
