import { ApiSuccessResponse, PaginatedResponse, PaginationMeta } from '@candle/shared';

/**
 * Response builders — blueprint §7.
 * Only ResponseInterceptor and GlobalExceptionFilter construct envelopes.
 * Controllers return plain data objects and NEVER build envelopes by hand.
 */
export function successResponse<T>(
  data: T,
  requestId: string,
  meta?: PaginationMeta | Record<string, unknown>
): ApiSuccessResponse<T> {
  return {
    success: true,
    data,
    ...(meta !== undefined ? { meta } : {}),
    requestId,
    timestamp: new Date().toISOString(),
  };
}

export function paginatedResponse<T>(
  data: T[],
  meta: PaginationMeta,
  requestId: string
): PaginatedResponse<T> {
  return {
    success: true,
    data,
    meta,
    requestId,
    timestamp: new Date().toISOString(),
  };
}
