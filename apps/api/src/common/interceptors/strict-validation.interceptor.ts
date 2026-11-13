import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { getMetadataStorage } from 'class-validator';
import { Observable } from 'rxjs';
import { AppError } from '../errors/app-error';
import { STRICT_DTO_KEY } from '../decorators/route.decorators';

/**
 * StrictValidationInterceptor — blueprint §8, strict endpoints.
 *
 * The global ValidationPipe strips unknown properties (whitelist). On
 * strict endpoints (auth, payments-like, admin) unknown properties must
 * be REJECTED instead. Pipes can't do this — the global pipe runs first
 * and strips them — so strictness is enforced here, BEFORE pipes run,
 * by comparing the raw body keys against the DTO's decorated properties.
 *
 * Usage: `@Strict(EchoDto)` on the route.
 */
@Injectable()
export class StrictValidationInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const dto = this.reflector.getAllAndOverride<new (...args: never[]) => object>(STRICT_DTO_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!dto) return next.handle();

    const req = context.switchToHttp().getRequest<{ body?: unknown }>();
    const body = req.body;
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      return next.handle();
    }
    const allowed = new Set(
      getMetadataStorage()
        .getTargetValidationMetadatas(dto, '', true, false, undefined)
        .map((m) => m.propertyName)
    );
    const unknownKeys = Object.keys(body).filter((k) => !allowed.has(k));
    if (unknownKeys.length > 0) {
      throw AppError.validationFailed(
        unknownKeys.map((field) => ({ field, issue: 'Unknown property is not allowed.' }))
      );
    }
    return next.handle();
  }
}
