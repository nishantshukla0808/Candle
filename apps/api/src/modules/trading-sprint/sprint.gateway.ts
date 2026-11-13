import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { Server, Socket } from 'socket.io';
import { DUELS, ErrorCode } from '@candle/shared';
import { AppError } from '../../common/errors/app-error';
import { AppLogger } from '../../common/services/logger.service';
import type { RequestUser } from '../../common/decorators/current-user.decorator';
import { TokenService } from '../auth/token.service';
import { RatingsService } from '../ratings/ratings.service';
import { SprintEngine, type SprintEmitter } from './sprint-engine.service';
import { SprintMatchmakingService } from './sprint-matchmaking.service';
import { SprintRepository } from './sprint.repository';
import { sprintDuelRoom, type SprintState } from './sprint-state';
import { SprintDuelIdSocketDto, SprintOrderSocketDto } from './dto/sprint.dto';

/**
 * SprintGateway — docs/05 §3.2/§3.4, docs/14 (Phase 9).
 *
 * Socket.IO namespace `/sprint`. Transport only: it authenticates the
 * handshake, validates every payload, joins sockets to one room per
 * sprint (`sprint:{duelId}`), and delegates every rule to
 * SprintMatchmakingService / SprintEngine. No scoring, timing, or
 * Rating logic lives here.
 *
 * Auth: the access JWT travels in the handshake (`auth.token`, or an
 * `Authorization: Bearer <token>` header) and is verified exactly like
 * HTTP (TokenService.verifyAccessToken). No anonymous sprints.
 * One socket per user: a second connection replaces the first — the
 * old socket's disconnect starts the 15-second grace, and the new
 * socket's reconnect clears it (docs/05 §3.1).
 *
 * Every handler answers with an ack `{ ok: true, ... }` or
 * `{ ok: false, code, message }`; asynchronous sprint events arrive as
 * `sprint:*` broadcasts. Errors never leak internals (blueprint §2.5).
 *
 * CORS: the namespace accepts only WEB_ORIGIN (same allow-list as
 * HTTP). Sticky sessions are REQUIRED in multi-server deploys — see
 * docs/09 §7 and the Redis adapter (live-redis.adapter.ts, shared
 * with this namespace by the Socket.IO server).
 */

interface SocketAck {
  ok: boolean;
  code?: string;
  message?: string;
  [key: string]: unknown;
}

type SocketData = { user?: RequestUser };

@WebSocketGateway({
  namespace: '/sprint',
  cors: {
    origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000',
    credentials: true,
  },
})
export class SprintGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, SprintEmitter
{
  @WebSocketServer()
  server!: Server;

  /** userId → sprint socket (one socket per user). */
  private readonly sockets = new Map<string, Socket>();
  /** userId → bot-offer timer armed at queue join (30 s, docs/05 §3.3). */
  private readonly botOfferTimers = new Map<string, NodeJS.Timeout>();
  /** Matchmaking sweep timer (5 s): pairs waiters whose windows overlap. */
  private sweepTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly engine: SprintEngine,
    private readonly matchmaking: SprintMatchmakingService,
    private readonly ratings: RatingsService,
    private readonly tokens: TokenService,
    private readonly repo: SprintRepository,
    private readonly logger: AppLogger
  ) {}

  afterInit(): void {
    this.engine.bindEmitter(this, 'SPRINT');
    this.sweepTimer = setInterval(() => {
      void this.sweepMatches().catch((err: unknown) => {
        this.logger.error('Sprint matchmaking sweep failed', {
          err: err instanceof Error ? err.message : String(err),
        });
      });
    }, 5000);
    if (typeof this.sweepTimer.unref === 'function') this.sweepTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    for (const t of this.botOfferTimers.values()) clearTimeout(t);
    this.botOfferTimers.clear();
  }

  // --- SprintEmitter (the engine calls back through these) --------------------

  toUser(userId: string, event: string, payload: unknown): void {
    this.sockets.get(userId)?.emit(event, payload);
  }

  toRoom(duelId: string, event: string, payload: unknown): void {
    this.server?.to(sprintDuelRoom(duelId)).emit(event, payload);
  }

  // --- connection lifecycle ---------------------------------------------------------

  async handleConnection(socket: Socket): Promise<void> {
    const token = this.tokenFromHandshake(socket);
    if (!token) {
      socket.disconnect(true);
      return;
    }
    let user: RequestUser;
    try {
      user = await this.tokens.verifyAccessToken(token);
    } catch {
      socket.disconnect(true);
      return;
    }
    (socket.data as SocketData).user = user;
    const previous = this.sockets.get(user.sub);
    if (previous && previous.id !== socket.id) {
      // Replaced: the old socket's disconnect starts the grace; this
      // connection's reconnect (below) clears it again.
      previous.disconnect(true);
    }
    this.sockets.set(user.sub, socket);
    // Reconnect to an active sprint: rejoin the room, clear the grace,
    // and resend the current sprint state (docs/05 §3.1).
    const active = await this.engine.activeSprintSummary(user.sub).catch(() => null);
    if (active) {
      void socket.join(sprintDuelRoom(active.duelId));
      await this.engine.handleReconnect(user.sub);
    }
    this.logger.info('Sprint socket connected', { userId: user.sub });
  }

  handleDisconnect(socket: Socket): void {
    const user = (socket.data as SocketData).user;
    if (!user) return;
    // Only the CURRENT socket's disconnect starts the grace: a
    // replaced socket disconnecting after its replacement must not
    // forfeit the live connection.
    if (this.sockets.get(user.sub)?.id !== socket.id) return;
    this.sockets.delete(user.sub);
    void this.matchmaking.dequeue(user.sub).catch(() => undefined);
    this.clearBotOfferTimer(user.sub);
    void this.engine.handleDisconnect(user.sub).catch((err: unknown) => {
      this.logger.error('Sprint disconnect handling failed', {
        userId: user.sub,
        err: err instanceof Error ? err.message : String(err),
      });
    });
  }

  // --- queue ---------------------------------------------------------------------------

  @SubscribeMessage('sprint:join-queue')
  async onJoinQueue(socket: Socket, _payload: unknown): Promise<SocketAck> {
    const user = this.requireUser(socket);
    if (!user)
      return { ok: false, code: ErrorCode.UNAUTHORIZED, message: 'Authentication is required.' };
    try {
      // No payload to validate: join-queue carries no fields — the
      // server reads the caller's Trading Rating.
      const rating = (await this.ratings.getUserRatings(user.sub)).trading.rating;
      const status = await this.matchmaking.enqueue(user.sub, rating, new Date());
      socket.emit('sprint:queued', {
        ...status,
        host: {
          name: DUELS.SPRINT_HOST_NAME,
          line: 'Finding you an opponent at your Trading Rating…',
        },
      });
      this.armBotOfferTimer(user.sub);
      await this.sweepMatches();
      return {
        ok: true,
        queued: true,
        waitedMs: status.waitedMs,
        ratingWindow: status.ratingWindow,
      };
    } catch (err) {
      return this.ackError(err);
    }
  }

  @SubscribeMessage('sprint:leave-queue')
  async onLeaveQueue(socket: Socket): Promise<SocketAck> {
    const user = this.requireUser(socket);
    if (!user)
      return { ok: false, code: ErrorCode.UNAUTHORIZED, message: 'Authentication is required.' };
    await this.matchmaking.dequeue(user.sub);
    this.clearBotOfferTimer(user.sub);
    socket.emit('sprint:queue-left', { userId: user.sub });
    return { ok: true };
  }

  @SubscribeMessage('sprint:accept-bot')
  async onAcceptBot(socket: Socket): Promise<SocketAck> {
    const user = this.requireUser(socket);
    if (!user)
      return { ok: false, code: ErrorCode.UNAUTHORIZED, message: 'Authentication is required.' };
    try {
      const status = await this.matchmaking.status(user.sub);
      if (!status.queued || !status.botOfferDue) {
        return {
          ok: false,
          code: ErrorCode.SPRINT_NOT_IN_QUEUE,
          message: 'The bot offer is not available yet — it appears after 30 seconds in the queue.',
        };
      }
      await this.matchmaking.dequeue(user.sub);
      this.clearBotOfferTimer(user.sub);
      const me = await this.playerRef(user.sub);
      const state = await this.engine.createBotSprint(me, new Date());
      this.joinRoom(state, [user.sub]);
      this.emitMatched(state, [user.sub]);
      return { ok: true, duelId: state.duelId, opponent: 'BOT' };
    } catch (err) {
      return this.ackError(err);
    }
  }

  // --- trading ----------------------------------------------------------------------------

  @SubscribeMessage('sprint:order')
  async onOrder(socket: Socket, payload: unknown): Promise<SocketAck> {
    const user = this.requireUser(socket);
    if (!user)
      return { ok: false, code: ErrorCode.UNAUTHORIZED, message: 'Authentication is required.' };
    try {
      const dto = await validatePayload(SprintOrderSocketDto, payload);
      const res = await this.engine.placeOrder(user.sub, dto.duelId, {
        instrumentId: dto.instrumentId,
        side: dto.side,
        quantity: dto.quantity,
        clientOrderId: dto.clientOrderId,
      });
      return { ok: true, order: res.order, portfolio: res.portfolio };
    } catch (err) {
      return this.ackError(err);
    }
  }

  @SubscribeMessage('sprint:leave-sprint')
  async onLeaveSprint(socket: Socket, payload: unknown): Promise<SocketAck> {
    const user = this.requireUser(socket);
    if (!user)
      return { ok: false, code: ErrorCode.UNAUTHORIZED, message: 'Authentication is required.' };
    try {
      const dto = await validatePayload(SprintDuelIdSocketDto, payload);
      await this.engine.leaveSprint(user.sub, dto.duelId);
      return { ok: true, forfeited: true };
    } catch (err) {
      return this.ackError(err);
    }
  }

  @SubscribeMessage('sprint:rematch')
  async onRematch(socket: Socket, payload: unknown): Promise<SocketAck> {
    const user = this.requireUser(socket);
    if (!user)
      return { ok: false, code: ErrorCode.UNAUTHORIZED, message: 'Authentication is required.' };
    try {
      const dto = await validatePayload(SprintDuelIdSocketDto, payload);
      const res = await this.engine.rematch(user.sub, dto.duelId);
      if (res.matched && res.newDuelId) {
        const otherId = await this.otherPlayerId(res.newDuelId, user.sub);
        const ids = otherId ? [user.sub, otherId] : [user.sub];
        for (const id of ids) void this.sockets.get(id)?.join(sprintDuelRoom(res.newDuelId));
        const fresh = await this.engine.getState(res.newDuelId);
        if (fresh) this.emitMatched(fresh, ids);
        return { ok: true, matched: true, newDuelId: res.newDuelId };
      }
      return { ok: true, matched: false, reason: res.reason, retryAfterMs: res.retryAfterMs };
    } catch (err) {
      return this.ackError(err);
    }
  }

  // --- internals ---------------------------------------------------------------------------

  /**
   * Pair waiters whose windows overlap. Runs on every queue join and
   * every 5 s, so a long-waiting player is matched even when the
   * newcomer's own (narrow) window does not reach them yet.
   */
  private async sweepMatches(): Promise<void> {
    const pairs = await this.matchmaking.sweep();
    for (const pair of pairs) {
      try {
        await this.matchmaking.dequeue(pair.a.userId);
        await this.matchmaking.dequeue(pair.b.userId);
        this.clearBotOfferTimer(pair.a.userId);
        this.clearBotOfferTimer(pair.b.userId);
        const [a, b] = await Promise.all([
          this.playerRef(pair.a.userId),
          this.playerRef(pair.b.userId),
        ]);
        const state = await this.engine.createSprint(a, b, new Date());
        this.joinRoom(state, [pair.a.userId, pair.b.userId]);
        this.emitMatched(state, [pair.a.userId, pair.b.userId]);
      } catch (err) {
        this.logger.error('Sprint match creation failed', {
          a: pair.a.userId,
          b: pair.b.userId,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  private async playerRef(
    userId: string
  ): Promise<{ userId: string; displayName: string; rating: number }> {
    const [user, ratings] = await Promise.all([
      this.repo.findUserById(userId),
      this.ratings.getUserRatings(userId),
    ]);
    return {
      userId,
      displayName: user?.displayName ?? 'Player',
      rating: ratings.trading.rating,
    };
  }

  private joinRoom(state: SprintState, userIds: string[]): void {
    for (const id of userIds) {
      void this.sockets.get(id)?.join(sprintDuelRoom(state.duelId));
    }
  }

  private emitMatched(state: SprintState, userIds: string[]): void {
    for (const id of userIds) {
      const matched = this.engine.matchedPayload(state, id);
      this.toUser(id, 'sprint:matched', matched);
      this.toUser(id, 'sprint:countdown', {
        duelId: state.duelId,
        countdownEndsAtMs: state.countdownEndsAtMs,
        serverNowMs: Date.now(),
        host: {
          name: DUELS.SPRINT_HOST_NAME,
          line: `${DUELS.SPRINT_HOST_NAME} is hosting this sprint.`,
        },
      });
    }
  }

  private async otherPlayerId(duelId: string, userId: string): Promise<string | null> {
    const duel = await this.repo.findDuelById(duelId);
    if (!duel) return null;
    if (duel.playerAId === userId) return duel.playerBId;
    return duel.playerAId;
  }

  private armBotOfferTimer(userId: string): void {
    this.clearBotOfferTimer(userId);
    const t = setTimeout(() => {
      void this.matchmaking.status(userId).then((status) => {
        if (status.queued && status.botOfferDue) {
          this.toUser(userId, 'sprint:bot-offer', {
            message:
              'No opponent at your Trading Rating yet. Play Mira (bot) instead — rated at your own Trading Rating.',
            botName: DUELS.BOT_NAME,
          });
        }
      });
    }, DUELS.LIVE_BOT_OFFER_AFTER_SEC * 1000);
    if (typeof t.unref === 'function') t.unref();
    this.botOfferTimers.set(userId, t);
  }

  private clearBotOfferTimer(userId: string): void {
    const t = this.botOfferTimers.get(userId);
    if (t) {
      clearTimeout(t);
      this.botOfferTimers.delete(userId);
    }
  }

  private tokenFromHandshake(socket: Socket): string | null {
    const auth = socket.handshake.auth as Record<string, unknown> | undefined;
    const fromAuth = typeof auth?.token === 'string' ? auth.token : null;
    if (fromAuth) return fromAuth;
    const header = socket.handshake.headers.authorization;
    if (header?.startsWith('Bearer ')) return header.slice('Bearer '.length).trim();
    return null;
  }

  private requireUser(socket: Socket): RequestUser | null {
    return (socket.data as SocketData).user ?? null;
  }

  private ackError(err: unknown): SocketAck {
    if (err instanceof AppError) {
      return { ok: false, code: err.code, message: err.message };
    }
    this.logger.error('Sprint socket handler failed', {
      err: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, code: ErrorCode.INTERNAL_ERROR, message: 'Something went wrong.' };
  }
}

/** Validate a socket payload with the DTO (blueprint §8, socket boundary). */
async function validatePayload<T extends object>(cls: new () => T, payload: unknown): Promise<T> {
  const dto = plainToInstance(cls, payload ?? {});
  const errors = await validate(dto);
  if (errors.length > 0) {
    const details = errors.flatMap((e) =>
      Object.values(e.constraints ?? {}).map((issue) => ({ field: e.property, issue }))
    );
    throw AppError.validationFailed(details);
  }
  return dto;
}
