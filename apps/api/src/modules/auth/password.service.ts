import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { argon2id } from 'hash-wasm';
import { AppError } from '../../common/errors/app-error';
import { CONFIG } from '../../config/config.module';
import type { AppConfig } from '../../config/configuration';

/**
 * PasswordService — blueprint §11.
 *
 * - Argon2id via hash-wasm (pure WebAssembly; ADR 0002/1).
 *   Parameters: m=64 MiB, t=3, p=1 — OWASP recommended minimums.
 * - Policy: configurable minimum length (default 12) + character-class
 *   complexity + a built-in common-password denylist (breach-aware).
 * - Stored format: `$argon2id$m=65536,t=3,p=1$<salt-hex>$<hash-hex>`.
 *   The raw password never leaves this service; hashes never leave
 *   the users table.
 */

// A short denylist of the most-abused passwords. Compared case-insensitively;
// also rejected when embedded in a longer password is NOT checked — exact or
// near-exact matches only, to avoid false positives on passphrases.
const COMMON_PASSWORDS = new Set(
  [
    'password',
    'password1',
    'password123',
    'password123!',
    '123456',
    '12345678',
    '123456789',
    '1234567890',
    'qwerty',
    'qwerty123',
    'abc123',
    'letmein',
    'welcome',
    'welcome123',
    'admin123',
    'iloveyou',
    'monkey123',
    'dragon123',
    'football1',
    'superman1',
    'trustno1',
    'candle123',
    'candle12',
    'changeme',
    'changeme123',
    'p@ssw0rd',
    'p@ssword',
    'passw0rd',
    '1q2w3e4r',
    '1qaz2wsx',
    'aa123456',
    'qwe123',
    'asd123',
    'zxc123',
  ].map((s) => s.toLowerCase())
);

const ARGON_PARAMS = { m: 65536, t: 3, p: 1 } as const;

@Injectable()
export class PasswordService {
  constructor(@Inject(CONFIG) private readonly config: AppConfig) {}

  /** Enforces the password policy; throws VALIDATION_FAILED per-field. */
  validatePolicy(password: string): void {
    const issues: string[] = [];
    if (password.length < this.config.PASSWORD_MIN_LENGTH) {
      issues.push(`Must be at least ${this.config.PASSWORD_MIN_LENGTH} characters.`);
    }
    if (!/[a-z]/.test(password)) issues.push('Must contain a lowercase letter.');
    if (!/[A-Z]/.test(password)) issues.push('Must contain an uppercase letter.');
    if (!/\d/.test(password)) issues.push('Must contain a digit.');
    if (!/[^a-zA-Z0-9]/.test(password)) issues.push('Must contain a symbol.');
    if (COMMON_PASSWORDS.has(password.toLowerCase())) {
      issues.push('This password is too common. Choose a less predictable one.');
    }
    if (issues.length > 0) {
      throw AppError.validationFailed(issues.map((issue) => ({ field: 'password', issue })));
    }
  }

  /** Returns the stored hash string. */
  async hash(password: string): Promise<string> {
    const salt = randomBytes(16).toString('hex');
    const hash = await argon2id({
      password,
      salt,
      parallelism: ARGON_PARAMS.p,
      iterations: ARGON_PARAMS.t,
      memorySize: ARGON_PARAMS.m,
      hashLength: 32,
      outputType: 'hex',
    });
    return `$argon2id$m=${ARGON_PARAMS.m},t=${ARGON_PARAMS.t},p=${ARGON_PARAMS.p}$${salt}$${hash}`;
  }

  /** Constant-shape verification: parses the stored format, never throws. */
  async verify(password: string, stored: string): Promise<boolean> {
    try {
      const parts = stored.split('$');
      // ['', 'argon2id', 'm=65536,t=3,p=1', salt, hash]
      if (parts.length !== 5 || parts[1] !== 'argon2id') return false;
      const salt = parts[3];
      const expected = parts[4];
      if (!salt || !expected) return false;
      const hash = await argon2id({
        password,
        salt,
        parallelism: ARGON_PARAMS.p,
        iterations: ARGON_PARAMS.t,
        memorySize: ARGON_PARAMS.m,
        hashLength: 32,
        outputType: 'hex',
      });
      return hash === expected;
    } catch {
      return false;
    }
  }

  /** SHA-256 hex of a raw token — what we STORE (blueprint §11). */
  hashToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  /** Generates a URL-safe raw token for email links. */
  generateToken(bytes = 32): string {
    return randomBytes(bytes).toString('hex');
  }
}
