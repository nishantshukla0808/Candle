-- Phase 13 — Profiles + Settings (docs/06 §1–§2, docs/18, ADR 0015).
-- Authored via `prisma migrate diff` (schema-before reconstructed from
-- the pre-change schema at /tmp/schema-before.prisma; no live DB) and
-- hand-reviewed.
--
--   users: + bio (nullable), profileVisibility (default PUBLIC),
--     displayNameChangedAt (30-day cooldown), deletionRequestedAt /
--     deletionScheduledAt (30-day DPDP grace). All new columns nullable
--     except profileVisibility, which has a default — no backfill, no
--     existing row changes. countryCode / countryCodeChangedAt are
--     UNTOUCHED: country is locked after signup (decision 4, ADR 0015
--     §2) and no longer written by any endpoint.
--   refresh_tokens: + userAgent (nullable) for the session list.
--   user_privacy_settings / user_settings / notification_preferences /
--     data_exports / sim_showcase_snapshots: new tables, one row per
--     user (or per user+type). No backfill: rows are created lazily
--     with documented defaults on first read/write.
--   NOT built here: friends/chat, communities, BlockedUser, LoginEvent
--     (deferred, ADR 0015 §10) — no tables for them in this phase.
-- No backfill. Not applied to a live Postgres.
--
-- CreateEnum
CREATE TYPE "ProfileVisibility" AS ENUM ('PUBLIC', 'FRIENDS', 'PRIVATE');

-- CreateEnum
CREATE TYPE "Theme" AS ENUM ('LIGHT', 'DARK', 'SYSTEM');

-- CreateEnum
CREATE TYPE "FontSize" AS ENUM ('NORMAL', 'LARGE');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('DUEL_INVITE', 'DUEL_RESULT', 'REMATCH_REQUEST', 'FRIEND_REQUEST', 'NEW_MESSAGE', 'COMMUNITY_REPLY', 'COMMUNITY_MENTION', 'STREAK_REMINDER', 'WEEKLY_LEAGUE_RESULT', 'SEASON_EVENT', 'NEW_LESSON', 'PRODUCT_NEWS');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "bio" TEXT,
ADD COLUMN     "deletionRequestedAt" TIMESTAMP(3),
ADD COLUMN     "deletionScheduledAt" TIMESTAMP(3),
ADD COLUMN     "displayNameChangedAt" TIMESTAMP(3),
ADD COLUMN     "profileVisibility" "ProfileVisibility" NOT NULL DEFAULT 'PUBLIC';

-- AlterTable
ALTER TABLE "refresh_tokens" ADD COLUMN     "userAgent" TEXT;

-- CreateTable
CREATE TABLE "user_privacy_settings" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "showRatings" BOOLEAN NOT NULL DEFAULT true,
    "showRank" BOOLEAN NOT NULL DEFAULT true,
    "showLearningProgress" BOOLEAN NOT NULL DEFAULT true,
    "showDuelHistory" BOOLEAN NOT NULL DEFAULT true,
    "showSimulatorShowcase" BOOLEAN NOT NULL DEFAULT true,
    "showBadges" BOOLEAN NOT NULL DEFAULT true,
    "showFriendsList" BOOLEAN NOT NULL DEFAULT true,
    "allowFriendRequests" BOOLEAN NOT NULL DEFAULT true,
    "allowChallengesFromStrangers" BOOLEAN NOT NULL DEFAULT true,
    "showOnlineStatus" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_privacy_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_settings" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "theme" "Theme" NOT NULL DEFAULT 'SYSTEM',
    "fontSize" "FontSize" NOT NULL DEFAULT 'NORMAL',
    "reduceMotion" BOOLEAN NOT NULL DEFAULT false,
    "language" TEXT NOT NULL DEFAULT 'en',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "quietHoursStart" TEXT NOT NULL DEFAULT '22:00',
    "quietHoursEnd" TEXT NOT NULL DEFAULT '08:00',
    "streakReminderEnabled" BOOLEAN NOT NULL DEFAULT true,
    "streakReminderTime" TEXT NOT NULL DEFAULT '19:00',
    "marketingConsent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "NotificationType" NOT NULL,
    "inApp" BOOLEAN NOT NULL,
    "push" BOOLEAN NOT NULL,
    "email" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_exports" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_exports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sim_showcase_snapshots" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "totalEquity" TEXT NOT NULL,
    "returnPct" DOUBLE PRECISION NOT NULL,
    "topHoldings" JSONB NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "computedDate" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sim_showcase_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_privacy_settings_userId_key" ON "user_privacy_settings"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_settings_userId_key" ON "user_settings"("userId");

-- CreateIndex
CREATE INDEX "notification_preferences_userId_idx" ON "notification_preferences"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_userId_type_key" ON "notification_preferences"("userId", "type");

-- CreateIndex
CREATE INDEX "data_exports_userId_requestedAt_idx" ON "data_exports"("userId", "requestedAt");

-- CreateIndex
CREATE UNIQUE INDEX "sim_showcase_snapshots_userId_key" ON "sim_showcase_snapshots"("userId");

-- AddForeignKey
ALTER TABLE "user_privacy_settings" ADD CONSTRAINT "user_privacy_settings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_exports" ADD CONSTRAINT "data_exports_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sim_showcase_snapshots" ADD CONSTRAINT "sim_showcase_snapshots_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

