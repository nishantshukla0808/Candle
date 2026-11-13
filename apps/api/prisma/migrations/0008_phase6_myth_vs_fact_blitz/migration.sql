-- Phase 6 — Myth vs Fact Blitz (L2, docs/05 §1, docs/08 §3.2).
-- Authored via `prisma migrate diff` (schema-before reconstructed from
-- the pre-change schema; no live DB) and hand-reviewed.
-- Adds DuelType.BLITZ only. Matchmaking queue state and live duel state
-- live in Redis, NOT in Postgres (docs/05 §3.2/§3.3) — no new tables.
-- No new index: the Phase 5 index on (type, status, createdAt) already
-- covers BLITZ lookups ("my active BLITZ duel", rematch-cooldown reads).
-- NOTE: ALTER TYPE ... ADD VALUE cannot run inside a transaction block;
-- `prisma migrate deploy` handles enum additions accordingly. Do NOT
-- hand-wrap this file in BEGIN/COMMIT.

-- AlterEnum
ALTER TYPE "DuelType" ADD VALUE 'BLITZ';
