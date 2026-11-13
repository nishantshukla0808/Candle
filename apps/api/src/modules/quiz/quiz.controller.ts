import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type RequestUser } from '../../common/decorators/current-user.decorator';
import { Strict } from '../../common/decorators/route.decorators';
import { IdParamDto } from '../../common/dto/id-param.dto';
import { SubmitQuizDto } from './dto/quiz.dto';
import { QuizService } from './quiz.service';

/**
 * QuizController — attempts and grading (blueprint §17).
 *
 * Starting an attempt requires the lesson to be unlocked. Submitting
 * requires an Idempotency-Key header (blueprint §6, ADR 0002/7).
 * Attempts are always the caller's own (blueprint §11).
 */
@ApiTags('quiz')
@Controller('quiz')
export class QuizController {
  constructor(private readonly quiz: QuizService) {}

  @Post('lessons/:id/attempts')
  @ApiOperation({ summary: 'Start a quiz attempt for a lesson.' })
  startAttempt(@Param() params: IdParamDto, @CurrentUser() user: RequestUser) {
    return this.quiz.startAttempt(user.sub, params.id);
  }

  @Post('attempts/:id/submit')
  @Strict(SubmitQuizDto)
  @ApiOperation({ summary: 'Submit answers. Idempotent; returns per-question feedback.' })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'Client-generated key; replays return the original result.',
  })
  submitAttempt(
    @Param() params: IdParamDto,
    @Body() dto: SubmitQuizDto,
    @CurrentUser() user: RequestUser,
    @Headers('idempotency-key') idempotencyKey?: string
  ) {
    return this.quiz.submitAttempt(user.sub, params.id, dto, idempotencyKey);
  }

  @Get('attempts/:id')
  @ApiOperation({ summary: 'Get my attempt (questions without answers).' })
  getAttempt(@Param() params: IdParamDto, @CurrentUser() user: RequestUser) {
    return this.quiz.getAttempt(user.sub, params.id);
  }
}
