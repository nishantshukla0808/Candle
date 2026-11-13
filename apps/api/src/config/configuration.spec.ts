import { loadConfig } from './configuration';

const BASE_ENV: NodeJS.ProcessEnv = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'a'.repeat(32),
};

describe('loadConfig', () => {
  it('fails fast when a required variable is missing', () => {
    const rest = { ...BASE_ENV };
    delete rest.DATABASE_URL;
    expect(() => loadConfig(rest)).toThrow('Invalid environment configuration');
  });

  it('fails fast when JWT_SECRET is too short', () => {
    expect(() => loadConfig({ ...BASE_ENV, JWT_SECRET: 'short' })).toThrow(
      'Invalid environment configuration'
    );
  });

  it('applies defaults and derives computed fields', () => {
    const cfg = loadConfig(BASE_ENV);
    expect(cfg.PORT).toBe(3001);
    expect(cfg.NODE_ENV).toBe('development');
    expect(cfg.isProduction).toBe(false);
    expect(cfg.corsOrigins).toEqual(['http://localhost:3000']);
    expect(cfg.rateLimitStrictPrefixes).toEqual(['/api/v1/auth']);
  });

  it('parses comma-separated lists and production flag', () => {
    const cfg = loadConfig({
      ...BASE_ENV,
      NODE_ENV: 'production',
      CORS_EXTRA_ORIGINS: 'https://a.example,https://b.example',
    });
    expect(cfg.isProduction).toBe(true);
    expect(cfg.corsOrigins).toEqual([
      'http://localhost:3000',
      'https://a.example',
      'https://b.example',
    ]);
  });
});
