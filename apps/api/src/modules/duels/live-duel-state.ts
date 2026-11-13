import { DUELS } from '@candle/shared';
import type { PublicQuestionView } from '../question-bank/question-bank.service';
import type { LiveDuelVariant } from './live-duel-variants';

/**
 * Live duel state — docs/05 §3.1/§3.2, docs/09 (Phase 5).
 *
 * Pure types + helpers (no I/O). The state is the server's picture of
 * one live duel: it lives in Redis (`live:duel:{duelId}`, JSON, TTL
 * DUELS.LIVE_STATE_TTL_SEC) and Postgres is the source of truth only
 * after the duel ends (the Duel row + answers + results). If Redis is
 * lost mid-duel the duel is voided — no Rating changes (docs/05 §3.2).
 *
 * ## Phases (one duel, server is the authority)
 * COUNTDOWN → IN_PROGRESS → REVEAL (per question) → … → FINISHED.
 * The client timer is display only; the server owns every deadline.
 *
 * ## What the state never holds
 * Correct answers. Answers are graded at answer time from the bank
 * (server-side) and stored as DuelAnswer rows; the state holds only
 * whether each player answered, their points, and their scores — so a
 * leaked state can never reveal an answer before its reveal.
 */

export type LiveDuelPhase = 'COUNTDOWN' | 'IN_PROGRESS' | 'REVEAL' | 'FINISHED';

export interface LivePlayerState {
  userId: string;
  displayName: string;
  /** Learning Rating at match time (shown in the queue / matched screens). */
  rating: number;
  score: number;
  correct: number;
  /** Sum of timeMs over answered questions (the tie-break, docs/07 §5). */
  totalTimeMs: number;
  /**
   * Current run of consecutive correct answers (Blitz streak bonus,
   * Phase 6). Reset to 0 on a wrong answer; a skip at settlement
   * breaks the run too (buildGameStats recomputes bestStreak from the
   * stored answers). Speed Quiz never reads this.
   */
  streak: number;
  /** Set when the socket drops; cleared on reconnect (15 s grace). */
  disconnectedAtMs: number | null;
}

export interface LiveAnswerState {
  questionId: string;
  optionId: string;
  timeMs: number;
  correct: boolean;
  points: number;
  /** Case Duel only: the player's one-line reason (null = skipped/missing). */
  reason?: string | null;
}

export interface LiveDuelState {
  duelId: string;
  /** Variant of this duel (LIVE = Speed Quiz, BLITZ = Myth vs Fact, CASE = Case Duel, CHART = Chart Detective). */
  variant: LiveDuelVariant;
  /** Player A is the matchmaker's first player; player B is null vs the bot. */
  playerA: LivePlayerState;
  playerB: LivePlayerState | null;
  /** True when the opponent is the Mira bot (no human player B). */
  isBot: boolean;
  /** Pre-simulated Mira answers, one per question (seeded, replayable). */
  botAnswers: LiveAnswerState[] | null;
  /**
   * Highest question index Mira has "answered" so far (her simulated
   * answer time elapsed). -1 when she has not answered any question yet.
   * Her score counts only answered questions — never future ones.
   */
  botAnsweredUpToIndex: number;
  /** Public question views, same set/order/option order for both sides. */
  questions: PublicQuestionView[];
  currentIndex: number;
  phase: LiveDuelPhase;
  countdownEndsAtMs: number;
  questionStartedAtMs: number | null;
  questionDeadlineMs: number | null;
  /** Answers so far, per player, per question index. */
  answers: Record<string, Record<number, LiveAnswerState>>;
  /**
   * Case Duel only (ADR 0009 §4): reasons submitted per player, per
   * question index. A key is present once the player has submitted a
   * reason (a chip string) or explicitly skipped it (null); absent
   * means "not submitted yet". The bot never submits a reason — her
   * reason is null from the start, so she never blocks the window.
   */
  reasons: Record<string, Record<number, string | null>>;
  /**
   * Case Duel only: server timestamp (ms) when the current question's
   * reason window closes, or null when no reason window is open. The
   * window opens when the question closes for answers (both players
   * answered, or the 45 s deadline) and the reveal is postponed until
   * every player who answered has a reason entry, or this deadline.
   */
  reasonDeadlineMs: number | null;
  /** Set at settlement: who forfeited by disconnecting (if anyone). */
  forfeitedByUserId: string | null;
  createdAtMs: number;
}

export function liveDuelRoom(duelId: string): string {
  return `duel:${duelId}`;
}

export function liveDuelStateKey(duelId: string): string {
  return `live:duel:${duelId}`;
}

export function liveUserDuelKey(userId: string): string {
  return `live:user-duel:${userId}`;
}

export function liveQueueKey(variant: LiveDuelVariant = 'LIVE'): string {
  // One queue per variant (Phase 6): a Speed Quiz waiter must never be
  // matched into a Blitz duel, and vice versa.
  return `live:queue:${variant}`;
}

export function liveQueueEntryKey(userId: string): string {
  return `live:queue-entry:${userId}`;
}

/**
 * Matchmaking window for a wait (docs/05 §3.3): ±50 for the first 5 s,
 * ±100 to 15 s, ±200 to 30 s, ±400 after that. Pure — unit-tested.
 */
export function windowForWait(waitedMs: number): number {
  for (const w of DUELS.LIVE_MATCH_WINDOWS) {
    if (waitedMs <= w.maxWaitSec * 1000) return w.delta;
  }
  return 400;
}

/** The bot offer is due once the player has waited this long (docs/05 §3.3). */
export function botOfferDue(waitedMs: number): boolean {
  return waitedMs >= DUELS.LIVE_BOT_OFFER_AFTER_SEC * 1000;
}

export function parseLiveDuelState(raw: string | null): LiveDuelState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as LiveDuelState;
    if (!parsed || typeof parsed.duelId !== 'string' || !Array.isArray(parsed.questions)) {
      return null;
    }
    // States written before Phase 6 carry no variant / streak: they are
    // Speed Quiz duels with no streak yet (never invent a Blitz state).
    // States written before Phase 7 carry no reason fields: they never
    // had a reason window (only CASE duels do).
    if (
      parsed.variant !== 'LIVE' &&
      parsed.variant !== 'BLITZ' &&
      parsed.variant !== 'CASE' &&
      parsed.variant !== 'CHART'
    ) {
      parsed.variant = 'LIVE';
    }
    if (!parsed.reasons || typeof parsed.reasons !== 'object') parsed.reasons = {};
    if (typeof parsed.reasonDeadlineMs !== 'number') parsed.reasonDeadlineMs = null;
    for (const side of [parsed.playerA, parsed.playerB]) {
      if (side && typeof side.streak !== 'number') side.streak = 0;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function scoresOf(state: LiveDuelState): {
  playerA: { userId: string; score: number; correct: number };
  playerB: { userId: string; score: number; correct: number } | null;
} {
  return {
    playerA: {
      userId: state.playerA.userId,
      score: state.playerA.score,
      correct: state.playerA.correct,
    },
    playerB: state.playerB
      ? {
          userId: state.playerB.userId,
          score: state.playerB.score,
          correct: state.playerB.correct,
        }
      : state.isBot
        ? { userId: 'bot:mira', score: botScoreOf(state), correct: botCorrectOf(state) }
        : null,
  };
}

export function botScoreOf(state: LiveDuelState): number {
  if (!state.botAnswers) return 0;
  return state.botAnswers
    .slice(0, state.botAnsweredUpToIndex + 1)
    .reduce((sum, a) => sum + a.points, 0);
}

export function botCorrectOf(state: LiveDuelState): number {
  if (!state.botAnswers) return 0;
  return state.botAnswers.slice(0, state.botAnsweredUpToIndex + 1).filter((a) => a.correct).length;
}
