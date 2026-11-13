import { ValidationError } from 'class-validator';
import { ErrorCode } from '@candle/shared';
import { validationExceptionFactory } from './validation.pipes';
import { AppError } from '../errors/app-error';

function ve(
  property: string,
  constraints: Record<string, string>,
  value?: unknown
): ValidationError {
  const e = new ValidationError();
  e.property = property;
  e.constraints = constraints;
  e.value = value;
  e.children = [];
  return e;
}

describe('validationExceptionFactory', () => {
  it('produces VALIDATION_FAILED with per-field details', () => {
    const err = validationExceptionFactory([
      ve('email', { isEmail: 'email must be a valid email address' }, 'not-an-email'),
      ve('note', { maxLength: 'note must be shorter' }, 'x'.repeat(200)),
    ]);
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe(ErrorCode.VALIDATION_FAILED);
    expect(err.status).toBe(400);
    expect(err.details).toEqual([
      { field: 'email', issue: 'email must be a valid email address', value: 'not-an-email' },
      { field: 'note', issue: 'note must be shorter', value: 'x'.repeat(200) },
    ]);
  });

  it('never includes values of sensitive fields in details', () => {
    const err = validationExceptionFactory([
      ve('password', { minLength: 'password too short' }, 'hunter2'),
    ]);
    const details = err.details as Array<{ field: string; value?: unknown }>;
    expect(details[0]?.field).toBe('password');
    expect(details[0]).not.toHaveProperty('value');
  });

  it('flattens nested validation errors with dotted paths', () => {
    const parent = ve('address', {});
    const child = ve('city', { isString: 'city must be a string' }, 42);
    parent.children = [child];
    const err = validationExceptionFactory([parent]);
    expect(err.details).toEqual([
      { field: 'address.city', issue: 'city must be a string', value: 42 },
    ]);
  });
});
