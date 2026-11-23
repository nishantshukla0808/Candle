import { Injectable } from '@nestjs/common';
import { FontSize, NotificationType, Theme } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import type { TxClient } from '../../database/tx-client';

/**
 * SettingsRepository — the ONLY file that touches Prisma for settings
 * (blueprint §4). Methods accept an optional transaction client
 * (ADR 0002/9).
 *
 * Owns: UserSettings, NotificationPreference, DataExport, and the
 * deletion fields on User. Sessions and passwords live in the auth
 * module (AuthRepository / PasswordService) — this repository never
 * touches refresh_tokens or password hashes. The hard-delete purge
 * reassigns rating rows to the tombstone user before deleting the
 * User row, so leaderboard history survives anonymised (docs/06
 * §2.6, ADR 0015 §8).
 */

export interface SettingsUserRow {
  id: string;
  email: string;
  displayName: string | null;
  deletedAt: Date | null;
  deletionRequestedAt: Date | null;
  deletionScheduledAt: Date | null;
}

export interface UserSettingsRow {
  userId: string;
  theme: Theme;
  fontSize: FontSize;
  reduceMotion: boolean;
  language: string;
  timezone: string;
  quietHoursStart: string;
  quietHoursEnd: string;
  streakReminderEnabled: boolean;
  streakReminderTime: string;
  marketingConsent: boolean;
}

export type SettingsPatch = Partial<Omit<UserSettingsRow, 'userId'>>;

export interface NotificationPrefRow {
  userId: string;
  type: NotificationType;
  inApp: boolean;
  push: boolean;
  email: boolean;
}

export interface DataExportRow {
  id: string;
  userId: string;
  requestedAt: Date;
}

/** The anonymised tombstone for purged accounts (docs/06 §2.6). */
export const DELETED_USER_EMAIL = 'deleted-user@candle.invalid';
export const DELETED_USER_DISPLAY_NAME = 'Deleted user';

@Injectable()
export class SettingsRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: TxClient): TxClient {
    return tx ?? this.prisma;
  }

  // --- settings user row ----------------------------------------------------------

  findSettingsUser(id: string, tx?: TxClient): Promise<SettingsUserRow | null> {
    return this.db(tx).user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        displayName: true,
        deletedAt: true,
        deletionRequestedAt: true,
        deletionScheduledAt: true,
      },
    });
  }

  // --- user settings ----------------------------------------------------------------

  async getOrCreateSettings(userId: string, tx?: TxClient): Promise<UserSettingsRow> {
    const client = this.db(tx);
    const existing = await client.userSettings.findUnique({ where: { userId } });
    if (existing) return toSettingsRow(existing);
    const created = await client.userSettings.create({ data: { userId } });
    return toSettingsRow(created);
  }

  async updateSettings(
    userId: string,
    patch: SettingsPatch,
    tx?: TxClient
  ): Promise<UserSettingsRow> {
    await this.getOrCreateSettings(userId, tx);
    const updated = await this.db(tx).userSettings.update({ where: { userId }, data: patch });
    return toSettingsRow(updated);
  }

  // --- notification preferences ------------------------------------------------------

  listNotificationPrefs(userId: string, tx?: TxClient): Promise<NotificationPrefRow[]> {
    return this.db(tx).notificationPreference.findMany({
      where: { userId },
      select: { userId: true, type: true, inApp: true, push: true, email: true },
    });
  }

  async upsertNotificationPref(
    userId: string,
    type: NotificationType,
    channels: { inApp?: boolean; push?: boolean; email?: boolean },
    defaults: { inApp: boolean; push: boolean; email: boolean },
    tx?: TxClient
  ): Promise<NotificationPrefRow> {
    const client = this.db(tx);
    const existing = await client.notificationPreference.findUnique({
      where: { userId_type: { userId, type } },
    });
    const data = {
      inApp: channels.inApp ?? existing?.inApp ?? defaults.inApp,
      push: channels.push ?? existing?.push ?? defaults.push,
      email: channels.email ?? existing?.email ?? defaults.email,
    };
    const saved = await client.notificationPreference.upsert({
      where: { userId_type: { userId, type } },
      create: { userId, type, ...data },
      update: data,
      select: { userId: true, type: true, inApp: true, push: true, email: true },
    });
    return saved;
  }

  // --- data export ---------------------------------------------------------------------

  async createDataExport(userId: string, tx?: TxClient): Promise<DataExportRow> {
    return this.db(tx).dataExport.create({
      data: { userId },
      select: { id: true, userId: true, requestedAt: true },
    });
  }

  findLastDataExport(userId: string, tx?: TxClient): Promise<DataExportRow | null> {
    return this.db(tx).dataExport.findFirst({
      where: { userId },
      orderBy: { requestedAt: 'desc' },
      select: { id: true, userId: true, requestedAt: true },
    });
  }

  // --- account deletion ------------------------------------------------------------------

  async requestDeletion(
    userId: string,
    requestedAt: Date,
    scheduledAt: Date,
    tx?: TxClient
  ): Promise<SettingsUserRow> {
    return this.db(tx).user.update({
      where: { id: userId },
      data: {
        deletedAt: requestedAt,
        deletionRequestedAt: requestedAt,
        deletionScheduledAt: scheduledAt,
      },
      select: {
        id: true,
        email: true,
        displayName: true,
        deletedAt: true,
        deletionRequestedAt: true,
        deletionScheduledAt: true,
      },
    });
  }

  async cancelDeletion(userId: string, tx?: TxClient): Promise<SettingsUserRow> {
    return this.db(tx).user.update({
      where: { id: userId },
      data: { deletedAt: null, deletionRequestedAt: null, deletionScheduledAt: null },
      select: {
        id: true,
        email: true,
        displayName: true,
        deletedAt: true,
        deletionRequestedAt: true,
        deletionScheduledAt: true,
      },
    });
  }

  /** Users whose 30-day grace has expired and are awaiting hard-delete. */
  findUsersPendingPurge(now: Date, tx?: TxClient): Promise<Array<{ id: string }>> {
    return this.db(tx).user.findMany({
      where: { deletedAt: { not: null }, deletionScheduledAt: { lte: now } },
      select: { id: true },
    });
  }

  /**
   * The single tombstone user. It can never log in: its email is a
   * reserved .invalid address and its password hash is not a valid
   * Argon2id hash, so PasswordService.verify always returns false.
   */
  async findOrCreateTombstoneUser(tx?: TxClient): Promise<{ id: string }> {
    const client = this.db(tx);
    const existing = await client.user.findUnique({ where: { email: DELETED_USER_EMAIL } });
    if (existing) return { id: existing.id };
    const created = await client.user.create({
      data: {
        email: DELETED_USER_EMAIL,
        passwordHash: 'deleted-user-no-login',
        displayName: DELETED_USER_DISPLAY_NAME,
      },
    });
    return { id: created.id };
  }

  /**
   * Anonymises one user's rating rows onto the tombstone, for
   * leaderboard integrity (docs/06 §2.6). RatingHistory rows move
   * freely (their PK is the row id). UserRating rows are one per
   * (user, kind): when the tombstone already holds that kind, the
   * incoming row is dropped instead — the tombstone keeps the first.
   */
  async reassignUserRatings(userId: string, tombstoneId: string, tx?: TxClient): Promise<void> {
    const client = this.db(tx);
    await client.ratingHistory.updateMany({
      where: { userId },
      data: { userId: tombstoneId },
    });
    const kinds = await client.userRating.findMany({
      where: { userId },
      select: { kind: true },
    });
    for (const { kind } of kinds) {
      const tombstoneHas = await client.userRating.findUnique({
        where: { userId_kind: { userId: tombstoneId, kind } },
      });
      if (tombstoneHas) {
        await client.userRating.delete({ where: { userId_kind: { userId, kind } } });
      } else {
        await client.userRating.update({
          where: { userId_kind: { userId, kind } },
          data: { userId: tombstoneId },
        });
      }
    }
  }

  /** Deletes the User row. Everything else personal cascades with it. */
  async deleteUserById(userId: string, tx?: TxClient): Promise<void> {
    await this.db(tx).user.delete({ where: { id: userId } });
  }
}

function toSettingsRow(row: {
  userId: string;
  theme: Theme;
  fontSize: FontSize;
  reduceMotion: boolean;
  language: string;
  timezone: string;
  quietHoursStart: string;
  quietHoursEnd: string;
  streakReminderEnabled: boolean;
  streakReminderTime: string;
  marketingConsent: boolean;
}): UserSettingsRow {
  return {
    userId: row.userId,
    theme: row.theme,
    fontSize: row.fontSize,
    reduceMotion: row.reduceMotion,
    language: row.language,
    timezone: row.timezone,
    quietHoursStart: row.quietHoursStart,
    quietHoursEnd: row.quietHoursEnd,
    streakReminderEnabled: row.streakReminderEnabled,
    streakReminderTime: row.streakReminderTime,
    marketingConsent: row.marketingConsent,
  };
}
