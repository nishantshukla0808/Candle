import { SetMetadata } from '@nestjs/common';

/** Metadata keys used by guards/interceptors. */
export const IS_PUBLIC_KEY = 'candle:isPublic';
export const ROLES_KEY = 'candle:roles';
export const STRICT_DTO_KEY = 'candle:strictDto';
export const TIMEOUT_MS_KEY = 'candle:timeoutMs';

/**
 * Marks a route public. Everything else is authenticated by default
 * (blueprint §9 step 6).
 */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Requires one of the given roles. Checked by RolesGuard AFTER auth.
 * Guards are the gate; services re-check ownership (blueprint §9 step 7).
 */
export const Roles = (...roles: string[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES_KEY, roles);

/**
 * Marks an endpoint strict: unknown properties are REJECTED, not stripped
 * (blueprint §8 — auth, payments-like, admin).
 *
 * The DTO class is required so StrictValidationInterceptor can compare the
 * raw body keys against the DTO's decorated properties BEFORE the global
 * ValidationPipe strips them:
 *
 *   @Strict(EchoDto)
 *   @Post('strict') ...
 */
export const Strict = (dto: new (...args: never[]) => object): MethodDecorator & ClassDecorator =>
  SetMetadata(STRICT_DTO_KEY, dto);

/** Overrides the default request timeout for one route (blueprint §9 step 9). */
export const TimeoutMs = (ms: number): MethodDecorator & ClassDecorator =>
  SetMetadata(TIMEOUT_MS_KEY, ms);
