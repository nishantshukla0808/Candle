import { Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';
import { CurrentUser, type RequestUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/route.decorators';
import { IdParamDto } from '../../common/dto/id-param.dto';
import { LearningService } from './learning.service';

class SlugParamDto {
  @IsString()
  @Matches(/^[a-z0-9-]+$/, { message: 'slug must be lowercase letters, numbers, and dashes' })
  slug!: string;
}

/**
 * LearningController — tracks, lessons, completions (blueprint §17).
 *
 * Reads are public (published content only). Completion requires auth and
 * an Idempotency-Key header (blueprint §6, ADR 0002/7).
 */
@ApiTags('learning')
@Controller('learning')
export class LearningController {
  constructor(private readonly learning: LearningService) {}

  @Public()
  @Get('tracks')
  @ApiOperation({ summary: 'List published tracks.' })
  listTracks() {
    return this.learning.listTracks();
  }

  @Public()
  @Get('tracks/:slug')
  @ApiOperation({ summary: 'Track structure with modules, lessons, and progress.' })
  getTrack(@Param() params: SlugParamDto, @CurrentUser() user?: RequestUser) {
    // user is undefined on public routes without a token — progress
    // fields degrade gracefully to locked/completed=false.
    return this.learning.getTrack(params.slug, user?.sub);
  }

  @Public()
  @Get('lessons/:id')
  @ApiOperation({ summary: 'Lesson player data: published content + quiz info.' })
  getLesson(@Param() params: IdParamDto, @CurrentUser() user?: RequestUser) {
    return this.learning.getLesson(params.id, user?.sub);
  }

  @Post('lessons/:id/complete')
  @ApiOperation({ summary: 'Complete a lesson (transactional, idempotent).' })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'Client-generated key; replays return the original result.',
  })
  completeLesson(
    @Param() params: IdParamDto,
    @CurrentUser() user: RequestUser,
    @Headers('idempotency-key') idempotencyKey?: string
  ) {
    return this.learning.completeLesson(user.sub, params.id, idempotencyKey);
  }
}
