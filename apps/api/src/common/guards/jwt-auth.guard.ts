import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { AppError } from '../errors/app-error';
import { IS_PUBLIC_KEY } from '../decorators/route.decorators';
import { RequestUser } from '../decorators/current-user.decorator';
import { TokenService } from '../../modules/auth/token.service';

/**
 * JwtAuthGuard — blueprint §9 step 6.
 * Verifies the access JWT and attaches the user to the request.
 * Routes marked @Public() are open; EVERYTHING else requires auth by default.
 *
 * Phase 0 is plumbing: token issuance/rotation (login, refresh) arrives
 * with the Auth module in Phase 1. TokenService here only verifies.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      // Opportunistic auth (ADR 0004): on public routes a valid Bearer token
      // still attaches the user, so personalized fields (progress, placement
      // waivers) work for signed-in callers. Absent/invalid tokens are
      // ignored — the route stays public.
      const req = context.switchToHttp().getRequest<Request & { user?: RequestUser }>();
      const header = req.headers.authorization;
      if (header && header.startsWith('Bearer ')) {
        const token = header.slice('Bearer '.length).trim();
        if (token) {
          try {
            req.user = await this.tokens.verifyAccessToken(token);
          } catch {
            // Ignore — public route, no user attached.
          }
        }
      }
      return true;
    }

    const req = context.switchToHttp().getRequest<Request & { user?: RequestUser }>();
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      throw AppError.unauthorized();
    }
    const token = header.slice('Bearer '.length).trim();
    if (!token) throw AppError.unauthorized();

    try {
      req.user = await this.tokens.verifyAccessToken(token);
      return true;
    } catch {
      // Generic message — never reveal why a token failed (no user enumeration).
      throw AppError.unauthorized();
    }
  }
}
