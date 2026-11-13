import { CallHandler, ExecutionContext, Inject, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, throwError, TimeoutError } from 'rxjs';
import { timeout, catchError } from 'rxjs/operators';
import { DEFAULT_REQUEST_TIMEOUT_MS } from '@candle/shared';
import { AppError } from '../errors/app-error';
import { TIMEOUT_MS_KEY } from '../decorators/route.decorators';
import { CONFIG } from '../../config/config.module';
import type { AppConfig } from '../../config/configuration';

/**
 * TimeoutInterceptor — blueprint §9 step 9.
 * Aborts handlers that exceed the timeout. Default from config;
 * overridable per route with @TimeoutMs(ms).
 */
@Injectable()
export class TimeoutInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    @Inject(CONFIG) private readonly config: AppConfig
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const ms =
      this.reflector.getAllAndOverride<number>(TIMEOUT_MS_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ??
      this.config.REQUEST_TIMEOUT_MS ??
      DEFAULT_REQUEST_TIMEOUT_MS;
    return next.handle().pipe(
      timeout(ms),
      catchError((err: unknown) =>
        throwError(() => (err instanceof TimeoutError ? AppError.requestTimeout() : (err as Error)))
      )
    );
  }
}
