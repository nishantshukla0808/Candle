import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Minimal authenticated-user shape attached by JwtAuthGuard.
 * Phase 0 plumbing only — the full user profile arrives in Phase 1.
 */
export interface RequestUser {
  sub: string; // user id (JWT subject)
  email?: string;
  roles: string[];
}

/** Extracts the authenticated user (or a field of it) from the request. */
export const CurrentUser = createParamDecorator(
  (field: keyof RequestUser | undefined, ctx: ExecutionContext): unknown => {
    const request = ctx.switchToHttp().getRequest<{ user?: RequestUser }>();
    const user = request.user;
    if (!user) return undefined;
    return field ? user[field] : user;
  }
);
