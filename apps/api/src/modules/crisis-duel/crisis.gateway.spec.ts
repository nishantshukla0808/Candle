import { AppError } from '../../common/errors/app-error';
import { CrisisGateway } from './crisis.gateway';

/**
 * CrisisGateway — docs/15 (Phase 10). Transport only: auth at the
 * handshake, payload validation, room joins, delegation to the
 * engine/matchmaking. The mirror of the sprint gateway spec, on the
 * crisis namespace and event names. The engine/matchmaking/ratings
 * are stubs; the socket is a stub that records emits/joins/disconnects.
 */

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function makeSocket(overrides: Record<string, unknown> = {}): any {
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
    activeTradingDuelSummary: jest.fn().mockResolvedValue(null),
    handleReconnect: jest.fn().mockResolvedValue(undefined),
    handleDisconnect: jest.fn().mockResolvedValue(undefined),
    matchedPayload: jest.fn((state: any, userId: string) => ({
      duelId: state.duelId,
      opponent: { userId: 'other', displayName: 'Ravi', rating: 1000, kind: 'HUMAN' },
      host: { name: 'Tara', line: 'A crash is coming. Stay calm.' },
      startingCash: '100000.00',
      countdownEndsAtMs: 0,
      serverNowMs: 0,
      forUser: userId,
    })),
    createCrisis: jest.fn(),
    createBotCrisis: jest.fn(),
    placeOrder: jest.fn(),
    leaveSprint: jest.fn(),
    rematch: jest.fn(),
    getState: jest.fn(),
  };
  const matchmaking = {
    enqueue: jest
      .fn()
      .mockResolvedValue({ queued: true, waitedMs: 0, ratingWindow: 50, botOfferDue: false }),
    dequeue: jest.fn().mockResolvedValue(undefined),
    status: jest
      .fn()
      .mockResolvedValue({ queued: false, waitedMs: 0, ratingWindow: 50, botOfferDue: false }),
    sweep: jest.fn().mockResolvedValue([]),
  };
  const ratings = {
    getUserRatings: jest.fn().mockResolvedValue({ trading: { rating: 1000 } }),
  };
  const tokens = {
    verifyAccessToken: jest.fn().mockImplementation(async (token: string) => {
      if (token !== 'good-token') throw new Error('bad token');
      return { sub: 'user-a', email: 'a@example.com', roles: [] };
    }),
  };
  const repo = {
    findUserById: jest.fn().mockResolvedValue({ id: 'user-a', displayName: 'Asha' }),
    findDuelById: jest.fn().mockResolvedValue(null),
  };
  const logger = { info: jest.fn(), error: jest.fn(), warn: jest.fn() } as never;
  const gateway = new CrisisGateway(
    engine as any,
    matchmaking as any,
    ratings as any,
    tokens as any,
    repo as any,
    logger
  );
  gateway.server = { to: jest.fn(() => ({ emit: jest.fn() })) } as any;
  return { gateway, engine, matchmaking, ratings, tokens, repo, logger };
}

describe('CrisisGateway', () => {
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
    await flush();
  });

  it('on reconnect to an active crisis, rejoins the crisis room and resumes', async () => {
    const { gateway, engine } = makeGateway();
    engine.activeTradingDuelSummary.mockResolvedValue({
      duelId: '11111111-1111-4111-8111-111111111111',
      phase: 'TRADING',
      type: 'CRISIS',
    });
    const socket = makeSocket();
    await gateway.handleConnection(socket);
    expect(socket.join).toHaveBeenCalledWith('crisis:11111111-1111-4111-8111-111111111111');
    expect(engine.handleReconnect).toHaveBeenCalledWith('user-a');
    gateway.handleDisconnect(socket);
    await flush();
  });

  it('join-queue enqueues on the Trading Rating, emits crisis:queued with host Tara, and acks', async () => {
    const { gateway, matchmaking, ratings } = makeGateway();
    const socket = makeSocket();
    await gateway.handleConnection(socket);
    const ack = await gateway.onJoinQueue(socket, {});
    expect(ratings.getUserRatings).toHaveBeenCalledWith('user-a');
    expect(matchmaking.enqueue).toHaveBeenCalledWith('user-a', 1000, expect.any(Date));
    expect(socket.emit).toHaveBeenCalledWith(
      'crisis:queued',
      expect.objectContaining({
        queued: true,
        ratingWindow: 50,
        host: expect.objectContaining({ name: 'Tara' }),
      })
    );
    expect(ack.ok).toBe(true);
    gateway.onModuleDestroy();
  });

  it('join-queue surfaces the already-queued error as an ack, not a crash', async () => {
    const { gateway, matchmaking } = makeGateway();
    matchmaking.enqueue.mockRejectedValue(AppError.crisisAlreadyQueued());
    const socket = makeSocket();
    await gateway.handleConnection(socket);
    const ack = await gateway.onJoinQueue(socket, {});
    expect(ack).toMatchObject({ ok: false, code: 'CRISIS_ALREADY_QUEUED' });
    gateway.onModuleDestroy();
  });

  it('leave-queue dequeues, emits crisis:queue-left, and acks', async () => {
    const { gateway, matchmaking } = makeGateway();
    const socket = makeSocket();
    await gateway.handleConnection(socket);
    const ack = await gateway.onLeaveQueue(socket);
    expect(matchmaking.dequeue).toHaveBeenCalledWith('user-a');
    expect(socket.emit).toHaveBeenCalledWith('crisis:queue-left', { userId: 'user-a' });
    expect(ack.ok).toBe(true);
    gateway.onModuleDestroy();
  });

  it('accept-bot before 30 s is refused; after 30 s it creates the bot crisis', async () => {
    const { gateway, matchmaking, engine } = makeGateway();
    const socket = makeSocket();
    await gateway.handleConnection(socket);

    const early = await gateway.onAcceptBot(socket);
    expect(early).toMatchObject({ ok: false, code: 'CRISIS_NOT_IN_QUEUE' });
    expect(engine.createBotCrisis).not.toHaveBeenCalled();

    matchmaking.status.mockResolvedValue({
      queued: true,
      waitedMs: 31000,
      ratingWindow: 400,
      botOfferDue: true,
    });
    engine.createBotCrisis.mockResolvedValue({
      duelId: '22222222-2222-4222-8222-222222222222',
      countdownEndsAtMs: 1000,
      playerA: { userId: 'user-a' },
      playerB: { userId: 'bot:mira' },
    });
    const late = await gateway.onAcceptBot(socket);
    expect(late).toMatchObject({
      ok: true,
      duelId: '22222222-2222-4222-8222-222222222222',
      opponent: 'BOT',
    });
    expect(socket.emit).toHaveBeenCalledWith(
      'crisis:matched',
      expect.objectContaining({ duelId: '22222222-2222-4222-8222-222222222222' })
    );
    expect(socket.emit).toHaveBeenCalledWith(
      'crisis:countdown',
      expect.objectContaining({ duelId: '22222222-2222-4222-8222-222222222222' })
    );
    gateway.onModuleDestroy();
  });

  it('order validates the payload, then delegates and acks the order + portfolio', async () => {
    const { gateway, engine } = makeGateway();
    const socket = makeSocket();
    await gateway.handleConnection(socket);

    const bad = await gateway.onOrder(socket, {
      duelId: '11111111-1111-4111-8111-111111111111',
      instrumentId: '55555555-5555-4555-8555-555555555555',
      side: 'BUY',
      quantity: 0,
      clientOrderId: '66666666-6666-4666-8666-666666666666',
    });
    expect(bad.ok).toBe(false);
    expect(bad.code).toBe('VALIDATION_FAILED');
    expect(engine.placeOrder).not.toHaveBeenCalled();

    engine.placeOrder.mockResolvedValue({
      order: { clientOrderId: '66666666-6666-4666-8666-666666666666', quantity: '10.000000' },
      portfolio: { cash: '91575.00' },
    });
    const good = await gateway.onOrder(socket, {
      duelId: '11111111-1111-4111-8111-111111111111',
      instrumentId: '55555555-5555-4555-8555-555555555555',
      side: 'BUY',
      quantity: 10,
      clientOrderId: '66666666-6666-4666-8666-666666666666',
    });
    expect(good.ok).toBe(true);
    expect(engine.placeOrder).toHaveBeenCalledWith(
      'user-a',
      '11111111-1111-4111-8111-111111111111',
      expect.objectContaining({
        instrumentId: '55555555-5555-4555-8555-555555555555',
        side: 'BUY',
        quantity: 10,
        clientOrderId: '66666666-6666-4666-8666-666666666666',
      })
    );
    gateway.onModuleDestroy();
  });

  it('leave-duel forfeits through the engine and acks', async () => {
    const { gateway, engine } = makeGateway();
    const socket = makeSocket();
    await gateway.handleConnection(socket);
    const ack = await gateway.onLeaveDuel(socket, {
      duelId: '11111111-1111-4111-8111-111111111111',
    });
    expect(engine.leaveSprint).toHaveBeenCalledWith(
      'user-a',
      '11111111-1111-4111-8111-111111111111'
    );
    expect(ack).toEqual({ ok: true, forfeited: true });
    gateway.onModuleDestroy();
  });

  it('rematch waits for the opponent, then matches both into the new crisis', async () => {
    const { gateway, engine, repo } = makeGateway();
    const socketA = makeSocket();
    await gateway.handleConnection(socketA);
    const socketB = makeSocket();
    await gateway.handleConnection(socketB);
    socketB.data.user = { sub: 'user-b', email: 'b@example.com', roles: [] };
    const sockets = (gateway as unknown as { sockets: Map<string, unknown> }).sockets;
    sockets.set('user-b', socketB);
    sockets.set('user-a', socketA);

    engine.rematch
      .mockResolvedValueOnce({ matched: false, reason: 'WAITING_OPPONENT' })
      .mockResolvedValueOnce({ matched: true, newDuelId: '33333333-3333-4333-8333-333333333333' });
    repo.findDuelById.mockResolvedValue({
      id: '33333333-3333-4333-8333-333333333333',
      playerAId: 'user-a',
      playerBId: 'user-b',
    });
    engine.getState.mockResolvedValue({
      duelId: '33333333-3333-4333-8333-333333333333',
      countdownEndsAtMs: 1000,
    });

    const waiting = await gateway.onRematch(socketA, {
      duelId: '11111111-1111-4111-8111-111111111111',
    });
    expect(waiting).toMatchObject({ ok: true, matched: false, reason: 'WAITING_OPPONENT' });

    const matched = await gateway.onRematch(socketA, {
      duelId: '11111111-1111-4111-8111-111111111111',
    });
    expect(matched).toMatchObject({
      ok: true,
      matched: true,
      newDuelId: '33333333-3333-4333-8333-333333333333',
    });
    expect(socketA.emit).toHaveBeenCalledWith(
      'crisis:matched',
      expect.objectContaining({ duelId: '33333333-3333-4333-8333-333333333333' })
    );
    expect(socketB.emit).toHaveBeenCalledWith(
      'crisis:matched',
      expect.objectContaining({ duelId: '33333333-3333-4333-8333-333333333333' })
    );
    gateway.onModuleDestroy();
  });

  it('sweep pairs crisis waiters into a crisis and emits matched to both', async () => {
    const { gateway, engine, matchmaking, repo, ratings } = makeGateway();
    const socketA = makeSocket();
    await gateway.handleConnection(socketA);
    const socketB = makeSocket();
    await gateway.handleConnection(socketB);
    socketB.data.user = { sub: 'user-b', email: 'b@example.com', roles: [] };
    const sockets = (gateway as unknown as { sockets: Map<string, unknown> }).sockets;
    sockets.set('user-b', socketB);
    sockets.set('user-a', socketA);

    matchmaking.sweep.mockResolvedValue([
      { a: { userId: 'user-a', rating: 1000 }, b: { userId: 'user-b', rating: 1010 } },
    ]);
    repo.findUserById.mockImplementation(async (id: string) => ({
      id,
      displayName: id === 'user-a' ? 'Asha' : 'Ravi',
    }));
    ratings.getUserRatings.mockImplementation(async (id: string) => ({
      trading: { rating: id === 'user-a' ? 1000 : 1010 },
    }));
    engine.createCrisis.mockResolvedValue({
      duelId: '44444444-4444-4444-8444-444444444444',
      countdownEndsAtMs: 1000,
    });

    await gateway.onJoinQueue(socketA, {});
    expect(engine.createCrisis).toHaveBeenCalled();
    expect(engine.createBotCrisis).not.toHaveBeenCalled(); // a human pair, never a bot
    expect(socketA.emit).toHaveBeenCalledWith(
      'crisis:matched',
      expect.objectContaining({ duelId: '44444444-4444-4444-8444-444444444444' })
    );
    expect(socketB.emit).toHaveBeenCalledWith(
      'crisis:matched',
      expect.objectContaining({ duelId: '44444444-4444-4444-8444-444444444444' })
    );
    gateway.onModuleDestroy();
  });

  it('disconnect removes the socket and dequeues', async () => {
    const { gateway, matchmaking } = makeGateway();
    const socket = makeSocket();
    await gateway.handleConnection(socket);
    gateway.handleDisconnect(socket);
    await flush();
    expect(matchmaking.dequeue).toHaveBeenCalledWith('user-a');
    gateway.onModuleDestroy();
  });
});
