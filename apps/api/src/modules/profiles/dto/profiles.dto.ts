import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { ProfileVisibility } from '@prisma/client';
import {
  PROFILE_BIO_MAX,
  PROFILE_DISPLAY_NAME_MAX,
  PROFILE_DISPLAY_NAME_MIN,
} from '@candle/shared';

/**
 * Profiles DTOs — docs/06 §1.3/§1.5, ADR 0015 §1–§3.
 *
 * PATCH /users/me accepts display name + bio ONLY. Country is locked
 * after signup (decision 4): there is no country field here, so the
 * @Strict() interceptor rejects it at the boundary. Language and
 * timezone live in Settings, not here.
 *
 * Bio link/phone/email rules cannot be expressed as a single regex,
 * so the DTO checks length only and the service rejects the content
 * with per-field errors (bio-validation.ts).
 */

/** PATCH /users/me — strict: unknown properties rejected. */
export class UpdateMyProfileDto {
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

/** PATCH /users/me/privacy — strict: unknown properties rejected. */
export class UpdatePrivacyDto {
  @ApiProperty({
    required: false,
    description:
      'Main visibility switch. FRIENDS behaves as PRIVATE until the friends phase lands (ADR 0015 §1).',
    enum: ProfileVisibility,
  })
  @IsOptional()
  @IsEnum(ProfileVisibility)
  visibility?: ProfileVisibility;

  @ApiProperty({ required: false, description: 'Show Learning / Trading / Candle Ratings.' })
  @IsOptional()
  @IsBoolean()
  showRatings?: boolean;

  @ApiProperty({ required: false, description: 'Show global + national rank and percentile.' })
  @IsOptional()
  @IsBoolean()
  showRank?: boolean;

  @ApiProperty({ required: false, description: 'Show learning progress (track, lessons done).' })
  @IsOptional()
  @IsBoolean()
  showLearningProgress?: boolean;

  @ApiProperty({ required: false, description: 'Show duel history (last 5 per duel type).' })
  @IsOptional()
  @IsBoolean()
  showDuelHistory?: boolean;

  @ApiProperty({ required: false, description: 'Show the simulator showcase.' })
  @IsOptional()
  @IsBoolean()
  showSimulatorShowcase?: boolean;

  @ApiProperty({ required: false, description: 'Show badges.' })
  @IsOptional()
  @IsBoolean()
  showBadges?: boolean;

  @ApiProperty({ required: false, description: 'Show friends list (empty until friends land).' })
  @IsOptional()
  @IsBoolean()
  showFriendsList?: boolean;

  @ApiProperty({ required: false, description: 'Allow friend requests (friends phase).' })
  @IsOptional()
  @IsBoolean()
  allowFriendRequests?: boolean;

  @ApiProperty({ required: false, description: 'Allow duel challenges from non-friends.' })
  @IsOptional()
  @IsBoolean()
  allowChallengesFromStrangers?: boolean;

  @ApiProperty({ required: false, description: 'Show online status (presence phase).' })
  @IsOptional()
  @IsBoolean()
  showOnlineStatus?: boolean;
}
