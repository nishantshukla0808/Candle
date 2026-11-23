import { Injectable } from '@nestjs/common';
import { NotificationType } from '@prisma/client';
import {
  NOTIFICATION_DEFAULTS,
  NOTIFICATION_TYPES,
  SETTINGS_DELETE_GRACE_DAYS,
  SETTINGS_EXPORT_DAILY_LIMIT,
  SETTINGS_LANGUAGES,
} from '@candle/shared';
import { AppError } from '../../common/errors/app-error';
import { AppLogger } from '../../common/services/logger.service';
import { TransactionService } from '../../database/transaction.service';
import { AuditService } from '../admin/audit.service';
import { AuthRepository } from '../auth/auth.repository';
import { PasswordService } from '../auth/password.service';
import { RefreshTokenService } from '../auth/refresh-token.service';
import { ProfilesService } from '../profiles/profiles.service';
import { isValidHHMM, isValidTimezone } from './quiet-hours';
import type {
  ChangePasswordDto,
  DeleteAccountDto,
  UpdateNotificationDto,
  UpdateSettingsDto,
} from './dto/settings.dto';
import { SettingsRepository, type UserSettingsRow } from './settings.repository';

/**
 * SettingsService — docs/06 §2, docs/18, ADR 0015.
 *
 * Account, security (sessions over the existing refresh-token
 * families), notifications, appearance, language + timezone, and
 * DPDP export/delete. 2FA, login history, change-email, and blocked
 * users are DEFERRED (ADR 0015 §10) — they are recorded in the ADR,
 * not built here.
 *
 * Password policy (ADR 0015 §6): the platform policy governs
 * (PasswordService — min 12 chars, upper + lower + digit + symbol,
 * common-password denylist), the same policy as registration and
 * reset. The task text's "min 8, letter + number" is the shorthand
 * for that policy's floor, not a weaker rule for this endpoint: a
 * password change must never let a user downgrade their security.
 */

export interface SessionView {
  familyId: string;
  /** User-Agent recorded when the family was created / last rotated. */
  userAgent: string | null;
  createdAt: Date;
  /** Last rotation in the family — the last time the device was active. */
  lastActiveAt: Date;
  expiresAt: Date;
  /** True when this family issued the caller's current refresh cookie. */
  isCurrent: boolean;
}

export interface NotificationPreferenceView {
  type: NotificationType;
  inApp: boolean;
  push: boolean;
  email: boolean;
  /** True when the user never changed this type (the default applies). */
  isDefault: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class SettingsService {
  constructor(
    private readonly repo: SettingsRepository,
    private readonly profiles: ProfilesService,
    private readonly authRepo: AuthRepository,
    private readonly passwords: PasswordService,
    private readonly refreshTokens: RefreshTokenService,
    private readonly transactions: TransactionService,
    private readonly audit: AuditService,
    private readonly logger: AppLogger
  ) {}

  // --- account / appearance / language / timezone ----------------------------------

  async getSettings(userId: string): Promise<{
    email: string;
    displayName: string | null;
    settings: UserSettingsRow;
    deletion: { requestedAt: Date; scheduledAt: Date } | null;
  }> {
    const user = await this.loadUser(userId);
    const settings = await this.repo.getOrCreateSettings(userId);
    return {
      email: user.email,
      displayName: user.displayName,
      settings,
      deletion:
        user.deletionRequestedAt && user.deletionScheduledAt
          ? { requestedAt: user.deletionRequestedAt, scheduledAt: user.deletionScheduledAt }
          : null,
    };
  }

  async updateSettings(userId: string, dto: UpdateSettingsDto): Promise<UserSettingsRow> {
    await this.loadUser(userId);
    const issues: Array<{ field: string; issue: string }> = [];
    if (
      dto.language !== undefined &&
      !(SETTINGS_LANGUAGES as readonly string[]).includes(dto.language)
    ) {
      issues.push({
        field: 'language',
        issue: `Language must be one of: ${SETTINGS_LANGUAGES.join(', ')}.`,
      });
    }
    if (dto.timezone !== undefined && !isValidTimezone(dto.timezone)) {
      issues.push({ field: 'timezone', issue: 'Timezone must be a valid IANA timezone name.' });
    }
    for (const field of ['quietHoursStart', 'quietHoursEnd', 'streakReminderTime'] as const) {
      if (dto[field] !== undefined && !isValidHHMM(dto[field])) {
        issues.push({ field, issue: `${field} must be a time like "22:00".` });
      }
    }
    if (issues.length > 0) throw AppError.validationFailed(issues);
    const patch: Record<string, unknown> = {};
    for (const key of [
      'theme',
      'fontSize',
      'reduceMotion',
      'language',
      'timezone',
      'quietHoursStart',
      'quietHoursEnd',
      'streakReminderEnabled',
      'streakReminderTime',
      'marketingConsent',
    ] as const) {
      if (dto[key] !== undefined) patch[key] = dto[key];
    }
    const saved = await this.repo.updateSettings(userId, patch);
    this.logger.info('Settings updated', { userId, fields: Object.keys(patch) });
    return saved;
  }

  // --- notifications -----------------------------------------------------------------

  async getNotifications(userId: string): Promise<NotificationPreferenceView[]> {
    await this.loadUser(userId);
    const rows = new Map((await this.repo.listNotificationPrefs(userId)).map((r) => [r.type, r]));
    return NOTIFICATION_TYPES.map((type) => {
      const row = rows.get(type);
      const defaults = NOTIFICATION_DEFAULTS[type];
      return {
        type,
        inApp: row?.inApp ?? defaults.inApp,
        push: row?.push ?? defaults.push,
        email: row?.email ?? defaults.email,
        isDefault: row === undefined,
      };
    });
  }

  async updateNotification(
    userId: string,
    dto: UpdateNotificationDto
  ): Promise<NotificationPreferenceView> {
    await this.loadUser(userId);
    if (dto.inApp === undefined && dto.push === undefined && dto.email === undefined) {
      throw AppError.validationFailed([
        { field: 'inApp', issue: 'Set at least one of inApp, push, or email.' },
      ]);
    }
    const saved = await this.repo.upsertNotificationPref(
      userId,
      dto.type,
      { inApp: dto.inApp, push: dto.push, email: dto.email },
      NOTIFICATION_DEFAULTS[dto.type]
    );
    return { ...saved, isDefault: false };
  }

  // --- sessions (over the existing refresh-token families) -----------------------------

  /**
   * Resolves the caller's current family from the presented refresh
   * token (the httpOnly cookie). Null when there is no cookie, the
   * token is unknown/revoked/expired, or it belongs to another user —
   * callers treat null as "no session to preserve".
   */
  async resolveCurrentFamily(
    userId: string,
    presentedRefreshToken: string | undefined
  ): Promise<string | null> {
    if (!presentedRefreshToken) return null;
    const row = await this.authRepo.findRefreshTokenByHash(
      this.passwords.hashToken(presentedRefreshToken)
    );
    if (!row || row.userId !== userId || row.revokedAt || row.expiresAt.getTime() < Date.now()) {
      return null;
    }
    return row.familyId;
  }

  /**
   * Resolve the current family from the access token's `fam` claim
   * (ADR 0015 §9). The claim is an identifier, never trusted on its
   * own: the family only counts as current while it still holds a
   * live (not revoked, not expired) refresh token for this user.
   * Returns null for a forged, revoked, expired, or pre-Phase-13
   * (claim-less) token — callers then fall back to the cookie, or
   * treat every session as revocable.
   */
  async resolveCurrentFamilyById(
    userId: string,
    familyId: string | undefined
  ): Promise<string | null> {
    if (!familyId) return null;
    const rows = await this.authRepo.listRefreshTokensByUser(userId);
    const live = rows.some(
      (r) => r.familyId === familyId && !r.revokedAt && r.expiresAt.getTime() >= Date.now()
    );
    return live ? familyId : null;
  }

  async listSessions(userId: string, currentFamilyId: string | null): Promise<SessionView[]> {
    await this.loadUser(userId);
    const rows = await this.authRepo.listRefreshTokensByUser(userId);
    const now = Date.now();
    const byFamily = new Map<string, typeof rows>();
    for (const row of rows) {
      // A family is a live session only while at least one token in it
      // is unrevoked and unexpired; fully revoked families are dead
      // sessions and are not listed.
      if (row.revokedAt || row.expiresAt.getTime() < now) continue;
      const list = byFamily.get(row.familyId) ?? [];
      list.push(row);
      byFamily.set(row.familyId, list);
    }
    const views: SessionView[] = [];
    for (const [familyId, family] of byFamily) {
      const sorted = [...family].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      const latest = sorted[sorted.length - 1];
      views.push({
        familyId,
        userAgent: latest?.userAgent ?? null,
        createdAt: sorted[0]?.createdAt ?? new Date(),
        lastActiveAt: latest?.createdAt ?? new Date(),
        expiresAt: new Date(Math.max(...family.map((r) => r.expiresAt.getTime()))),
        isCurrent: familyId === currentFamilyId,
      });
    }
    views.sort((a, b) => b.lastActiveAt.getTime() - a.lastActiveAt.getTime());
    return views;
  }

  async revokeSession(
    userId: string,
    familyId: string
  ): Promise<{ familyId: string; revoked: boolean }> {
    await this.loadUser(userId);
    const rows = await this.authRepo.listRefreshTokensByUser(userId);
    if (!rows.some((r) => r.familyId === familyId)) {
      throw AppError.settingsSessionNotFound('That session was not found.');
    }
    await this.authRepo.revokeFamily(familyId);
    this.logger.info('Session revoked', { userId, familyId });
    return { familyId, revoked: true };
  }

  async revokeAllOtherSessions(
    userId: string,
    currentFamilyId: string | null
  ): Promise<{ revokedFamilies: number; keptCurrent: boolean }> {
    await this.loadUser(userId);
    const before = await this.listSessions(userId, currentFamilyId);
    if (currentFamilyId) {
      await this.authRepo.revokeAllExceptFamily(userId, currentFamilyId);
      return {
        revokedFamilies: before.filter((s) => !s.isCurrent).length,
        keptCurrent: true,
      };
    }
    // No identifiable current session (no cookie): revoke everything
    // and say so — there is nothing to preserve.
    await this.refreshTokens.revokeAllForUser(userId);
    return { revokedFamilies: before.length, keptCurrent: false };
  }

  // --- password -------------------------------------------------------------------------

  /**
   * Change password (current + new). After the change, all OTHER
   * sessions are revoked — the current session stays signed in.
   * When the current session cannot be identified (no refresh
   * cookie), every session is revoked and the user signs in again.
   */
  async changePassword(
    userId: string,
    dto: ChangePasswordDto,
    currentFamilyId: string | null
  ): Promise<{ changed: boolean; otherSessionsRevoked: boolean }> {
    const user = await this.authRepo.findUserById(userId);
    if (!user || user.deletedAt) throw AppError.notFound('User not found.');
    if (!(await this.passwords.verify(dto.currentPassword, user.passwordHash))) {
      throw AppError.unauthorized('Current password is incorrect.');
    }
    this.passwords.validatePolicy(dto.newPassword);
    const passwordHash = await this.passwords.hash(dto.newPassword);
    await this.transactions.run(async (tx) => {
      await this.authRepo.updatePassword(userId, passwordHash, tx);
      if (currentFamilyId) {
        await this.authRepo.revokeAllExceptFamily(userId, currentFamilyId, tx);
      } else {
        await this.authRepo.revokeAllUserRefreshTokens(userId, tx);
      }
    });
    await this.audit.log({
      actorId: userId,
      action: 'account.password.changed',
      entityType: 'User',
      entityId: userId,
    });
    this.logger.info('Password changed', { userId });
    return { changed: true, otherSessionsRevoked: true };
  }

  // --- DPDP export / delete ------------------------------------------------------------------

  /**
   * Export my data (docs/06 §2.6): one button, max 1/day (rolling
   * 24 h). v1 generates the JSON synchronously and returns it inline
   * — no file is stored and there is no 7-day link yet (ADR 0015 §8).
   * Messages/posts are NOT included: those features do not exist yet.
   */
  async exportData(userId: string): Promise<Record<string, unknown>> {
    const user = await this.loadUser(userId);
    const last = await this.repo.findLastDataExport(userId);
    if (last && Date.now() - last.requestedAt.getTime() < SETTINGS_EXPORT_DAILY_LIMIT * DAY_MS) {
      throw AppError.settingsExportDailyLimit(
        'You can export your data at most once per day. Please try again tomorrow.'
      );
    }
    const record = await this.repo.createDataExport(userId);
    const [profile, ledger, settings, notifications] = await Promise.all([
      this.profiles.getMyProfile(userId),
      this.profiles.getExportLedger(userId),
      this.repo.getOrCreateSettings(userId),
      this.getNotifications(userId),
    ]);
    this.logger.info('Data exported', { userId, exportId: record.id });
    return {
      exportedAt: record.requestedAt.toISOString(),
      exportId: record.id,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        bio: profile.bio,
        countryCode: profile.countryCode,
        joinedMonth: profile.joinedMonth,
        careerTitle: profile.careerTitle,
      },
      profile,
      xpLedger: ledger.xpLedger,
      simulatorOrders: ledger.simulatorOrders,
      settings,
      notifications,
      disclaimer:
        'Educational purpose only — this is not investment advice. ' +
        'All trading is simulated with virtual money.',
    };
  }

  /**
   * Delete account, step 1 (docs/06 §2.6): password confirm, then
   * DEACTIVATED AT ONCE — profile hidden, no login, all sessions
   * revoked. The 30-day grace runs from now; login inside the grace
   * cancels the deletion (AuthService.login); after it, the future
   * scheduler job calls purgeExpiredDeletions (ADR 0015 §8).
   */
  async requestDeletion(
    userId: string,
    dto: DeleteAccountDto
  ): Promise<{ deletionRequestedAt: Date; deletionScheduledAt: Date }> {
    const user = await this.authRepo.findUserById(userId);
    if (!user) throw AppError.notFound('User not found.');
    // Already in grace (a still-valid access token can reach this for
    // up to 15 min after deactivation): that is a 409, not a 404.
    if (user.deletionRequestedAt) {
      throw AppError.settingsDeleteAlreadyRequested('Account deletion has already been requested.');
    }
    if (user.deletedAt) throw AppError.notFound('User not found.');
    if (!(await this.passwords.verify(dto.password, user.passwordHash))) {
      throw AppError.unauthorized('Incorrect password.');
    }
    const requestedAt = new Date();
    const scheduledAt = new Date(requestedAt.getTime() + SETTINGS_DELETE_GRACE_DAYS * DAY_MS);
    await this.transactions.run(async (tx) => {
      await this.repo.requestDeletion(userId, requestedAt, scheduledAt, tx);
      await this.authRepo.revokeAllUserRefreshTokens(userId, tx);
      await this.audit.log(
        {
          actorId: userId,
          action: 'account.deletion.requested',
          entityType: 'User',
          entityId: userId,
          after: { deletionRequestedAt: requestedAt, deletionScheduledAt: scheduledAt },
        },
        tx
      );
    });
    this.logger.info('Account deletion requested', { userId, scheduledAt });
    return { deletionRequestedAt: requestedAt, deletionScheduledAt: scheduledAt };
  }

  /** Cancel a deletion in its grace period (step 2 of docs/06 §2.6).
   * Loads the user WITHOUT the live-account guard: a deactivated
   * account is exactly the one that has a deletion to cancel. */
  async cancelDeletion(userId: string): Promise<{ cancelled: boolean }> {
    const user = await this.repo.findSettingsUser(userId);
    if (!user) throw AppError.notFound('User not found.');
    if (!user.deletionRequestedAt) {
      throw AppError.settingsDeleteNotRequested('No account deletion is in progress.');
    }
    await this.transactions.run(async (tx) => {
      await this.repo.cancelDeletion(userId, tx);
      await this.audit.log(
        {
          actorId: userId,
          action: 'account.deletion.cancelled',
          entityType: 'User',
          entityId: userId,
        },
        tx
      );
    });
    this.logger.info('Account deletion cancelled', { userId });
    return { cancelled: true };
  }

  /**
   * Hard-delete, called by the future scheduler (no HTTP endpoint in
   * v1 — docs/16 names the future cron `weekly-season-scheduler`;
   * the deletion job is its sibling, ADR 0015 §8). Exact rule: every
   * user whose deletionScheduledAt has passed is purged — their
   * rating rows are first anonymised onto the tombstone user
   * ("Deleted user") so leaderboard history survives, then the User
   * row is deleted and everything else personal cascades with it.
   */
  async purgeExpiredDeletions(now: Date = new Date()): Promise<{ purged: string[] }> {
    const candidates = await this.repo.findUsersPendingPurge(now);
    const purged: string[] = [];
    for (const { id } of candidates) {
      await this.transactions.run(async (tx) => {
        const tombstone = await this.repo.findOrCreateTombstoneUser(tx);
        await this.repo.reassignUserRatings(id, tombstone.id, tx);
        await this.repo.deleteUserById(id, tx);
        await this.audit.log(
          {
            actorId: id,
            action: 'account.deletion.purged',
            entityType: 'User',
            entityId: id,
          },
          tx
        );
      });
      purged.push(id);
      this.logger.info('Account purged after deletion grace', { userId: id });
    }
    return { purged };
  }

  // --- internals ----------------------------------------------------------------------------

  /** Settings reads/writes are for live accounts only (a deactivated
   * account's settings are unreachable — it cannot sign in). */
  private async loadUser(userId: string) {
    const user = await this.repo.findSettingsUser(userId);
    if (!user || user.deletedAt) throw AppError.notFound('User not found.');
    return user;
  }
}
