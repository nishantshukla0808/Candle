import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthRepository } from './auth.repository';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { RefreshTokenService } from './refresh-token.service';
import { TokenService } from './token.service';

/**
 * AuthModule — Phase 1 authentication (blueprint §11).
 *
 * Register (email verification required), login (progressive delay, no
 * enumeration), rotating refresh-token families with reuse detection,
 * logout, password reset (revokes all families). TokenService is also
 * exported for the global JwtAuthGuard.
 */
@Module({
  controllers: [AuthController],
  providers: [AuthService, AuthRepository, PasswordService, RefreshTokenService, TokenService],
  exports: [TokenService, AuthRepository, PasswordService, RefreshTokenService],
})
export class AuthModule {}
