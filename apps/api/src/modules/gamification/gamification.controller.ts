import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type RequestUser } from '../../common/decorators/current-user.decorator';
import { GamificationService } from './gamification.service';

/**
 * GamificationController — blueprint §17.
 * The dashboard is always the caller's own (blueprint §11).
 */
@ApiTags('gamification')
@Controller('gamification')
export class GamificationController {
  constructor(private readonly gamification: GamificationService) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'My XP, level, streaks, badges, and per-track progress.' })
  dashboard(@CurrentUser() user: RequestUser) {
    return this.gamification.getDashboard(user.sub);
  }
}
