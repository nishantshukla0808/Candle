import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { FontSize, NotificationType, Theme } from '@prisma/client';

/**
 * Settings DTOs — docs/06 §2, ADR 0015 §5–§8.
 *
 * Language allowlist (en only) and IANA timezone / HH:MM checks live
 * in the service (they need custom validators); the DTO checks shape
 * only. All PATCH endpoints are @Strict: unknown properties rejected.
 */

/** PATCH /settings/me. */
export class UpdateSettingsDto {
  @ApiProperty({ required: false, enum: Theme, description: 'LIGHT / DARK / SYSTEM (default).' })
  @IsOptional()
  @IsEnum(Theme)
  theme?: Theme;

  @ApiProperty({ required: false, enum: FontSize })
  @IsOptional()
  @IsEnum(FontSize)
  fontSize?: FontSize;

  @ApiProperty({ required: false, description: 'Reduce motion: no confetti, no large animations.' })
  @IsOptional()
  @IsBoolean()
  reduceMotion?: boolean;

  @ApiProperty({ required: false, description: 'en only in v1.' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  language?: string;

  @ApiProperty({
    required: false,
    description: 'IANA name, e.g. Asia/Kolkata.',
    example: 'Asia/Kolkata',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  @ApiProperty({ required: false, description: 'Quiet hours start, "HH:MM".', example: '22:00' })
  @IsOptional()
  @IsString()
  @MaxLength(5)
  quietHoursStart?: string;

  @ApiProperty({ required: false, description: 'Quiet hours end, "HH:MM".', example: '08:00' })
  @IsOptional()
  @IsString()
  @MaxLength(5)
  quietHoursEnd?: string;

  @ApiProperty({ required: false, description: 'Streak reminder on/off (max 1/day).' })
  @IsOptional()
  @IsBoolean()
  streakReminderEnabled?: boolean;

  @ApiProperty({ required: false, description: 'Streak reminder time, "HH:MM".', example: '19:00' })
  @IsOptional()
  @IsString()
  @MaxLength(5)
  streakReminderTime?: string;

  @ApiProperty({ required: false, description: 'Marketing consent, OFF by default.' })
  @IsOptional()
  @IsBoolean()
  marketingConsent?: boolean;
}

/** PATCH /settings/notifications — one type per call. */
export class UpdateNotificationDto {
  @ApiProperty({ enum: NotificationType, description: 'Notification type (docs/06 §2.3).' })
  @IsEnum(NotificationType)
  type!: NotificationType;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  inApp?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  push?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  email?: boolean;
}

/** POST /settings/change-password. */
export class ChangePasswordDto {
  @ApiProperty({ description: 'Current password.' })
  @IsString()
  @IsNotEmpty({ message: 'Current password is required.' })
  @MaxLength(128)
  currentPassword!: string;

  @ApiProperty({
    description:
      'New password. The platform policy governs (min 12 chars, upper+lower+digit+symbol).',
  })
  @IsString()
  @IsNotEmpty({ message: 'New password is required.' })
  @MaxLength(128, { message: 'New password must be at most 128 characters.' })
  newPassword!: string;
}

/** POST /settings/delete-account — step 1 needs the password. */
export class DeleteAccountDto {
  @ApiProperty({ description: 'Password confirmation for account deletion.' })
  @IsString()
  @IsNotEmpty({ message: 'Password is required.' })
  @MaxLength(128)
  password!: string;
}

/** DELETE /settings/sessions/:familyId. */
export class FamilyParamDto {
  @ApiProperty({ description: 'Refresh-token family id (a session).' })
  @IsUUID('4', { message: 'familyId must be a valid UUID v4' })
  familyId!: string;
}
