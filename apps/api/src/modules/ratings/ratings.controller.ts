import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type RequestUser } from '../../common/decorators/current-user.decorator';
import { Public, Roles, Strict } from '../../common/decorators/route.decorators';
import { IdParamDto } from '../../common/dto/id-param.dto';
import {
  DecayDto,
  LeaderboardQueryDto,
  RatingHistoryQueryDto,
  RecordDuelDto,
  RecordTradingWeekDto,
  SeasonResetDto,
} from './dto/ratings.dto';
import { RATINGS_DISCLAIMER, RatingsService } from './ratings.service';

/**
 * RatingsController — docs/04-ratings-and-deployment.md (Phase 3).
 *
 * Thin: every endpoint validates at the boundary, calls one service
 * method, and returns its result. The response envelope is applied by
 * the global interceptor — never hand-built here (blueprint §7).
 *
 * Learning ratings change ONLY through rated duels; practice and lesson
 * quizzes never touch a rating. Trading ratings change ONLY through the
 * admin weekly endpoint. Every endpoint carries the educational
 * disclaimer (blueprint §16).
 */
@ApiTags('ratings')
@Controller('ratings')
export class RatingsController {
  constructor(private readonly ratings: RatingsService) {}

  @Post('duels')
  @Strict(RecordDuelDto)
  @ApiOperation({
    summary: 'Record one rated learning duel (both players updated in one transaction).',
    description:
      `${RATINGS_DISCLAIMER} Idempotent — the Idempotency-Key header must match ` +
      'idempotencyKey in the body; replays return the original result. ' +
      'Anti-gaming: same pair max 3 rated duels/day, max 10 rated events/user/day, ' +
      '5-minute rematch cooldown.',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'Client-generated key; must match idempotencyKey in the body.',
  })
  recordDuel(
    @Body() dto: RecordDuelDto,
    @CurrentUser() user: RequestUser,
    @Headers('idempotency-key') idempotencyKey?: string
  ) {
    return this.ratings.recordDuel(user.sub, dto, idempotencyKey);
  }

  @Post('trading-week')
  @Roles('ADMIN')
  @Strict(RecordTradingWeekDto)
  @ApiOperation({
    summary: 'ADMIN: record one user’s weekly Trading rating vs the simulated index (1200).',
    description:
      `${RATINGS_DISCLAIMER} The caller supplies the numbers; Ratings never reads the ` +
      'simulator. Fewer than 3 trades = unrated week (applied:false, no change). ' +
      'One rated update per user per week.',
  })
  recordTradingWeek(@Body() dto: RecordTradingWeekDto, @CurrentUser() user: RequestUser) {
    return this.ratings.recordTradingWeek(user.sub, dto);
  }

  @Post('admin/season-reset')
  @Roles('ADMIN')
  @Strict(SeasonResetDto)
  @ApiOperation({
    summary: 'ADMIN: quarterly soft reset — every rating moves halfway toward 1000.',
    description: `${RATINGS_DISCLAIMER} Idempotent per season; re-running a season never double-resets.`,
  })
  seasonReset(@Body() dto: SeasonResetDto, @CurrentUser() user: RequestUser) {
    return this.ratings.seasonReset(user.sub, dto);
  }

  @Post('admin/decay')
  @Roles('ADMIN')
  @Strict(DecayDto)
  @ApiOperation({
    summary: 'ADMIN: inactivity decay — ratings idle 30+ days drift toward 1000.',
    description: `${RATINGS_DISCLAIMER} 10 points per week past the grace, max 50 per run, never below the floor. One decay per user/kind/week.`,
  })
  runDecay(@Body() dto: DecayDto, @CurrentUser() user: RequestUser) {
    return this.ratings.runDecay(user.sub, dto);
  }

  @Get('me')
  @ApiOperation({
    summary: 'My Learning / Trading / Candle ratings, tiers, and ranks.',
    description: RATINGS_DISCLAIMER,
  })
  getMyRatings(@CurrentUser() user: RequestUser) {
    return this.ratings.getMyRatings(user.sub);
  }

  @Get('me/history')
  @ApiOperation({
    summary: 'My rating history (audit trail), newest first.',
    description: RATINGS_DISCLAIMER,
  })
  listMyHistory(@Query() query: RatingHistoryQueryDto, @CurrentUser() user: RequestUser) {
    return this.ratings.listHistory(user.sub, query.page, query.limit, query.kind);
  }

  @Public()
  @Get('leaderboard')
  @ApiOperation({
    summary: 'Public leaderboard: top 100 per rating kind and scope (global or country).',
    description:
      `${RATINGS_DISCLAIMER} Shows display name, rating, tier, rank, and percentile only — ` +
      'never email, phone, or holdings.',
  })
  getLeaderboard(@Query() query: LeaderboardQueryDto) {
    return this.ratings.getLeaderboard(query);
  }

  @Public()
  @Get('users/:id')
  @ApiOperation({
    summary: 'Public ratings for one user (Learning / Trading / Candle).',
    description: RATINGS_DISCLAIMER,
  })
  getUserRatings(@Param() params: IdParamDto) {
    return this.ratings.getUserRatings(params.id);
  }
}
