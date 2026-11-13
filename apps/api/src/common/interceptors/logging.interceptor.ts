import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Request } from 'express';
import { Observable, tap } from 'rxjs';
import { AppLogger } from '../services/logger.service';
import { RequestUser } from '../decorators/current-user.decorator';

/**
 * LoggingInterceptor — blueprint §9 step 5.
 * One structured JSON log line per request: method, path, status,
 * duration, requestId, userId. NEVER bodies, passwords, tokens, or PII.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  constructor(private readonly logger: AppLogger) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context
      .switchToHttp()
      .getRequest<Request & { requestId?: string; user?: RequestUser }>();
    const startedAt = Date.now();
    const requestId = req.requestId ?? 'unknown';
    return next.handle().pipe(
      tap({
        next: () => this.log(req, requestId, startedAt, undefined),
        error: (err: unknown) =>
          this.log(req, requestId, startedAt, err instanceof Error ? err.message : 'error'),
      })
    );
  }

  private log(
    req: Request & { requestId?: string; user?: RequestUser },
    requestId: string,
    startedAt: number,
    error?: string
  ): void {
    const res = (req as unknown as { res?: { statusCode?: number } }).res;
    this.logger.http('request', {
      requestId,
      method: req.method,
      path: req.path,
      status: res?.statusCode,
      durationMs: Date.now() - startedAt,
      userId: req.user?.sub,
      ...(error ? { error } : {}),
    });
  }
}
