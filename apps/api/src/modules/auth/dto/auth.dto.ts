import { IsEmail, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Auth DTOs — blueprint §8. Every auth endpoint is @Strict:
 * unknown properties are REJECTED, not stripped.
 *
 * Password strength (length, complexity, common-password denylist) is
 * enforced by PasswordService, which throws VALIDATION_FAILED with
 * per-field details — the same envelope as DTO validation.
 */

export class RegisterDto {
  @ApiProperty({ example: 'nishu@example.com' })
  @IsEmail({}, { message: 'Must be a valid email address.' })
  @MaxLength(254)
  email!: string;

  @ApiProperty({ minLength: 12, description: 'Min 12 chars, upper+lower+digit+symbol.' })
  @IsString()
  @IsNotEmpty({ message: 'Password is required.' })
  @MaxLength(128, { message: 'Password must be at most 128 characters.' })
  password!: string;

  @ApiProperty({ required: false, example: 'Nishu' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  displayName?: string;
}

export class VerifyEmailDto {
  @ApiProperty({ description: 'Raw verification token from the email link.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  token!: string;
}

export class LoginDto {
  @ApiProperty({ example: 'nishu@example.com' })
  @IsEmail({}, { message: 'Must be a valid email address.' })
  @MaxLength(254)
  email!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Password is required.' })
  @MaxLength(128)
  password!: string;
}

export class ForgotPasswordDto {
  @ApiProperty({ example: 'nishu@example.com' })
  @IsEmail({}, { message: 'Must be a valid email address.' })
  @MaxLength(254)
  email!: string;
}

export class ResetPasswordDto {
  @ApiProperty({ description: 'Raw reset token from the email link.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  token!: string;

  @ApiProperty({ minLength: 12 })
  @IsString()
  @IsNotEmpty({ message: 'New password is required.' })
  @MinLength(1)
  @MaxLength(128, { message: 'Password must be at most 128 characters.' })
  newPassword!: string;
}

/** Public user shape returned by auth endpoints — never a password hash. */
export interface PublicUser {
  id: string;
  email: string;
  displayName: string | null;
  roles: string[];
  emailVerified: boolean;
}
