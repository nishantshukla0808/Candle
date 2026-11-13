-- CreateEnum
CREATE TYPE "DuelType" AS ENUM ('BOT', 'DAILY');

-- CreateEnum
CREATE TYPE "DuelStatus" AS ENUM ('IN_PROGRESS', 'WAITING_OPPONENT', 'SETTLED');

-- CreateEnum
CREATE TYPE "DuelOutcome" AS ENUM ('WIN', 'DRAW', 'LOSS');

-- CreateTable
CREATE TABLE "duels" (
    "id" UUID NOT NULL,
    "type" "DuelType" NOT NULL,
    "status" "DuelStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "playerAId" UUID NOT NULL,
    "playerBId" UUID,
    "pairedDuelId" UUID,
    "dailyDate" TEXT,
    "dailySetId" UUID,
    "questionIds" JSONB NOT NULL,
    "seed" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "winnerId" UUID,
    "botScore" INTEGER,
    "botCorrect" INTEGER,
    "botTotalTimeMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "duels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "duel_answers" (
    "id" UUID NOT NULL,
    "duelId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "questionId" UUID NOT NULL,
    "optionId" UUID,
    "skipped" BOOLEAN NOT NULL DEFAULT false,
    "correct" BOOLEAN NOT NULL DEFAULT false,
    "timeMs" INTEGER,
    "points" INTEGER NOT NULL DEFAULT 0,
    "order" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "duel_answers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "duel_daily_sets" (
    "id" UUID NOT NULL,
    "date" TEXT NOT NULL,
    "questionIds" JSONB NOT NULL,
    "seed" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "duel_daily_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "duel_game_results" (
    "id" UUID NOT NULL,
    "duelId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "result" "DuelOutcome" NOT NULL,
    "score" INTEGER NOT NULL,
    "correct" INTEGER NOT NULL,
    "wrong" INTEGER NOT NULL,
    "skipped" INTEGER NOT NULL,
    "accuracy" DOUBLE PRECISION NOT NULL,
    "avgTimeMs" INTEGER,
    "fastestTimeMs" INTEGER,
    "slowestTimeMs" INTEGER,
    "bestStreak" INTEGER NOT NULL,
    "perTopic" JSONB NOT NULL,
    "perQuestion" JSONB NOT NULL,
    "ratingBefore" DOUBLE PRECISION,
    "ratingAfter" DOUBLE PRECISION,
    "ratingDelta" DOUBLE PRECISION,
    "ratingReason" TEXT NOT NULL,
    "xpAwarded" INTEGER NOT NULL,
    "xpBreakdown" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "duel_game_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "duels_playerAId_type_createdAt_idx" ON "duels"("playerAId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "duels_type_dailyDate_status_idx" ON "duels"("type", "dailyDate", "status");

-- CreateIndex
CREATE INDEX "duel_answers_duelId_userId_idx" ON "duel_answers"("duelId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "duel_answers_duelId_userId_questionId_key" ON "duel_answers"("duelId", "userId", "questionId");

-- CreateIndex
CREATE UNIQUE INDEX "duel_daily_sets_date_key" ON "duel_daily_sets"("date");

-- CreateIndex
CREATE INDEX "duel_game_results_userId_createdAt_idx" ON "duel_game_results"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "duel_game_results_duelId_userId_key" ON "duel_game_results"("duelId", "userId");

-- AddForeignKey
ALTER TABLE "duels" ADD CONSTRAINT "duels_playerAId_fkey" FOREIGN KEY ("playerAId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "duels" ADD CONSTRAINT "duels_playerBId_fkey" FOREIGN KEY ("playerBId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "duels" ADD CONSTRAINT "duels_dailySetId_fkey" FOREIGN KEY ("dailySetId") REFERENCES "duel_daily_sets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "duel_answers" ADD CONSTRAINT "duel_answers_duelId_fkey" FOREIGN KEY ("duelId") REFERENCES "duels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "duel_answers" ADD CONSTRAINT "duel_answers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "duel_answers" ADD CONSTRAINT "duel_answers_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "duel_bank_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "duel_game_results" ADD CONSTRAINT "duel_game_results_duelId_fkey" FOREIGN KEY ("duelId") REFERENCES "duels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "duel_game_results" ADD CONSTRAINT "duel_game_results_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

