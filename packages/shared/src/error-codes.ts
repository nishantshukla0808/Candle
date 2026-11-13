/**
 * Error catalogue — blueprint §7.
 *
 * Every API error carries one of these codes. The HTTP status is fixed
 * per code and lives with the API (see apps/api error-code->status map),
 * so clients can rely on the code alone.
 */
export enum ErrorCode {
  VALIDATION_FAILED = 'VALIDATION_FAILED',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  NOT_FOUND = 'NOT_FOUND',
  CONFLICT = 'CONFLICT',
  RATE_LIMITED = 'RATE_LIMITED',
  FILE_TOO_LARGE = 'FILE_TOO_LARGE',
  UNSUPPORTED_FILE_TYPE = 'UNSUPPORTED_FILE_TYPE',
  IDEMPOTENCY_REPLAY = 'IDEMPOTENCY_REPLAY',
  REQUEST_TIMEOUT = 'REQUEST_TIMEOUT',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  // Phase 1 domain codes (blueprint §7: the list lives in code).
  PREREQUISITE_NOT_COMPLETED = 'PREREQUISITE_NOT_COMPLETED',
  EMAIL_NOT_VERIFIED = 'EMAIL_NOT_VERIFIED',
  // Phase 2 domain codes (simulator money-like effects — blueprint §8:
  // business rules are domain errors, never validation errors).
  INSUFFICIENT_FUNDS = 'INSUFFICIENT_FUNDS',
  INSUFFICIENT_HOLDINGS = 'INSUFFICIENT_HOLDINGS',
  // Onboarding assessment domain codes (docs/03-onboarding-assessment-design.md §6).
  ASSESSMENT_NOT_FOUND = 'ASSESSMENT_NOT_FOUND',
  ASSESSMENT_ALREADY_SUBMITTED = 'ASSESSMENT_ALREADY_SUBMITTED',
  ASSESSMENT_RETAKE_TOO_SOON = 'ASSESSMENT_RETAKE_TOO_SOON',
  ASSESSMENT_ATTEMPTS_EXHAUSTED = 'ASSESSMENT_ATTEMPTS_EXHAUSTED',
  PLACEMENT_ALREADY_ACCEPTED = 'PLACEMENT_ALREADY_ACCEPTED',
  // Phase 3 domain codes (Ratings — docs/04-ratings-and-deployment.md).
  RATING_EVENT_DUPLICATE = 'RATING_EVENT_DUPLICATE',
  RATING_DUEL_COOLDOWN = 'RATING_DUEL_COOLDOWN',
  RATING_DAILY_LIMIT = 'RATING_DAILY_LIMIT',
  RATING_COUNTRY_COOLDOWN = 'RATING_COUNTRY_COOLDOWN',
  // Phase 3 domain codes (Question Bank — docs/05-duels-system-design.md §2).
  QUESTION_BANK_INSUFFICIENT_COVERAGE = 'QUESTION_BANK_INSUFFICIENT_COVERAGE',
  QUESTION_BANK_REVIEWER_MUST_DIFFER = 'QUESTION_BANK_REVIEWER_MUST_DIFFER',
  QUESTION_BANK_INVALID_TRANSITION = 'QUESTION_BANK_INVALID_TRANSITION',
  // Phase 4 domain codes (Duels Step 2 — Bot Duel + Async Daily Duel, docs/05 §1).
  DUEL_DAILY_ALREADY_PLAYED = 'DUEL_DAILY_ALREADY_PLAYED',
  DUEL_BOT_DAILY_LIMIT = 'DUEL_BOT_DAILY_LIMIT',
  DUEL_NOT_IN_PROGRESS = 'DUEL_NOT_IN_PROGRESS',
  // Phase 5 domain codes (Live Speed Quiz Duel L1 — docs/05 §3, docs/09).
  DUEL_ALREADY_QUEUED = 'DUEL_ALREADY_QUEUED',
  DUEL_NOT_IN_QUEUE = 'DUEL_NOT_IN_QUEUE',
  DUEL_LIVE_NOT_ACTIVE = 'DUEL_LIVE_NOT_ACTIVE',
  DUEL_LIVE_ALREADY_ACTIVE = 'DUEL_LIVE_ALREADY_ACTIVE',
  // Phase 9 domain codes (Paper Trading Sprint T1 — docs/05 §1, docs/14).
  SPRINT_ALREADY_QUEUED = 'SPRINT_ALREADY_QUEUED',
  SPRINT_NOT_IN_QUEUE = 'SPRINT_NOT_IN_QUEUE',
  SPRINT_NOT_ACTIVE = 'SPRINT_NOT_ACTIVE',
  SPRINT_ALREADY_ACTIVE = 'SPRINT_ALREADY_ACTIVE',
  // Phase 10 domain codes (Crisis Duel T2 — docs/05 §1, docs/15).
  CRISIS_ALREADY_QUEUED = 'CRISIS_ALREADY_QUEUED',
  CRISIS_NOT_IN_QUEUE = 'CRISIS_NOT_IN_QUEUE',
  CRISIS_NOT_ACTIVE = 'CRISIS_NOT_ACTIVE',
  CRISIS_ALREADY_ACTIVE = 'CRISIS_ALREADY_ACTIVE',
  // Phase 11 domain codes (Weekly Portfolio Battle T3 — docs/05 §1, docs/16).
  WEEKLY_ALREADY_JOINED = 'WEEKLY_ALREADY_JOINED',
  WEEKLY_JOIN_CLOSED = 'WEEKLY_JOIN_CLOSED',
  WEEKLY_NOT_STARTED = 'WEEKLY_NOT_STARTED',
  WEEKLY_NOT_ACTIVE = 'WEEKLY_NOT_ACTIVE',
  WEEKLY_NOT_ENDED = 'WEEKLY_NOT_ENDED',
  WEEKLY_ALREADY_SETTLED = 'WEEKLY_ALREADY_SETTLED',
  WEEKLY_NOT_IN_LEAGUE = 'WEEKLY_NOT_IN_LEAGUE',
  // Phase 12 domain codes (Friend Challenge P2 — docs/05 §1, docs/17).
  CHALLENGE_ALREADY_PENDING = 'CHALLENGE_ALREADY_PENDING',
  CHALLENGE_EXPIRED = 'CHALLENGE_EXPIRED',
  CHALLENGE_NOT_PENDING = 'CHALLENGE_NOT_PENDING',
}

/** Human-readable, client-safe default message per code. */
export const ERROR_DEFAULT_MESSAGES: Record<ErrorCode, string> = {
  [ErrorCode.VALIDATION_FAILED]: 'The request could not be validated.',
  [ErrorCode.UNAUTHORIZED]: 'Authentication is required.',
  [ErrorCode.FORBIDDEN]: 'You do not have permission to perform this action.',
  [ErrorCode.NOT_FOUND]: 'The requested resource was not found.',
  [ErrorCode.CONFLICT]: 'The request conflicts with the current state.',
  [ErrorCode.RATE_LIMITED]: 'Too many requests. Please slow down and try again.',
  [ErrorCode.FILE_TOO_LARGE]: 'The uploaded file exceeds the allowed size.',
  [ErrorCode.UNSUPPORTED_FILE_TYPE]: 'The uploaded file type is not supported.',
  [ErrorCode.IDEMPOTENCY_REPLAY]: 'This request was already processed.',
  [ErrorCode.REQUEST_TIMEOUT]: 'The request took too long to process.',
  [ErrorCode.SERVICE_UNAVAILABLE]: 'A required service is temporarily unavailable.',
  [ErrorCode.INTERNAL_ERROR]: 'Something went wrong. Please try again later.',
  [ErrorCode.PREREQUISITE_NOT_COMPLETED]:
    'Complete the previous lesson (and its quiz) before continuing.',
  [ErrorCode.EMAIL_NOT_VERIFIED]: 'Please verify your email address first.',
  [ErrorCode.INSUFFICIENT_FUNDS]: 'Not enough virtual cash for this order.',
  [ErrorCode.INSUFFICIENT_HOLDINGS]: 'Not enough holdings to sell this quantity.',
  [ErrorCode.ASSESSMENT_NOT_FOUND]: 'Assessment attempt not found.',
  [ErrorCode.ASSESSMENT_ALREADY_SUBMITTED]: 'This assessment was already submitted.',
  [ErrorCode.ASSESSMENT_RETAKE_TOO_SOON]: 'Please wait before retaking the assessment.',
  [ErrorCode.ASSESSMENT_ATTEMPTS_EXHAUSTED]: 'No assessment attempts left for this version.',
  [ErrorCode.PLACEMENT_ALREADY_ACCEPTED]: 'Placement was already accepted for this track.',
  [ErrorCode.RATING_EVENT_DUPLICATE]: 'This rated event was already recorded.',
  [ErrorCode.RATING_DUEL_COOLDOWN]: 'Please wait before a rematch against the same opponent.',
  [ErrorCode.RATING_DAILY_LIMIT]: 'The daily limit for rated events has been reached.',
  [ErrorCode.RATING_COUNTRY_COOLDOWN]: 'Country can only be changed once every 90 days.',
  [ErrorCode.QUESTION_BANK_INSUFFICIENT_COVERAGE]:
    'The question bank does not have enough suitable live questions for this duel set.',
  [ErrorCode.QUESTION_BANK_REVIEWER_MUST_DIFFER]:
    'The reviewer must be a different person from the author.',
  [ErrorCode.QUESTION_BANK_INVALID_TRANSITION]:
    'This status change is not allowed from the current status.',
  [ErrorCode.DUEL_DAILY_ALREADY_PLAYED]:
    'You have already played today’s Daily Duel. Come back tomorrow.',
  [ErrorCode.DUEL_BOT_DAILY_LIMIT]:
    'You have played the maximum number of Bot Duels for today. Come back tomorrow.',
  [ErrorCode.DUEL_NOT_IN_PROGRESS]: 'This duel is not in progress any more.',
  [ErrorCode.DUEL_ALREADY_QUEUED]: 'You are already in the live duel queue.',
  [ErrorCode.DUEL_NOT_IN_QUEUE]: 'You are not in the live duel queue.',
  [ErrorCode.DUEL_LIVE_NOT_ACTIVE]: 'This live duel is not active any more.',
  [ErrorCode.DUEL_LIVE_ALREADY_ACTIVE]:
    'You already have a live duel in progress. Finish or forfeit it first.',
  [ErrorCode.SPRINT_ALREADY_QUEUED]: 'You are already in the Paper Trading Sprint queue.',
  [ErrorCode.SPRINT_NOT_IN_QUEUE]: 'You are not in the Paper Trading Sprint queue.',
  [ErrorCode.SPRINT_NOT_ACTIVE]: 'This Paper Trading Sprint is not active any more.',
  [ErrorCode.SPRINT_ALREADY_ACTIVE]:
    'You already have a Paper Trading Sprint in progress. Finish or forfeit it first.',
  [ErrorCode.CRISIS_ALREADY_QUEUED]: 'You are already in the Crisis Duel queue.',
  [ErrorCode.CRISIS_NOT_IN_QUEUE]: 'You are not in the Crisis Duel queue.',
  [ErrorCode.CRISIS_NOT_ACTIVE]: 'This Crisis Duel is not active any more.',
  [ErrorCode.CRISIS_ALREADY_ACTIVE]:
    'You already have a Crisis Duel in progress. Finish or forfeit it first.',
  [ErrorCode.WEEKLY_ALREADY_JOINED]: 'You have already joined this weekly season.',
  [ErrorCode.WEEKLY_JOIN_CLOSED]:
    'Joining for this weekly season is closed — the season has already started.',
  [ErrorCode.WEEKLY_NOT_STARTED]: 'This weekly season has not started yet.',
  [ErrorCode.WEEKLY_NOT_ACTIVE]: 'This weekly season is not active any more.',
  [ErrorCode.WEEKLY_NOT_ENDED]: 'This weekly season has not ended yet.',
  [ErrorCode.WEEKLY_ALREADY_SETTLED]: 'This weekly season is already settled.',
  [ErrorCode.WEEKLY_NOT_IN_LEAGUE]:
    'You are not in a league for this weekly season, so you cannot trade in it.',
  [ErrorCode.CHALLENGE_ALREADY_PENDING]:
    'You already have a pending challenge with this player for this duel type.',
  [ErrorCode.CHALLENGE_EXPIRED]: 'This challenge has expired. Send a new one to play.',
  [ErrorCode.CHALLENGE_NOT_PENDING]: 'This challenge is no longer waiting for an answer.',
};

/** One per-field validation problem, returned under `error.details`. */
export interface ValidationIssue {
  field: string;
  issue: string;
  /** The rejected value is included only when it is safe (never passwords/tokens). */
  value?: unknown;
}
