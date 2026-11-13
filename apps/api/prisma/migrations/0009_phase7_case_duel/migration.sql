-- Phase 7 Stage 1 — CASE_CHOICE format (docs/08 §3.3, docs/05 §7 step 5).
-- Authored via `prisma migrate diff` (schema-before reconstructed from
-- the pre-change schema; no live DB) and hand-reviewed.
-- Adds ONLY the bank fields + one index. It does NOT add DuelType.CASE —
-- that addition belongs to the Stage 2 agent (the duel itself) in a
-- later migration; see /tmp/case-stage1-notes.md.
--
-- AMENDED in Stage 2 (ADR 0009 §10): the Stage 2 agent adds DuelType.CASE
-- and DuelAnswer.reason to THIS file instead of a second migration.
-- Amending is correct here because migration 0009 was never applied to
-- a live Postgres (none on this machine) — no deployed database has a
-- 0009 without these statements, so there is no drift to reconcile.
-- The amendment is hand-reviewed the same way as the original file,
-- and `prisma validate` passes with `DATABASE_URL` set.
--   DuelBankItem.context (JSONB, nullable): structured case numbers as
--     labelled key/value pairs, shown as a small table by the renderer.
--   DuelBankItem.rubric (TEXT, nullable): required for CASE_CHOICE,
--     shown line by line on reveal.
--   DuelBankOption.points (INTEGER, default 0): per-option score
--     fraction — best 100, second-best 50, other 0.
--   DuelBankOption.consequence (TEXT, nullable): one-line consequence
--     shown under each action card.
--   Index (status, type, difficulty) on duel_bank_items (doc 11 Phase A):
--     selection filters by exactly those three columns. No sharding,
--     partitioning, or any other scaling change.
--   DuelType.CASE (Stage 2): the Case Duel's DuelType value, so a Case
--     Duel row can be written. Queue and live state are Redis-only by
--     design (docs/05 §3.2/§3.3); no new tables, no new index — the
--     Phase 5 index on (type, status, createdAt) already covers CASE
--     lookups ("my active CASE duel", rematch-cooldown reads).
--   DuelAnswer.reason (TEXT, nullable; Stage 2): the player's one-line
--     reason for the action they picked (a reason chip, or null when
--     skipped/missing). Never scored — recorded with the answer only.
-- The migration was NOT applied to a live Postgres (none on this machine).
-- `prisma validate` passes with `DATABASE_URL` set.
-- NOTE: `ALTER TYPE … ADD VALUE` cannot run inside a transaction block;
-- `prisma migrate deploy` handles enum additions accordingly — do not
-- hand-wrap this file in BEGIN/COMMIT.

-- AlterTable
ALTER TABLE "duel_bank_items" ADD COLUMN     "context" JSONB,
ADD COLUMN     "rubric" TEXT;

-- AlterTable
ALTER TABLE "duel_bank_options" ADD COLUMN     "consequence" TEXT,
ADD COLUMN     "points" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "duel_bank_items_status_type_difficulty_idx" ON "duel_bank_items"("status", "type", "difficulty");

-- Stage 2 (Case Duel itself, ADR 0009 §10): DuelType.CASE + DuelAnswer.reason.
-- Amended into this file (never applied to a live DB) — see the header note.
ALTER TYPE "DuelType" ADD VALUE 'CASE';

-- AlterTable
ALTER TABLE "duel_answers" ADD COLUMN     "reason" TEXT;
