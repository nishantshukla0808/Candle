-- Phase 10 — Crisis Duel (T2, docs/05 §1, docs/08 §3.7, ADR 0012).
-- Authored via `prisma migrate diff` (schema-before reconstructed from
-- the pre-change schema; no live DB) and hand-reviewed.
--
--   DuelType.CRISIS: the Crisis Duel's DuelType value, so a crisis
--     Duel row can be written. Queue and live state are Redis-only by
--     design (docs/05 §3.2/§3.3) in their own `crisis:*` keyspace; the
--     Duel row is reused (type CRISIS, questionIds = [], seed = market
--     seed — the crash minute is derived from it, docs/15 §4).
--   sprint_duel_results gains 4 nullable columns (all null for
--     sprints — a crisis duel reuses the sprint result table, docs/15
--     §8): crashMinute (the seeded crash minute, 7–10),
--     crashDrawdownPct (this player's peak-to-trough fall across the
--     crash window), tradesDuringCrash (their trades executed during
--     the crash window), panicSold (sold ≥ half of a holding during
--     the crash window — reported on the result screen, not scored).
-- No new tables: the crisis reuses SprintTrade + SprintDuelResult
-- (docs/15 §3). No new index: the Phase 5 index on
-- (type, status, createdAt) already covers CRISIS lookups ("my active
-- crisis duel", rematch-cooldown reads).
-- The migration was NOT applied to a live Postgres (none on this machine).
-- `prisma validate` passes with `DATABASE_URL` set.
-- NOTE: `ALTER TYPE … ADD VALUE` cannot run inside a transaction block;
-- `prisma migrate deploy` handles enum additions accordingly — do not
-- hand-wrap this file in BEGIN/COMMIT.

-- AlterEnum
ALTER TYPE "DuelType" ADD VALUE 'CRISIS';

-- AlterTable
ALTER TABLE "sprint_duel_results" ADD COLUMN "crashDrawdownPct" DOUBLE PRECISION,
ADD COLUMN "crashMinute" INTEGER,
ADD COLUMN "panicSold" BOOLEAN,
ADD COLUMN "tradesDuringCrash" INTEGER;
