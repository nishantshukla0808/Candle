import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type RequestUser } from '../../common/decorators/current-user.decorator';
import { IdParamDto } from '../../common/dto/id-param.dto';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { AppError } from '../../common/errors/app-error';
import { SprintEngine } from './sprint-engine.service';
import { SprintMatchmakingService } from './sprint-matchmaking.service';
import { SPRINT_DISCLAIMER, SprintService } from './sprint.service';

/**
 * SprintController — docs/14 (Phase 9).
 *
 * Thin: every endpoint validates at the boundary, calls one service
 * method, and returns its result. The response envelope is applied by
 * the global interceptor — never hand-built here (blueprint §7).
 *
 * Live trading itself happens over the Socket.IO namespace /sprint,
 * not over REST. These endpoints exist for page loads, reconnect /
 * resume, and clients without a socket. Every endpoint carries the
 * educational disclaimer (blueprint §16).
 */
@ApiTags('sprint')
@Controller('sprint')
export class SprintController {
  constructor(
    private readonly engine: SprintEngine,
    private readonly matchmaking: SprintMatchmakingService,
    private readonly sprints: SprintService
  ) {}

  @Get('active')
  @ApiOperation({
    summary: 'My active Paper Trading Sprint, if any (for reconnect / resume on page load).',
    description:
      `${SPRINT_DISCLAIMER} Returns the sprint summary (phase, start/end, my equity, ` +
      'opponent equity) — never holdings or orders. Live trading happens over the Socket.IO ' +
      'namespace /sprint, not over REST.',
  })
  getActive(@CurrentUser() user: RequestUser) {
    return this.engine.activeSprintSummary(user.sub);
  }

  @Get('queue/status')
  @ApiOperation({
    summary: 'My sprint matchmaking queue status (waited time, Trading Rating window, bot offer).',
    description:
      `${SPRINT_DISCLAIMER} The Trading Rating window widens with wait time (±50 → ±100 → ` +
      '±200 → ±400); after 30 seconds the Mira bot is offered instead of waiting. The sprint ' +
      'queue is separate from the learning-duel queues — a sprint waiter is never matched into ' +
      'a quiz duel.',
  })
  getQueueStatus(@CurrentUser() user: RequestUser) {
    return this.matchmaking.status(user.sub);
  }

  @Get('history')
  @ApiOperation({
    summary: 'My Paper Trading Sprint history, newest first.',
    description: `${SPRINT_DISCLAIMER} One item per finished sprint: result, final equity, return, risk-adjusted score, opponent, Trading Rating change.`,
  })
  getHistory(@Query() query: PaginationDto, @CurrentUser() user: RequestUser) {
    return this.sprints.listHistory(user.sub, query.page ?? 1, query.limit ?? 20);
  }

  @Get(':id/state')
  @ApiOperation({
    summary: 'One sprint’s state summary (mine only — phase, prices, my portfolio, equities).',
    description:
      `${SPRINT_DISCLAIMER} My portfolio only, plus both players’ total equity — never the ` +
      'opponent’s holdings or orders. A sprint that is not mine is 404.',
  })
  async getState(@Param() params: IdParamDto, @CurrentUser() user: RequestUser) {
    const summary = await this.engine.stateSummary(user.sub, params.id);
    if (!summary) throw AppError.notFound('Sprint not found.');
    return summary;
  }

  @Post(':id/forfeit')
  @ApiOperation({
    summary: 'Forfeit my sprint (leaving mid-sprint counts as a loss).',
    description:
      `${SPRINT_DISCLAIMER} The sprint settles immediately: the opponent wins on ` +
      'risk-adjusted return, the Trading Rating updates once, and both players get their ' +
      'stored results.',
  })
  async forfeit(@Param() params: IdParamDto, @CurrentUser() user: RequestUser) {
    await this.engine.leaveSprint(user.sub, params.id);
    return { forfeited: true, duelId: params.id };
  }

  @Get(':id/result')
  @ApiOperation({
    summary: 'One sprint’s stored result (mine only).',
    description:
      `${SPRINT_DISCLAIMER} The stored SprintDuelResult row: risk metrics, equity curve, ` +
      'per-instrument summary, opponent summary, Trading Rating change, XP. Never recomputed.',
  })
  getResult(@Param() params: IdParamDto, @CurrentUser() user: RequestUser) {
    return this.sprints.getResult(user.sub, params.id);
  }
}
