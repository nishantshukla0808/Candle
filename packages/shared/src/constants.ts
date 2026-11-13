/**
 * Shared constants — no logic, no secrets.
 * Environment-specific values live in config, never here.
 */

/** API versioning — blueprint §6: versioned from day one. */
export const API_VERSION = 'v1';
export const API_BASE_PATH = `/api/${API_VERSION}`;

/** Request correlation header — blueprint §9 step 1. */
export const REQUEST_ID_HEADER = 'x-request-id';

/** Pagination defaults — blueprint §6 (capped at 100). */
export const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 20,
  MAX_LIMIT: 100,
} as const;

/** Default request timeout (ms) — blueprint §9 step 9. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

/** Fields that must never appear in logs. */
export const SENSITIVE_FIELDS = [
  'password',
  'passwordHash',
  'token',
  'accessToken',
  'refreshToken',
  'authorization',
  'secret',
  'apiKey',
] as const;

/**
 * Gamification tuning — blueprint §6/§17 (Phase 1).
 * These are product constants, not secrets: safe to share with the web app.
 */
export const XP = {
  /** Awarded once per lesson completion (idempotent, ADR 0002/2). */
  LESSON_COMPLETION: 50,
  /** Awarded once per passed quiz attempt (idempotent). */
  QUIZ_PASS: 20,
  /** Awarded once per executed simulator trade (idempotent, ADR 0003/5). */
  TRADE_EXECUTED: 5,
  /** Awarded once for completing onboarding placement (idempotent, ADR 0004/2). */
  ONBOARDING_BONUS: 50,
} as const;

/**
 * XP thresholds for levels. Level N is reached when totalXp >= thresholds[N-1].
 * Level 1 starts at 0 XP.
 */
export const LEVEL_XP_THRESHOLDS = [0, 100, 250, 500, 900, 1400, 2100, 3000, 4200, 6000] as const;

/** Timezone streaks are computed in — blueprint §6. */
export const STREAK_TIMEZONE = 'Asia/Kolkata';

/** Quiz pass mark (fraction of points). */
export const QUIZ_PASS_MARK = 0.7;

/**
 * Simulator tuning — blueprint §17 (Phase 2).
 * Virtual cash granted to a newly created simulator portfolio (INR).
 * This is play money; it has no real-world value (blueprint §16).
 */
export const SIMULATOR_STARTING_CASH = 100_000;

/** Maximum quantity per simulator order (anti-abuse bound). */
export const SIMULATOR_MAX_ORDER_QTY = 1_000_000;

/**
 * Onboarding assessment tuning — docs/03-onboarding-assessment-design.md.
 * The assessment is diagnostic: 12 questions, 4 topics x 3 difficulty tiers.
 */
export const ONBOARDING_QUESTION_COUNT = 12;
/** Cooldown between assessment submissions (days). */
export const ONBOARDING_RETAKE_COOLDOWN_DAYS = 7;
/** Max submitted attempts per assessment version. */
export const ONBOARDING_MAX_ATTEMPTS = 3;
/** An in-progress attempt younger than this is resumed instead of replaced. */
export const ONBOARDING_ATTEMPT_RESUME_HOURS = 24;

/**
 * Assessment topics in track order (docs/03-onboarding-assessment-design.md §3.1).
 * Index = module order in the Foundations track, so placement maps directly.
 */
export const ASSESSMENT_TOPICS = [
  'money-basics',
  'banking-saving',
  'markets',
  'investor-mindset',
] as const;

export type AssessmentTopicKey = (typeof ASSESSMENT_TOPICS)[number];

/** Display labels for knowledge levels 1–5 (spec §4.2). */
export const ASSESSMENT_LEVEL_LABELS: Record<number, string> = {
  1: 'Starting Out',
  2: 'Foundations',
  3: 'Building',
  4: 'Confident',
  5: 'Market Ready',
};

/**
 * Ratings tuning — docs/04-ratings-and-deployment.md (Phase 3).
 * Separate Learning and Trading ratings per user; the headline Candle
 * Rating is the weighted mix, shown only with its two parts beside it.
 * These are product constants, not secrets: safe to share with the web app.
 */

/** Every new user starts at 1000 in each rating. */
export const RATING_START = 1000;
/** No rating ever goes below this floor. */
export const RATING_FLOOR = 100;
/** Tier bands (same for Learning and Trading). Tier names are display only. */
export const RATING_TIERS = [
  { name: 'Bronze', min: 0 },
  { name: 'Silver', min: 1100 },
  { name: 'Gold', min: 1300 },
  { name: 'Platinum', min: 1500 },
  { name: 'Diamond', min: 1700 },
  { name: 'Master', min: 1900 },
] as const;
/** K-factor: how fast a rating moves (docs/04 §3). */
export const RATING_K_PROVISIONAL = 40;
export const RATING_K_BELOW_1400 = 32;
export const RATING_K_1400_TO_1799 = 24;
export const RATING_K_1800_PLUS = 16;
/** A rating is provisional for its first 10 rated events. */
export const RATING_PROVISIONAL_EVENTS = 10;
/** The simulated market index sits at a fixed rating of 1200 (docs/04 §5). */
export const RATING_INDEX_OPPONENT = 1200;
/** Headline Candle Rating weights: 0.5 × Learning + 0.5 × Trading. */
export const RATING_WEIGHTS = { LEARNING: 0.5, TRADING: 0.5 } as const;
/** Anti-gaming: same pair, max 3 rated duels per day (docs/04 §5). */
export const RATING_DUEL_DAILY_PAIR_LIMIT = 3;
/** Anti-gaming: max 10 rated events per user per day (all kinds). */
export const RATING_DAILY_EVENT_LIMIT = 10;
/** Anti-gaming: 5-minute rematch cooldown for the same pair. */
export const RATING_DUEL_REMATCH_COOLDOWN_MINUTES = 5;
/** Country changes: 90-day cooldown between changes to a different code. */
export const RATING_COUNTRY_CHANGE_COOLDOWN_DAYS = 90;
/** Trading: a week counts only with at least 3 trades. */
export const RATING_TRADING_MIN_TRADES = 3;
/** Trading: win/loss margin vs the index, in percentage points. */
export const RATING_TRADING_WIN_MARGIN_PCT = 2;
/** Inactivity decay: grace period with no rated event before decay starts. */
export const RATING_DECAY_GRACE_DAYS = 30;
/** Inactivity decay: points drifted toward 1000 per week past the grace. */
export const RATING_DECAY_POINTS_PER_WEEK = 10;
/** Inactivity decay: maximum points drifted in a single decay run. */
export const RATING_DECAY_MAX_POINTS = 50;
/** Leaderboard: top N entries served per scope. */
export const RATING_LEADERBOARD_TOP = 100;

/**
 * Question Bank tuning — docs/05-duels-system-design.md §2 (Phase 3).
 * Topics are an allowlist constant, not a closed enum, so topics can grow
 * without a migration (ADR 0005 §15).
 */
export const DUEL_BANK_TOPICS = [
  'money-basics',
  'budgeting',
  'banking-saving',
  'stocks',
  'mutual-funds',
  'risk',
  'compounding',
  'tax-basics',
  'insurance',
  'markets',
] as const;

export type DuelBankTopic = (typeof DUEL_BANK_TOPICS)[number];

export const DUEL_BANK_SKILLS = [
  'RECALL',
  'CALCULATION',
  'JUDGEMENT',
  'CHART_READING',
  'SCENARIO',
  'RISK_ASSESSMENT',
] as const;

export type DuelBankSkillKey = (typeof DUEL_BANK_SKILLS)[number];

export const DUEL_BANK_TYPES = [
  'MCQ_4',
  'TRUE_FALSE',
  'CASE_CHOICE',
  'CHART_CHOICE',
  'NUMERIC',
  'ORDERING',
] as const;

export type DuelBankTypeKey = (typeof DUEL_BANK_TYPES)[number];

/**
 * Seeded chart templates (docs/08 §3.4, Phase 8 Stage 1). Every
 * CHART_CHOICE series has the same fixed length (CHART_SERIES_LENGTH
 * points) — the shape of the line is what the question is about.
 * - STEADY_RISE: climbs most steps, ends clearly above the start.
 * - VOLATILE_FLAT: swings up and down, ends near where it started.
 * - SHARP_FALL_RECOVERY: falls sharply, then climbs back part-way.
 * - STEADY_FALL: drops most steps, ends clearly below the start.
 * - SPIKE_THEN_FALL: jumps to a peak mid-series, then falls below the start.
 */
export const CHART_TEMPLATES = [
  'STEADY_RISE',
  'VOLATILE_FLAT',
  'SHARP_FALL_RECOVERY',
  'STEADY_FALL',
  'SPIKE_THEN_FALL',
] as const;

export type ChartTemplateKey = (typeof CHART_TEMPLATES)[number];

/** Points in every seeded chart series (docs/08 §3.4: fixed per template). */
export const CHART_SERIES_LENGTH = 6;

/** Question Bank constants (docs/05 §2.3/§2.5/§2.6). */
export const QUESTION_BANK = {
  /** An item may be shown to the same user at most once in this window. */
  EXPOSURE_WINDOW_DAYS: 30,
  /** …and at most this many times in total before it is rested. */
  EXPOSURE_MAX_SEEN: 3,
  /** Pilot answers needed before an item's difficulty may be calibrated. */
  PILOT_MIN_ANSWERS: 50,
  /** Default cap on items from one topic in a single duel set. */
  DEFAULT_MAX_PER_TOPIC: 2,
  /** Minimum distinct skills in a set of 6 or more items. */
  MIN_SKILLS_FOR_LARGE_SET: 3,
  /** Set size at or above which the skill-diversity rule applies. */
  LARGE_SET_MIN_COUNT: 6,
  /** v1 seed target for live items (docs/05 §2.3/§2.6). 620 after Phase 8
   *  Stage 1 adds 50 LIVE CHART_CHOICE items (qb-571..qb-620). */
  SEED_LIVE_TARGET: 620,
} as const;

/**
 * Duels tuning — docs/05-duels-system-design.md §1/§3 (Phase 4, Step 2).
 * Bot Duel (P1, unrated) and Async Daily Duel (L5, rated, 1 per day).
 * These are product constants, not secrets: safe to share with the web app.
 */
export const DUELS = {
  /** Bot Duel (Speed Quiz format, docs/05 §1 L1/P1): 7 questions. */
  BOT_QUESTION_COUNT: 7,
  /** Async Daily Duel (docs/05 §1 L5): 5 questions, same set all day. */
  DAILY_QUESTION_COUNT: 5,
  /** Seconds allowed per question in both duel formats. */
  SECONDS_PER_QUESTION: 15,
  /** The same limit in milliseconds (the unit answers carry). */
  QUESTION_TIME_LIMIT_MS: 15_000,
  /** Bot Duels per user per Asia/Kolkata calendar day (unrated practice). */
  BOT_DAILY_LIMIT: 10,
  /** Rated Daily Duels per user per Asia/Kolkata calendar day. */
  DAILY_PER_DAY: 1,
  /**
   * Bot Duel difficulty mix (2 easy + 3 medium + 2 hard, docs/05 §2.2):
   * difficulty 2 = easy, 3 = medium, 4 = hard. Selection falls back to
   * the nearest difficulty when a cell is short (ADR 0005 §15.8).
   */
  BOT_DIFFICULTY_MIX: { 2: 2, 3: 3, 4: 2 },
  /** Daily Duel difficulty mix: 2 easy + 2 medium + 1 hard. */
  DAILY_DIFFICULTY_MIX: { 2: 2, 3: 2, 4: 1 },
  /** At most this many items from one topic in a single duel set. */
  MAX_PER_TOPIC: 2,
  /** The bot opponent's display name (docs/05 §1 P1 — Mira, the Daily Coach). */
  BOT_NAME: 'Mira',
  // --- Live Speed Quiz Duel (L1, docs/05 §3, docs/09 Phase 5) -----------------
  /** Live Speed Quiz Duel: 7 questions, same set for both players. */
  LIVE_QUESTION_COUNT: 7,
  /** Live difficulty mix: same Speed Quiz blueprint as the Bot Duel. */
  LIVE_DIFFICULTY_MIX: { 2: 2, 3: 3, 4: 2 },
  /** Live formats only (doc 08 §3.7/§4): MCQ_4 + TRUE_FALSE, never others. */
  LIVE_TYPES: ['MCQ_4', 'TRUE_FALSE'] as const,
  // --- Myth vs Fact Blitz (L2, docs/05 §1, docs/08 §3.2, Phase 6) -----------
  /** Blitz: 10 rapid true/false questions, 10 seconds each. */
  BLITZ_QUESTION_COUNT: 10,
  /** Blitz difficulty mix: 3 easy + 4 medium + 3 hard (sums to 10). */
  BLITZ_DIFFICULTY_MIX: { 2: 3, 3: 4, 4: 3 },
  /** Blitz formats only (doc 08 §3.2): TRUE_FALSE, never others. */
  BLITZ_TYPES: ['TRUE_FALSE'] as const,
  /** Blitz per-topic cap: 3 (10 questions across the bank's topics). */
  BLITZ_MAX_PER_TOPIC: 3,
  /** Seconds allowed per Blitz question (doc 08 §3.2: 10 s timer). */
  BLITZ_SECONDS_PER_QUESTION: 10,
  /** The same limit in milliseconds (the unit Blitz answers carry). */
  BLITZ_QUESTION_TIME_LIMIT_MS: 10_000,
  /** Blitz streak bonus: +10 per consecutive correct answer beyond the 2nd. */
  BLITZ_STREAK_BONUS_STEP: 10,
  /** …capped at +30 per question (streak 5 and beyond). */
  BLITZ_STREAK_BONUS_CAP: 30,
  // --- Case Duel (L3, docs/05 §1, docs/08 §3.3, Phase 7) -------------------
  // Stage 1 (format + bank) + Stage 2 (the duel itself, ADR 0009).
  // Host: Kabir (doc 08 §2.2) — speaks before/after only, never during a question.
  /** Case Duel host (speaks before/after only, never during a question). */
  CASE_HOST_NAME: 'Kabir',
  /** Case Duel: 5 cases per duel (doc 12 §2 — the 50-item bank supports ~5–7). */
  CASE_QUESTION_COUNT: 5,
  /** Case difficulty mix: 1 easy + 2 medium + 2 hard (sums to 5). */
  CASE_DIFFICULTY_MIX: { 2: 1, 3: 2, 4: 2 },
  /** Case formats only (doc 08 §3.3): CASE_CHOICE, never others. */
  CASE_TYPES: ['CASE_CHOICE'] as const,
  /** Case per-topic cap: 2 (5 cases across the bank's topics). */
  CASE_MAX_PER_TOPIC: 2,
  /** Seconds allowed per CASE_CHOICE question (judgement, not recall). */
  CASE_SECONDS_PER_QUESTION: 45,
  /** The same limit in milliseconds. */
  CASE_QUESTION_TIME_LIMIT_MS: 45_000,
  /** CASE_CHOICE per-option points: best action. */
  CASE_POINTS_BEST: 100,
  /** CASE_CHOICE per-option points: second-best action (at most one per item). */
  CASE_POINTS_SECOND_BEST: 50,
  /** CASE_CHOICE per-option points: harmful / other actions. */
  CASE_POINTS_OTHER: 0,
  /** Speed bonus cap for a case answer (doc 08 §3.3: smaller than quiz). */
  CASE_SPEED_BONUS_MAX: 20,
  /** Reason window after a case closes for answers (ms): the reveal is
   * postponed until every player who answered has submitted/skipped a
   * reason, or this long after the window opened (ADR 0009 §4). */
  CASE_REASON_WINDOW_MS: 10_000,
  // --- Chart Detective (L4, docs/05 §1, docs/08 §3.4, Phase 8 Stage 1) ---
  // Stage 1 (format + generator + bank) only — the duel itself (Stage 2)
  // adds DuelType.CHART + the variant row. Host: Kabir (doc 08 §2.2).
  /** Chart Detective host (speaks before/after only, never during a question). */
  CHART_HOST_NAME: 'Kabir',
  /** Chart Detective: 5 charts per duel (doc 13 §2 — the 50-item bank supports ~5–7). */
  CHART_QUESTION_COUNT: 5,
  /** Chart difficulty mix: 1 easy + 2 medium + 2 hard (sums to 5). */
  CHART_DIFFICULTY_MIX: { 2: 1, 3: 2, 4: 2 },
  /** Chart formats only (doc 08 §3.4): CHART_CHOICE, never others. */
  CHART_TYPES: ['CHART_CHOICE'] as const,
  /** Chart per-topic cap: 2 (5 charts across the bank's topics). */
  CHART_MAX_PER_TOPIC: 2,
  /** Seconds allowed per CHART_CHOICE question (doc 08 §3.4: 30 s). */
  CHART_SECONDS_PER_QUESTION: 30,
  /** The same limit in milliseconds. */
  CHART_QUESTION_TIME_LIMIT_MS: 30_000,
  /** Countdown before the first live question (seconds). */
  LIVE_COUNTDOWN_SECONDS: 3,
  // --- Paper Trading Sprint (T1, docs/05 §1, docs/08 §3.7, Phase 9) ------
  // Host: Tara (doc 08 §2.2) — speaks before/after only, never during
  // the sprint, never gives trading advice. A sprint is a live trading
  // duel on the Phase 2 deterministic price engine: 15 minutes, same
  // fictional market, same starting cash (SIMULATOR_STARTING_CASH),
  // winner by RISK-ADJUSTED return (docs/14 §3), not highest return.
  /** Paper Trading Sprint host (speaks before/after only). */
  SPRINT_HOST_NAME: 'Tara',
  /** Sprint length: 15 minutes (docs/05 §1 T1). */
  SPRINT_DURATION_MS: 900_000,
  /** Live price + equity broadcast interval during a sprint (ms). */
  SPRINT_TICK_MS: 30_000,
  /** A sprint's Redis state lives this long (seconds): 15-min duel +
   * disconnect grace + settlement buffer. */
  SPRINT_STATE_TTL_SEC: 1800,
  /** Sprint queue entries expire after this long without a match (seconds). */
  SPRINT_QUEUE_TTL_SEC: 300,
  /** Anti-spam: max orders one player may place in a single sprint.
   * Wash trades inside a minute cannot move the score (same-minute
   * execution price), so this is a guard, not the fairness mechanism. */
  SPRINT_MAX_ORDERS_PER_PLAYER: 120,
  /** Orders are whole units only, at least 1 unit per order. */
  SPRINT_MIN_ORDER_QTY: 1,
  /** Max units in a single sprint order (anti-abuse bound). */
  SPRINT_MAX_ORDER_QTY: 100_000,
  /** Risk-adjusted score clamp (docs/14 §3): scores never exceed ±100. */
  SPRINT_SCORE_CLAMP: 100,
  /** Two risk-adjusted scores within this gap are a tie on score; the
   * higher return then wins, else a draw (docs/14 §3). */
  SPRINT_SCORE_TIE_EPSILON: 0.001,
  /** Bot (Mira) trade cap per sprint: she never trades more than this. */
  SPRINT_BOT_MAX_TRADES: 12,
  /** Bot (Mira) max position: never more than this share of her
   * portfolio value in one instrument. */
  SPRINT_BOT_MAX_POSITION_SHARE: 0.3,
  /** Bot take-profit: sell half when a position is up this much vs its
   * average cost (fraction, 0.01 = 1%). */
  SPRINT_BOT_TAKE_PROFIT_PCT: 0.01,
  /** Bot stop-loss: sell all when a position is down this much vs its
   * average cost (fraction, 0.01 = 1%). */
  SPRINT_BOT_STOP_LOSS_PCT: 0.01,
  // --- Crisis Duel (T2, docs/05 §1, docs/08 §3.7, Phase 10) --------------
  // A Paper Trading Sprint with a seeded crash mid-duel. Same 15-minute
  // timer, same 30-second ticks, same starting cash, same order rules
  // (SPRINT_DURATION_MS / SPRINT_TICK_MS / SPRINT_MAX_ORDERS_PER_PLAYER
  // are shared with the sprint — a crisis IS a sprint with a crash).
  // Host: Tara (doc 08 §2.2) — speaks before/after only, never during
  // the duel, never gives trading advice. Winner by CRISIS risk-adjusted
  // return (docs/15 §5): the sprint formula, with the loss branch
  // dividing instead of multiplying (see crisis-scoring.ts).
  /** Crisis Duel host (speaks before/after only). */
  CRISIS_HOST_NAME: 'Tara',
  /** Earliest crash minute of the 15 (docs/15 §4): crashMinute =
   * CRISIS_CRASH_MIN_MINUTE + (hash(seed) % CRISIS_CRASH_MINUTE_SPAN),
   * i.e. minute 7–10. Never disclosed to players in advance. */
  CRISIS_CRASH_MIN_MINUTE: 7,
  /** Crash-minute span: 4 values (minutes 7, 8, 9, 10). */
  CRISIS_CRASH_MINUTE_SPAN: 4,
  /** Total crash drop, in % of the pre-crash price, over
   * CRISIS_CRASH_DROP_MINUTES minutes (docs/15 §4). */
  CRISIS_CRASH_DROP_PCT: 12,
  /** Minutes the crash fall takes (a straight-line fall, same for all
   * 6 instruments, identical for both players). */
  CRISIS_CRASH_DROP_MINUTES: 3,
  /** Partial recovery after the fall, in % of the pre-crash price,
   * over CRISIS_CRASH_RECOVERY_MINUTES minutes (docs/15 §4). The
   * recovery is load-bearing for the scoring: a player who panic-sells
   * at the bottom locks the full −12% and misses it. */
  CRISIS_CRASH_RECOVERY_PCT: 5,
  /** Minutes the partial recovery takes (a straight-line rise). */
  CRISIS_CRASH_RECOVERY_MINUTES: 5,
  /** Panic-sell threshold (docs/15 §5): a player who sells at least
   * this share of the holdings they held at the crash start, during
   * the crash window, is flagged panicSold on the stored result. The
   * flag is reported, not scored — the missed recovery already prices
   * the panic into the return. */
  CRISIS_PANIC_SELL_SHARE: 0.5,
  /** A crisis duel's Redis state lives this long (seconds): same
   * budget as a sprint (15-min duel + disconnect grace + settlement). */
  CRISIS_STATE_TTL_SEC: 1800,
  /** Crisis queue entries expire after this long without a match (seconds). */
  CRISIS_QUEUE_TTL_SEC: 300,
  // --- Weekly Portfolio Battle (T3, docs/05 §1, docs/08 §3.7, Phase 11) ---
  // A week-long ASYNC trading duel on the Phase 2 deterministic price
  // engine: same fictional market, same starting cash
  // (SIMULATOR_STARTING_CASH), winner by RISK-ADJUSTED return (the
  // sprint family, docs/14 §3). Host: Anaya (doc 08 §2.2) — speaks
  // before/after only, never during the week, never gives trading
  // advice. REST orders only — no WebSocket namespace: a week-long
  // duel has no live clock to push (docs/16 §3, ADR 0013 §3).
  /** Weekly Portfolio Battle host (speaks before/after only). */
  WEEKLY_HOST_NAME: 'Anaya',
  /** Players per league (docs/05 §4/§7 Step 9: league of 30). */
  WEEKLY_LEAGUE_SIZE: 30,
  /** A league needs at least this many players to be a competition. */
  WEEKLY_MIN_LEAGUE_SIZE: 2,
  /** A league never grows past this: a leftover single player merges
   * into the previous league (30 + 1) instead of playing alone
   * (docs/16 §4, ADR 0013 §4). */
  WEEKLY_MAX_LEAGUE_SIZE: 31,
  /** Top this many in a league are promoted one tier at season end. */
  WEEKLY_PROMOTION_COUNT: 3,
  /** Bottom this many in a league are demoted one tier at season end. */
  WEEKLY_RELEGATION_COUNT: 3,
  /** Anti-spam: max orders one player may place in a single weekly
   * season. A week has ~10,080 minutes; 500 is a spam guard, not a
   * strategy limit. */
  WEEKLY_MAX_ORDERS_PER_PLAYER: 500,
  /** Orders are whole units only, at least 1 unit per order. */
  WEEKLY_MIN_ORDER_QTY: 1,
  /** Max units in a single weekly order (anti-abuse bound). */
  WEEKLY_MAX_ORDER_QTY: 100_000,
  /** Risk-adjusted score clamp (same as the sprint, docs/14 §3). */
  WEEKLY_SCORE_CLAMP: 100,
  /** Two risk-adjusted scores within this gap are a tie on score; the
   * higher return then wins, else a draw (same as the sprint). */
  WEEKLY_SCORE_TIE_EPSILON: 0.001,
  /**
   * Matchmaking windows (docs/05 §3.3): the Rating window widens with
   * wait time. `maxWaitSec` is the wait up to which this window applies.
   */
  LIVE_MATCH_WINDOWS: [
    { maxWaitSec: 5, delta: 50 },
    { maxWaitSec: 15, delta: 100 },
    { maxWaitSec: 30, delta: 200 },
    { maxWaitSec: Number.POSITIVE_INFINITY, delta: 400 },
  ] as const,
  /** After this many seconds with no human match, offer the Mira bot. */
  LIVE_BOT_OFFER_AFTER_SEC: 30,
  /** Disconnect grace (seconds) before a live duel is forfeited (docs/05 §3.1). */
  LIVE_DISCONNECT_GRACE_SEC: 15,
  /** A live duel's Redis state lives this long (seconds) after creation. */
  LIVE_STATE_TTL_SEC: 900,
  /** Live queue entries expire after this long without a match (seconds). */
  LIVE_QUEUE_TTL_SEC: 300,
  // --- Friend Challenge (P2, docs/05 §1, docs/17 Phase 12) -------------------
  // An invite-only start-mode on the existing engines, not a separate
  // engine and not the friends system (doc 06). A challenge is RATED
  // by default (ADR 0014 §3): accepting it, with both Ratings shown
  // on the invite, is the opt-in — there is no unrated toggle.
  /** A challenge invite expires this long after creation (hours). */
  CHALLENGE_EXPIRY_HOURS: 24,
  /** The same limit in milliseconds (the unit the service compares). */
  CHALLENGE_EXPIRY_MS: 24 * 60 * 60 * 1000,
  /** Anti-spam: max challenges one user may create per hour. */
  CHALLENGE_CREATE_PER_HOUR: 10,
  /** A challenge claimed (ACCEPTED) but with no duel created is
   * reverted to PENDING after this long (minutes) — see ADR 0014 §5:
   * ACCEPTED is transient and must never stick. */
  CHALLENGE_STALE_ACCEPTED_MINUTES: 5,
  /** Duel types a challenge may start (docs/17 §2): the six 1v1 live
   * duels only. DAILY and WEEKLY are season-based and cannot be
   * challenged; BOT is practice, never a challenge. */
  CHALLENGE_DUEL_TYPES: ['LIVE', 'BLITZ', 'CASE', 'CHART', 'SPRINT', 'CRISIS'] as const,
} as const;

/** Bot (Mira) base accuracy by the player's Learning Rating (docs/07 §5). */
export const BOT_ACCURACY_BY_RATING: Array<{ maxRating: number; accuracy: number }> = [
  { maxRating: 1099, accuracy: 0.55 },
  { maxRating: 1299, accuracy: 0.65 },
  { maxRating: 1499, accuracy: 0.75 },
  { maxRating: 1699, accuracy: 0.82 },
  { maxRating: Number.POSITIVE_INFINITY, accuracy: 0.88 },
] as const;

/**
 * Paper Trading Sprint bot (Mira) skill bands by the player's Trading
 * Rating (docs/14 §5). The bot is rules-based, not random: a stronger
 * player faces a sharper bot — a lower momentum threshold to act on
 * (she reacts to smaller moves) and a larger position size per trade.
 * - `momentumThreshold`: the 5-minute momentum (fraction) that triggers
 *   a buy (above +threshold) or a trim (below −threshold).
 * - `sizeShare`: the share of her current cash one buy may spend.
 */
export const SPRINT_BOT_BANDS: Array<{
  maxRating: number;
  momentumThreshold: number;
  sizeShare: number;
}> = [
  { maxRating: 1099, momentumThreshold: 0.004, sizeShare: 0.15 },
  { maxRating: 1299, momentumThreshold: 0.0035, sizeShare: 0.18 },
  { maxRating: 1499, momentumThreshold: 0.003, sizeShare: 0.2 },
  { maxRating: 1699, momentumThreshold: 0.0025, sizeShare: 0.22 },
  { maxRating: Number.POSITIVE_INFINITY, momentumThreshold: 0.002, sizeShare: 0.25 },
] as const;
