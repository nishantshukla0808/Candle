import { ApiProperty } from '@nestjs/swagger';
import { SimOrderSide } from '@prisma/client';
import { IsEnum, IsNumber, IsPositive, IsUUID, Max } from 'class-validator';
import { SIMULATOR_MAX_ORDER_QTY } from '@candle/shared';

/**
 * PlaceOrderDto — a single simulated order (blueprint §8).
 *
 * Boundary validation only: types, positivity, bounds. Whether the user
 * can afford the order is a DOMAIN rule checked by the service
 * (INSUFFICIENT_FUNDS / INSUFFICIENT_HOLDINGS), never a validation error.
 */
export class PlaceOrderDto {
  @ApiProperty({
    description: 'Fictional instrument id (from GET /simulator/instruments).',
    format: 'uuid',
  })
  @IsUUID('4')
  instrumentId!: string;

  @ApiProperty({
    enum: SimOrderSide,
    description: 'BUY spends virtual cash; SELL converts holdings to virtual cash.',
  })
  @IsEnum(SimOrderSide)
  side!: SimOrderSide;

  @ApiProperty({
    description: 'Units to trade. Positive, up to 6 decimal places.',
    example: 10,
  })
  @IsNumber({ maxDecimalPlaces: 6 })
  @IsPositive()
  @Max(SIMULATOR_MAX_ORDER_QTY)
  quantity!: number;
}
