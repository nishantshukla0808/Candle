import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { User } from '@prisma/client';
import { AppError } from '../../common/errors/app-error';
import { AppLogger } from '../../common/services/logger.service';
import { CONFIG } from '../../config/config.module';
import type { AppConfig } from '../../config/configuration';
import type { TxClient } from '../../database/tx-client';
import { AuthRepository } from './auth.repository';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';

export interface TokenPair {
  accessToken: string;
  /** Raw refresh token — the caller sets it as an httpOnly cookie. */
  refreshToken: string;
  refreshExpiresAt: Date;
}

/**
 * RefreshTokenService — rotating refresh tokens (blueprint §11).
 *
 * - Refresh tokens are opaque random strings; only the SHA-256 hash is stored.
 * - Rotation: presenting a valid token revokes it and issues a new token in
 *   the SAME family.
 * - Reuse detection: presenting an already-rotated token revokes the WHOLE
 *   family and forces re-login (possible token theft).
 * - Password reset revokes all of the user's families.
 */
@Injectable()
export class RefreshTokenService {
  constructor(
    private readonly repo: AuthRepository,
    private readonly tokens: TokenService,
    private readonly passwords: PasswordService,
    private readonly logger: AppLogger,
    @Inject(CONFIG) private readonly config: AppConfig
  ) {}

  /** Issues a fresh family (first login / registration auto-login). */
  async issuePair(user: User, tx?: TxClient): Promise<TokenPair> {
    const raw = this.passwords.generateToken();
    const familyId = randomUUID();
    const refreshExpiresAt = new Date(Date.now() + this.config.JWT_REFRESH_TTL_SECONDS * 1000);
    await this.repo.createRefreshToken(
      {
        userId: user.id,
        familyId,
        tokenHash: this.passwords.hashToken(raw),
        expiresAt: refreshExpiresAt,
      },
      tx
    );
    return {
      accessToken: this.tokens.signAccessToken({
        sub: user.id,
        email: user.email,
        roles: user.roles,
      }),
      refreshToken: raw,
      refreshExpiresAt,
    };
  }

  /**
   * Rotates the presented refresh token. Returns the new pair.
   * Throws generic UNAUTHORIZED on any failure (no reason leaked).
   */
  async rotate(presented: string, tx?: TxClient): Promise<TokenPair> {
    const row = await this.repo.findRefreshTokenByHash(this.passwords.hashToken(presented), tx);
    if (!row || row.revokedAt || row.expiresAt.getTime() < Date.now()) {
      // Possible reuse of a rotated token: kill the whole family.
      if (row?.revokedAt) {
        await this.repo.revokeFamily(row.familyId, tx);
        this.logger.warn('Refresh token reuse detected; family revoked', {
          familyId: row.familyId,
        });
      }
      throw AppError.unauthorized('Session expired. Please log in again.');
    }
    await this.repo.revokeRefreshToken(row.id, tx);
    const raw = this.passwords.generateToken();
    const refreshExpiresAt = new Date(Date.now() + this.config.JWT_REFRESH_TTL_SECONDS * 1000);
    await this.repo.createRefreshToken(
      {
        userId: row.userId,
        familyId: row.familyId,
        tokenHash: this.passwords.hashToken(raw),
        expiresAt: refreshExpiresAt,
      },
      tx
    );
    return {
      accessToken: this.tokens.signAccessToken({
        sub: row.user.id,
        email: row.user.email,
        roles: row.user.roles,
      }),
      refreshToken: raw,
      refreshExpiresAt,
    };
  }

  /** Revokes the presented token (logout). Unknown tokens are a no-op. */
  async revoke(presented: string | undefined, tx?: TxClient): Promise<void> {
    if (!presented) return;
    const row = await this.repo.findRefreshTokenByHash(this.passwords.hashToken(presented), tx);
    if (row && !row.revokedAt) {
      await this.repo.revokeRefreshToken(row.id, tx);
    }
  }

  /** Revokes every family for the user (password reset). */
  async revokeAllForUser(userId: string, tx?: TxClient): Promise<void> {
    await this.repo.revokeAllUserRefreshTokens(userId, tx);
  }
}
