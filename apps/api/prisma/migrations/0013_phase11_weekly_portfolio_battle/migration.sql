-- Phase 11 — Weekly Portfolio Battle (T3) + Leagues (docs/05 §1,
-- docs/08 §3.7, ADR 0013).
-- Authored via `prisma migrate diff` (schema-before reconstructed from
-- the pre-change schema at /tmp/schema-before.prisma; no live DB) and
-- hand-reviewed.
--
--   No DuelType.WEEKLY: a weekly battle has no 1v1 Duel row (docs/16
--     §2, ADR 0013 §2) — it is a season of leagues, not a duel.
--   New enum WeeklySeasonStatus (OPEN / ACTIVE / SETTLED). ENDED is
--     derived (ACTIVE + now >= endsAt), not stored.
--   weekly_seasons: one row per Monday (weekStart unique, YYYY-MM-DD
--     Asia/Kolkata), scheduled window + real window (startedAt/endsAt,
--     set by the ADMIN start) + the settled index return.
--   weekly_leagues: one row per league of 30 (tier 1 = top,
--     leagueNumber unique per season).
--   weekly_league_memberships: one row per joiner (season, user)
--     unique; leagueId null until leagues form; carried = lone joiner
--     carried to the next season.
--   weekly_trades: one row per executed order (season, user,
--     clientOrderId) unique — the idempotency key, enforced at the DB
--     level as well as in the service; the audit trail the equity
--     curve is rebuilt from at settlement.
--   weekly_results: one row per (season, player) — rank, league
--     outcome, risk metrics, equity curve, Trading Rating vs the
--     index (null when unrated, < 3 trades), XP.
-- No backfill: all tables are new. Not applied to a live Postgres.

-- CreateEnum
CREATE TYPE "WeeklySeasonStatus" AS ENUM ('OPEN', 'ACTIVE', 'SETTLED');

-- CreateTable
CREATE TABLE "weekly_seasons" (
    "id" UUID NOT NULL,
    "weekStart" TEXT NOT NULL,
    "status" "WeeklySeasonStatus" NOT NULL DEFAULT 'OPEN',
    "scheduledStartsAt" TIMESTAMP(3) NOT NULL,
    "scheduledEndsAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "indexReturnPct" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "weekly_seasons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weekly_leagues" (
    "id" UUID NOT NULL,
    "seasonId" UUID NOT NULL,
    "tier" INTEGER NOT NULL,
    "leagueNumber" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "weekly_leagues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weekly_league_memberships" (
    "id" UUID NOT NULL,
    "seasonId" UUID NOT NULL,
    "leagueId" UUID,
    "userId" UUID NOT NULL,
    "tradingRating" DOUBLE PRECISION NOT NULL,
    "tier" INTEGER NOT NULL DEFAULT 1,
    "carried" BOOLEAN NOT NULL DEFAULT false,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "weekly_league_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weekly_trades" (
    "id" UUID NOT NULL,
    "seasonId" UUID NOT NULL,
    "leagueId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "instrumentId" UUID NOT NULL,
    "side" "SimOrderSide" NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "price" DECIMAL(18,2) NOT NULL,
    "totalValue" DECIMAL(18,2) NOT NULL,
    "clientOrderId" TEXT NOT NULL,
    "executedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "weekly_trades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weekly_results" (
    "id" UUID NOT NULL,
    "seasonId" UUID NOT NULL,
    "leagueId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "rank" INTEGER NOT NULL,
    "leagueSize" INTEGER NOT NULL,
    "tier" INTEGER NOT NULL,
    "nextTier" INTEGER NOT NULL,
    "result" "DuelOutcome" NOT NULL,
    "finalEquity" DECIMAL(18,2) NOT NULL,
    "returnPct" DOUBLE PRECISION NOT NULL,
    "realisedVolPct" DOUBLE PRECISION NOT NULL,
    "maxDrawdownPct" DOUBLE PRECISION NOT NULL,
    "riskAdjustedScore" DOUBLE PRECISION NOT NULL,
    "tradeCount" INTEGER NOT NULL,
    "perInstrument" JSONB NOT NULL,
    "equityCurve" JSONB NOT NULL,
    "ratingBefore" DOUBLE PRECISION,
    "ratingAfter" DOUBLE PRECISION,
    "ratingDelta" DOUBLE PRECISION,
    "ratingResult" TEXT,
    "ratingReason" TEXT NOT NULL,
    "xpAwarded" INTEGER NOT NULL,
    "xpBreakdown" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "weekly_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "weekly_seasons_weekStart_key" ON "weekly_seasons"("weekStart");

-- CreateIndex
CREATE INDEX "weekly_seasons_status_createdAt_idx" ON "weekly_seasons"("status", "createdAt");

-- CreateIndex
CREATE INDEX "weekly_leagues_seasonId_tier_idx" ON "weekly_leagues"("seasonId", "tier");

-- CreateIndex
CREATE UNIQUE INDEX "weekly_leagues_seasonId_leagueNumber_key" ON "weekly_leagues"("seasonId", "leagueNumber");

-- CreateIndex
CREATE INDEX "weekly_league_memberships_seasonId_leagueId_idx" ON "weekly_league_memberships"("seasonId", "leagueId");

-- CreateIndex
CREATE INDEX "weekly_league_memberships_userId_createdAt_idx" ON "weekly_league_memberships"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "weekly_league_memberships_seasonId_userId_key" ON "weekly_league_memberships"("seasonId", "userId");

-- CreateIndex
CREATE INDEX "weekly_trades_seasonId_userId_idx" ON "weekly_trades"("seasonId", "userId");

-- CreateIndex
CREATE INDEX "weekly_trades_leagueId_userId_idx" ON "weekly_trades"("leagueId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "weekly_trades_seasonId_userId_clientOrderId_key" ON "weekly_trades"("seasonId", "userId", "clientOrderId");

-- CreateIndex
CREATE INDEX "weekly_results_seasonId_leagueId_idx" ON "weekly_results"("seasonId", "leagueId");

-- CreateIndex
CREATE INDEX "weekly_results_userId_createdAt_idx" ON "weekly_results"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "weekly_results_seasonId_userId_key" ON "weekly_results"("seasonId", "userId");

-- AddForeignKey
ALTER TABLE "weekly_leagues" ADD CONSTRAINT "weekly_leagues_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "weekly_seasons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_league_memberships" ADD CONSTRAINT "weekly_league_memberships_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "weekly_seasons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_league_memberships" ADD CONSTRAINT "weekly_league_memberships_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "weekly_leagues"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_league_memberships" ADD CONSTRAINT "weekly_league_memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_trades" ADD CONSTRAINT "weekly_trades_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "weekly_seasons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_trades" ADD CONSTRAINT "weekly_trades_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "weekly_leagues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_trades" ADD CONSTRAINT "weekly_trades_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_trades" ADD CONSTRAINT "weekly_trades_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "sim_instruments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_results" ADD CONSTRAINT "weekly_results_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "weekly_seasons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_results" ADD CONSTRAINT "weekly_results_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "weekly_leagues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_results" ADD CONSTRAINT "weekly_results_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

