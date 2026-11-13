-- Phase 9 — Paper Trading Sprint (T1, docs/05 §1, docs/08 §3.7, ADR 0011).
-- Authored via `prisma migrate diff` (schema-before reconstructed from
-- the pre-change schema; no live DB) and hand-reviewed.
--
--   DuelType.SPRINT: the Paper Trading Sprint's DuelType value, so a
--     sprint Duel row can be written. Queue and live state are
--     Redis-only by design (docs/05 §3.2/§3.3); the Duel row is reused
--     (type SPRINT, questionIds = [], seed = market seed).
--   sprint_trades: one row per executed sprint order — the audit trail
--     for a sprint (docs/05 §5). Unique (duelId, userId, clientOrderId)
--     is the order idempotency guard: a retried order never
--     double-applies. Bot trades are NOT rows here (the bot has no user
--     account; her trades are reproducible from the duel seed + the
--     documented bot strategy, docs/14 §5).
--   sprint_duel_results: post-sprint stats per human player (risk
--     metrics, equity curve, per-instrument summary, opponent summary,
--     Trading Rating change, XP). Unique (duelId, userId); the result
--     screen reads this row, never recomputes stats.
-- No new index beyond the tables' own: the Phase 5 index on
-- (type, status, createdAt) already covers SPRINT lookups ("my active
-- sprint", rematch-cooldown reads).
-- The migration was NOT applied to a live Postgres (none on this machine).
-- `prisma validate` passes with `DATABASE_URL` set.
-- NOTE: `ALTER TYPE … ADD VALUE` cannot run inside a transaction block;
-- `prisma migrate deploy` handles enum additions accordingly — do not
-- hand-wrap this file in BEGIN/COMMIT.

-- AlterEnum
ALTER TYPE "DuelType" ADD VALUE 'SPRINT';
-- CreateTable
CREATE TABLE "sprint_trades" (
    "id" UUID NOT NULL,
    "duelId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "instrumentId" UUID NOT NULL,
    "side" "SimOrderSide" NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "price" DECIMAL(18,2) NOT NULL,
    "totalValue" DECIMAL(18,2) NOT NULL,
    "clientOrderId" TEXT NOT NULL,
    "executedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sprint_trades_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "sprint_duel_results" (
    "id" UUID NOT NULL,
    "duelId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "result" "DuelOutcome" NOT NULL,
    "finalEquity" DECIMAL(18,2) NOT NULL,
    "returnPct" DOUBLE PRECISION NOT NULL,
    "realisedVolPct" DOUBLE PRECISION NOT NULL,
    "maxDrawdownPct" DOUBLE PRECISION NOT NULL,
    "riskAdjustedScore" DOUBLE PRECISION NOT NULL,
    "tradeCount" INTEGER NOT NULL,
    "perInstrument" JSONB NOT NULL,
    "equityCurve" JSONB NOT NULL,
    "opponentRiskScore" DOUBLE PRECISION NOT NULL,
    "opponentEquity" DECIMAL(18,2),
    "opponentTradeCount" INTEGER NOT NULL,
    "ratingBefore" DOUBLE PRECISION,
    "ratingAfter" DOUBLE PRECISION,
    "ratingDelta" DOUBLE PRECISION,
    "ratingReason" TEXT NOT NULL,
    "xpAwarded" INTEGER NOT NULL,
    "xpBreakdown" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sprint_duel_results_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "sprint_trades_duelId_userId_idx" ON "sprint_trades"("duelId", "userId");
-- CreateIndex
CREATE UNIQUE INDEX "sprint_trades_duelId_userId_clientOrderId_key" ON "sprint_trades"("duelId", "userId", "clientOrderId");
-- CreateIndex
CREATE INDEX "sprint_duel_results_userId_createdAt_idx" ON "sprint_duel_results"("userId", "createdAt");
-- CreateIndex
CREATE UNIQUE INDEX "sprint_duel_results_duelId_userId_key" ON "sprint_duel_results"("duelId", "userId");
-- AddForeignKey
ALTER TABLE "sprint_trades" ADD CONSTRAINT "sprint_trades_duelId_fkey" FOREIGN KEY ("duelId") REFERENCES "duels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "sprint_trades" ADD CONSTRAINT "sprint_trades_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "sprint_trades" ADD CONSTRAINT "sprint_trades_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "sim_instruments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "sprint_duel_results" ADD CONSTRAINT "sprint_duel_results_duelId_fkey" FOREIGN KEY ("duelId") REFERENCES "duels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "sprint_duel_results" ADD CONSTRAINT "sprint_duel_results_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
