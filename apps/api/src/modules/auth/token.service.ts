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
    };
  }

  /** Signs an access token. Phase 1 login will be the real caller. */
  signAccessToken(user: RequestUser): string {
    return jwt.sign({ email: user.email, roles: user.roles }, this.config.JWT_SECRET, {
      algorithm: 'HS256',
      subject: user.sub,
      expiresIn: this.config.JWT_ACCESS_TTL_SECONDS,
    });
  }
}
