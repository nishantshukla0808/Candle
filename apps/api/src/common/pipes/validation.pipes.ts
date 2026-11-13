import { ValidationError, ValidationPipe } from '@nestjs/common';
import { ValidationIssue } from '@candle/shared';
import { AppError } from '../errors/app-error';
import { SENSITIVE_FIELDS } from '@candle/shared';

/**
 * Maps class-validator failures to VALIDATION_FAILED with per-field details
 * (blueprint §8). The raw rejected value is included only when safe —
 * never for sensitive fields (passwords, tokens).
 *
 * Returns an AppError directly so GlobalExceptionFilter maps it with
 * its details intact.
 */
export function validationExceptionFactory(errors: ValidationError[]): AppError {
  const details: ValidationIssue[] = flattenErrors(errors);
  return AppError.validationFailed(details);
}

/** Shared global pipe config: whitelist + transform (blueprint §8). */
export function createGlobalValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true, // unknown properties are stripped…
    transform: true, // …query strings become typed numbers/booleans
    forbidUnknownValues: true,
    exceptionFactory: validationExceptionFactory,
  });
}

/**
 * Strict pipe for strict endpoints (auth, payments-like, admin):
 * unknown properties are REJECTED with per-field details (blueprint §8).
 *
 * NOTE: with the global whitelist pipe active, the global pipe strips
 * unknown properties before any method-level pipe sees them. The effective
 * strict mechanism is therefore StrictValidationInterceptor + @Strict(Dto).
 * This pipe remains available for direct @UsePipes use in modules that
 * opt out of the global whitelist behavior.
 */
export const strictValidationPipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  forbidUnknownValues: true,
  exceptionFactory: validationExceptionFactory,
});

function flattenErrors(errors: ValidationError[], parent = ''): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  for (const e of errors) {
    const field = parent ? `${parent}.${e.property}` : e.property;
    if (e.constraints) {
      for (const issue of Object.values(e.constraints)) {
        const entry: ValidationIssue = { field, issue };
        const lower = field.toLowerCase();
        if (
          !SENSITIVE_FIELDS.some((s) => lower.includes(s)) &&
          e.value !== undefined &&
          e.value !== null
        ) {
          entry.value = e.value;
        }
        out.push(entry);
      }
    }
    if (e.children && e.children.length > 0) {
      out.push(...flattenErrors(e.children, field));
    }
  }
  return out;
}
