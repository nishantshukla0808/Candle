import { Body, Controller, Get, Ip, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type RequestUser } from '../../common/decorators/current-user.decorator';
import { Roles, Strict } from '../../common/decorators/route.decorators';
import { IdParamDto } from '../../common/dto/id-param.dto';
import {
  CreateBankItemDto,
  GenerateTemplateDto,
  ListBankItemsQueryDto,
  NewBankItemVersionDto,
  ReviewBankItemDto,
  SelectBlueprintDto,
} from './dto/question-bank.dto';
import { QUESTION_BANK_DISCLAIMER, QuestionBankService } from './question-bank.service';

/**
 * QuestionBankController — docs/05 §2 (Duels Step 1).
 *
 * Thin: every endpoint validates at the boundary, calls one service
 * method, and returns its result. The response envelope is applied by
 * the global interceptor — never hand-built here (blueprint §7).
 *
 * Admin CMS routes (create / workflow / templates / list / coverage)
 * require the ADMIN role (RolesGuard). Selection is authenticated:
 * any user may select a set for themselves (and their opponent), and
 * the endpoint records exposure for the caller in one transaction.
 * Public views NEVER carry isCorrect or the explanation.
 *
 * Every endpoint carries the educational disclaimer (blueprint §16).
 */
@ApiTags('question-bank')
@Controller('question-bank')
export class QuestionBankController {
  constructor(private readonly bank: QuestionBankService) {}

  private ctx(user: RequestUser, ip?: string) {
    return { actorId: user.sub, ...(ip ? { ip } : {}) };
  }

  // --- admin authoring + workflow -------------------------------------------

  @Post('items')
  @Roles('ADMIN')
  @Strict(CreateBankItemDto)
  @ApiOperation({
    summary: 'ADMIN: create a DRAFT bank item (author = caller).',
    description: `${QUESTION_BANK_DISCLAIMER} MCQ_4 needs exactly 4 options with exactly 1 correct; TRUE_FALSE needs exactly 2 with exactly 1 correct; CASE_CHOICE needs 3–4 options with exactly 1 correct (best action, 100 points; at most one 50-point second-best; rest 0), every option with a consequence, a context object with at least 2 labelled entries, and a rubric of at least 2 lines.`,
  })
  createItem(@Body() dto: CreateBankItemDto, @CurrentUser() user: RequestUser, @Ip() ip: string) {
    return this.bank.createItem(dto, this.ctx(user, ip));
  }

  @Post('items/:id/submit-review')
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'ADMIN: submit a DRAFT item for review (DRAFT → REVIEW).',
    description: QUESTION_BANK_DISCLAIMER,
  })
  submitReview(@Param() params: IdParamDto, @CurrentUser() user: RequestUser, @Ip() ip: string) {
    return this.bank.submitReview(params.id, this.ctx(user, ip));
  }

  @Post('items/:id/review')
  @Roles('ADMIN')
  @Strict(ReviewBankItemDto)
  @ApiOperation({
    summary: 'ADMIN: review an item (REVIEW → PILOT on approve, REVIEW → DRAFT on reject).',
    description: `${QUESTION_BANK_DISCLAIMER} Two-person rule: the reviewer must differ from the author.`,
  })
  reviewItem(
    @Param() params: IdParamDto,
    @Body() dto: ReviewBankItemDto,
    @CurrentUser() user: RequestUser,
    @Ip() ip: string
  ) {
    return this.bank.review(params.id, dto, this.ctx(user, ip));
  }

  @Post('items/:id/publish')
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'ADMIN: publish a PILOT item (PILOT → LIVE).',
    description: `${QUESTION_BANK_DISCLAIMER} Publish runs only from PILOT — never direct DRAFT → LIVE.`,
  })
  publishItem(@Param() params: IdParamDto, @CurrentUser() user: RequestUser, @Ip() ip: string) {
    return this.bank.publish(params.id, this.ctx(user, ip));
  }

  @Post('items/:id/retire')
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'ADMIN: retire a LIVE or PILOT item.',
    description: QUESTION_BANK_DISCLAIMER,
  })
  retireItem(@Param() params: IdParamDto, @CurrentUser() user: RequestUser, @Ip() ip: string) {
    return this.bank.retire(params.id, this.ctx(user, ip));
  }

  @Post('items/:id/new-version')
  @Roles('ADMIN')
  @Strict(NewBankItemVersionDto)
  @ApiOperation({
    summary: 'ADMIN: create a new DRAFT version of an item (published versions are immutable).',
    description: `${QUESTION_BANK_DISCLAIMER} Creates a new row (version + 1, key "<key>-v<version>"); the old row is never edited in place.`,
  })
  newVersion(
    @Param() params: IdParamDto,
    @Body() dto: NewBankItemVersionDto,
    @CurrentUser() user: RequestUser,
    @Ip() ip: string
  ) {
    return this.bank.newVersion(params.id, dto, this.ctx(user, ip));
  }

  @Get('items')
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'ADMIN: list bank items (includes correct answers), filtered + paginated.',
    description: QUESTION_BANK_DISCLAIMER,
  })
  listItems(@Query() query: ListBankItemsQueryDto) {
    return this.bank.listItems(query);
  }

  @Get('coverage')
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'ADMIN: LIVE counts per topic × difficulty (thin cells visible, zeros included).',
    description: QUESTION_BANK_DISCLAIMER,
  })
  coverage() {
    return this.bank.coverage();
  }

  @Get('items/:id')
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'ADMIN: one bank item (includes correct answers).',
    description: QUESTION_BANK_DISCLAIMER,
  })
  getItem(@Param() params: IdParamDto) {
    return this.bank.getItem(params.id);
  }

  // --- templates ----------------------------------------------------------------

  @Post('templates/:id/generate')
  @Roles('ADMIN')
  @Strict(GenerateTemplateDto)
  @ApiOperation({
    summary: 'ADMIN: generate DRAFT variants from a template (deterministic per seed).',
    description:
      `${QUESTION_BANK_DISCLAIMER} Variants go through review like any item. ` +
      'Re-running the same template + seed skips already-generated variants.',
  })
  generateFromTemplate(
    @Param() params: IdParamDto,
    @Body() dto: GenerateTemplateDto,
    @CurrentUser() user: RequestUser,
    @Ip() ip: string
  ) {
    return this.bank.generateFromTemplate(params.id, dto, this.ctx(user, ip));
  }

  // --- selection ------------------------------------------------------------------

  @Post('select')
  @Strict(SelectBlueprintDto)
  @ApiOperation({
    summary: 'Select a duel set (public views only) and record exposure for the caller.',
    description:
      `${QUESTION_BANK_DISCLAIMER} LIVE items only; excludes items any listed user saw in ` +
      'the last 30 days or saw 3+ times. Throws 409 when the bank cannot fill the set. ' +
      'Future live duels call the service directly instead of this endpoint.',
  })
  select(@Body() dto: SelectBlueprintDto, @CurrentUser() user: RequestUser) {
    return this.bank.selectAndRecordExposure(user.sub, dto);
  }
}
