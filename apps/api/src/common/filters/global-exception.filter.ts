import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Inject,
} from '@nestjs/common';
import { Request, Response } from 'express';
import {
  ApiErrorResponse,
  ErrorCode,
  ERROR_DEFAULT_MESSAGES,
  ValidationIssue,
} from '@candle/shared';
import { AppError } from '../errors/app-error';
import { ERROR_STATUS_MAP } from '../errors/error-status-map';
import { AppLogger } from '../services/logger.service';
import { CONFIG } from '../../config/config.module';
import type { AppConfig } from '../../config/configuration';

/**
 * Well-known HTTP status -> catalogue code for framework-thrown errors.
 * AppError and domain errors carry their own codes; this is only the
 * fallback for raw HttpExceptions (e.g. Nest's own 404).
 */
const HTTP_STATUS_CODE_MAP: ReadonlyMap<number, ErrorCode> = new Map([
  [HttpStatus.BAD_REQUEST, ErrorCode.VALIDATION_FAILED],
  [HttpStatus.UNAUTHORIZED, ErrorCode.UNAUTHORIZED],
  [HttpStatus.FORBIDDEN, ErrorCode.FORBIDDEN],
  [HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND],
  [HttpStatus.CONFLICT, ErrorCode.CONFLICT],
  [HttpStatus.REQUEST_TIMEOUT, ErrorCode.REQUEST_TIMEOUT],
  [HttpStatus.TOO_MANY_REQUESTS, ErrorCode.RATE_LIMITED],
]);

/**
 * GlobalExceptionFilter — blueprint §9 step 11.
 * Catches EVERYTHING and maps it to the standard error envelope (§7).
 *
 * - AppError      -> its code/status/details
 * - HttpException -> best-fit catalogue code by status (e.g. 404 -> NOT_FOUND)
 * - anything else -> INTERNAL_ERROR 500, NO details in production
 *
 * Fail safe and fail quiet in prod: no stack traces, no internals leak.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  constructor(
    private readonly logger: AppLogger,
    @Inject(CONFIG) private readonly config: AppConfig
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request & { requestId?: string }>();
    const res = ctx.getResponse<Response>();
    const requestId = req.requestId ?? 'unknown';

    const mapped = this.map(exception);

    // Server errors are always logged; client errors at debug level.
    if (mapped.status >= 500) {
      this.logger.error('Unhandled request error', {
        requestId,
        method: req.method,
        path: req.path,
        status: mapped.status,
        code: mapped.code,
        err: exception instanceof Error ? exception.message : String(exception),
        stack: this.config.isProduction ? undefined : this.safeStack(exception),
      });
    }

    const body: ApiErrorResponse = {
      success: false,
      error: {
        code: mapped.code,
        message: mapped.message,
        ...(mapped.details !== undefined ? { details: mapped.details } : {}),
      },
      requestId,
      timestamp: new Date().toISOString(),
    };
    res.status(mapped.status).json(body);
  }

  private map(exception: unknown): {
    code: ErrorCode;
    status: number;
    message: string;
    details?: ValidationIssue[] | Record<string, unknown>;
  } {
    if (exception instanceof AppError) {
      return {
        code: exception.code,
        status: exception.status,
        message: exception.message || ERROR_DEFAULT_MESSAGES[exception.code],
        ...(exception.details !== undefined
          ? { details: exception.details as ValidationIssue[] | Record<string, unknown> }
          : {}),
      };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code = this.codeForStatus(status);
      const response = exception.getResponse();
      const message =
        typeof response === 'object' && response !== null && 'message' in response
          ? String(response.message)
          : ERROR_DEFAULT_MESSAGES[code];
      return { code, status, message };
    }
    // Unknown error: INTERNAL_ERROR, and never leak details in production.
    return this.config.isProduction
      ? {
          code: ErrorCode.INTERNAL_ERROR,
          status: 500,
          message: ERROR_DEFAULT_MESSAGES.INTERNAL_ERROR,
        }
      : {
          code: ErrorCode.INTERNAL_ERROR,
          status: 500,
          message: exception instanceof Error ? exception.message : 'Unknown error',
        };
  }

  private codeForStatus(status: number): ErrorCode {
    const direct = HTTP_STATUS_CODE_MAP.get(status);
    if (direct) return direct;
    for (const code of Object.values(ErrorCode)) {
      if (ERROR_STATUS_MAP[code] === status) return code;
    }
    return ErrorCode.INTERNAL_ERROR;
  }

  private safeStack(exception: unknown): string | undefined {
    return exception instanceof Error ? exception.stack : undefined;
  }
}
