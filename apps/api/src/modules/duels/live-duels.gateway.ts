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
import { DuelsRepository } from './duels.repository';
import { LiveMatchmakingService } from './live-matchmaking.service';
import { LiveDuelEngine, type LiveDuelEmitter } from './live-duel-engine.service';
import { liveDuelRoom, type LiveDuelState } from './live-duel-state';
import {
  LiveAnswerSocketDto,
  LiveDuelIdSocketDto,
  LiveJoinQueueSocketDto,
  LiveReasonSocketDto,
} from './dto/live-duels.dto';

/**
 * LiveDuelsGateway — docs/05 §3.2/§3.4, docs/09 (Phase 5), Phase 6 (Blitz),
 * Phase 7 (Case Duel, ADR 0009).
 *
 * Socket.IO namespace `/duels-live`. Transport only: it authenticates
 * the handshake, validates every payload, joins sockets to one room
 * per duel (`duel:{duelId}`), and delegates every rule to
 * LiveMatchmakingService / LiveDuelEngine. No scoring, timing, or
 * Rating logic lives here. Four live variants share this gateway:
 * Speed Quiz (LIVE), Myth vs Fact Blitz (BLITZ), the Case Duel
 * (CASE), and Chart Detective (CHART) — the variant travels in `live:join-queue`, in `live:queued` /
 * `live:matched`, and in the per-question `timeLimitMs`
 * (15000 / 10000 / 45000 / 30000). The Case Duel adds one event,
 * `live:reason` (ADR 0009 §4), for the post-answer reason step.
 * Chart Detective adds no new event — its reveal carries the chart
 * `annotation` (ADR 0010 §5).
 *
 * Auth: the access JWT travels in the handshake (`auth.token`, or an
 * `Authorization: Bearer <token>` header) and is verified exactly like
 * HTTP (TokenService.verifyAccessToken). No anonymous live duels.
 * One socket per user: a second connection replaces the first — the
 * old socket's disconnect starts the 15-second grace, and the new
 * socket's reconnect clears it (docs/05 §3.1).
 *
 * Every handler answers with an ack `{ ok: true, ... }` or
 * `{ ok: false, code, message }`; asynchronous duel events arrive as
 * `live:*` broadcasts. Errors never leak internals (blueprint §2.5).
 *
 * CORS: the namespace accepts only WEB_ORIGIN (same allow-list as
 * HTTP). Sticky sessions are REQUIRED in multi-server deploys — see
 * docs/09 §7 and the Redis adapter (live-redis.adapter.ts).
 */

interface SocketAck {
  ok: boolean;
  code?: string;
  message?: string;
  [key: string]: unknown;
}

type SocketData = { user?: RequestUser };

@WebSocketGateway({
  namespace: '/duels-live',
  cors: {
    origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000',
    credentials: true,
  },
})
export class LiveDuelsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, LiveDuelEmitter
{
  @WebSocketServer()
  server!: Server;

  /** userId → live socket (one socket per user). */
  private readonly sockets = new Map<string, Socket>();
  /** userId → bot-offer timer armed at queue join (30 s, docs/05 §3.3). */
  private readonly botOfferTimers = new Map<string, NodeJS.Timeout>();
  /** Matchmaking sweep timer (5 s): pairs waiters whose windows overlap. */
  private sweepTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly engine: LiveDuelEngine,
    private readonly matchmaking: LiveMatchmakingService,
    private readonly ratings: RatingsService,
    private readonly tokens: TokenService,
    private readonly repo: DuelsRepository,
    private readonly logger: AppLogger
  ) {}

  afterInit(): void {
    this.engine.bindEmitter(this);
    this.sweepTimer = setInterval(() => {
      void this.sweepMatches().catch((err: unknown) => {
        this.logger.error('Live matchmaking sweep failed', {
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

  // --- LiveDuelEmitter (the engine calls back through these) --------------------

  toUser(userId: string, event: string, payload: unknown): void {
    this.sockets.get(userId)?.emit(event, payload);
  }

  toRoom(duelId: string, event: string, payload: unknown): void {
    this.server?.to(liveDuelRoom(duelId)).emit(event, payload);
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
    // Reconnect to an active duel: rejoin the room, clear the grace,
    // and resend the current question/countdown (docs/05 §3.1).
    const active = await this.engine.activeDuelSummary(user.sub).catch(() => null);
    if (active) {
      void socket.join(liveDuelRoom(active.duelId));
      await this.engine.handleReconnect(user.sub);
    }
    this.logger.info('Live duel socket connected', { userId: user.sub });
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
      this.logger.error('Live disconnect handling failed', {
        userId: user.sub,
        err: err instanceof Error ? err.message : String(err),
      });
    });
  }

  // --- queue ---------------------------------------------------------------------------

  @SubscribeMessage('live:join-queue')
  async onJoinQueue(socket: Socket, payload: unknown): Promise<SocketAck> {
    const user = this.requireUser(socket);
    if (!user)
      return { ok: false, code: ErrorCode.UNAUTHORIZED, message: 'Authentication is required.' };
    try {
      const dto = await validatePayload(LiveJoinQueueSocketDto, payload);
      const variant = dto.variant ?? 'LIVE';
      const rating = (await this.ratings.getUserRatings(user.sub)).learning.rating;
      const status = await this.matchmaking.enqueue(user.sub, rating, new Date(), variant);
      socket.emit('live:queued', {
        ...status,
        host: { name: DUELS.BOT_NAME, line: 'Finding you an opponent at your Rating…' },
      });
      this.armBotOfferTimer(user.sub);
      await this.sweepMatches();
      return {
        ok: true,
        queued: true,
        variant: status.variant,
        waitedMs: status.waitedMs,
        ratingWindow: status.ratingWindow,
      };
    } catch (err) {
      return this.ackError(err);
    }
  }

  @SubscribeMessage('live:leave-queue')
  async onLeaveQueue(socket: Socket): Promise<SocketAck> {
    const user = this.requireUser(socket);
    if (!user)
      return { ok: false, code: ErrorCode.UNAUTHORIZED, message: 'Authentication is required.' };
    await this.matchmaking.dequeue(user.sub);
    this.clearBotOfferTimer(user.sub);
    socket.emit('live:queue-left', { userId: user.sub });
    return { ok: true };
  }

  @SubscribeMessage('live:accept-bot')
  async onAcceptBot(socket: Socket): Promise<SocketAck> {
    const user = this.requireUser(socket);
    if (!user)
      return { ok: false, code: ErrorCode.UNAUTHORIZED, message: 'Authentication is required.' };
    try {
      const status = await this.matchmaking.status(user.sub);
      if (!status.queued || !status.botOfferDue) {
        return {
          ok: false,
          code: ErrorCode.DUEL_NOT_IN_QUEUE,
          message: 'The bot offer is not available yet — it appears after 30 seconds in the queue.',
        };
      }
      await this.matchmaking.dequeue(user.sub);
      this.clearBotOfferTimer(user.sub);
      const me = await this.playerRef(user.sub);
      // The bot duel replays the variant the player queued for (a Blitz
      // queue's bot offer is a Blitz duel vs Mira, on the 10 s timer).
      const state = await this.engine.createBotDuel(me, new Date(), status.variant ?? 'LIVE');
      this.joinRoom(state, [user.sub]);
      this.emitMatched(state, [user.sub]);
      return { ok: true, duelId: state.duelId, opponent: 'BOT', variant: state.variant };
    } catch (err) {
      return this.ackError(err);
    }
  }

  // --- play ----------------------------------------------------------------------------

  @SubscribeMessage('live:answer')
  async onAnswer(socket: Socket, payload: unknown): Promise<SocketAck> {
    const user = this.requireUser(socket);
    if (!user)
      return { ok: false, code: ErrorCode.UNAUTHORIZED, message: 'Authentication is required.' };
    try {
      const dto = await validatePayload(LiveAnswerSocketDto, payload);
      const res = await this.engine.answer(user.sub, dto.duelId, dto.questionId, dto.optionId);
      return { ok: true, ...res };
    } catch (err) {
      return this.ackError(err);
    }
  }

  /**
   * Case Duel only (`live:reason`, ADR 0009 §4): the player's
   * one-line reason for the action they already picked, sent inside
   * the reason window (or null to skip it). The reason is never
   * scored — the engine stores it on the DuelAnswer row and reveals
   * the case once every player who answered has submitted (or the
   * window expires). A reason for a non-CASE duel, for a question
   * never answered, or after the window closed is rejected.
   */
  @SubscribeMessage('live:reason')
  async onReason(socket: Socket, payload: unknown): Promise<SocketAck> {
    const user = this.requireUser(socket);
    if (!user)
      return { ok: false, code: ErrorCode.UNAUTHORIZED, message: 'Authentication is required.' };
    try {
      const dto = await validatePayload(LiveReasonSocketDto, payload);
      const res = await this.engine.submitReason(
        user.sub,
        dto.duelId,
        dto.questionId,
        dto.reason ?? null
      );
      return { ok: true, ...res };
    } catch (err) {
      return this.ackError(err);
    }
  }

  @SubscribeMessage('live:leave-duel')
  async onLeaveDuel(socket: Socket, payload: unknown): Promise<SocketAck> {
    const user = this.requireUser(socket);
    if (!user)
      return { ok: false, code: ErrorCode.UNAUTHORIZED, message: 'Authentication is required.' };
    try {
      const dto = await validatePayload(LiveDuelIdSocketDto, payload);
      await this.engine.leaveDuel(user.sub, dto.duelId);
      return { ok: true, forfeited: true };
    } catch (err) {
      return this.ackError(err);
    }
  }

  @SubscribeMessage('live:rematch')
  async onRematch(socket: Socket, payload: unknown): Promise<SocketAck> {
    const user = this.requireUser(socket);
    if (!user)
      return { ok: false, code: ErrorCode.UNAUTHORIZED, message: 'Authentication is required.' };
    try {
      const dto = await validatePayload(LiveDuelIdSocketDto, payload);
      const res = await this.engine.rematch(user.sub, dto.duelId);
      if (res.matched && res.newDuelId) {
        const otherId = await this.otherPlayerId(res.newDuelId, user.sub);
        const ids = otherId ? [user.sub, otherId] : [user.sub];
        for (const id of ids) void this.sockets.get(id)?.join(liveDuelRoom(res.newDuelId));
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
        // The sweep pairs within one variant only; the duel it creates
        // is that variant (a BLITZ pair never becomes a Speed Quiz duel).
        const state = await this.engine.createLiveDuel(a, b, new Date(), pair.variant);
        this.joinRoom(state, [pair.a.userId, pair.b.userId]);
        this.emitMatched(state, [pair.a.userId, pair.b.userId]);
      } catch (err) {
        this.logger.error('Live match creation failed', {
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
      rating: ratings.learning.rating,
    };
  }

  private joinRoom(state: LiveDuelState, userIds: string[]): void {
    for (const id of userIds) {
      void this.sockets.get(id)?.join(liveDuelRoom(state.duelId));
    }
  }

  private emitMatched(state: LiveDuelState, userIds: string[]): void {
    for (const id of userIds) {
      const matched = this.engine.matchedPayload(state, id);
      this.toUser(id, 'live:matched', matched);
      // The host is the variant's host (Mira for LIVE/BLITZ, Kabir
      // for CASE/CHART) — the matched payload already names it, so
      // this never guesses a host from the variant.
      const hostName = matched.host?.name ?? DUELS.BOT_NAME;
      this.toUser(id, 'live:countdown', {
        duelId: state.duelId,
        countdownEndsAtMs: state.countdownEndsAtMs,
        serverNowMs: Date.now(),
        host: { name: hostName, line: `${hostName} is hosting this duel.` },
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
          this.toUser(userId, 'live:bot-offer', {
            message:
              'No opponent at your Rating yet. Play Mira (bot) instead — rated at your own Rating.',
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
    this.logger.error('Live duel socket handler failed', {
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
