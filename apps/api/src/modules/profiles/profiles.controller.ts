import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type RequestUser } from '../../common/decorators/current-user.decorator';
import { Public, Strict } from '../../common/decorators/route.decorators';
import { IdParamDto } from '../../common/dto/id-param.dto';
import { UpdatePrivacyDto } from './dto/profiles.dto';
import { ProfilesService } from './profiles.service';

/**
 * ProfilesController — docs/06 §1.11, ADR 0015.
 *
 * Thin: parse input (already validated), call one service method.
 * Only the privacy + history + ratings sub-routes live here. GET
 * /users/me, PATCH /users/me, and GET /users/:id stay in
 * UsersController, which delegates to ProfilesService — the profile
 * is an extension of users, not a second users module.
 *
 * GET /users/:id/duels and /ratings are @Public (logged-out visitors
 * can read a PUBLIC profile) with opportunistic auth: a valid token
 * still attaches the viewer, so the owner sees their own full profile.
 */
@ApiTags('users')
@Controller('users')
export class ProfilesController {
  constructor(private readonly profiles: ProfilesService) {}

  @Patch('me/privacy')
  @Strict(UpdatePrivacyDto)
  @ApiOperation({ summary: 'Update my profile visibility + granular privacy toggles.' })
  updatePrivacy(@CurrentUser() user: RequestUser, @Body() dto: UpdatePrivacyDto) {
    return this.profiles.updatePrivacy(user.sub, dto);
  }

  @Public()
  @Get(':id/duels')
  @ApiOperation({
    summary: 'Duel history for a user: last 5 rated games per duel type, if allowed.',
  })
  getDuelHistory(@CurrentUser() user: RequestUser | undefined, @Param() params: IdParamDto) {
    return this.profiles.getDuelHistory(user?.sub ?? null, params.id);
  }

  @Public()
  @Get(':id/ratings')
  @ApiOperation({ summary: 'Ratings + rank for a user, if allowed.' })
  getRatings(@CurrentUser() user: RequestUser | undefined, @Param() params: IdParamDto) {
    return this.profiles.getRatingsView(user?.sub ?? null, params.id);
  }
}
