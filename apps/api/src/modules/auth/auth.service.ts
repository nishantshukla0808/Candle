import { Inject, Injectable } from '@nestjs/common';
import { EmailTokenType, Role, type User } from '@prisma/client';
import { ErrorCode } from '@candle/shared';
import { AppError } from '../../common/errors/app-error';
import { AppLogger } from '../../common/services/logger.service';
import { RedisService } from '../../common/services/redis.service';
import { CONFIG } from '../../config/config.module';
import type { AppConfig } from '../../config/configuration';
import { TransactionService } from '../../database/transaction.service';
import {
  ForgotPasswordDto,
  LoginDto,
  PublicUser,
  RegisterDto,
  ResetPasswordDto,
} from './dto/auth.dto';
import { AuthRepository } from './auth.repository';
import { PasswordService } from './password.service';
import { RefreshTokenService, TokenPair } from './refresh-token.service';

/**
 * AuthService — Phase 1 authentication (blueprint §11).
 *
 * - Register: Argon2id hash, email verification required before login.
 * - Login: rate-limited by middleware (strict prefix /api/v1/auth),
 *   progressive delay on failure, generic "invalid credentials" —
 *   no user enumeration.
 * - Refresh: rotating families with reuse detection.
 * - Password reset: single-use hashed expiring tokens; resets revoke
 *   every refresh family ("log out everywhere").
 *
 * Dev note: email delivery doesn't exist in Phase 1, so the raw
 * verification/reset token is returned in the response in non-production
 * environments (clearly labeled). Production never returns it.
 */

const EMAIL_VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;
const LOGIN_FAIL_TTL_SECONDS = 15 * 60;

@Injectable()
export class AuthService {
  constructor(
    private readonly repo: AuthRepository,
    private readonly passwords: PasswordService,
    private readonly refreshTokens: RefreshTokenService,
    private readonly redis: RedisService,
    private readonly tx: TransactionService,
    private readonly logger: AppLogger,
    @Inject(CONFIG) private readonly config: AppConfig
  ) {}

  // --- registration ----------------------------------------------------------

  async register(dto: RegisterDto): Promise<{ user: PublicUser; devVerificationToken?: string }> {
    const email = dto.email.trim().toLowerCase();
    this.passwords.validatePolicy(dto.password);
    const existing = await this.repo.findUserByEmail(email);
    if (existing) {
      throw new AppError(ErrorCode.CONFLICT, 409, 'An account with this email already exists.');
    }
    const passwordHash = await this.passwords.hash(dto.password);
    const roles: Role[] = this.config.adminSeedEmails.includes(email)
      ? [Role.USER, Role.ADMIN]
      : [Role.USER];

    const rawToken = this.passwords.generateToken();
    const user = await this.tx.run(async (t) => {
      const created = await this.repo.createUser(
        { email, passwordHash, displayName: dto.displayName?.trim() || undefined, roles },
        t
      );
      await this.repo.createEmailToken(
        {
          userId: created.id,
          type: EmailTokenType.EMAIL_VERIFY,
          tokenHash: this.passwords.hashToken(rawToken),
          expiresAt: new Date(Date.now() + EMAIL_VERIFY_TTL_MS),
        },
        t
      );
      return created;
    });

    this.logger.info('User registered', { userId: user.id });
    return {
      user: toPublicUser(user),
      ...(this.config.isProduction ? {} : { devVerificationToken: rawToken }),
    };
  }

  async verifyEmail(rawToken: string): Promise<{ user: PublicUser }> {
    const row = await this.repo.findValidEmailToken(
      this.passwords.hashToken(rawToken),
      EmailTokenType.EMAIL_VERIFY
    );
    if (!row) {
      throw AppError.unauthorized('This verification link is invalid or has expired.');
    }
    await this.tx.run(async (t) => {
      await this.repo.setEmailVerified(row.userId, t);
      await this.repo.markEmailTokenUsed(row.id, t);
      await this.repo.deleteEmailTokens(row.userId, EmailTokenType.EMAIL_VERIFY, t);
    });
    const user = await this.repo.findUserById(row.userId);
    // findValidEmailToken guarantees the user exists (FK); guard for types.
    if (!user) throw AppError.unauthorized('This verification link is invalid or has expired.');
    this.logger.info('Email verified', { userId: user.id });
    return { user: toPublicUser(user) };
  }

  // --- login / logout / refresh ------------------------------------------------

  async login(
    dto: LoginDto,
    userAgent?: string | null
  ): Promise<{ user: PublicUser; pair: TokenPair }> {
    const email = dto.email.trim().toLowerCase();
    const user = await this.repo.findUserByEmail(email);
    if (!user || !(await this.passwords.verify(dto.password, user.passwordHash))) {
      await this.failedLogin(email);
    }
    // `user` is defined here: failedLogin always throws.
    const confirmed = user as User;
    // Phase 13 (docs/06 §2.6, ADR 0015 §8): a deactivated account
    // inside its 30-day grace cancels its deletion by logging in.
    // Past the grace the account is gone (the scheduler purges it)
    // and the login fails generically — never reveal why (no user
    // enumeration, blueprint §11).
    if (confirmed.deletedAt) {
      if (confirmed.deletionScheduledAt && confirmed.deletionScheduledAt.getTime() > Date.now()) {
        await this.repo.cancelDeletion(confirmed.id);
        this.logger.info('Account deletion cancelled by login during grace', {
          userId: confirmed.id,
        });
      } else {
        await this.failedLogin(email);
      }
    }
    if (!confirmed.emailVerifiedAt) {
      throw AppError.emailNotVerified();
    }
    await this.redis.del(loginFailKey(email));
    const pair = await this.refreshTokens.issuePair(confirmed, userAgent);
    this.logger.info('User logged in', { userId: confirmed.id });
    return { user: toPublicUser(confirmed), pair };
  }

  async refresh(presented: string | undefined, userAgent?: string | null): Promise<TokenPair> {
    if (!presented) throw AppError.unauthorized('Session expired. Please log in again.');
    return this.refreshTokens.rotate(presented, userAgent);
  }

  async logout(presented: string | undefined): Promise<void> {
    await this.refreshTokens.revoke(presented);
  }

  // --- password reset ------------------------------------------------------------

  async forgotPassword(dto: ForgotPasswordDto): Promise<{ devResetToken?: string }> {
    const email = dto.email.trim().toLowerCase();
    const user = await this.repo.findUserByEmail(email);
    let rawToken: string | undefined;
    if (user) {
      rawToken = this.passwords.generateToken();
      await this.tx.run(async (t) => {
        await this.repo.deleteEmailTokens(user.id, EmailTokenType.PASSWORD_RESET, t);
        await this.repo.createEmailToken(
          {
            userId: user.id,
            type: EmailTokenType.PASSWORD_RESET,
            tokenHash: this.passwords.hashToken(rawToken as string),
            expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
          },
          t
        );
      });
      this.logger.info('Password reset requested', { userId: user.id });
    }
    // Always 200 — never reveal whether the email is registered (§11).
    return this.config.isProduction || !rawToken ? {} : { devResetToken: rawToken };
  }

  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    this.passwords.validatePolicy(dto.newPassword);
    const row = await this.repo.findValidEmailToken(
      this.passwords.hashToken(dto.token),
      EmailTokenType.PASSWORD_RESET
    );
    if (!row) {
      throw AppError.unauthorized('This reset link is invalid or has expired.');
    }
    const passwordHash = await this.passwords.hash(dto.newPassword);
    await this.tx.run(async (t) => {
      await this.repo.updatePassword(row.userId, passwordHash, t);
      await this.repo.markEmailTokenUsed(row.id, t);
      await this.repo.deleteEmailTokens(row.userId, EmailTokenType.PASSWORD_RESET, t);
      // Log out everywhere: every refresh family is revoked.
      await this.repo.revokeAllUserRefreshTokens(row.userId, t);
    });
    this.logger.info('Password reset completed', { userId: row.userId });
  }

  // --- helpers ---------------------------------------------------------------------

  /**
   * Progressive delay on failed login (blueprint §11): each consecutive
   * failure for an email doubles the wait, capped at 4s. Always throws the
   * same generic error — no user enumeration.
   */
  private async failedLogin(email: string): Promise<never> {
    const key = loginFailKey(email);
    let fails = 1;
    try {
      fails = await this.redis.incr(key);
      await this.redis.expire(key, LOGIN_FAIL_TTL_SECONDS);
    } catch {
      // Redis down: fail closed on delay, still reject the login.
    }
    const delayMs = Math.min(250 * 2 ** Math.min(fails - 1, 4), 4000);
    await new Promise((r) => setTimeout(r, delayMs));
    throw AppError.unauthorized('Invalid email or password.');
  }
}

function loginFailKey(email: string): string {
  return `login:fail:${email}`;
}

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    roles: user.roles,
    emailVerified: user.emailVerifiedAt !== null,
  };
}
