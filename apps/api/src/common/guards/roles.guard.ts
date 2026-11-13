import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppError } from '../errors/app-error';
import { ROLES_KEY } from '../decorators/route.decorators';
import { RequestUser } from '../decorators/current-user.decorator';

/**
 * RolesGuard — blueprint §9 step 7 (skeleton).
 * Enforces @Roles('ADMIN') etc. Runs AFTER JwtAuthGuard, so req.user exists
 * on protected routes. No @Roles metadata = no role requirement.
 *
 * Guards are the gate; services still re-check ownership. The full
 * PermissionsGuard arrives with Phase 1 RBAC.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest<{ user?: RequestUser }>();
    const roles = req.user?.roles ?? [];
    const allowed = required.some((r) => roles.includes(r));
    if (!allowed) throw AppError.forbidden();
    return true;
  }
}
