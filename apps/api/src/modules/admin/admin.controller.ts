import { Body, Controller, Delete, Get, Ip, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type RequestUser } from '../../common/decorators/current-user.decorator';
import { Roles, Strict } from '../../common/decorators/route.decorators';
import { IdParamDto } from '../../common/dto/id-param.dto';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { AdminService } from './admin.service';
import {
  CreateLessonDto,
  CreateModuleDto,
  CreateQuestionDto,
  CreateTrackDto,
  UpdateLessonDraftDto,
  UpdateModuleDto,
  UpdateQuestionDto,
  UpdateTrackDto,
} from './dto/admin.dto';

/**
 * AdminController — content management (blueprint §15/§17).
 *
 * Every route requires the ADMIN role (RolesGuard). Every endpoint is
 * @Strict. Every mutation writes an append-only audit row with the
 * actor, action, before/after, and IP.
 */
@ApiTags('admin')
@Roles('ADMIN')
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  private ctx(user: RequestUser, ip?: string) {
    return { actorId: user.sub, ...(ip ? { ip } : {}) };
  }

  // --- tracks ------------------------------------------------------------

  @Post('tracks')
  @Strict(CreateTrackDto)
  @ApiOperation({ summary: 'Create a track (draft).' })
  createTrack(@Body() dto: CreateTrackDto, @CurrentUser() user: RequestUser, @Ip() ip: string) {
    return this.admin.createTrack(dto, this.ctx(user, ip));
  }

  @Patch('tracks/:id')
  @Strict(UpdateTrackDto)
  @ApiOperation({ summary: 'Update a track.' })
  updateTrack(
    @Param() params: IdParamDto,
    @Body() dto: UpdateTrackDto,
    @CurrentUser() user: RequestUser,
    @Ip() ip: string
  ) {
    return this.admin.updateTrack(params.id, dto, this.ctx(user, ip));
  }

  @Post('tracks/:id/publish')
  @ApiOperation({ summary: 'Publish a track.' })
  publishTrack(@Param() params: IdParamDto, @CurrentUser() user: RequestUser, @Ip() ip: string) {
    return this.admin.publishTrack(params.id, this.ctx(user, ip));
  }

  @Get('tracks')
  @ApiOperation({ summary: 'List all tracks, including drafts.' })
  listTracks() {
    return this.admin.listTracks();
  }

  @Get('tracks/:id')
  @ApiOperation({ summary: 'Full content tree of a track (admin, all statuses).' })
  getTrackTree(@Param() params: IdParamDto) {
    return this.admin.getTrackTree(params.id);
  }

  // --- modules -----------------------------------------------------------

  @Post('modules')
  @Strict(CreateModuleDto)
  @ApiOperation({ summary: 'Create a module (draft).' })
  createModule(@Body() dto: CreateModuleDto, @CurrentUser() user: RequestUser, @Ip() ip: string) {
    return this.admin.createModule(dto, this.ctx(user, ip));
  }

  @Patch('modules/:id')
  @Strict(UpdateModuleDto)
  @ApiOperation({ summary: 'Update a module.' })
  updateModule(
    @Param() params: IdParamDto,
    @Body() dto: UpdateModuleDto,
    @CurrentUser() user: RequestUser,
    @Ip() ip: string
  ) {
    return this.admin.updateModule(params.id, dto, this.ctx(user, ip));
  }

  @Post('modules/:id/publish')
  @ApiOperation({ summary: 'Publish a module.' })
  publishModule(@Param() params: IdParamDto, @CurrentUser() user: RequestUser, @Ip() ip: string) {
    return this.admin.publishModule(params.id, this.ctx(user, ip));
  }

  // --- lessons -----------------------------------------------------------

  @Post('lessons')
  @Strict(CreateLessonDto)
  @ApiOperation({ summary: 'Create a lesson (family + draft v1).' })
  createLesson(@Body() dto: CreateLessonDto, @CurrentUser() user: RequestUser, @Ip() ip: string) {
    return this.admin.createLesson(dto, this.ctx(user, ip));
  }

  @Get('lessons/:id/draft')
  @ApiOperation({ summary: 'Get (or create) the lesson draft version.' })
  getDraft(@Param() params: IdParamDto, @CurrentUser() user: RequestUser) {
    return this.admin.getDraft(params.id, user.sub);
  }

  @Patch('lessons/:id/draft')
  @Strict(UpdateLessonDraftDto)
  @ApiOperation({ summary: 'Edit the lesson draft version.' })
  updateDraft(
    @Param() params: IdParamDto,
    @Body() dto: UpdateLessonDraftDto,
    @CurrentUser() user: RequestUser,
    @Ip() ip: string
  ) {
    return this.admin.updateDraft(params.id, dto, this.ctx(user, ip));
  }

  @Post('lessons/:id/publish')
  @ApiOperation({ summary: 'Publish the draft version (immutable afterwards).' })
  publishLesson(@Param() params: IdParamDto, @CurrentUser() user: RequestUser, @Ip() ip: string) {
    return this.admin.publishLesson(params.id, this.ctx(user, ip));
  }

  @Get('lessons/:id/versions')
  @ApiOperation({ summary: 'List all versions of a lesson.' })
  listVersions(@Param() params: IdParamDto) {
    return this.admin.listVersions(params.id);
  }

  // --- questions (draft versions only) -----------------------------------

  @Get('lessons/:id/questions')
  @ApiOperation({ summary: 'List questions on the lesson draft version.' })
  listDraftQuestions(@Param() params: IdParamDto, @CurrentUser() user: RequestUser) {
    return this.admin.listDraftQuestions(params.id, user.sub);
  }

  @Post('lessons/:id/questions')
  @Strict(CreateQuestionDto)
  @ApiOperation({ summary: 'Add a question to the lesson draft version.' })
  createQuestion(
    @Param() params: IdParamDto,
    @Body() dto: CreateQuestionDto,
    @CurrentUser() user: RequestUser,
    @Ip() ip: string
  ) {
    return this.admin.createQuestion(params.id, dto, this.ctx(user, ip));
  }

  @Patch('questions/:id')
  @Strict(UpdateQuestionDto)
  @ApiOperation({ summary: 'Update a draft-version question.' })
  updateQuestion(
    @Param() params: IdParamDto,
    @Body() dto: UpdateQuestionDto,
    @CurrentUser() user: RequestUser,
    @Ip() ip: string
  ) {
    return this.admin.updateQuestion(params.id, dto, this.ctx(user, ip));
  }

  @Delete('questions/:id')
  @ApiOperation({ summary: 'Delete a draft-version question.' })
  deleteQuestion(@Param() params: IdParamDto, @CurrentUser() user: RequestUser, @Ip() ip: string) {
    return this.admin.deleteQuestion(params.id, this.ctx(user, ip));
  }

  // --- audit --------------------------------------------------------------

  @Get('audit-log')
  @ApiOperation({ summary: 'Paginated admin audit log (append-only).' })
  listAudit(@Query() query: PaginationDto) {
    return this.admin.listAudit(query);
  }
}
