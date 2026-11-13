import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type RequestUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/route.decorators';
import { IdParamDto } from '../../common/dto/id-param.dto';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { CreateWeeklySeasonDto, WeeklyTradeDto } from './dto/weekly.dto';
import { WEEKLY_DISCLAIMER, WeeklyService } from './weekly.service';

/**
 * WeeklyController — docs/16 (Phase 11).
 *
 * Thin: every endpoint validates at the boundary, calls one service
 * method, and returns its result. The response envelope is applied by
 * the global interceptor — never hand-built here (blueprint §7).
 *
 * A weekly battle is REST-only: a week-long async duel has no live
 * clock to push, so there is no WebSocket namespace (docs/16 §3).
 * Every endpoint carries the educational disclaimer (blueprint §16).
 * Settlement is a manual ADMIN endpoint in v1 — no scheduler exists;
 * docs/16 §9 names the future cron that will replace it.
 */
@ApiTags('weekly')
@Controller('weekly')
export class WeeklyController {
  constructor(private readonly weekly: WeeklyService) {}

  @Post('seasons')
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'ADMIN: create one weekly season for a Monday (join window opens).',
    description:
      `${WEEKLY_DISCLAIMER} weekStart must be a Monday (YYYY-MM-DD, Asia/Kolkata). ` +
      'The season opens in OPEN; players join, then an admin starts it (leagues form) and ' +
      'later settles it. Carried joiners from the previous season are enrolled automatically.',
  })
  createSeason(@Body() dto: CreateWeeklySeasonDto, @CurrentUser() user: RequestUser) {
    return this.weekly.createSeason(user.sub, dto);
  }

  @Get('seasons')
  @ApiOperation({
    summary: 'List weekly seasons, newest first (status, window, league/member counts).',
    description: `${WEEKLY_DISCLAIMER} Anyone authenticated can list seasons; joining is a separate step.`,
  })
  listSeasons() {
    return this.weekly.listSeasons();
  }

  @Get('seasons/:id')
  @ApiOperation({
    summary: 'One weekly season (status, window, league/member counts, host).',
    description: `${WEEKLY_DISCLAIMER} No holdings or orders are ever exposed here.`,
  })
  getSeason(@Param() params: IdParamDto) {
    return this.weekly.getSeason(params.id);
  }

  @Post('seasons/:id/join')
  @ApiOperation({
    summary: 'Join a weekly season (only while it is OPEN — no mid-season joining).',
    description:
      `${WEEKLY_DISCLAIMER} Joining closes when the season starts: leagues are seeded by ` +
      'Trading Rating at season start, and a mid-season joiner would enter a league whose ' +
      'rivals have a week’s head start. Your Trading Rating at join time is the seeding number.',
  })
  joinSeason(@Param() params: IdParamDto, @CurrentUser() user: RequestUser) {
    return this.weekly.joinSeason(user.sub, params.id);
  }

  @Post('seasons/:id/start')
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'ADMIN: start a season — closes joining, forms leagues, opens the trading window.',
    description:
      `${WEEKLY_DISCLAIMER} Leagues of 30 form from the joiners sorted by Trading Rating ` +
      '(tier 1 = top). A leftover single player merges into the previous league (max 31); a ' +
      'lone joiner in a tier is carried to the next season. The trading window runs ' +
      'WEEKLY_SEASON_DURATION_MS from the start (one week in production).',
  })
  startSeason(@Param() params: IdParamDto, @CurrentUser() user: RequestUser) {
    return this.weekly.startSeason(user.sub, params.id);
  }

  @Post('seasons/:id/settle')
  @Roles('ADMIN')
  @ApiOperation({
    summary:
      'ADMIN: settle a season (only after it has ended). Re-settling replays stored results.',
    description:
      `${WEEKLY_DISCLAIMER} Final equity + risk metrics per player, league results + ` +
      'promotion/relegation, Trading Rating updates vs the index (idempotency key ' +
      'weekly:{seasonId}:{userId}), XP by league outcome — one transaction per league. ' +
      'In v1 this is manual; the future weekly cron (docs/16 §9) will call it automatically.',
  })
  settleSeason(@Param() params: IdParamDto, @CurrentUser() user: RequestUser) {
    return this.weekly.settleSeason(user.sub, params.id);
  }

  @Post('seasons/:id/trade')
  @ApiOperation({
    summary: 'Place one order in the active season (server-priced, idempotent).',
    description:
      `${WEEKLY_DISCLAIMER} BUY/SELL on a fictional instrument at the PriceEngine price for ` +
      'the current minute. A retried clientOrderId replays the stored trade, never a second ' +
      'trade. No XP per trade. Orders are persisted — they are the audit trail the equity ' +
      'curve is rebuilt from.',
  })
  trade(
    @Param() params: IdParamDto,
    @Body() dto: WeeklyTradeDto,
    @CurrentUser() user: RequestUser
  ) {
    return this.weekly.trade(user.sub, params.id, dto);
  }

  @Get('seasons/:id/standings')
  @ApiOperation({
    summary:
      'Live league standings (rank, return, risk-adjusted score, promotion/relegation zones).',
    description:
      `${WEEKLY_DISCLAIMER} Computed on demand from stored trades + current prices. ` +
      'Totals and scores only — never another player’s holdings or orders. A settled season ' +
      'returns its stored results, never recomputed.',
  })
  getStandings(@Param() params: IdParamDto) {
    return this.weekly.getStandings(params.id);
  }

  @Get('seasons/:id/portfolio')
  @ApiOperation({
    summary: 'My portfolio in a season (cash, holdings, current prices, equity).',
    description: `${WEEKLY_DISCLAIMER} Your portfolio only — never another player’s.`,
  })
  getPortfolio(@Param() params: IdParamDto, @CurrentUser() user: RequestUser) {
    return this.weekly.getPortfolio(user.sub, params.id);
  }

  @Get('seasons/:id/result')
  @ApiOperation({
    summary: 'My stored result for a settled season (rank, metrics, Rating change, XP).',
    description:
      `${WEEKLY_DISCLAIMER} The stored WeeklyResult row: league rank and outcome, ` +
      'risk-adjusted score, Trading Rating change vs the index (null when unrated — fewer ' +
      'than 3 trades), XP. Never recomputed.',
  })
  getMyResult(@Param() params: IdParamDto, @CurrentUser() user: RequestUser) {
    return this.weekly.getMyResult(user.sub, params.id);
  }

  @Get('history')
  @ApiOperation({
    summary: 'My weekly battle history, newest first.',
    description: `${WEEKLY_DISCLAIMER} One item per settled season I played: rank, return, risk-adjusted score, Trading Rating change, XP.`,
  })
  getHistory(@Query() query: PaginationDto, @CurrentUser() user: RequestUser) {
    return this.weekly.listHistory(user.sub, query.page ?? 1, query.limit ?? 20);
  }
}
