-- CreateEnum
CREATE TYPE "RatingKind" AS ENUM ('LEARNING', 'TRADING');

-- CreateEnum
CREATE TYPE "RatingEventSource" AS ENUM ('DUEL', 'TRADING_WEEK', 'SEASON_RESET', 'DECAY');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "countryCode" TEXT,
ADD COLUMN     "countryCodeChangedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "user_ratings" (
    "userId" UUID NOT NULL,
    "kind" "RatingKind" NOT NULL,
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 1000,
    "gamesPlayed" INTEGER NOT NULL DEFAULT 0,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "draws" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "provisional" BOOLEAN NOT NULL DEFAULT true,
    "lastRatedAt" TIMESTAMP(3),
    "season" TEXT NOT NULL,
    "countryCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_ratings_pkey" PRIMARY KEY ("userId","kind")
);

-- CreateTable
CREATE TABLE "rating_history" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "kind" "RatingKind" NOT NULL,
    "source" "RatingEventSource" NOT NULL,
    "eventId" TEXT NOT NULL,
    "opponentId" UUID,
    "opponentRating" DOUBLE PRECISION,
    "expectedScore" DOUBLE PRECISION NOT NULL,
    "actualScore" DOUBLE PRECISION NOT NULL,
    "kFactor" INTEGER NOT NULL,
    "delta" DOUBLE PRECISION NOT NULL,
    "ratingBefore" DOUBLE PRECISION NOT NULL,
    "ratingAfter" DOUBLE PRECISION NOT NULL,
    "season" TEXT NOT NULL,
    "weekStart" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rating_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_ratings_kind_rating_idx" ON "user_ratings"("kind", "rating");

-- CreateIndex
CREATE INDEX "rating_history_userId_kind_createdAt_idx" ON "rating_history"("userId", "kind", "createdAt");

-- CreateIndex
CREATE INDEX "rating_history_userId_createdAt_idx" ON "rating_history"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "rating_history_userId_eventId_key" ON "rating_history"("userId", "eventId");

-- AddForeignKey
ALTER TABLE "user_ratings" ADD CONSTRAINT "user_ratings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rating_history" ADD CONSTRAINT "rating_history_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Question Bank (docs/05 §2, ADR 0005 §15) — appended by the Question Bank builder;
-- same phase, same migration number (see ADR 0005 §11). Authored via
-- `prisma migrate diff` from the ratings-only schema to this schema and
-- hand-reviewed: 3 enums, duel_bank_items + duel_bank_options +
-- duel_bank_templates + user_question_exposures, selector/audit indexes,
-- unique keys, FKs. NOT applied to a live Postgres (none on this machine).
-- CreateEnum
CREATE TYPE "DuelBankSkill" AS ENUM ('RECALL', 'CALCULATION', 'JUDGEMENT', 'CHART_READING', 'SCENARIO', 'RISK_ASSESSMENT');

-- CreateEnum
CREATE TYPE "DuelBankQuestionType" AS ENUM ('MCQ_4', 'TRUE_FALSE', 'CASE_CHOICE', 'CHART_CHOICE', 'NUMERIC', 'ORDERING');

-- CreateEnum
CREATE TYPE "DuelBankStatus" AS ENUM ('DRAFT', 'REVIEW', 'PILOT', 'LIVE', 'RETIRED');

-- CreateTable
CREATE TABLE "duel_bank_items" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "skill" "DuelBankSkill" NOT NULL,
    "type" "DuelBankQuestionType" NOT NULL,
    "difficulty" INTEGER NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "sourceLessonId" UUID,
    "stem" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "status" "DuelBankStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "templateId" UUID,
    "parameters" JSONB,
    "authorId" UUID,
    "reviewerId" UUID,
    "publishedAt" TIMESTAMP(3),
    "pilotAnswers" INTEGER NOT NULL DEFAULT 0,
    "pilotCorrect" INTEGER NOT NULL DEFAULT 0,
    "correctRate" DOUBLE PRECISION,
    "discrimination" DOUBLE PRECISION,
    "exposureCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "duel_bank_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "duel_bank_options" (
    "id" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "isCorrect" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "duel_bank_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "duel_bank_templates" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "skill" "DuelBankSkill" NOT NULL,
    "templateText" TEXT NOT NULL,
    "parameterSchema" JSONB NOT NULL,
    "answerFormula" TEXT,
    "distractorRules" JSONB,
    "status" "DuelBankStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "duel_bank_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_question_exposures" (
    "userId" UUID NOT NULL,
    "bankItemId" UUID NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "seenCount" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "user_question_exposures_pkey" PRIMARY KEY ("userId","bankItemId")
);

-- CreateIndex
CREATE UNIQUE INDEX "duel_bank_items_key_key" ON "duel_bank_items"("key");

-- CreateIndex
CREATE INDEX "duel_bank_items_status_topic_difficulty_idx" ON "duel_bank_items"("status", "topic", "difficulty");

-- CreateIndex
CREATE INDEX "duel_bank_items_status_skill_idx" ON "duel_bank_items"("status", "skill");

-- CreateIndex
CREATE INDEX "duel_bank_items_templateId_idx" ON "duel_bank_items"("templateId");

-- CreateIndex
CREATE INDEX "duel_bank_options_itemId_idx" ON "duel_bank_options"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "duel_bank_templates_key_key" ON "duel_bank_templates"("key");

-- CreateIndex
CREATE INDEX "user_question_exposures_userId_lastSeenAt_idx" ON "user_question_exposures"("userId", "lastSeenAt");

-- AddForeignKey
ALTER TABLE "duel_bank_items" ADD CONSTRAINT "duel_bank_items_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "duel_bank_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "duel_bank_options" ADD CONSTRAINT "duel_bank_options_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "duel_bank_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_question_exposures" ADD CONSTRAINT "user_question_exposures_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_question_exposures" ADD CONSTRAINT "user_question_exposures_bankItemId_fkey" FOREIGN KEY ("bankItemId") REFERENCES "duel_bank_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

