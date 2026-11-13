import { AppError } from './app-error';
import { ErrorCode } from '@candle/shared';

describe('AppError', () => {
  it('validationFailed carries code, status and per-field details', () => {
    const details = [{ field: 'email', issue: 'must be valid' }];
    const err = AppError.validationFailed(details);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe(ErrorCode.VALIDATION_FAILED);
    expect(err.status).toBe(400);
    expect(err.details).toBe(details);
    expect(err.isOperational).toBe(true);
  });

  it('maps each factory to the catalogue status', () => {
    expect(AppError.unauthorized().status).toBe(401);
    expect(AppError.forbidden().status).toBe(403);
    expect(AppError.notFound().status).toBe(404);
    expect(AppError.conflict().status).toBe(409);
    expect(AppError.rateLimited().status).toBe(429);
    expect(AppError.fileTooLarge().status).toBe(413);
    expect(AppError.unsupportedFileType().status).toBe(415);
    expect(AppError.requestTimeout().status).toBe(408);
    expect(AppError.serviceUnavailable().status).toBe(503);
    expect(AppError.internal().status).toBe(500);
  });

  it('uses a safe default message when none is supplied', () => {
    const err = AppError.internal();
    expect(err.message).toBe('');
  });
});
