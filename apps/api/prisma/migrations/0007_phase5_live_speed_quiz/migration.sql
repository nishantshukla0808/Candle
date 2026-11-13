-- Phase 5 — Live Speed Quiz Duel (L1, docs/05 §3, docs/09, ADR 0007).
-- Authored via `prisma migrate diff` (schema-before reconstructed from
-- the pre-change schema; no live DB) and hand-reviewed.
-- Adds DuelType.LIVE only. Matchmaking queue state and live duel state
-- live in Redis, NOT in Postgres (docs/05 §3.2/§3.3) — no new tables.
-- The new index supports "my active LIVE duel" lookups.
-- NOTE: ALTER TYPE ... ADD VALUE cannot run inside a transaction block;
-- `prisma migrate deploy` handles enum additions accordingly. Do NOT
-- hand-wrap this file in BEGIN/COMMIT.

-- AlterEnum
ALTER TYPE "DuelType" ADD VALUE 'LIVE';

-- CreateIndex
CREATE INDEX "duels_type_status_createdAt_idx" ON "duels"("type", "status", "createdAt");
