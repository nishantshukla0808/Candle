import { LiveDuelsGateway } from './live-duels.gateway';

/**
 * LiveDuelsGateway — docs/09 (Phase 5). Transport only: auth at the
 * handshake, payload validation, room joins, delegation to the engine.
 * The engine/matchmaking/ratings are stubs; the socket is a stub that
 * records emits/joins/disconnects.
 */

function makeSocket(overrides: any = {}): any {
  return {
    id: `socket-${Math.random().toString(36).slice(2)}`,
    data: {},
    handshake: { auth: { token: 'good-token' }, headers: {} },
    emit: jest.fn(),
    join: jest.fn(),
    disconnect: jest.fn(),
    ...overrides,
  };
}

function makeGateway() {
  const engine = {
    bindEmitter: jest.fn(),
    activeDuelSummary: jest.fn().mockResolvedValue(null),
    handleReconnect: jest.fn().mockResolvedValue(undefined),
    handleDisconnect: jest.fn().mockResolvedValue(undefined),
    matchedPayload: jest.fn((state: any, userId: string) => ({
      duelId: state.duelId,
      opponent: { userId: 'other', displayName: 'Ravi', rating: 1000, kind: 'HUMAN' },
      host: { name: 'Mira', line: 'Good luck.' },
      questionCount: 7,
      countdownEndsAtMs: 0,
      serverNowMs: 0,
      forUser: userId,
    })),
    createLiveDuel: jest.fn(),
    createBotDuel: jest.fn(),
    answer: jest.fn(),
    submitReason: jest.fn(),
    leaveDuel: jest.fn(),
    rematch: jest.fn(),
    getState: jest.fn(),
  };
  const matchmaking = {
    enqueue: jest.fn().mockResolvedValue({ queued: true, waitedMs: 0, ratingWindow: 50 }),
    dequeue: jest.fn().mockResolvedValue(undefined),
    status: jest
      .fn()
      .mockResolvedValue({ queued: true, waitedMs: 0, ratingWindow: 50, botOfferDue: false }),
    sweep: jest.fn().mockResolvedValue([]),
  };
  const ratings = {
    getUserRatings: jest.fn().mockResolvedValue({ learning: { rating: 1000 } }),
  };
  const tokens = {
    verifyAccessToken: jest.fn().mockImplementation(async (token: string) => {
      if (token !== 'good-token') throw new Error('bad token');
      return { sub: 'user-a', email: 'a@example.com', roles: [] };
    }),
  };
  const repo = { findUserById: jest.fn().mockResolvedValue({ id: 'user-a', displayName: 'Asha' }) };
  const logger = { info: jest.fn(), error: jest.fn(), warn: jest.fn() };
  const gateway = new LiveDuelsGateway(
    engine as any,
    matchmaking as any,
    ratings as any,
    tokens as any,
    repo as any,
    logger as any
  );
  gateway.server = { to: jest.fn(() => ({ emit: jest.fn() })) } as any;
  return { gateway, engine, matchmaking, ratings, tokens, repo, logger };
}

describe('LiveDuelsGateway', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('disconnects a socket with no token or a bad token', async () => {
    const { gateway } = makeGateway();
    const noToken = makeSocket({ handshake: { auth: {}, headers: {} } });
    await gateway.handleConnection(noToken);
    expect(noToken.disconnect).toHaveBeenCalledWith(true);

    const badToken = makeSocket({ handshake: { auth: { token: 'bad' }, headers: {} } });
    await gateway.handleConnection(badToken);
    expect(badToken.disconnect).toHaveBeenCalledWith(true);
  });

  it('accepts a valid token and attaches the user', async () => {
    const { gateway } = makeGateway();
    const socket = makeSocket();
    await gateway.handleConnection(socket);
    expect(socket.disconnect).not.toHaveBeenCalled();
    expect(socket.data.user.sub).toBe('user-a');
    gateway.handleDisconnect(socket);
  });

  it('join-queue enqueues, emits live:queued, and acks', async () => {
    const { gateway, matchmaking } = makeGateway();
    const socket = makeSocket();
    await gateway.handleConnection(socket);
    const ack = await gateway.onJoinQueue(socket, {});
    expect(matchmaking.enqueue).toHaveBeenCalledWith('user-a', 1000, expect.any(Date), 'LIVE');
    expect(socket.emit).toHaveBeenCalledWith(
      'live:queued',
      expect.objectContaining({ queued: true, ratingWindow: 50 })
    );
    expect(ack.ok).toBe(true);
    gateway.onModuleDestroy();
  });

  it('join-queue with variant BLITZ enqueues into the Blitz queue', async () => {
    const { gateway, matchmaking } = makeGateway();
    matchmaking.enqueue.mockResolvedValue({
      queued: true,
      waitedMs: 0,
      ratingWindow: 50,
      variant: 'BLITZ',
    });
    const socket = makeSocket();
    await gateway.handleConnection(socket);
    const ack = await gateway.onJoinQueue(socket, { variant: 'BLITZ' });
    expect(matchmaking.enqueue).toHaveBeenCalledWith('user-a', 1000, expect.any(Date), 'BLITZ');
    expect(ack.ok).toBe(true);
    expect(ack.variant).toBe('BLITZ');
    gateway.onModuleDestroy();
  });

  it('join-queue with variant CASE enqueues into the Case queue, hosted by Kabir', async () => {
    const { gateway, matchmaking } = makeGateway();
    matchmaking.enqueue.mockResolvedValue({
      queued: true,
      waitedMs: 0,
      ratingWindow: 50,
      variant: 'CASE',
    });
    const socket = makeSocket();
    await gateway.handleConnection(socket);
    const ack = await gateway.onJoinQueue(socket, { variant: 'CASE' });
    expect(matchmaking.enqueue).toHaveBeenCalledWith('user-a', 1000, expect.any(Date), 'CASE');
    expect(ack.ok).toBe(true);
    expect(ack.variant).toBe('CASE');
    gateway.onModuleDestroy();
  });

  it('join-queue with variant CHART enqueues into the Chart queue, hosted by Kabir', async () => {
    const { gateway, matchmaking } = makeGateway();
    matchmaking.enqueue.mockResolvedValue({
      queued: true,
      waitedMs: 0,
      ratingWindow: 50,
      variant: 'CHART',
    });
    const socket = makeSocket();
    await gateway.handleConnection(socket);
    const ack = await gateway.onJoinQueue(socket, { variant: 'CHART' });
    expect(matchmaking.enqueue).toHaveBeenCalledWith('user-a', 1000, expect.any(Date), 'CHART');
    expect(ack.ok).toBe(true);
    expect(ack.variant).toBe('CHART');
    gateway.onModuleDestroy();
  });

  it('join-queue rejects an unknown variant at the boundary', async () => {
    const { gateway, matchmaking } = makeGateway();
    const socket = makeSocket();
    await gateway.handleConnection(socket);
    const ack = await gateway.onJoinQueue(socket, { variant: 'DAILY' });
    expect(ack.ok).toBe(false);
    expect(ack.code).toBe('VALIDATION_FAILED');
    expect(matchmaking.enqueue).not.toHaveBeenCalled();
    gateway.onModuleDestroy();
  });

  it('answer validates the payload before touching the engine', async () => {
    const { gateway, engine } = makeGateway();
    const socket = makeSocket();
    await gateway.handleConnection(socket);
    const bad = await gateway.onAnswer(socket, { duelId: 'not-a-uuid' });
    expect(bad.ok).toBe(false);
    expect(bad.code).toBe('VALIDATION_FAILED');
    expect(engine.answer).not.toHaveBeenCalled();

    engine.answer.mockResolvedValue({ answeredCount: 1, totalQuestions: 7 });
    const good = await gateway.onAnswer(socket, {
      duelId: 'b09f8a85-2fef-499a-85fd-49c4b2807fd4',
      questionId: '174bced2-1423-4a73-b79c-e1d99116752b',
      optionId: 'dbde7cd4-7e9a-45d4-8895-21c40e2f1854',
    });
    expect(good.ok).toBe(true);
    expect(engine.answer).toHaveBeenCalledWith(
      'user-a',
      'b09f8a85-2fef-499a-85fd-49c4b2807fd4',
      '174bced2-1423-4a73-b79c-e1d99116752b',
      'dbde7cd4-7e9a-45d4-8895-21c40e2f1854'
    );
  });

  it('live:reason validates the payload and delegates to the engine', async () => {
    const { gateway, engine } = makeGateway();
    const socket = makeSocket();
    await gateway.handleConnection(socket);
    const bad = await gateway.onReason(socket, {
      duelId: 'not-a-uuid',
      questionId: '174bced2-1423-4a73-b79c-e1d99116752b',
      reason: 'Safest for my goal',
    });
    expect(bad.ok).toBe(false);
    expect(bad.code).toBe('VALIDATION_FAILED');
    expect(engine.submitReason).not.toHaveBeenCalled();

    const tooLong = await gateway.onReason(socket, {
      duelId: 'b09f8a85-2fef-499a-85fd-49c4b2807fd4',
      questionId: '174bced2-1423-4a73-b79c-e1d99116752b',
      reason: 'x'.repeat(81),
    });
    expect(tooLong.ok).toBe(false);
    expect(tooLong.code).toBe('VALIDATION_FAILED');
    expect(engine.submitReason).not.toHaveBeenCalled();

    engine.submitReason.mockResolvedValue({ submitted: true });
    const good = await gateway.onReason(socket, {
      duelId: 'b09f8a85-2fef-499a-85fd-49c4b2807fd4',
      questionId: '174bced2-1423-4a73-b79c-e1d99116752b',
      reason: 'Safest for my goal',
    });
    expect(good.ok).toBe(true);
    expect(engine.submitReason).toHaveBeenCalledWith(
      'user-a',
      'b09f8a85-2fef-499a-85fd-49c4b2807fd4',
      '174bced2-1423-4a73-b79c-e1d99116752b',
      'Safest for my goal'
    );

    // null is an explicit skip — it is still a submission, not an error.
    const skipped = await gateway.onReason(socket, {
      duelId: 'b09f8a85-2fef-499a-85fd-49c4b2807fd4',
      questionId: '174bced2-1423-4a73-b79c-e1d99116752b',
      reason: null,
    });
    expect(skipped.ok).toBe(true);
    expect(engine.submitReason).toHaveBeenCalledWith(
      'user-a',
      'b09f8a85-2fef-499a-85fd-49c4b2807fd4',
      '174bced2-1423-4a73-b79c-e1d99116752b',
      null
    );
    gateway.onModuleDestroy();
  });

  it('sweep matches create the duel, join the room, and emit matched', async () => {
    const { gateway, engine, matchmaking } = makeGateway();
    const state = {
      duelId: 'duel-1',
      countdownEndsAtMs: 123,
      playerA: { userId: 'user-a' },
      playerB: { userId: 'user-b' },
    };
    matchmaking.sweep.mockResolvedValue([
      {
        a: { userId: 'user-a', rating: 1000, joinedAtMs: 0 },
        b: { userId: 'user-b', rating: 1000, joinedAtMs: 0 },
        variant: 'LIVE',
      },
    ]);
    engine.createLiveDuel.mockResolvedValue(state);
    const socketA = makeSocket();
    const socketB = makeSocket();
    await gateway.handleConnection(socketA);
    // Second user connects with a different token identity.
    (gateway as any).tokens.verifyAccessToken.mockResolvedValueOnce({
      sub: 'user-b',
      email: 'b@example.com',
      roles: [],
    });
    socketB.handshake.auth.token = 'good-token';
    await gateway.handleConnection(socketB);
    await gateway.onJoinQueue(socketA, {});
    expect(engine.createLiveDuel).toHaveBeenCalled();
    expect(engine.createLiveDuel.mock.calls[0][3]).toBe('LIVE');
    expect(socketA.join).toHaveBeenCalledWith('duel:duel-1');
    expect(socketB.join).toHaveBeenCalledWith('duel:duel-1');
    expect(socketA.emit).toHaveBeenCalledWith(
      'live:matched',
      expect.objectContaining({ duelId: 'duel-1' })
    );
    expect(socketB.emit).toHaveBeenCalledWith(
      'live:matched',
      expect.objectContaining({ duelId: 'duel-1' })
    );
    gateway.onModuleDestroy();
  });

  it('disconnect of the current socket starts the grace; a replaced socket does not', async () => {
    const { gateway, engine } = makeGateway();
    const first = makeSocket();
    await gateway.handleConnection(first);
    const second = makeSocket();
    await gateway.handleConnection(second);
    expect(first.disconnect).toHaveBeenCalledWith(true);
    // The replaced (first) socket disconnecting now must NOT trigger grace.
    gateway.handleDisconnect(first);
    expect(engine.handleDisconnect).not.toHaveBeenCalled();
    gateway.handleDisconnect(second);
    expect(engine.handleDisconnect).toHaveBeenCalledWith('user-a');
    gateway.onModuleDestroy();
  });
});
