-- Phase 8 — CHART_CHOICE format (Stage 1) + Chart Detective duel
-- (Stage 2, docs/08 §3.4, docs/05 §7 step 6, ADR 0010).
-- Authored via `prisma migrate diff` (schema-before reconstructed from
-- the pre-change schema; no live DB) and hand-reviewed.
-- Stage 1 adds the bank field; Stage 2 appends DuelType.CHART to THIS
-- file (same precedent as 0009, ADR 0009 §10). Amending is correct
-- because migration 0010 was never applied to a live Postgres
-- (none on this machine) — no deployed database has a 0010 without
-- the Stage 2 statement, so there is no drift to reconcile.
--
--   DuelBankItem.chart (JSONB, nullable): structured chart data —
--     { title, instrument, template, xLabel, yLabel, xLabels[6],
--     series[6], annotation }. The renderer draws the chart from this
--     data (never an image); the public view carries it WITHOUT the
--     annotation, which is reveal-only.
--   DuelType.CHART (Stage 2): the Chart Detective duel's DuelType
--     value, so a Chart Duel row can be written. Queue and live state
--     are Redis-only by design (docs/05 §3.2/§3.3); no new tables, no
--     new index — the Phase 5 index on (type, status, createdAt)
--     already covers CHART lookups ("my active CHART duel",
--     rematch-cooldown reads), and the Phase 7 index on
--     (status, type, difficulty) already covers CHART selection.
-- The migration was NOT applied to a live Postgres (none on this machine).
-- `prisma validate` passes with `DATABASE_URL` set.
-- NOTE: `ALTER TYPE … ADD VALUE` cannot run inside a transaction block;
-- `prisma migrate deploy` handles enum additions accordingly — do not
-- hand-wrap this file in BEGIN/COMMIT.

-- AlterTable
ALTER TABLE "duel_bank_items" ADD COLUMN     "chart" JSONB;

-- Stage 2 (Chart Detective duel itself): DuelType.CHART.
-- Appended in Stage 2 (ADR 0010 §10, same precedent as 0009):
-- the migration was never applied to a live Postgres, so amending
-- this file is correct — no deployed database has a 0010 without
-- this statement, so there is no drift to reconcile. No new tables,
-- no new index — the Phase 5 index on (type, status, createdAt)
-- already covers CHART lookups ("my active CHART duel",
-- rematch-cooldown reads). Queue and live state are Redis-only by
-- design (docs/05 §3.2/§3.3). Do NOT hand-wrap this file in
-- BEGIN/COMMIT: `ALTER TYPE … ADD VALUE` cannot run inside a
-- transaction block; `prisma migrate deploy` handles enum additions
-- accordingly. The migration was NOT applied to a live Postgres
-- (none on this machine). `prisma validate` passes with DATABASE_URL
-- set, and the Prisma client was regenerated (DuelType.CHART
-- confirmed in the generated client).

ALTER TYPE "DuelType" ADD VALUE 'CHART';
