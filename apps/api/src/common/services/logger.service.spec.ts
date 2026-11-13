import { AppLogger } from './logger.service';

describe('AppLogger redaction', () => {
  const logger = new AppLogger();

  it('redacts sensitive fields at the top level', () => {
    const out = logger.redact({ email: 'a@b.c', password: 'secret', token: 'abc' });
    expect(out).toEqual({ email: 'a@b.c', password: '[REDACTED]', token: '[REDACTED]' });
  });

  it('redacts nested objects and arrays', () => {
    const out = logger.redact({
      user: { passwordHash: 'x', name: 'Nishu' },
      items: [{ apiKey: 'k' }, { safe: 1 }],
    });
    expect(out).toEqual({
      user: { passwordHash: '[REDACTED]', name: 'Nishu' },
      items: [{ apiKey: '[REDACTED]' }, { safe: 1 }],
    });
  });

  it('matches case-insensitively and on substrings', () => {
    const out = logger.redact({ Authorization: 'Bearer x', mySecretValue: 1 });
    expect(out).toEqual({ Authorization: '[REDACTED]', mySecretValue: '[REDACTED]' });
  });

  it('does not mutate the original object', () => {
    const input = { password: 'p' };
    logger.redact(input);
    expect(input.password).toBe('p');
  });
});
