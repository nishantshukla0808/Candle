import {
  crisisDuelRoom,
  crisisDuelStateKey,
  crisisQueueEntryKey,
  crisisQueueKey,
  crisisRematchKey,
  crisisUserDuelKey,
  parseSprintState,
  sprintBotOfferDue,
  sprintDuelStateKey,
  sprintQueueEntryKey,
  sprintQueueKey,
  sprintUserDuelKey,
  sprintWindowForWait,
  type SprintState,
} from './sprint-state';

/** A minimal valid sprint state (COUNTDOWN, two players, no trades). */
function makeState(): SprintState {
  return {
    duelId: 'duel-1',
    variant: 'SPRINT',
    seed: 'seed-1',
    crashMinute: null,
    crashFired: false,
    crashFiredAtMs: null,
    startCash: '100000.00',
    instruments: [{ id: 'i1', symbol: 'NVLT', name: 'NovaVolt Energy', basePrice: '842.50' }],
    playerA: {
      userId: 'a',
      displayName: 'Asha',
      rating: 1000,
      cash: '100000.00',
      holdings: {},
      tradeCount: 0,
      executedOrderIds: [],
      disconnectedAtMs: null,
    },
    playerB: {
      userId: 'b',
      displayName: 'Ravi',
      rating: 1000,
      cash: '100000.00',
      holdings: {},
      tradeCount: 0,
      executedOrderIds: [],
      disconnectedAtMs: null,
    },
    isBot: false,
    phase: 'COUNTDOWN',
    countdownEndsAtMs: 1000,
    startedAtMs: null,
    endsAtMs: null,
    lastSampleMinute: null,
    equityCurve: {},
    trades: [],
    forfeitedByUserId: null,
    createdAtMs: 0,
  };
}

describe('sprint-state', () => {
  it('keys are in the sprint namespace (never the live namespace)', () => {
    expect(sprintDuelStateKey('d1')).toBe('sprint:duel:d1');
    expect(sprintUserDuelKey('u1')).toBe('sprint:user-duel:u1');
    expect(sprintQueueKey()).toBe('sprint:queue');
    expect(sprintQueueEntryKey('u1')).toBe('sprint:queue-entry:u1');
  });

  it('crisis keys are in their own crisis namespace (never sprint:*)', () => {
    expect(crisisDuelStateKey('d1')).toBe('crisis:duel:d1');
    expect(crisisUserDuelKey('u1')).toBe('crisis:user-duel:u1');
    expect(crisisQueueKey()).toBe('crisis:queue');
    expect(crisisQueueEntryKey('u1')).toBe('crisis:queue-entry:u1');
    expect(crisisRematchKey('d1')).toBe('crisis:rematch:d1');
    expect(crisisDuelRoom('d1')).toBe('crisis:d1');
  });

  it('a pre-Phase 10 state without variant/crash fields parses as a sprint', () => {
    const state = makeState();
    const legacy = { ...state };
    delete (legacy as Partial<SprintState>).variant;
    delete (legacy as Partial<SprintState>).crashMinute;
    delete (legacy as Partial<SprintState>).crashFired;
    delete (legacy as Partial<SprintState>).crashFiredAtMs;
    const parsed = parseSprintState(JSON.stringify(legacy));
    expect(parsed?.variant).toBe('SPRINT');
    expect(parsed?.crashMinute).toBeNull();
    expect(parsed?.crashFired).toBe(false);
    expect(parsed?.crashFiredAtMs).toBeNull();
  });

  describe('sprintWindowForWait', () => {
    it('widens with wait: ±50 → ±100 → ±200 → ±400', () => {
      expect(sprintWindowForWait(0)).toBe(50);
      expect(sprintWindowForWait(5000)).toBe(50);
      expect(sprintWindowForWait(5001)).toBe(100);
      expect(sprintWindowForWait(15000)).toBe(100);
      expect(sprintWindowForWait(15001)).toBe(200);
      expect(sprintWindowForWait(30000)).toBe(200);
      expect(sprintWindowForWait(30001)).toBe(400);
    });
  });

  describe('sprintBotOfferDue', () => {
    it('is due at 30 s, not before', () => {
      expect(sprintBotOfferDue(29999)).toBe(false);
      expect(sprintBotOfferDue(30000)).toBe(true);
    });
  });

  describe('parseSprintState', () => {
    it('parses a valid state', () => {
      expect(parseSprintState(JSON.stringify(makeState()))?.duelId).toBe('duel-1');
    });

    it('returns null for null, garbage, and wrong shapes', () => {
      expect(parseSprintState(null)).toBeNull();
      expect(parseSprintState('not json')).toBeNull();
      expect(parseSprintState(JSON.stringify({ duelId: 1 }))).toBeNull();
      expect(parseSprintState(JSON.stringify({ ...makeState(), phase: 'NOPE' }))).toBeNull();
    });

    it('defaults missing curve/trades instead of crashing', () => {
      const raw = JSON.stringify({ ...makeState(), equityCurve: undefined, trades: undefined });
      const parsed = parseSprintState(raw);
      expect(parsed?.equityCurve).toEqual({});
      expect(parsed?.trades).toEqual([]);
    });
  });
});
