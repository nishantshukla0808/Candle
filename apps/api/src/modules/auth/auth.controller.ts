import { Body, Controller, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Inject } from '@nestjs/common';
import { Public, Strict } from '../../common/decorators/route.decorators';
import { CONFIG } from '../../config/config.module';
import type { AppConfig } from '../../config/configuration';
import { AuthService } from './auth.service';
import {
  ForgotPasswordDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
  VerifyEmailDto,
} from './dto/auth.dto';

/**
 * AuthController — blueprint §9/§11, Phase 1.
 *
 * All routes are @Public (they establish identity) and @Strict (unknown
 * properties rejected). Refresh tokens travel in an httpOnly cookie;
 * access tokens go in the response body for the client to hold in memory.
 */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(CONFIG) private readonly config: AppConfig
  ) {}

  private cookieOptions() {
    return {
      httpOnly: true,
      secure: this.config.isProduction,
      sameSite: 'lax' as const,
      path: '/api/v1/auth',
      maxAge: this.config.JWT_REFRESH_TTL_SECONDS * 1000,
    };
  }

  private refreshCookieName(): string {
    return this.config.REFRESH_COOKIE_NAME;
  }

  @Public()
  @Post('register')
  @Strict(RegisterDto)
  @ApiOperation({ summary: 'Register a new account (email verification required).' })
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Public()
  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @Strict(VerifyEmailDto)
  @ApiOperation({ summary: 'Verify an email address with the emailed token.' })
  verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.auth.verifyEmail(dto.token);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Strict(LoginDto)
  @ApiOperation({ summary: 'Log in. Sets the refresh cookie; returns an access token.' })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ): Promise<{ user: unknown; accessToken: string }> {
    const { user, pair } = await this.auth.login(dto, req.headers['user-agent']);
    res.cookie(this.refreshCookieName(), pair.refreshToken, this.cookieOptions());
    return { user, accessToken: pair.accessToken };
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate the refresh cookie; returns a new access token.' })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ): Promise<{ accessToken: string }> {
    const presented = req.cookies?.[this.refreshCookieName()] as string | undefined;
    const pair = await this.auth.refresh(presented, req.headers['user-agent']);
    res.cookie(this.refreshCookieName(), pair.refreshToken, this.cookieOptions());
    return { accessToken: pair.accessToken };
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke the refresh token and clear the cookie.' })
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ): Promise<{ message: string }> {
    const presented = req.cookies?.[this.refreshCookieName()] as string | undefined;
    await this.auth.logout(presented);
    res.clearCookie(this.refreshCookieName(), { path: '/api/v1/auth' });
    return { message: 'Logged out.' };
  }

  @Public()
  @Post('password/forgot')
  @HttpCode(HttpStatus.OK)
  @Strict(ForgotPasswordDto)
  @ApiOperation({ summary: 'Request a password reset. Always 200 (no enumeration).' })
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.auth.forgotPassword(dto);
  }

  @Public()
  @Post('password/reset')
  @HttpCode(HttpStatus.OK)
  @Strict(ResetPasswordDto)
  @ApiOperation({ summary: 'Reset the password with the emailed token.' })
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<{ message: string }> {
    await this.auth.resetPassword(dto);
    return { message: 'Password has been reset. Please log in again.' };
  }
}
