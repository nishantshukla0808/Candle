/**
 * Application configuration — blueprint §13.
 *
 * Every environment variable is validated at boot. Missing or invalid
 * config crashes the process immediately, in every environment —
 * never halfway through a user request.
 *
 * Secrets live ONLY in the environment. `.env.example` lists names,
 * never values (blueprint §11).
 */
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // HTTP
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),

  // CORS — allow-listed origins only (blueprint §9 step 3).
  // Comma-separated list; credentials are sent ONLY to the Candle web origin.
  WEB_ORIGIN: z.string().url().default('http://localhost:3000'),
  CORS_EXTRA_ORIGINS: z.string().default(''),

  // Database — Prisma/PostgreSQL, single source of truth (blueprint §12).
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // Redis — rate limiting, future sessions/queues (blueprint §3).
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

  // Auth plumbing — short-lived access JWT (blueprint §11).
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900), // 15 min

  // Rate limiting (blueprint §9 step 4). Stricter prefixes get their own limits.
  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  RATE_LIMIT_STRICT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_STRICT_MAX: z.coerce.number().int().positive().default(30),
  // Comma-separated path prefixes that use the strict limits (auth-like routes).
  RATE_LIMIT_STRICT_PREFIXES: z.string().default('/api/v1/auth'),

  // Request timeout (blueprint §9 step 9).
  REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),

  // File storage — local disk in dev only; S3-compatible in prod (§10).
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('./uploads'),
  STORAGE_MAX_FILE_MB: z.coerce.number().int().positive().default(10),

  // Auth — refresh token cookie (blueprint §11).
  JWT_REFRESH_TTL_SECONDS: z.coerce.number().int().positive().default(2_592_000), // 30 days
  REFRESH_COOKIE_NAME: z.string().default('candle_refresh'),

  // Password policy — blueprint §11: minimum length + breach-aware.
  PASSWORD_MIN_LENGTH: z.coerce.number().int().min(8).default(12),

  // Admin bootstrap — comma-separated emails granted ADMIN at registration
  // (ADR 0002/10). No other promotion path exists in Phase 1.
  ADMIN_SEED_EMAILS: z.string().default(''),

  // Avatar upload policy — blueprint §10 (per-class policy lives in config).
  AVATAR_MAX_MB: z.coerce.number().int().positive().default(2),
  AVATAR_ALLOWED_MIMES: z.string().default('image/png,image/jpeg,image/webp'),

  // Outbox relay poll interval (blueprint §3, ADR 0002/3).
  OUTBOX_POLL_MS: z.coerce.number().int().positive().default(5000),

  // Live Speed Quiz Duel (docs/05 §3, docs/09 Phase 5) — server-owned
  // timers. Defaults are the documented values; tests override them
  // with small values via env. Never 0: a question must have a timer.
  LIVE_QUESTION_MS: z.coerce.number().int().positive().default(15_000),
  // Myth vs Fact Blitz (Phase 6) — same pattern, 10-second questions.
  BLITZ_QUESTION_MS: z.coerce.number().int().positive().default(10_000),
  // Case Duel (Phase 7) — 45-second cases + a 10-second reason window
  // after each case closes for answers (ADR 0009 §4).
  CASE_QUESTION_MS: z.coerce.number().int().positive().default(45_000),
  CASE_REASON_WINDOW_MS: z.coerce.number().int().nonnegative().default(10_000),
  // Chart Detective (Phase 8) — 30-second charts (docs/08 §3.4, ADR 0010).
  CHART_QUESTION_MS: z.coerce.number().int().positive().default(30_000),
  // Paper Trading Sprint (Phase 9) — 15-minute sprints, 30-second ticks
  // (docs/05 §1 T1, docs/14, ADR 0011). The countdown and the
  // disconnect grace are the shared live values (LIVE_COUNTDOWN_MS /
  // LIVE_DISCONNECT_GRACE_MS): a sprint is a live duel, not a new timer family.
  SPRINT_DURATION_MS: z.coerce.number().int().positive().default(900_000),
  SPRINT_TICK_MS: z.coerce.number().int().positive().default(30_000),
  // Weekly Portfolio Battle (T3, docs/05 §1, docs/16 Phase 11) — the
  // trading window of one season, in ms. Production default is one
  // week (7 × 24 h): an admin starts the season on Monday 00:00 IST
  // and it ends the next Monday 00:00 IST. Tests override this with a
  // small value (WEEKLY_SEASON_DURATION_MS=15000) so a full weekly
  // cycle — create → join → trade → end → settle — runs in test time.
  // Never 0: a season must have a trading window.
  WEEKLY_SEASON_DURATION_MS: z.coerce.number().int().positive().default(604_800_000),
  LIVE_COUNTDOWN_MS: z.coerce.number().int().positive().default(3_000),
  LIVE_DISCONNECT_GRACE_MS: z.coerce.number().int().positive().default(15_000),
  /** Pause between a question's reveal and the next question (ms). */
  LIVE_REVEAL_PAUSE_MS: z.coerce.number().int().nonnegative().default(2_000),
  // Multi-server WebSocket fan-out (docs/05 §3.4): when true, main.ts
  // installs the Socket.IO Redis adapter. Single-server v1 runs with
  // this OFF; turning it on without sticky sessions does NOT make
  // multi-server work — the LB must still pin a connection to one node.
  WS_REDIS_ADAPTER_ENABLED: z.coerce.boolean().default(false),
});

export type AppConfig = z.infer<typeof envSchema> & {
  corsOrigins: string[];
  rateLimitStrictPrefixes: string[];
  avatarAllowedMimes: string[];
  adminSeedEmails: string[];
  isProduction: boolean;
};

/**
 * Validates process.env and returns a typed config.
 * THROWS (and crashes boot) on any missing/invalid value.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    // eslint-disable-next-line no-console
    console.error(`[config] Invalid environment configuration:\n${problems}`);
    throw new Error('Invalid environment configuration. See .env.example for required names.');
  }
  const base = parsed.data;
  return {
    ...base,
    corsOrigins: [base.WEB_ORIGIN, ...base.CORS_EXTRA_ORIGINS.split(',').filter(Boolean)],
    rateLimitStrictPrefixes: base.RATE_LIMIT_STRICT_PREFIXES.split(',').filter(Boolean),
    avatarAllowedMimes: base.AVATAR_ALLOWED_MIMES.split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    adminSeedEmails: base.ADMIN_SEED_EMAILS.split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
    isProduction: base.NODE_ENV === 'production',
  };
}
