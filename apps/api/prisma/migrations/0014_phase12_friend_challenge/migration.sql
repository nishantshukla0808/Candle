-- Phase 12 — Friend Challenge (P2, docs/05 §1, docs/17, ADR 0014).
-- Authored via `prisma migrate diff` (schema-before reconstructed from
-- the pre-change schema at /tmp/schema-before.prisma; no live DB) and
-- hand-reviewed.
--
--   New enum ChallengeStatus (PENDING / ACCEPTED / DECLINED / EXPIRED /
--     PLAYED). ACCEPTED is transient (ADR 0014 §5): it is written only
--     when an accept claims the challenge and the same request moves it
--     to PLAYED or reverts it to PENDING — it is never a terminal state.
--   challenges: one row per invite — creator, invitee, duelType (one of
--     the six 1v1 types; never DAILY/WEEKLY/BOT), status, inviteCode
--     (unique, the unguessable token behind /duels/challenge?code=…),
--     duelId (null until PLAYED), expiresAt (createdAt + 24 h).
--   Hand-added (not from migrate diff): the partial unique index
--     challenges_one_pending_per_pair_type_idx — one PENDING or
--     ACCEPTED challenge per unordered pair per duel type, in either
--     direction (LEAST/GREATEST over the two user ids). The service
--     checks the same rule before inserting; the index is the race
--     guard, the same pattern as the Daily set's unique date.
-- No backfill: the table is new. Not applied to a live Postgres.

-- CreateEnum
CREATE TYPE "ChallengeStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'PLAYED');

-- CreateTable
CREATE TABLE "challenges" (
    "id" UUID NOT NULL,
    "creatorId" UUID NOT NULL,
    "inviteeId" UUID NOT NULL,
    "duelType" "DuelType" NOT NULL,
    "status" "ChallengeStatus" NOT NULL DEFAULT 'PENDING',
    "inviteCode" TEXT NOT NULL,
    "duelId" UUID,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "challenges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "challenges_inviteCode_key" ON "challenges"("inviteCode");

-- CreateIndex
CREATE INDEX "challenges_creatorId_status_createdAt_idx" ON "challenges"("creatorId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "challenges_inviteeId_status_createdAt_idx" ON "challenges"("inviteeId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "challenges_duelId_idx" ON "challenges"("duelId");

-- AddForeignKey
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_inviteeId_fkey" FOREIGN KEY ("inviteeId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_duelId_fkey" FOREIGN KEY ("duelId") REFERENCES "duels"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Hand-added: one pending/accepted challenge per pair per duel type.
CREATE UNIQUE INDEX "challenges_one_pending_per_pair_type_idx" ON "challenges" (LEAST("creatorId", "inviteeId"), GREATEST("creatorId", "inviteeId"), "duelType") WHERE "status" IN ('PENDING', 'ACCEPTED');
