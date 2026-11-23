import { ErrorCode } from '@candle/shared';
import { AppError } from '../../common/errors/app-error';
import type { AppLogger } from '../../common/services/logger.service';
import type { TransactionService } from '../../database/transaction.service';
import type { AuditService } from '../admin/audit.service';
import type { AuthRepository } from '../auth/auth.repository';
import type { PasswordService } from '../auth/password.service';
import type { RefreshTokenService } from '../auth/refresh-token.service';
import type { ProfilesService } from '../profiles/profiles.service';
import { SettingsService } from './settings.service';
import { DELETED_USER_DISPLAY_NAME, DELETED_USER_EMAIL } from './settings.repository';

/**
 * SettingsService spec — service against in-memory fakes. Covers the
 * settings catalogue + validation, notification defaults, session
 * list/revoke, password change revoking other sessions, the 1/day
 * export limit, and the delete flows (deactivate, login-cancel is in
 * auth; purge with tombstone anonymisation).
 */

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER_USER = '22222222-2222-4222-8222-222222222222';
const DAY_MS = 24 * 60 * 60 * 1000;
const PASSWORD = 'Str0ng!Passphrase12';

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as AppLogger;

class FakeSettingsRepo {
  users = new Map<string, any>();
  settingsRows = new Map<string, any>();
  prefs = new Map<string, any>(); // `${userId}:${type}`
  exports: any[] = [];
  purgeCandidates: string[] = [];
  tombstoneId: string | null = null;
  ratingsReassigned: Array<{ from: string; to: string }> = [];
  deletedUsers: string[] = [];

  async findSettingsUser(id: string): Promise<any | null> {
    return this.users.get(id) ?? null;
  }

  async getOrCreateSettings(userId: string): Promise<any> {
    let row = this.settingsRows.get(userId);
    if (!row) {
      row = {
        userId,
        theme: 'SYSTEM',
        fontSize: 'NORMAL',
        reduceMotion: false,
        language: 'en',
        timezone: 'Asia/Kolkata',
        quietHoursStart: '22:00',
        quietHoursEnd: '08:00',
        streakReminderEnabled: true,
        streakReminderTime: '19:00',
        marketingConsent: false,
      };
      this.settingsRows.set(userId, row);
    }
    return { ...row };
  }

  async updateSettings(userId: string, patch: any): Promise<any> {
    const row = await this.getOrCreateSettings(userId);
    Object.assign(row, patch);
    this.settingsRows.set(userId, row);
    return { ...row };
  }

  async listNotificationPrefs(userId: string): Promise<any[]> {
    return [...this.prefs.values()].filter((p) => p.userId === userId);
  }

  async upsertNotificationPref(
    userId: string,
    type: string,
    channels: any,
    defaults: any
  ): Promise<any> {
    const key = `${userId}:${type}`;
    const existing = this.prefs.get(key);
    const row = {
      userId,
      type,
      inApp: channels.inApp ?? existing?.inApp ?? defaults.inApp,
      push: channels.push ?? existing?.push ?? defaults.push,
      email: channels.email ?? existing?.email ?? defaults.email,
    };
    this.prefs.set(key, row);
    return { ...row };
  }

  async createDataExport(userId: string): Promise<any> {
    const row = { id: `exp-${this.exports.length + 1}`, userId, requestedAt: new Date() };
    this.exports.push(row);
    return { ...row };
  }

  async findLastDataExport(userId: string): Promise<any | null> {
    const rows = this.exports.filter((e) => e.userId === userId);
    return rows.length > 0 ? { ...rows[rows.length - 1] } : null;
  }

  async requestDeletion(userId: string, requestedAt: Date, scheduledAt: Date): Promise<any> {
    const u = this.users.get(userId);
    Object.assign(u, {
      deletedAt: requestedAt,
      deletionRequestedAt: requestedAt,
      deletionScheduledAt: scheduledAt,
    });
    return { ...u };
  }

  async cancelDeletion(userId: string): Promise<any> {
    const u = this.users.get(userId);
    Object.assign(u, { deletedAt: null, deletionRequestedAt: null, deletionScheduledAt: null });
    return { ...u };
  }

  async findUsersPendingPurge(): Promise<Array<{ id: string }>> {
    return this.purgeCandidates.map((id) => ({ id }));
  }

  async findOrCreateTombstoneUser(): Promise<{ id: string }> {
    if (!this.tombstoneId) {
      this.tombstoneId = 'tombstone-id';
      this.users.set(this.tombstoneId, {
        id: this.tombstoneId,
        email: DELETED_USER_EMAIL,
        displayName: DELETED_USER_DISPLAY_NAME,
        deletedAt: null,
        deletionRequestedAt: null,
        deletionScheduledAt: null,
      });
    }
    return { id: this.tombstoneId };
  }

  async reassignUserRatings(userId: string, tombstoneId: string): Promise<void> {
    this.ratingsReassigned.push({ from: userId, to: tombstoneId });
  }

  async deleteUserById(userId: string): Promise<void> {
    this.deletedUsers.push(userId);
    this.users.delete(userId);
  }
}

class FakeAuthRepo {
  users = new Map<string, any>();
  tokens: any[] = []; // { familyId, userId, userAgent, createdAt, expiresAt, revokedAt }
  revokedAllFor: string[] = [];
  revokedExcept: Array<{ userId: string; familyId: string }> = [];
  passwordUpdates: Array<{ userId: string; hash: string }> = [];

  async findUserById(id: string): Promise<any | null> {
    return this.users.get(id) ?? null;
  }

  async findRefreshTokenByHash(hash: string): Promise<any | null> {
    const row = this.tokens.find((t) => t.tokenHash === hash);
    if (!row) return null;
    return { ...row, user: this.users.get(row.userId) ?? null };
  }

  async listRefreshTokensByUser(userId: string): Promise<any[]> {
    return this.tokens
      .filter((t) => t.userId === userId)
      .map((t) => ({ ...t, user: this.users.get(t.userId) ?? null }));
  }

  async revokeFamily(familyId: string): Promise<void> {
    for (const t of this.tokens) if (t.familyId === familyId) t.revokedAt = new Date();
  }

  async revokeAllExceptFamily(userId: string, familyId: string): Promise<void> {
    this.revokedExcept.push({ userId, familyId });
    for (const t of this.tokens) {
      if (t.userId === userId && t.familyId !== familyId) t.revokedAt = new Date();
    }
  }

  async revokeAllUserRefreshTokens(userId: string): Promise<void> {
    this.revokedAllFor.push(userId);
    for (const t of this.tokens) if (t.userId === userId) t.revokedAt = new Date();
  }

  async updatePassword(userId: string, passwordHash: string): Promise<void> {
    this.passwordUpdates.push({ userId, hash: passwordHash });
    const u = this.users.get(userId);
    if (u) u.passwordHash = passwordHash;
  }
}

const passwords = {
  hashToken: (raw: string): string => `hash:${raw}`,
  verify: async (plain: string, stored: string): Promise<boolean> => plain === stored,
  hash: async (plain: string): Promise<string> => `hashed:${plain}`,
  validatePolicy: (password: string): void => {
    const issues: string[] = [];
    if (password.length < 12) issues.push('Must be at least 12 characters.');
    if (!/[a-z]/.test(password)) issues.push('Must contain a lowercase letter.');
    if (!/[A-Z]/.test(password)) issues.push('Must contain an uppercase letter.');
    if (!/\d/.test(password)) issues.push('Must contain a digit.');
    if (!/[^a-zA-Z0-9]/.test(password)) issues.push('Must contain a symbol.');
    if (issues.length > 0) {
      throw AppError.validationFailed(issues.map((issue) => ({ field: 'password', issue })));
    }
  },
} as unknown as PasswordService;

function buildService() {
  const repo = new FakeSettingsRepo();
  const authRepo = new FakeAuthRepo();
  const refreshTokens = {
    revokeAllForUser: async (userId: string): Promise<void> => {
      await authRepo.revokeAllUserRefreshTokens(userId);
    },
  } as unknown as RefreshTokenService;
  const transactions = {
    run: async (fn: (tx: unknown) => Promise<any>): Promise<any> => fn({}),
  } as unknown as TransactionService;
  const auditLog: any[] = [];
  const audit = {
    log: jest.fn(async (input: any): Promise<void> => {
      auditLog.push(input);
    }),
  } as unknown as AuditService;
  const profiles = {
    getMyProfile: jest.fn(async (userId: string) => ({
      id: userId,
      displayName: 'Nishu',
      bio: null,
      countryCode: null,
      joinedMonth: 'Nov 2026',
      careerTitle: 'Intern',
    })),
    getExportLedger: jest.fn(async () => ({ xpLedger: [], simulatorOrders: [] })),
  } as unknown as ProfilesService;
  const service = new SettingsService(
    repo as any,
    profiles,
    authRepo as unknown as AuthRepository,
    passwords,
    refreshTokens,
    transactions,
    audit,
    logger
  );
  const user = {
    id: USER,
    email: 'nishu@example.com',
    displayName: 'Nishu',
    passwordHash: PASSWORD,
    deletedAt: null,
    deletionRequestedAt: null,
    deletionScheduledAt: null,
  };
  repo.users.set(USER, { ...user });
  // Same object reference in both fakes: in production both repos read
  // the same DB row, so a deletion stamped by one is visible to the other.
  authRepo.users.set(USER, repo.users.get(USER));
  return { service, repo, authRepo, auditLog };
}

function seedSession(
  authRepo: FakeAuthRepo,
  familyId: string,
  userAgent: string,
  ageMs: number,
  revoked = false
) {
  const now = Date.now();
  authRepo.tokens.push({
    id: `tok-${familyId}`,
    familyId,
    userId: USER,
    userAgent,
    tokenHash: `hash:${familyId}`,
    createdAt: new Date(now - ageMs),
    updatedAt: new Date(now - ageMs),
    expiresAt: new Date(now + 30 * DAY_MS),
    revokedAt: revoked ? new Date(now - 1000) : null,
  });
}

describe('SettingsService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('getSettings returns the documented defaults', async () => {
    const { service } = buildService();
    const got = await service.getSettings(USER);
    expect(got.email).toBe('nishu@example.com');
    expect(got.settings.theme).toBe('SYSTEM');
    expect(got.settings.timezone).toBe('Asia/Kolkata');
    expect(got.settings.quietHoursStart).toBe('22:00');
    expect(got.settings.quietHoursEnd).toBe('08:00');
    expect(got.settings.streakReminderTime).toBe('19:00');
    expect(got.settings.streakReminderEnabled).toBe(true);
    expect(got.settings.marketingConsent).toBe(false);
    expect(got.deletion).toBeNull();
  });

  it('updateSettings rejects a non-en language, a bad timezone, and a bad HH:MM', async () => {
    const { service } = buildService();
    await expect(service.updateSettings(USER, { language: 'hi' })).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_FAILED,
    });
    await expect(service.updateSettings(USER, { timezone: 'Mars/Olympus' })).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_FAILED,
    });
    await expect(service.updateSettings(USER, { quietHoursStart: '10pm' })).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_FAILED,
    });
    const saved = await service.updateSettings(USER, {
      theme: 'DARK',
      timezone: 'America/New_York',
      quietHoursStart: '23:00',
    });
    expect(saved.theme).toBe('DARK');
    expect(saved.timezone).toBe('America/New_York');
  });

  it('notifications return all 12 types with the documented defaults', async () => {
    const { service } = buildService();
    const prefs = await service.getNotifications(USER);
    expect(prefs).toHaveLength(12);
    const byType = new Map(prefs.map((p) => [p.type, p]));
    expect(byType.get('STREAK_REMINDER')).toMatchObject({
      inApp: false,
      push: true,
      email: false,
      isDefault: true,
    });
    expect(byType.get('PRODUCT_NEWS')).toMatchObject({ inApp: false, push: false, email: true });
    expect(byType.get('NEW_LESSON')).toMatchObject({ inApp: false, push: false, email: false });
    expect(byType.get('DUEL_INVITE')).toMatchObject({ inApp: true, push: true, email: false });
  });

  it('updating one notification type keeps the others at default', async () => {
    const { service } = buildService();
    const updated = await service.updateNotification(USER, { type: 'PRODUCT_NEWS', push: true });
    expect(updated).toMatchObject({
      type: 'PRODUCT_NEWS',
      push: true,
      email: true,
      isDefault: false,
    });
    await expect(
      service.updateNotification(USER, { type: 'DUEL_RESULT' as any })
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
  });

  it('resolveCurrentFamilyById trusts the fam claim only while the family has a live token', async () => {
    const { service, authRepo } = buildService();
    seedSession(authRepo, 'fam-live', 'Mozilla/5.0 Live', 60_000);
    seedSession(authRepo, 'fam-dead', 'Mozilla/5.0 Dead', DAY_MS, true);
    expect(await service.resolveCurrentFamilyById(USER, 'fam-live')).toBe('fam-live');
    expect(await service.resolveCurrentFamilyById(USER, 'fam-dead')).toBeNull(); // revoked
    expect(await service.resolveCurrentFamilyById(USER, 'fam-missing')).toBeNull();
    expect(await service.resolveCurrentFamilyById(USER, undefined)).toBeNull(); // pre-Phase-13 token
  });

  it('sessions group families, skip revoked ones, and mark the current family', async () => {
    const { service, authRepo } = buildService();
    seedSession(authRepo, 'fam-current', 'Mozilla/5.0 Current', 60_000);
    seedSession(authRepo, 'fam-old', 'Mozilla/5.0 Old', 2 * DAY_MS);
    seedSession(authRepo, 'fam-dead', 'Mozilla/5.0 Dead', DAY_MS, true);
    // A rotated family: two tokens, same family — one session, last active = newest.
    seedSession(authRepo, 'fam-rotated', 'Mozilla/5.0 Rot', 3 * DAY_MS);
    authRepo.tokens.push({
      id: 'tok-rot-2',
      familyId: 'fam-rotated',
      userId: USER,
      userAgent: 'Mozilla/5.0 Rot2',
      tokenHash: 'hash:rot2',
      createdAt: new Date(Date.now() - 30_000),
      updatedAt: new Date(Date.now() - 30_000),
      expiresAt: new Date(Date.now() + 30 * DAY_MS),
      revokedAt: null,
    });
    const sessions = await service.listSessions(USER, 'fam-current');
    // Sorted by last activity, most recent first (the rotated family
    // was active 30 s ago; the current one 60 s ago).
    expect(sessions.map((s) => s.familyId)).toEqual(['fam-rotated', 'fam-current', 'fam-old']);
    expect(sessions[0]).toMatchObject({ familyId: 'fam-rotated', userAgent: 'Mozilla/5.0 Rot2' });
    expect(sessions[1]).toMatchObject({ isCurrent: true, userAgent: 'Mozilla/5.0 Current' });
  });

  it('revoking an unknown session is a 404; revoking all others keeps the current family', async () => {
    const { service, authRepo } = buildService();
    seedSession(authRepo, 'fam-a', 'UA A', 60_000);
    seedSession(authRepo, 'fam-b', 'UA B', 2 * DAY_MS);
    await expect(service.revokeSession(USER, 'no-such-family')).rejects.toMatchObject({
      code: ErrorCode.SETTINGS_SESSION_NOT_FOUND,
    });
    const out = await service.revokeAllOtherSessions(USER, 'fam-a');
    expect(out).toEqual({ revokedFamilies: 1, keptCurrent: true });
    expect(authRepo.tokens.find((t) => t.familyId === 'fam-b')?.revokedAt).not.toBeNull();
    expect(authRepo.tokens.find((t) => t.familyId === 'fam-a')?.revokedAt).toBeNull();
  });

  it('password change with the wrong current password is a 401; success revokes only other sessions', async () => {
    const { service, authRepo } = buildService();
    seedSession(authRepo, 'fam-current', 'UA', 60_000);
    seedSession(authRepo, 'fam-other', 'UA', 2 * DAY_MS);
    await expect(
      service.changePassword(
        USER,
        { currentPassword: 'wrong', newPassword: 'N3w!StrongPassphrase' },
        'fam-current'
      )
    ).rejects.toMatchObject({ code: ErrorCode.UNAUTHORIZED });
    await expect(
      service.changePassword(
        USER,
        { currentPassword: PASSWORD, newPassword: 'short' },
        'fam-current'
      )
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
    const out = await service.changePassword(
      USER,
      { currentPassword: PASSWORD, newPassword: 'N3w!StrongPassphrase' },
      'fam-current'
    );
    expect(out).toEqual({ changed: true, otherSessionsRevoked: true });
    expect(authRepo.tokens.find((t) => t.familyId === 'fam-other')?.revokedAt).not.toBeNull();
    expect(authRepo.tokens.find((t) => t.familyId === 'fam-current')?.revokedAt).toBeNull();
    expect(authRepo.passwordUpdates).toHaveLength(1);
  });

  it('export is limited to 1/day (rolling 24 h)', async () => {
    const { service, repo } = buildService();
    const first = await service.exportData(USER);
    expect(first.exportId).toBeTruthy();
    expect((first as any).profile.careerTitle).toBe('Intern');
    await expect(service.exportData(USER)).rejects.toMatchObject({
      code: ErrorCode.SETTINGS_EXPORT_DAILY_LIMIT,
    });
    // A day later the limit resets.
    repo.exports[0].requestedAt = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await expect(service.exportData(USER)).resolves.toBeTruthy();
  });

  it('delete: wrong password is a 401; success deactivates + revokes all + schedules 30 days out', async () => {
    const { service, repo, authRepo, auditLog } = buildService();
    seedSession(authRepo, 'fam-a', 'UA', 60_000);
    await expect(service.requestDeletion(USER, { password: 'wrong' })).rejects.toMatchObject({
      code: ErrorCode.UNAUTHORIZED,
    });
    const out = await service.requestDeletion(USER, { password: PASSWORD });
    const user = repo.users.get(USER);
    expect(user.deletedAt).not.toBeNull();
    expect(out.deletionScheduledAt.getTime() - out.deletionRequestedAt.getTime()).toBe(30 * DAY_MS);
    expect(authRepo.tokens.find((t) => t.familyId === 'fam-a')?.revokedAt).not.toBeNull();
    expect(auditLog.some((a) => a.action === 'account.deletion.requested')).toBe(true);
    // A second request while the grace runs is a 409.
    await expect(service.requestDeletion(USER, { password: PASSWORD })).rejects.toMatchObject({
      code: ErrorCode.SETTINGS_DELETE_ALREADY_REQUESTED,
    });
  });

  it('cancel with no deletion in progress is a 409; cancel clears the deactivation', async () => {
    const { service, repo } = buildService();
    await expect(service.cancelDeletion(USER)).rejects.toMatchObject({
      code: ErrorCode.SETTINGS_DELETE_NOT_REQUESTED,
    });
    await service.requestDeletion(USER, { password: PASSWORD });
    const out = await service.cancelDeletion(USER);
    expect(out).toEqual({ cancelled: true });
    expect(repo.users.get(USER).deletedAt).toBeNull();
    expect(repo.users.get(USER).deletionScheduledAt).toBeNull();
  });

  it('purge anonymises ratings onto the tombstone, then deletes the user', async () => {
    const { service, repo } = buildService();
    repo.purgeCandidates = [USER, OTHER_USER];
    const out = await service.purgeExpiredDeletions(new Date());
    expect(out.purged).toEqual([USER, OTHER_USER]);
    expect(repo.ratingsReassigned).toEqual([
      { from: USER, to: 'tombstone-id' },
      { from: OTHER_USER, to: 'tombstone-id' },
    ]);
    expect(repo.deletedUsers).toEqual([USER, OTHER_USER]);
    expect(repo.users.get('tombstone-id')?.email).toBe(DELETED_USER_EMAIL);
  });
});
