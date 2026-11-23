import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Inject } from '@nestjs/common';
import { CurrentUser, type RequestUser } from '../../common/decorators/current-user.decorator';
import { Strict } from '../../common/decorators/route.decorators';
import { CONFIG } from '../../config/config.module';
import type { AppConfig } from '../../config/configuration';
import {
  ChangePasswordDto,
  DeleteAccountDto,
  FamilyParamDto,
  UpdateNotificationDto,
  UpdateSettingsDto,
} from './dto/settings.dto';
import { SettingsService } from './settings.service';

/**
 * SettingsController — docs/06 §2.9, ADR 0015.
 *
 * Thin: parse input (already validated), call one service method.
 * The current session is identified from the access token's `fam`
 * claim (ADR 0015 §9) — the refresh cookie cannot identify it, because
 * the cookie is path-scoped to /api/v1/auth and is never sent to
 * /api/v1/settings/*. The cookie is kept only as a fallback for
 * claim-less (pre-Phase-13) tokens. Every session endpoint works
 * without an identifiable current session, but "revoke all OTHER
 * sessions" and "change password" can only preserve the current
 * session when one is identified.
 *
 * NOT here (deferred, ADR 0015 §10): GET /settings/logins (login
 * history), 2FA, change-email, GET /settings/blocked (blocked users).
 */
@ApiTags('settings')
@Controller('settings')
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    @Inject(CONFIG) private readonly config: AppConfig
  ) {}

  /** The presented refresh token, if the caller sent the cookie. */
  private presentedRefreshToken(req: Request): string | undefined {
    return req.cookies?.[this.config.REFRESH_COOKIE_NAME] as string | undefined;
  }

  private async currentFamily(req: Request, user: RequestUser): Promise<string | null> {
    // Primary: the access token's `fam` claim (ADR 0015 §9). Fallback:
    // the refresh cookie, for claim-less tokens minted before Phase 13.
    const byClaim = await this.settings.resolveCurrentFamilyById(user.sub, user.familyId);
    if (byClaim) return byClaim;
    return this.settings.resolveCurrentFamily(user.sub, this.presentedRefreshToken(req));
  }

  @Get('me')
  @ApiOperation({ summary: 'Get my settings (account, appearance, language, timezone).' })
  getSettings(@CurrentUser() user: RequestUser) {
    return this.settings.getSettings(user.sub);
  }

  @Patch('me')
  @Strict(UpdateSettingsDto)
  @ApiOperation({ summary: 'Update my settings.' })
  updateSettings(@CurrentUser() user: RequestUser, @Body() dto: UpdateSettingsDto) {
    return this.settings.updateSettings(user.sub, dto);
  }

  @Get('notifications')
  @ApiOperation({ summary: 'Get my notification preferences (all 12 types, with defaults).' })
  getNotifications(@CurrentUser() user: RequestUser) {
    return this.settings.getNotifications(user.sub);
  }

  @Patch('notifications')
  @Strict(UpdateNotificationDto)
  @ApiOperation({ summary: 'Update one notification type (inApp / push / email).' })
  updateNotification(@CurrentUser() user: RequestUser, @Body() dto: UpdateNotificationDto) {
    return this.settings.updateNotification(user.sub, dto);
  }

  @Get('sessions')
  @ApiOperation({ summary: 'List my active sessions (refresh-token families).' })
  async listSessions(@CurrentUser() user: RequestUser, @Req() req: Request) {
    const currentFamily = await this.currentFamily(req, user);
    return this.settings.listSessions(user.sub, currentFamily);
  }

  @Delete('sessions/:familyId')
  @ApiOperation({ summary: 'Revoke one session.' })
  revokeSession(@CurrentUser() user: RequestUser, @Param() params: FamilyParamDto) {
    return this.settings.revokeSession(user.sub, params.familyId);
  }

  @Delete('sessions')
  @ApiOperation({ summary: 'Revoke all other sessions (keeps the current one).' })
  async revokeAllOtherSessions(@CurrentUser() user: RequestUser, @Req() req: Request) {
    const currentFamily = await this.currentFamily(req, user);
    return this.settings.revokeAllOtherSessions(user.sub, currentFamily);
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @Strict(ChangePasswordDto)
  @ApiOperation({ summary: 'Change password (revokes all other sessions).' })
  async changePassword(
    @CurrentUser() user: RequestUser,
    @Body() dto: ChangePasswordDto,
    @Req() req: Request
  ) {
    const currentFamily = await this.currentFamily(req, user);
    return this.settings.changePassword(user.sub, dto, currentFamily);
  }

  @Post('export')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Export my data as JSON (max 1/day).' })
  exportData(@CurrentUser() user: RequestUser) {
    return this.settings.exportData(user.sub);
  }

  @Post('delete-account')
  @HttpCode(HttpStatus.OK)
  @Strict(DeleteAccountDto)
  @ApiOperation({ summary: 'Request account deletion (password confirm; 30-day grace).' })
  requestDeletion(@CurrentUser() user: RequestUser, @Body() dto: DeleteAccountDto) {
    return this.settings.requestDeletion(user.sub, dto);
  }

  @Post('delete-account/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel a deletion in its grace period.' })
  cancelDeletion(@CurrentUser() user: RequestUser) {
    return this.settings.cancelDeletion(user.sub);
  }
}
