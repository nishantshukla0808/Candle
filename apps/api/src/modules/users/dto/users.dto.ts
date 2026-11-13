import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/** PATCH /users/me — strict: unknown properties rejected. */
export class UpdateProfileDto {
  @ApiProperty({ required: false, example: 'Nishu' })
  @IsOptional()
  @IsString()
  @MaxLength(80, { message: 'Display name must be at most 80 characters.' })
  displayName?: string;

  @ApiProperty({
    required: false,
    description:
      '2-letter ISO country code (e.g. IN). Changing to a different code is allowed once ' +
      'every 90 days; users with no country appear only on the global leaderboard (ADR 0005/8).',
    example: 'IN',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{2}$/, { message: 'countryCode must be a 2-letter uppercase ISO code.' })
  countryCode?: string;
}
