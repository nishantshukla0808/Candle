import { Inject, Injectable } from '@nestjs/common';
import { Readable } from 'node:stream';
import { AppError } from '../../common/errors/app-error';
import { AppLogger } from '../../common/services/logger.service';
import { StorageService, type UploadPolicy } from '../../common/services/storage.service';
import { CONFIG } from '../../config/config.module';
import type { AppConfig } from '../../config/configuration';
import {
  ProfilesService,
  type OwnerProfileView,
  type PublicProfileView,
} from '../profiles/profiles.service';
import { UpdateProfileDto } from './dto/users.dto';
import { UsersRepository } from './users.repository';

/**
 * UsersService — avatar upload + profile delegation (blueprint §4/§10).
 *
 * The profile itself lives in the profiles module (Phase 13): GET
 * /users/me, PATCH /users/me, and GET /users/:id delegate to
 * ProfilesService, which owns privacy filtering, the career title,
 * duel history, and the simulator showcase. This service keeps only
 * avatar handling. Ownership: mutations are on /users/me, so user A
 * can never touch user B's profile by changing an ID (blueprint §11).
 *
 * Country (ADR 0015 §2): locked after signup (decision 4). The
 * country-change code and its 90-day cooldown are GONE from this
 * service — PATCH /users/me rejects countryCode at the boundary —
 * and RatingsService.syncCountry is now dormant (kept for a future
 * admin correction flow, if one is ever approved).
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly users: UsersRepository,
    private readonly storage: StorageService,
    private readonly logger: AppLogger,
    private readonly profiles: ProfilesService,
    @Inject(CONFIG) private readonly config: AppConfig
  ) {}

  /** GET /users/me — the full owner profile (profiles module). */
  getMe(id: string): Promise<OwnerProfileView> {
    return this.profiles.getMyProfile(id);
  }

  /** GET /users/:id — the public profile, privacy-filtered server-side. */
  getPublicUser(viewerId: string | null, id: string): Promise<PublicProfileView> {
    return this.profiles.getPublicProfile(viewerId, id);
  }

  /** PATCH /users/me — display name + bio only (country is locked). */
  updateMe(id: string, dto: UpdateProfileDto): Promise<OwnerProfileView> {
    return this.profiles.updateMyProfile(id, dto);
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
   * after the new one is safely stored. Returns the owner profile.
   */
  async setAvatar(id: string, buffer: Buffer): Promise<OwnerProfileView> {
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
