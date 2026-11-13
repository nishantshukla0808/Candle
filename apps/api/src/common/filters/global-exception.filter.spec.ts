import { ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from '@candle/shared';
import { GlobalExceptionFilter } from './global-exception.filter';
import { AppError } from '../errors/app-error';
import { AppLogger } from '../services/logger.service';
import type { AppConfig } from '../../config/configuration';

function makeHost(requestId = 'req_test'): {
  host: ArgumentsHost;
  statusCode: { value: number };
  body: { value: unknown };
} {
  const statusCode = { value: 0 };
  const body = { value: null as unknown };
  const res = {
    status: (s: number) => ({
      json: (b: unknown) => {
        statusCode.value = s;
        body.value = b;
      },
    }),
  };
  const req = { requestId, method: 'GET', path: '/x', headers: {} };
  const host = {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as ArgumentsHost;
  return { host, statusCode, body };
}

function makeFilter(isProduction: boolean): GlobalExceptionFilter {
  const config = { isProduction } as AppConfig;
  return new GlobalExceptionFilter(new AppLogger(), config);
}

describe('GlobalExceptionFilter', () => {
  it('maps AppError to its code/status/details with the envelope', () => {
    const filter = makeFilter(false);
    const { host, statusCode, body } = makeHost();
    filter.catch(AppError.validationFailed([{ field: 'email', issue: 'bad' }], 'Bad input'), host);
    expect(statusCode.value).toBe(400);
    const b = body.value as {
      success: boolean;
      error: { code: string; message: string; details: unknown };
      requestId: string;
      timestamp: string;
    };
    expect(b.success).toBe(false);
    expect(b.error.code).toBe(ErrorCode.VALIDATION_FAILED);
    expect(b.error.message).toBe('Bad input');
    expect(b.error.details).toEqual([{ field: 'email', issue: 'bad' }]);
    expect(b.requestId).toBe('req_test');
    expect(typeof b.timestamp).toBe('string');
  });

  it('maps HttpException 404 to NOT_FOUND envelope', () => {
    const filter = makeFilter(false);
    const { host, statusCode, body } = makeHost();
    filter.catch(new HttpException('nope', HttpStatus.NOT_FOUND), host);
    expect(statusCode.value).toBe(404);
    expect((body.value as { error: { code: string } }).error.code).toBe(ErrorCode.NOT_FOUND);
  });

  it('hides details of unknown errors in production', () => {
    const filter = makeFilter(true);
    const { host, statusCode, body } = makeHost();
    filter.catch(new Error('db password=hunter2 at 10.0.0.1'), host);
    expect(statusCode.value).toBe(500);
    const b = body.value as { error: { code: string; message: string; details?: unknown } };
    expect(b.error.code).toBe(ErrorCode.INTERNAL_ERROR);
    expect(b.error.message).toBe('Something went wrong. Please try again later.');
    expect(JSON.stringify(b)).not.toContain('hunter2');
    expect(b.error.details).toBeUndefined();
  });

  it('includes the message for unknown errors outside production', () => {
    const filter = makeFilter(false);
    const { host, body } = makeHost();
    filter.catch(new Error('boom'), host);
    expect((body.value as { error: { message: string } }).error.message).toBe('boom');
  });
});
