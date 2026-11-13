import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type RequestUser } from '../../common/decorators/current-user.decorator';
import { Roles, Strict } from '../../common/decorators/route.decorators';
import { IdParamDto } from '../../common/dto/id-param.dto';
import { AcceptPlacementDto, SubmitAssessmentDto } from './dto/onboarding.dto';
import { ONBOARDING_DISCLAIMER, OnboardingService } from './onboarding.service';

/**
 * OnboardingController — knowledge assessment (docs/03-onboarding-assessment-design.md).
 *
 * Diagnostic, not summative: questions are served WITHOUT correct flags or
 * explanations, results reveal levels only, and correct answers grant no XP.
 * Submitting requires an Idempotency-Key header (blueprint §6, ADR 0002/7).
 * Attempts, results, and profiles are always the caller's own (blueprint §11).
 *
 * Every endpoint carries the educational disclaimer (blueprint §16).
 */
@ApiTags('onboarding')
@Controller('onboarding')
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Post('assessment/start')
  @ApiOperation({
    summary: 'Start (or resume) the onboarding assessment.',
    description: `${ONBOARDING_DISCLAIMER} Idempotent: returns the fresh in-progress attempt when one exists.`,
  })
  startAssessment(@CurrentUser() user: RequestUser) {
    return this.onboarding.startAssessment(user.sub);
  }

  @Post('assessment/attempts/:id/submit')
  @Strict(SubmitAssessmentDto)
  @ApiOperation({
    summary: 'Submit assessment answers. Idempotent; returns levels and placement.',
    description: `${ONBOARDING_DISCLAIMER} Exactly 12 answers, one per presented question. Replays return the original result.`,
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'Client-generated key; replays return the original result.',
  })
  submitAssessment(
    @Param() params: IdParamDto,
    @Body() dto: SubmitAssessmentDto,
    @CurrentUser() user: RequestUser,
    @Headers('idempotency-key') idempotencyKey?: string
  ) {
    return this.onboarding.submitAssessment(user.sub, params.id, dto, idempotencyKey);
  }

  @Post('assessment/attempts/:id/abandon')
  @ApiOperation({
    summary: 'Abandon an in-progress attempt (exiting mid-flow).',
    description: ONBOARDING_DISCLAIMER,
  })
  abandonAssessment(@Param() params: IdParamDto, @CurrentUser() user: RequestUser) {
    return this.onboarding.abandonAssessment(user.sub, params.id).then(() => ({
      abandoned: true,
    }));
  }

  @Post('placement/accept')
  @Strict(AcceptPlacementDto)
  @ApiOperation({
    summary: 'Accept placement: start where placed, or from the beginning.',
    description: `${ONBOARDING_DISCLAIMER} Single-use per track. Grants the one-time onboarding XP bonus.`,
  })
  acceptPlacement(@Body() dto: AcceptPlacementDto, @CurrentUser() user: RequestUser) {
    return this.onboarding.acceptPlacement(user.sub, dto);
  }

  @Get('profile')
  @ApiOperation({
    summary: 'My knowledge profile (null when never assessed).',
    description: ONBOARDING_DISCLAIMER,
  })
  getProfile(@CurrentUser() user: RequestUser) {
    return this.onboarding.getProfile(user.sub);
  }

  @Get('assessment/bank')
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Assessment bank with answers and explanations (admin review only).',
    description: `${ONBOARDING_DISCLAIMER} Never exposed to non-admin callers.`,
  })
  getBank() {
    return this.onboarding.getBank();
  }
}
