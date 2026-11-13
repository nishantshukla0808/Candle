import {
  botCorrectOf,
  botOfferDue,
  botScoreOf,
  parseLiveDuelState,
  scoresOf,
  windowForWait,
  type LiveDuelState,
} from './live-duel-state';

/**
 * Live duel state helpers — docs/05 §3.3 (matchmaking windows),
 * docs/09 (Phase 5). Pure: no I/O, no timers.
 */

function makeState(overrides: Partial<LiveDuelState> = {}): LiveDuelState {
  return {
    duelId: 'duel-1',
    variant: 'LIVE',
    playerA: {
      userId: 'a',
      displayName: 'Asha',
      rating: 1000,
      score: 100,
      correct: 1,
      totalTimeMs: 4000,
      streak: 0,
      disconnectedAtMs: null,
    },
    playerB: {
      userId: 'b',
      displayName: 'Ravi',
      rating: 1100,
      score: 0,
      correct: 0,
      totalTimeMs: 0,
      streak: 0,
      disconnectedAtMs: null,
    },
    isBot: false,
    botAnswers: null,
    botAnsweredUpToIndex: -1,
    questions: [],
    currentIndex: 0,
    phase: 'IN_PROGRESS',
    countdownEndsAtMs: 0,
    questionStartedAtMs: 0,
    questionDeadlineMs: 15000,
    answers: {},
    reasons: {},
    reasonDeadlineMs: null,
    forfeitedByUserId: null,
    createdAtMs: 0,
    ...overrides,
  };
}

describe('windowForWait (docs/05 §3.3)', () => {
  it.each([
    [0, 50],
    [5000, 50],
    [5001, 100],
    [15000, 100],
    [15001, 200],
    [30000, 200],
    [30001, 400],
    [120000, 400],
  ])('waited %d ms → ±%d', (waitedMs, delta) => {
    expect(windowForWait(waitedMs)).toBe(delta);
  });
});

describe('botOfferDue (docs/05 §3.3)', () => {
  it('is false before 30 s and true at 30 s', () => {
    expect(botOfferDue(29_999)).toBe(false);
    expect(botOfferDue(30_000)).toBe(true);
  });
});

describe('parseLiveDuelState', () => {
  it('returns null for null, garbage, and malformed states', () => {
    expect(parseLiveDuelState(null)).toBeNull();
    expect(parseLiveDuelState('not json')).toBeNull();
    expect(parseLiveDuelState(JSON.stringify({ duelId: 1 }))).toBeNull();
    expect(parseLiveDuelState(JSON.stringify({ duelId: 'x', questions: 'no' }))).toBeNull();
  });

  it('round-trips a state', () => {
    const state = makeState();
    expect(parseLiveDuelState(JSON.stringify(state))).toEqual(state);
  });

  it('defaults a pre-Phase 6 state (no variant / streak) to LIVE with streak 0', () => {
    const legacy = makeState();
    delete (legacy as any).variant;
    delete (legacy.playerA as any).streak;
    const parsed = parseLiveDuelState(JSON.stringify(legacy));
    expect(parsed?.variant).toBe('LIVE');
    expect(parsed?.playerA.streak).toBe(0);
  });

  it('defaults a pre-Phase 7 state (no reason fields) to an empty reason map', () => {
    const legacy = makeState();
    delete (legacy as any).reasons;
    delete (legacy as any).reasonDeadlineMs;
    const parsed = parseLiveDuelState(JSON.stringify(legacy));
    expect(parsed?.reasons).toEqual({});
    expect(parsed?.reasonDeadlineMs).toBeNull();
  });

  it('keeps a CASE variant (never defaults it to LIVE)', () => {
    const state = makeState({ variant: 'CASE' });
    expect(parseLiveDuelState(JSON.stringify(state))?.variant).toBe('CASE');
  });

  it('keeps a CHART variant (never defaults it to LIVE)', () => {
    const state = makeState({ variant: 'CHART' });
    expect(parseLiveDuelState(JSON.stringify(state))?.variant).toBe('CHART');
  });
});

describe('scoresOf / bot scores', () => {
  it('reports both human scores', () => {
    expect(scoresOf(makeState())).toEqual({
      playerA: { userId: 'a', score: 100, correct: 1 },
      playerB: { userId: 'b', score: 0, correct: 0 },
    });
  });

  it('counts only the bot questions she has answered so far', () => {
    const state = makeState({
      playerB: null,
      isBot: true,
      botAnswers: [
        { questionId: 'q1', optionId: '', timeMs: 5000, correct: true, points: 133 },
        { questionId: 'q2', optionId: '', timeMs: 6000, correct: false, points: 0 },
        { questionId: 'q3', optionId: '', timeMs: 4000, correct: true, points: 136 },
      ],
      botAnsweredUpToIndex: 0,
    });
    expect(botScoreOf(state)).toBe(133);
    expect(botCorrectOf(state)).toBe(1);
    expect(scoresOf(state).playerB).toEqual({ userId: 'bot:mira', score: 133, correct: 1 });
    const later = { ...state, botAnsweredUpToIndex: 2 };
    expect(botScoreOf(later)).toBe(269);
    expect(botCorrectOf(later)).toBe(2);
  });
});
