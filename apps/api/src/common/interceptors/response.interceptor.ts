import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Request } from 'express';
import { map, Observable } from 'rxjs';
import { successResponse } from '../responses/api-response';

/**
 * ResponseInterceptor — blueprint §9 step 10.
 * Wraps every successful controller return in the standard envelope (§7).
 * Controllers return plain data; they NEVER build envelopes by hand.
 *
 * Already-enveloped values (shouldn't happen, but defensive) pass through.
 */
@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request & { requestId?: string }>();
    const requestId = req.requestId ?? 'unknown';
    return next.handle().pipe(
      map((data: unknown) => {
        if (typeof data === 'object' && data !== null && 'success' in data && 'requestId' in data) {
          return data;
        }
        return successResponse(data, requestId);
      })
    );
  }
}
