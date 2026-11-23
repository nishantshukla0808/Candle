import { Inject, Injectable } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { CONFIG } from '../../config/config.module';
import type { AppConfig } from '../../config/configuration';

/**
 * TokenService — auth plumbing (blueprint §11, Phase 0).
 *
 * Phase 0 scope: VERIFY access tokens only. Signing is exposed for tests
 * and future login flows; issuance, rotation, refresh-token families and
 * revocation lists arrive with the Auth module in Phase 1.
 */
@Injectable()
export class TokenService {
  constructor(@Inject(CONFIG) private readonly config: AppConfig) {}

  /** Verifies a Bearer access token and returns the attached user. */
  async verifyAccessToken(token: string): Promise<RequestUser> {
    const payload = jwt.verify(token, this.config.JWT_SECRET, {
      algorithms: ['HS256'],
    }) as jwt.JwtPayload;
    if (!payload.sub || typeof payload.sub !== 'string') {
      throw new Error('Token has no subject');
    }
    const roles = Array.isArray(payload.roles)
      ? payload.roles.filter((r): r is string => typeof r === 'string')
      : [];
    return {
      sub: payload.sub,
      ...(typeof payload.email === 'string' ? { email: payload.email } : {}),
      roles,
      // Phase 13 (ADR 0015 §9): the refresh family the token was issued
      // for, so settings routes can identify the current session.
      ...(typeof payload.fam === 'string' ? { familyId: payload.fam } : {}),
    };
  }

  /**
   * Signs an access token. Phase 1 login will be the real caller.
   *
   * `familyId` (Phase 13, ADR 0015 §9) is the refresh-token family the
   * token belongs to, carried as the `fam` claim. It is an identifier,
   * not a credential: it only ever identifies a session, and every use
   * is checked server-side against the stored family (still live, still
   * this user's). It lets the settings module keep the current session
   * on "revoke all others" / password change — the refresh cookie
   * cannot do that, because it is path-scoped to /api/v1/auth and is
   * never sent to /api/v1/settings/*.
   */
  signAccessToken(user: RequestUser, familyId?: string): string {
    return jwt.sign(
      { email: user.email, roles: user.roles, ...(familyId ? { fam: familyId } : {}) },
      this.config.JWT_SECRET,
      {
        algorithm: 'HS256',
        subject: user.sub,
        expiresIn: this.config.JWT_ACCESS_TTL_SECONDS,
      }
    );
  }
}
