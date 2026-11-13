# ADR 0003 — Phase 2 Trading Simulator

**Date:** 2026-11-02
**Status:** Accepted
**Context:** Blueprint §17 — Phase 2 builds the risk-free trading simulator
end to end as a new `simulator` module: virtual-money portfolios,
fictional tickers, buy/sell orders, valuation, and order history.
Phase 0/1 core is untouched except for the additive touchpoints listed
below (blueprint §2.4 — core changes go through an ADR).

## Decisions

1. **Virtual money only, fictional tickers only (blueprint §16).**
   Portfolios start with ₹100,000 of play money
   (`SIMULATOR_STARTING_CASH` in `@candle/shared`). The six seeded
   instruments (`NVLT`, `KVRF`, `ASTL`, `MRUM`, `SGNR`, `HELX`) are
   invented companies with invented symbols. No real ticker, no real
   price, no real money — anywhere. Every simulator endpoint's OpenAPI
   description and every simulator screen carries the disclaimer:
   educational purpose only, not investment advice, virtual money only.

2. **Deterministic simulated price engine, no market data.**
   `PriceEngine.price(symbol, basePrice, at)` is pure:
   `base · exp(drift·t + Σ ampᵢ·sin(freqᵢ·t + phaseᵢ))`, with `t` in whole
   minutes since a fixed epoch and all oscillator parameters derived
   from a FNV-1a hash of the symbol. Same (symbol, minute) always
   yields the same price; prices are minute-bucketed so a quote and the
   execution that follows it agree; `exp()` keeps prices positive by
   construction. This is a teaching toy, not a market model — no
   volatility clustering, no volume, no bid/ask spread. Real market data
   stays explicitly out of scope (blueprint §17).

3. **Orders fill immediately at the simulated price.** v1 has no order
   book, no limit orders, no partial fills. A BUY debits virtual cash
   and upserts the holding (weighted-average cost); a SELL credits
   virtual cash and reduces the holding, deleting the row at zero.
   Rejections (insufficient funds/holdings, unknown instrument) are
   domain errors (`INSUFFICIENT_FUNDS`, `INSUFFICIENT_HOLDINGS`,
   `NOT_FOUND` — blueprint §8), never rows and never validation errors.

4. **One transaction per order (blueprint §12).** Validations, cash move,
   holding update, order row, XP grant, outbox event, and idempotency
   record commit together or roll back together. `POST /orders`
   requires an `Idempotency-Key` header (blueprint §6); replays return
   409 `IDEMPOTENCY_REPLAY` with the original result. The order row also
   carries a UNIQUE `idempotencyKey` as belt-and-braces.

5. **Event-driven XP hook.** Executed trades emit `trade.executed`
   (new `DomainEventType` + `TradeExecutedPayload` in the event bus).
   `GamificationService.grantTradeRewards` grants `XP.TRADE_EXECUTED`
   (5 XP) idempotently via `xpIdempotencyKey = trade:{orderId}`, and
   subscribes to the event for the outbox-relay recovery path — the
   same dual-path pattern as lesson/quiz rewards (ADR 0002/2, 0002/3).
   The simulator module imports `GamificationModule` one-directionally;
   gamification never imports the simulator, so no `forwardRef`.

6. **Money as Prisma Decimal, 2dp strings on the wire.** All money
   columns are `DECIMAL(18,2)` (quantities `DECIMAL(18,6)`); arithmetic
   uses `Prisma.Decimal` with `ROUND_HALF_UP`. API responses render
   money as fixed-2dp strings (`"91574.70"`, never `"91574.7"`) —
   standard shapes (blueprint §7).

7. **Additive core touchpoints (blueprint §2.4).** The only edits
   outside `simulator/` are additive: `ErrorCode.INSUFFICIENT_FUNDS` /
   `INSUFFICIENT_HOLDINGS` (+ default messages, status map, `AppError`
   factories), the `trade.executed` event type/payload, the
   gamification grant method + subscription, `XP.TRADE_EXECUTED` /
   `SIMULATOR_STARTING_CASH` / `SIMULATOR_MAX_ORDER_QTY` constants,
   six `upsert` rows in `prisma/seed.ts`, and the one-line
   `SimulatorModule` registration in `app.module.ts`. No existing
   behavior was changed.

8. **E2E strategy without a live DB.** Same as ADR 0002/12: a
   `FakeSimulatorRepository` implements the repository surface over
   the in-memory `FakeDb` (Decimal values preserved); HTTP pipeline,
   guards, validation, envelope, transactions, and idempotency run for
   real. Migration `0003_phase2_simulator` was authored via
   `prisma migrate diff` (schema-before reconstructed in /tmp; no git
   history exists) and hand-reviewed; it was NOT applied to a live
   Postgres (none on this machine).

## Consequences

- The simulator is a self-contained module: controller (thin),
  service (transactional core), repository (only Prisma touchpoint),
  DTO, price engine, spec, README.
- Portfolio state is per-user and ownership-checked by construction
  (portfolio is resolved from the auth token, never from a client id).
- Phase 3 (ELO) can later rank traders from `sim_orders` without
  touching this module.

## Manual QA checklist

- [ ] `docker compose up --build` on a machine with Docker: migrations
      0001–0003 apply, seed loads 6 instruments.
- [ ] `GET /api/v1/simulator/instruments` (no auth) returns 6 fictional
      tickers with positive prices; prices stable within a minute.
- [ ] Register → `GET /api/v1/simulator/portfolio` shows ₹100000.00 cash,
      empty holdings.
- [ ] `POST /api/v1/simulator/orders` (BUY, with Idempotency-Key):
      cash decreases, holding appears, order in history, +5 XP on the
      gamification dashboard.
- [ ] Replay with the same Idempotency-Key → 409 IDEMPOTENCY_REPLAY,
      cash unchanged.
- [ ] BUY exceeding cash → 409 INSUFFICIENT_FUNDS; SELL exceeding
      holdings → 409 INSUFFICIENT_HOLDINGS.
- [ ] SELL entire position → holding disappears from the portfolio.
- [ ] Second user sees an empty portfolio and empty order history
      (no cross-user leakage).
- [ ] Every simulator response carries the standard envelope +
      request id; no secrets in logs (verified: logger fields are
      userId, orderId, symbol, side, quantity, price).
- [ ] Web: /simulator shows portfolio; /simulator/trade executes a
      trade; /simulator/orders lists history; disclaimer visible on
      all three pages.

## Open questions for Nishu

- None blocking. Product calls for later: limit orders / order book,
  short selling, and real tickers (the last needs legal + market-data
  licensing review per blueprint §16 — explicitly not in v1).
