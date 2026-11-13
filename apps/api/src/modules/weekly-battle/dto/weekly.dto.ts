import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsInt, IsString, IsUUID, Matches, Max, Min } from 'class-validator';
import { SimOrderSide } from '@prisma/client';

/**
 * Weekly Portfolio Battle DTOs — docs/16 (Phase 11).
 *
 * Boundary validation only: types, shapes, ranges. Whether a season
 * may be joined / traded / settled is a DOMAIN rule checked by the
 * service, never a validation error (blueprint §8).
 */

/** POST /weekly/seasons — ADMIN: create one weekly season. */
export class CreateWeeklySeasonDto {
  @ApiProperty({
    description: 'Monday date identifying the season (YYYY-MM-DD, Asia/Kolkata). Must be a Monday.',
    example: '2026-11-09',
  })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'weekStart must look like "2026-11-09".' })
  weekStart!: string;
}

/** POST /weekly/seasons/:id/trade — one order in the active season. */
export class WeeklyTradeDto {
  @ApiProperty({ description: 'Fictional instrument to trade.', format: 'uuid' })
  @IsUUID('4')
  instrumentId!: string;

  @ApiProperty({ enum: SimOrderSide, description: 'BUY spends virtual cash; SELL returns it.' })
  @IsEnum(SimOrderSide)
  side!: SimOrderSide;

  @ApiProperty({ description: 'Whole units, 1–100,000 per order.', example: 10 })
  @IsInt()
  @Min(1)
  @Max(100_000)
  quantity!: number;

  @ApiProperty({
    description: 'Client-supplied idempotency id: a retried order replays, never double-applies.',
    format: 'uuid',
  })
  @IsUUID('4')
  clientOrderId!: string;
}
