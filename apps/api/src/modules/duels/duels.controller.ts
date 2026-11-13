import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type RequestUser } from '../../common/decorators/current-user.decorator';
import { Roles, Strict } from '../../common/decorators/route.decorators';
import { IdParamDto } from '../../common/dto/id-param.dto';
import { AppError } from '../../common/errors/app-error';
import { AnswerDuelDto, DuelHistoryQueryDto, SettleUnpairedDto } from './dto/duels.dto';
import { DUELS_DISCLAIMER, DuelsService } from './duels.service';
import { LiveDuelEngine } from './live-duel-engine.service';
import { LiveMatchmakingService } from './live-matchmaking.service';

/**
 * DuelsController — docs/05 §1, docs/07 (Phase 4 Step 2).
 *
 * Thin: every endpoint validates at the boundary, calls one service
 * method, and returns its result. The response envelope is applied by
 * the global interceptor — never hand-built here (blueprint §7).
 *
 * Bot Duel (P1, unrated practice vs Mira) and Async Daily Duel (L5,
 * rated, 1 per user per IST day). No live gateway, no matchmaking.
 * Answers never leave the server before reveal: start/answer
 * responses carry option id + text only, never isCorrect or the
 * explanation — correctness appears only in the stored post-game
 * result. Every endpoint carries the educational disclaimer
 * (blueprint §16).
 */
@ApiTags('duels')
@Controller('duels')
export class DuelsController {
  constructor(
    private readonly duels: DuelsService,
    private readonly live: LiveDuelEngine,
    private readonly matchmaking: LiveMatchmakingService
  ) {}

  // --- Live Speed Quiz Duel (L1) + Myth vs Fact Blitz (L2) + Case Duel (L3) + Chart Detective (L4), rated, WebSocket — docs/09 Phase 5, Phase 6, docs/12 Phase 7, docs/13 Phase 8 -----------

  @Get('live/active')
  @ApiOperation({
    summary: 'My active live duel, if any (for reconnect / resume on page load).',
    description:
      `${DUELS_DISCLAIMER} Returns the live duel state summary (variant, phase, current question, ` +
      'scores, deadline, per-question time limit) — never answers. Live play itself happens over the ' +
      'Socket.IO namespace /duels-live, not over REST. Works for Speed Quiz (LIVE), Blitz (BLITZ), Case Duel (CASE), and Chart Detective (CHART).',
  })
  getLiveActive(@CurrentUser() user: RequestUser) {
    return this.live.activeDuelSummary(user.sub);
  }

  @Get('live/queue/status')
  @ApiOperation({
    summary: 'My live matchmaking queue status (variant, waited time, Rating window, bot offer).',
    description:
      `${DUELS_DISCLAIMER} The Rating window widens with wait time (±50 → ±100 → ±200 → ±400); ` +
      'after 30 seconds the Mira bot is offered instead of waiting. The status names the variant ' +
      '(LIVE = Speed Quiz, BLITZ = Myth vs Fact, CASE = Case Duel, CHART = Chart Detective) — each variant has its own queue.',
  })
  getLiveQueueStatus(@CurrentUser() user: RequestUser) {
    return this.matchmaking.status(user.sub);
  }

  @Get('live/:id/state')
  @ApiOperation({
    summary: 'One live duel’s state summary (mine only — variant, phase, scores, deadline).',
    description: `${DUELS_DISCLAIMER} Never answers. A duel that is not mine is 404.`,
  })
  async getLiveState(@Param() params: IdParamDto, @CurrentUser() user: RequestUser) {
    const summary = await this.live.activeDuelSummary(user.sub);
    if (!summary || summary.duelId !== params.id) {
      throw AppError.notFound('Duel not found.');
    }
    return summary;
  }

  @Post('live/:id/forfeit')
  @ApiOperation({
    summary: 'Forfeit my live duel (leaving mid-duel counts as a loss).',
    description:
      `${DUELS_DISCLAIMER} The duel settles immediately: the opponent wins, the Learning ` +
      'Rating updates once, and both players get their stored results.',
  })
  async forfeitLive(@Param() params: IdParamDto, @CurrentUser() user: RequestUser) {
    await this.live.leaveDuel(user.sub, params.id);
    return { forfeited: true, duelId: params.id };
  }

  // --- Bot Duel (P1, unrated) -------------------------------------------------

  @Post('bot/start')
  @ApiOperation({
    summary: 'Start a Bot Duel vs Mira (7 questions, 15 sec each, unrated).',
    description:
      `${DUELS_DISCLAIMER} Opponent is the Mira bot, matched to your Learning Rating. ` +
      'Capped at 10 Bot Duels per day (Asia/Kolkata). No Rating change ever — XP and streak only.',
  })
  startBot(@CurrentUser() user: RequestUser) {
    return this.duels.startBot(user.sub);
  }

  @Post('bot/:id/answer')
  @Strict(AnswerDuelDto)
  @ApiOperation({
    summary: 'Answer the next question of a Bot Duel (in order, first answer only).',
    description:
      `${DUELS_DISCLAIMER} The server validates timing (0–15000 ms), order, and ownership, ` +
      'and scores server-side. Correctness is NOT returned here — it appears only in the result.',
  })
  answerBot(
    @Param() params: IdParamDto,
    @Body() dto: AnswerDuelDto,
    @CurrentUser() user: RequestUser
  ) {
    return this.duels.answerBot(user.sub, params.id, dto);
  }

  @Post('bot/:id/finish')
  @ApiOperation({
    summary: 'Finish a Bot Duel (unanswered questions become skips; Mira is simulated).',
    description: `${DUELS_DISCLAIMER} Idempotent — re-finishing returns the stored result, never double-applies XP.`,
  })
  finishBot(@Param() params: IdParamDto, @CurrentUser() user: RequestUser) {
    return this.duels.finishBot(user.sub, params.id);
  }

  // --- Async Daily Duel (L5, rated, 1/day IST) ----------------------------------

  @Get('daily/today')
  @ApiOperation({
    summary: 'Today’s Daily Duel (Asia/Kolkata date) — set status, no questions.',
    description:
      `${DUELS_DISCLAIMER} The 5-question set is fixed for the day and shared by every player; ` +
      'it is revealed only by starting. One rated Daily Duel per user per day.',
  })
  getDailyToday(@CurrentUser() user: RequestUser) {
    return this.duels.getDailyToday(user.sub);
  }

  @Post('daily/start')
  @ApiOperation({
    summary: 'Start today’s Daily Duel (the fixed 5-question set for the day).',
    description:
      `${DUELS_DISCLAIMER} One per user per day (Asia/Kolkata) — a second start is 409. ` +
      'Players are paired in order of finishing; the duel settles when the second player of a pair finishes.',
  })
  startDaily(@CurrentUser() user: RequestUser) {
    return this.duels.startDaily(user.sub);
  }

  @Post('daily/:id/answer')
  @Strict(AnswerDuelDto)
  @ApiOperation({
    summary: 'Answer the next question of a Daily Duel (in order, first answer only).',
    description: `${DUELS_DISCLAIMER} Same rules as the Bot Duel answer endpoint. Correctness is NOT returned here.`,
  })
  answerDaily(
    @Param() params: IdParamDto,
    @Body() dto: AnswerDuelDto,
    @CurrentUser() user: RequestUser
  ) {
    return this.duels.answerDaily(user.sub, params.id, dto);
  }

  @Post('daily/:id/finish')
  @ApiOperation({
    summary: 'Finish a Daily Duel (settles immediately when paired; otherwise waits).',
    description:
      `${DUELS_DISCLAIMER} If another player has already finished today’s set, the pair settles now ` +
      'and the Learning Rating updates once (idempotency key duel:{duelId}). Otherwise the duel waits ' +
      'for an opponent — unpaired at day end it is settled against the Mira bot.',
  })
  finishDaily(@Param() params: IdParamDto, @CurrentUser() user: RequestUser) {
    return this.duels.finishDaily(user.sub, params.id);
  }

  @Post('daily/settle-unpaired')
  @Roles('ADMIN')
  @Strict(SettleUnpairedDto)
  @ApiOperation({
    summary: 'ADMIN: settle a day’s unpaired Daily Duels against the Mira bot.',
    description:
      `${DUELS_DISCLAIMER} Only run for a date whose day has ended (23:59 IST). Each unpaired player ` +
      'is rated once against the bot at their own Rating. One failure never aborts the batch.',
  })
  settleUnpaired(@Body() dto: SettleUnpairedDto, @CurrentUser() user: RequestUser) {
    return this.duels.settleUnpaired(user.sub, dto);
  }

  // --- history + results -----------------------------------------------------------

  @Get('history')
  @ApiOperation({
    summary: 'My duel history, newest first.',
    description: DUELS_DISCLAIMER,
  })
  listHistory(@Query() query: DuelHistoryQueryDto, @CurrentUser() user: RequestUser) {
    return this.duels.listHistory(user.sub, query.page, query.limit);
  }

  @Get(':id/result')
  @ApiOperation({
    summary: 'One duel’s stored post-game result (or its waiting / in-progress status).',
    description: `${DUELS_DISCLAIMER} Results are stored at duel end and read back here — never recomputed on page view.`,
  })
  getResult(@Param() params: IdParamDto, @CurrentUser() user: RequestUser) {
    return this.duels.getResult(user.sub, params.id);
  }
}
