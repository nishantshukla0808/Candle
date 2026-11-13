import { ConsoleLogger, Injectable, LoggerService } from '@nestjs/common';
import { SENSITIVE_FIELDS } from '@candle/shared';

/**
 * AppLogger — the ONLY logging facility (blueprint §13, §14).
 * Structured JSON, one line per event, with requestId / userId / module.
 *
 * NEVER log: secrets, tokens, passwords, request bodies, or PII.
 * Use `redact()` on any object that might contain sensitive fields.
 * No console.log in production code — this service is the replacement.
 */
@Injectable()
export class AppLogger implements LoggerService {
  private readonly console = new ConsoleLogger('candle', { timestamp: true });

  log(message: string, context?: Record<string, unknown>): void {
    this.console.log(this.format(message, context), 'app');
  }

  /** Structured info log with a context object (redacted). */
  info(message: string, context?: Record<string, unknown>): void {
    this.console.log(this.format(message, context), 'app');
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.console.warn(this.format(message, context), 'app');
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.console.error(this.format(message, context), 'app');
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.console.debug(this.format(message, context), 'app');
  }

  verbose(message: string, context?: Record<string, unknown>): void {
    this.console.verbose(this.format(message, context), 'app');
  }

  /** Request-scoped HTTP log line (blueprint §9 step 5). */
  http(message: string, context?: Record<string, unknown>): void {
    this.console.log(this.format(message, context), 'http');
  }

  /**
   * Returns a copy of `obj` with sensitive fields replaced by '[REDACTED]'.
   * Handles nested objects and arrays.
   */
  redact<T>(obj: T): T {
    return redactDeep(obj) as T;
  }

  private format(message: string, context?: Record<string, unknown>): string {
    if (!context) return message;
    try {
      return `${message} ${JSON.stringify(redactDeep(context))}`;
    } catch {
      return `${message} [unserializable context]`;
    }
  }
}

function redactDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactDeep);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_FIELDS.some((s) => k.toLowerCase().includes(s.toLowerCase()))
        ? '[REDACTED]'
        : redactDeep(v);
    }
    return out;
  }
  return value;
}
