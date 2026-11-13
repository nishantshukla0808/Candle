import { Inject, Injectable } from '@nestjs/common';
import { Readable } from 'node:stream';
import { RATING_COUNTRY_CHANGE_COOLDOWN_DAYS } from '@candle/shared';
import { AppError } from '../../common/errors/app-error';
import { AppLogger } from '../../common/services/logger.service';
import { StorageService, type UploadPolicy } from '../../common/services/storage.service';
import { CONFIG } from '../../config/config.module';
import type { AppConfig } from '../../config/configuration';
import { RatingsService } from '../ratings/ratings.service';
import { UpdateProfileDto } from './dto/users.dto';
import { UserPrivateRow, UserPublicRow, UsersRepository } from './users.repository';

export interface ProfileResponse extends UserPrivateRow {
  /** URL the client can use to fetch the avatar (ownership-checked). */
  avatarUrl: string | null;
}

/**
 * UsersService — profile read/update + avatar upload (blueprint §4/§10).
 *
 * Ownership: every method here operates on the caller's own id. There is
 * no "update user X" — the route is /users/me, so user A can never touch
 * user B's profile by changing an ID (blueprint §11).
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly users: UsersRepository,
    private readonly storage: StorageService,
    private readonly logger: AppLogger,
    private readonly ratings: RatingsService,
    @Inject(CONFIG) private readonly config: AppConfig
  ) {}

  /** Legacy Phase 0 shape (id + email). Kept for compatibility. */
  getPublicProfile(id: string): Promise<{ id: string; email: string } | null> {
    return this.users.findById(id);
  }

  async getMe(id: string): Promise<ProfileResponse> {
    const row = await this.users.findPrivateById(id);
    if (!row) throw AppError.notFound('User not found.');
    return { ...row, avatarUrl: row.avatarKey ? '/api/v1/users/me/avatar' : null };
  }

  async getPublicUser(id: string): Promise<UserPublicRow> {
    const row = await this.users.findPublicById(id);
    if (!row) throw AppError.notFound('User not found.');
    return row;
  }

  async updateMe(id: string, dto: UpdateProfileDto): Promise<ProfileResponse> {
    const update: {
      displayName?: string | null;
      countryCode?: string | null;
      countryCodeChangedAt?: Date | null;
    } = {
      ...(dto.displayName !== undefined ? { displayName: dto.displayName.trim() || null } : {}),
    };
    let countryChanged: { oldCode: string | null; newCode: string } | null = null;
    if (dto.countryCode !== undefined) {
      // Country change rules (ADR 0005/8): a different code is allowed
      // once every 90 days; the first set is always allowed, and setting
      // the same code is a no-op (no cooldown consumed).
      const me = await this.users.findPrivateById(id);
      if (!me) throw AppError.notFound('User not found.');
      const newCode = dto.countryCode.toUpperCase();
      if (newCode !== me.countryCode) {
        const changedAt = me.countryCodeChangedAt;
        if (changedAt) {
          const daysSince = (Date.now() - changedAt.getTime()) / (24 * 60 * 60 * 1000);
          if (daysSince < RATING_COUNTRY_CHANGE_COOLDOWN_DAYS) {
            throw AppError.ratingCountryCooldown(
              `Country can only be changed once every ${RATING_COUNTRY_CHANGE_COOLDOWN_DAYS} days.`
            );
          }
        }
        update.countryCode = newCode;
        update.countryCodeChangedAt = new Date();
        countryChanged = { oldCode: me.countryCode, newCode };
      }
    }
    const row = await this.users.updateProfile(id, update);
    if (countryChanged) {
      // Keep the denormalised countryCode on rating rows truthful, and
      // move the user's national leaderboard membership (ADR 0005/8).
      await this.ratings.syncCountry(id, countryChanged.newCode, countryChanged.oldCode);
    }
    return { ...row, avatarUrl: row.avatarKey ? '/api/v1/users/me/avatar' : null };
  }

  private avatarPolicy(): UploadPolicy {
    return {
      maxBytes: this.config.AVATAR_MAX_MB * 1024 * 1024,
      allowedMimeTypes: this.config.avatarAllowedMimes,
      prefix: 'avatars',
    };
  }

  /**
   * Stores a new avatar: validated + stored via StorageService (§10),
   * old avatar deleted, key saved. The previous file is removed only
   * after the new one is safely stored.
   */
  async setAvatar(id: string, buffer: Buffer): Promise<ProfileResponse> {
    const me = await this.users.findPrivateById(id);
    if (!me) throw AppError.notFound('User not found.');
    const stored = await this.storage.save(Readable.from([buffer]), this.avatarPolicy());
    try {
      await this.users.setAvatarKey(id, stored.key);
    } catch (err) {
      // Don't orphan the file if the DB write fails.
      await this.storage.delete(stored.key).catch(() => undefined);
      throw err;
    }
    if (me.avatarKey) {
      await this.storage.delete(me.avatarKey).catch(() => undefined);
    }
    this.logger.info('Avatar updated', { userId: id, key: stored.key });
    return this.getMe(id);
  }

  /** Resolves the caller's avatar to a local path (dev storage). */
  async resolveOwnAvatarPath(id: string): Promise<string> {
    const me = await this.users.findPrivateById(id);
    if (!me?.avatarKey) throw AppError.notFound('No avatar set.');
    const path = this.storage.resolveLocalPath?.(me.avatarKey);
    if (!path) {
      throw AppError.serviceUnavailable('Avatar serving is not configured.');
    }
    return path;
  }

  /** Resolves any user's avatar to a local path (public avatars). */
  async resolvePublicAvatarPath(id: string): Promise<string> {
    const row = await this.users.findPublicById(id);
    if (!row?.avatarKey) throw AppError.notFound('No avatar set.');
    const path = this.storage.resolveLocalPath?.(row.avatarKey);
    if (!path) {
      throw AppError.serviceUnavailable('Avatar serving is not configured.');
    }
    return path;
  }
}
