import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { RatingKind } from '@prisma/client';
import { PaginationDto } from '../../../common/dto/pagination.dto';

/**
 * Ratings DTOs — docs/04-ratings-and-deployment.md (Phase 3).
 *
 * Boundary validation only: types, shapes, ranges. Whether a duel may
 * be rated (caps, cooldowns, duplicate events) is a DOMAIN rule checked
 * by the service, never a validation error (blueprint §8).
 */

export enum DuelResult {
  WIN = 'WIN',
  DRAW = 'DRAW',
  LOSS = 'LOSS',
}

/**
 * POST /ratings/duels — record one rated learning duel.
 * The caller's result is from the caller's perspective; the opponent's
 * side is mirrored by the service. `idempotencyKey` in the body MUST
 * match the `Idempotency-Key` header (ADR 0005/5) — one key, two
 * carriers, so the event id is visible in the audit trail.
 */
export class RecordDuelDto {
  @ApiProperty({ description: 'Opponent user id (must differ from the caller).', format: 'uuid' })
  @IsUUID('4')
  opponentId!: string;

  @ApiProperty({ enum: DuelResult, description: 'Result from the caller’s perspective.' })
  @IsEnum(DuelResult)
  result!: DuelResult;

  @ApiProperty({
    description: 'Idempotency key for this duel; must match the Idempotency-Key header.',
    example: 'duel-2026-11-11-001',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  idempotencyKey!: string;
}

/**
 * POST /ratings/trading-week — ADMIN: record one user's weekly trading
 * rating against the simulated index. The caller (admin job) supplies
 * the numbers; the Ratings module never queries the simulator module
 * (ADR 0005/7 — the seam is the caller).
 */
export class RecordTradingWeekDto {
  @ApiProperty({ description: 'User whose Trading rating is updated.', format: 'uuid' })
  @IsUUID('4')
  userId!: string;

  @ApiProperty({ description: 'User portfolio return for the week, in percent.', example: 4.5 })
  @IsNumber()
  @Min(-100)
  @Max(10000)
  portfolioReturnPct!: number;

  @ApiProperty({ description: 'Simulated index return for the week, in percent.', example: 1.2 })
  @IsNumber()
  @Min(-100)
  @Max(10000)
  indexReturnPct!: number;

  @ApiProperty({ description: 'Trades the user made that week. Fewer than 3 = unrated week.' })
  @IsInt()
  @Min(0)
  tradeCount!: number;

  @ApiProperty({
    description: 'Week start date (any day in the week; normalised to its Monday, UTC).',
    example: '2026-11-09',
  })
  @IsDateString()
  weekStart!: string;

  @ApiProperty({
    description: 'Idempotency key for this weekly update.',
    example: 'trading-2026-11-09-u1',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  idempotencyKey!: string;
}

/** POST /ratings/admin/season-reset — ADMIN: quarterly soft reset. */
export class SeasonResetDto {
  @ApiProperty({
    required: false,
    description: 'Season to reset into, e.g. "2026-Q4". Defaults to the current quarter.',
    example: '2026-Q4',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-Q[1-4]$/, { message: 'season must look like "2026-Q4"' })
  season?: string;
}

/** POST /ratings/admin/decay — ADMIN: inactivity decay run. */
export class DecayDto {
  @ApiProperty({
    required: false,
    description: 'Evaluate inactivity as of this date (ISO). Defaults to now.',
    example: '2026-11-11T00:00:00.000Z',
  })
  @IsOptional()
  @IsDateString()
  asOf?: string;
}

/** GET /ratings/me/history — paginated, with an optional kind filter. */
export class RatingHistoryQueryDto extends PaginationDto {
  @ApiProperty({ required: false, enum: RatingKind })
  @IsOptional()
  @IsEnum(RatingKind)
  kind?: RatingKind;
}

/** GET /ratings/leaderboard — public read, top 100 per scope. */
export class LeaderboardQueryDto {
  @ApiProperty({ required: false, enum: RatingKind, description: 'Defaults to LEARNING.' })
  @IsOptional()
  @IsEnum(RatingKind)
  kind?: RatingKind;

  @ApiProperty({ required: false, enum: ['global', 'country'], description: 'Defaults to global.' })
  @IsOptional()
  @IsIn(['global', 'country'])
  scope?: 'global' | 'country';

  @ApiProperty({
    required: false,
    description: '2-letter ISO country code. Required when scope=country.',
    example: 'IN',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{2}$/, { message: 'country must be a 2-letter uppercase ISO code' })
  country?: string;

  @ApiProperty({ required: false, description: 'Max entries (1–100). Defaults to 100.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
