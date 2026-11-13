import { ErrorCode, ValidationIssue } from './error-codes';

/**
 * Standard success envelope — blueprint §7.
 * Controllers NEVER build this by hand; ResponseInterceptor wraps every success.
 */
export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
  meta?: PaginationMeta | Record<string, unknown>;
  requestId: string;
  timestamp: string;
}

/** Standard error envelope — blueprint §7. */
export interface ApiErrorResponse {
  success: false;
  error: {
    code: ErrorCode;
    message: string;
    details?: ValidationIssue[] | Record<string, unknown>;
  };
  requestId: string;
  timestamp: string;
}

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

/** Pagination meta — blueprint §6. Always present on paginated responses. */
export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/** Paginated success envelope. */
export interface PaginatedResponse<T> extends ApiSuccessResponse<T[]> {
  meta: PaginationMeta;
}
