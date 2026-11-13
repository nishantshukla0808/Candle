import { ErrorCode } from '@candle/shared';

/**
 * AppError — the ONLY error type thrown for expected failures.
 * Carries an ErrorCode from the shared catalogue, an HTTP status,
 * a client-safe message, and optional details. Services throw these;
 * GlobalExceptionFilter maps them to the standard envelope (blueprint §7).
 *
 * Business rules (e.g. "already completed") are domain errors with their
 * own codes — never VALIDATION_FAILED (blueprint §8).
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;
  readonly isOperational = true;

  constructor(code: ErrorCode, status: number, message?: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
  }

  /** Shorthand factories for the catalogue codes. */
  static validationFailed(details: unknown, message?: string): AppError {
    return new AppError(ErrorCode.VALIDATION_FAILED, 400, message, details);
  }
  static unauthorized(message?: string): AppError {
    return new AppError(ErrorCode.UNAUTHORIZED, 401, message);
  }
  static forbidden(message?: string): AppError {
    return new AppError(ErrorCode.FORBIDDEN, 403, message);
  }
  static notFound(message?: string): AppError {
    return new AppError(ErrorCode.NOT_FOUND, 404, message);
  }
  static conflict(message?: string): AppError {
    return new AppError(ErrorCode.CONFLICT, 409, message);
  }
  static rateLimited(message?: string): AppError {
    return new AppError(ErrorCode.RATE_LIMITED, 429, message);
  }
  static fileTooLarge(message?: string): AppError {
    return new AppError(ErrorCode.FILE_TOO_LARGE, 413, message);
  }
  static unsupportedFileType(message?: string): AppError {
    return new AppError(ErrorCode.UNSUPPORTED_FILE_TYPE, 415, message);
  }
  static requestTimeout(message?: string): AppError {
    return new AppError(ErrorCode.REQUEST_TIMEOUT, 408, message);
  }
  static serviceUnavailable(message?: string): AppError {
    return new AppError(ErrorCode.SERVICE_UNAVAILABLE, 503, message);
  }
  static internal(message?: string): AppError {
    return new AppError(ErrorCode.INTERNAL_ERROR, 500, message);
  }
  /** Domain error: a lesson/module prerequisite is not satisfied (blueprint §8). */
  static prerequisiteNotCompleted(message?: string): AppError {
    return new AppError(ErrorCode.PREREQUISITE_NOT_COMPLETED, 409, message);
  }
  /** Domain error: not enough virtual cash for a simulator BUY (blueprint §8). */
  static insufficientFunds(message?: string): AppError {
    return new AppError(ErrorCode.INSUFFICIENT_FUNDS, 409, message);
  }
  /** Domain error: not enough holdings for a simulator SELL (blueprint §8). */
  static insufficientHoldings(message?: string): AppError {
    return new AppError(ErrorCode.INSUFFICIENT_HOLDINGS, 409, message);
  }
  static emailNotVerified(message?: string): AppError {
    return new AppError(ErrorCode.EMAIL_NOT_VERIFIED, 403, message);
  }
  /** Domain error: a rated event with this idempotency key already exists. */
  static ratingEventDuplicate(message?: string): AppError {
    return new AppError(ErrorCode.RATING_EVENT_DUPLICATE, 409, message);
  }
  /** Domain error: rematch against the same opponent is inside the cooldown. */
  static ratingDuelCooldown(message?: string): AppError {
    return new AppError(ErrorCode.RATING_DUEL_COOLDOWN, 409, message);
  }
  /** Domain error: daily cap for rated events (per pair or per user). */
  static ratingDailyLimit(message?: string): AppError {
    return new AppError(ErrorCode.RATING_DAILY_LIMIT, 409, message);
  }
  /** Domain error: country changed too recently (90-day cooldown). */
  static ratingCountryCooldown(message?: string): AppError {
    return new AppError(ErrorCode.RATING_COUNTRY_COOLDOWN, 409, message);
  }
  /** Domain error: the bank cannot fill a duel set, even after fallback. */
  static questionBankInsufficientCoverage(message?: string): AppError {
    return new AppError(ErrorCode.QUESTION_BANK_INSUFFICIENT_COVERAGE, 409, message);
  }
  /** Domain error: the reviewer is the same person as the author (two-person rule). */
  static questionBankReviewerMustDiffer(message?: string): AppError {
    return new AppError(ErrorCode.QUESTION_BANK_REVIEWER_MUST_DIFFER, 403, message);
  }
  /** Domain error: a workflow transition is not allowed from the current status. */
  static questionBankInvalidTransition(message?: string): AppError {
    return new AppError(ErrorCode.QUESTION_BANK_INVALID_TRANSITION, 409, message);
  }
  /** Domain error: the user already played today's (IST) Daily Duel. */
  static duelDailyAlreadyPlayed(message?: string): AppError {
    return new AppError(ErrorCode.DUEL_DAILY_ALREADY_PLAYED, 409, message);
  }
  /** Domain error: the user hit the Bot Duel daily cap (10/day, IST). */
  static duelBotDailyLimit(message?: string): AppError {
    return new AppError(ErrorCode.DUEL_BOT_DAILY_LIMIT, 409, message);
  }
  /** Domain error: answering/finishing a duel that is not IN_PROGRESS. */
  static duelNotInProgress(message?: string): AppError {
    return new AppError(ErrorCode.DUEL_NOT_IN_PROGRESS, 409, message);
  }
  /** Domain error: the user is already in the live duel queue. */
  static duelAlreadyQueued(message?: string): AppError {
    return new AppError(ErrorCode.DUEL_ALREADY_QUEUED, 409, message);
  }
  /** Domain error: the user is not in the live duel queue. */
  static duelNotInQueue(message?: string): AppError {
    return new AppError(ErrorCode.DUEL_NOT_IN_QUEUE, 409, message);
  }
  /** Domain error: a live duel is no longer active (finished / forfeited). */
  static duelLiveNotActive(message?: string): AppError {
    return new AppError(ErrorCode.DUEL_LIVE_NOT_ACTIVE, 409, message);
  }
  /** Domain error: the user already has a live duel in progress. */
  static duelLiveAlreadyActive(message?: string): AppError {
    return new AppError(ErrorCode.DUEL_LIVE_ALREADY_ACTIVE, 409, message);
  }
  /** Domain error: the user is already in the Paper Trading Sprint queue. */
  static sprintAlreadyQueued(message?: string): AppError {
    return new AppError(ErrorCode.SPRINT_ALREADY_QUEUED, 409, message);
  }
  /** Domain error: the user is not in the Paper Trading Sprint queue. */
  static sprintNotInQueue(message?: string): AppError {
    return new AppError(ErrorCode.SPRINT_NOT_IN_QUEUE, 409, message);
  }
  /** Domain error: a Paper Trading Sprint is no longer active (finished / forfeited). */
  static sprintNotActive(message?: string): AppError {
    return new AppError(ErrorCode.SPRINT_NOT_ACTIVE, 409, message);
  }
  /** Domain error: the user already has a Paper Trading Sprint in progress. */
  static sprintAlreadyActive(message?: string): AppError {
    return new AppError(ErrorCode.SPRINT_ALREADY_ACTIVE, 409, message);
  }
  /** Domain error: the user is already in the Crisis Duel queue. */
  static crisisAlreadyQueued(message?: string): AppError {
    return new AppError(ErrorCode.CRISIS_ALREADY_QUEUED, 409, message);
  }
  /** Domain error: the user is not in the Crisis Duel queue. */
  static crisisNotInQueue(message?: string): AppError {
    return new AppError(ErrorCode.CRISIS_NOT_IN_QUEUE, 409, message);
  }
  /** Domain error: a Crisis Duel is no longer active (finished / forfeited). */
  static crisisNotActive(message?: string): AppError {
    return new AppError(ErrorCode.CRISIS_NOT_ACTIVE, 409, message);
  }
  /** Domain error: the user already has a Crisis Duel in progress. */
  static crisisAlreadyActive(message?: string): AppError {
    return new AppError(ErrorCode.CRISIS_ALREADY_ACTIVE, 409, message);
  }
  /** Domain error: the user already joined this weekly season. */
  static weeklyAlreadyJoined(message?: string): AppError {
    return new AppError(ErrorCode.WEEKLY_ALREADY_JOINED, 409, message);
  }
  /** Domain error: joining this weekly season is closed (already started). */
  static weeklyJoinClosed(message?: string): AppError {
    return new AppError(ErrorCode.WEEKLY_JOIN_CLOSED, 409, message);
  }
  /** Domain error: this weekly season has not started yet. */
  static weeklyNotStarted(message?: string): AppError {
    return new AppError(ErrorCode.WEEKLY_NOT_STARTED, 409, message);
  }
  /** Domain error: this weekly season is not active any more. */
  static weeklyNotActive(message?: string): AppError {
    return new AppError(ErrorCode.WEEKLY_NOT_ACTIVE, 409, message);
  }
  /** Domain error: this weekly season has not ended yet. */
  static weeklyNotEnded(message?: string): AppError {
    return new AppError(ErrorCode.WEEKLY_NOT_ENDED, 409, message);
  }
  /** Domain error: this weekly season is already settled. */
  static weeklyAlreadySettled(message?: string): AppError {
    return new AppError(ErrorCode.WEEKLY_ALREADY_SETTLED, 409, message);
  }
  /** Domain error: the user is not in a league for this weekly season. */
  static weeklyNotInLeague(message?: string): AppError {
    return new AppError(ErrorCode.WEEKLY_NOT_IN_LEAGUE, 409, message);
  }
  /** Domain error: a pending challenge already exists for this pair + duel type. */
  static challengeAlreadyPending(message?: string): AppError {
    return new AppError(ErrorCode.CHALLENGE_ALREADY_PENDING, 409, message);
  }
  /** Domain error: the challenge invite has expired (24 h, ADR 0014 §4). */
  static challengeExpired(message?: string): AppError {
    return new AppError(ErrorCode.CHALLENGE_EXPIRED, 409, message);
  }
  /** Domain error: accept/decline on a challenge that is not PENDING. */
  static challengeNotPending(message?: string): AppError {
    return new AppError(ErrorCode.CHALLENGE_NOT_PENDING, 409, message);
  }
}
