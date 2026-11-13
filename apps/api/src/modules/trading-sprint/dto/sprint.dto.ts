import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { SimOrderSide } from '@prisma/client';
import { DUELS } from '@candle/shared';

/**
 * Sprint DTOs — docs/14 (Phase 9). Every REST endpoint and every
 * socket payload is validated at the boundary (blueprint §8); the
 * engine never re-trusts a value the DTO has not checked.
 */

// --- REST ------------------------------------------------------------------------

export class SprintHistoryQueryDto {
  @ApiProperty({ description: 'Page number (1-based).', default: 1, required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @ApiProperty({ description: 'Items per page (max 100).', default: 20, required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

// --- Socket ----------------------------------------------------------------------
// Note: sprint:join-queue carries no payload (the server reads the
// caller's Trading Rating), so there is no join-queue DTO: class-validator
// rejects a class with no validation metadata outright ("unknown value"),
// and a metadata-less DTO would validate nothing anyway.

export class SprintOrderSocketDto {
  @ApiProperty({ description: 'Sprint duel id.', format: 'uuid' })
  @IsUUID('4')
  duelId!: string;

  @ApiProperty({ description: 'Instrument to trade.', format: 'uuid' })
  @IsUUID('4')
  instrumentId!: string;

  @ApiProperty({ enum: SimOrderSide, description: 'BUY or SELL. No shorting in v1.' })
  @IsEnum(SimOrderSide)
  side!: SimOrderSide;

  @ApiProperty({
    description: 'Whole units to trade.',
    minimum: DUELS.SPRINT_MIN_ORDER_QTY,
    maximum: DUELS.SPRINT_MAX_ORDER_QTY,
  })
  @IsInt()
  @Min(DUELS.SPRINT_MIN_ORDER_QTY)
  @Max(DUELS.SPRINT_MAX_ORDER_QTY)
  quantity!: number;

  @ApiProperty({
    description: 'Client-supplied idempotency id: a retried order replays, never double-applies.',
    format: 'uuid',
  })
  @IsUUID('4')
  clientOrderId!: string;
}

export class SprintDuelIdSocketDto {
  @ApiProperty({ description: 'Sprint duel id.', format: 'uuid' })
  @IsUUID('4')
  duelId!: string;
}
