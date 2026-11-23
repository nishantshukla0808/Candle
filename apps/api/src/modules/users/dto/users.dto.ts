import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import {
  PROFILE_BIO_MAX,
  PROFILE_DISPLAY_NAME_MAX,
  PROFILE_DISPLAY_NAME_MIN,
} from '@candle/shared';

/**
 * PATCH /users/me — strict: unknown properties rejected.
 *
 * Display name + bio only. Country is LOCKED after signup (docs/06
 * §1.6 decision 4, ADR 0015 §2): there is no country field here, so
 * sending countryCode is rejected at the boundary with
 * VALIDATION_FAILED. Language and timezone live in Settings.
 */
export class UpdateProfileDto {
  @ApiProperty({
    required: false,
    description: 'Display name, 2–30 chars, letters/numbers/spaces only. Max 1 change per 30 days.',
    example: 'Nishu',
  })
  @IsOptional()
  @IsString()
  @MinLength(PROFILE_DISPLAY_NAME_MIN, {
    message: `Display name must be at least ${PROFILE_DISPLAY_NAME_MIN} characters.`,
  })
  @MaxLength(PROFILE_DISPLAY_NAME_MAX, {
    message: `Display name must be at most ${PROFILE_DISPLAY_NAME_MAX} characters.`,
  })
  @Matches(/^[A-Za-z0-9 ]+$/, {
    message: 'Display name may only contain letters, numbers, and spaces.',
  })
  displayName?: string;

  @ApiProperty({
    required: false,
    description: 'Bio, max 160 chars. No links, phone numbers, or email addresses.',
    example: 'Learning money, one lesson at a time.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(PROFILE_BIO_MAX, {
    message: `Bio must be at most ${PROFILE_BIO_MAX} characters.`,
  })
  bio?: string;
}
