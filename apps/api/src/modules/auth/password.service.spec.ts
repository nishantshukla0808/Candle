import { PasswordService } from './password.service';
import type { AppConfig } from '../../config/configuration';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '@candle/shared';

const config = { PASSWORD_MIN_LENGTH: 12 } as AppConfig;

describe('PasswordService', () => {
  const svc = new PasswordService(config);

  describe('validatePolicy', () => {
    it('accepts a strong password', () => {
      expect(() => svc.validatePolicy('Str0ng!Passphrase')).not.toThrow();
    });

    it('rejects short passwords with per-field details', () => {
      try {
        svc.validatePolicy('Sh0rt!');
        fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        const e = err as AppError;
        expect(e.code).toBe(ErrorCode.VALIDATION_FAILED);
        const details = e.details as Array<{ field: string }>;
        expect(details.every((d) => d.field === 'password')).toBe(true);
      }
    });

    it('rejects passwords missing character classes', () => {
      expect(() => svc.validatePolicy('alllowercase123!')).toThrow(AppError);
      expect(() => svc.validatePolicy('ALLUPPERCASE123!')).toThrow(AppError);
      expect(() => svc.validatePolicy('NoDigitsHere!!')).toThrow(AppError);
      expect(() => svc.validatePolicy('NoSymbols12345')).toThrow(AppError);
    });

    it('rejects common passwords', () => {
      expect(() => svc.validatePolicy('Password123!')).toThrow(AppError);
    });

    it('never includes the rejected value for the password field', () => {
      try {
        svc.validatePolicy('weak');
        fail('should have thrown');
      } catch (err) {
        const details = (err as AppError).details as Array<{ value?: unknown }>;
        expect(details.every((d) => d.value === undefined)).toBe(true);
      }
    });
  });

  describe('hash / verify', () => {
    it('round-trips', async () => {
      const hash = await svc.hash('Str0ng!Passphrase');
      expect(hash).toMatch(/^\$argon2id\$/);
      expect(await svc.verify('Str0ng!Passphrase', hash)).toBe(true);
      expect(await svc.verify('Wrong!Passphrase1', hash)).toBe(false);
    });

    it('verify returns false for malformed hashes (never throws)', async () => {
      await expect(svc.verify('x', 'not-a-hash')).resolves.toBe(false);
      await expect(svc.verify('x', '')).resolves.toBe(false);
    });
  });

  describe('tokens', () => {
    it('hashToken is deterministic SHA-256 hex', () => {
      const h1 = svc.hashToken('abc');
      const h2 = svc.hashToken('abc');
      expect(h1).toBe(h2);
      expect(h1).toMatch(/^[0-9a-f]{64}$/);
      expect(svc.hashToken('abd')).not.toBe(h1);
    });

    it('generateToken produces unique URL-safe tokens', () => {
      const a = svc.generateToken();
      const b = svc.generateToken();
      expect(a).not.toBe(b);
      expect(a).toMatch(/^[0-9a-f]+$/);
    });
  });
});
