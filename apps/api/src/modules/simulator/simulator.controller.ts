import { Body, Controller, Get, Headers, Post, Query } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type RequestUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/route.decorators';
import { Strict } from '../../common/decorators/route.decorators';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { PlaceOrderDto } from './dto/simulator.dto';
import { SIMULATOR_DISCLAIMER, SimulatorService } from './simulator.service';

/**
 * SimulatorController — risk-free trading simulator (blueprint §17).
 *
 * Quotes are public (fictional tickers, simulated prices). Portfolio,
 * orders, and history are the caller's own and require auth.
 * Placing an order is money-like: it requires an Idempotency-Key
 * header (blueprint §6, ADR 0002/7).
 *
 * Every endpoint carries the educational disclaimer (blueprint §16).
 */
@ApiTags('simulator')
@Controller('simulator')
export class SimulatorController {
  constructor(private readonly simulator: SimulatorService) {}

  @Public()
  @Get('instruments')
  @ApiOperation({
    summary: 'List fictional instruments with current simulated prices.',
    description: SIMULATOR_DISCLAIMER,
  })
  listInstruments() {
    return this.simulator.listInstruments();
  }

  @Get('portfolio')
  @ApiOperation({
    summary: 'My virtual portfolio: cash, holdings valued at simulated prices, total equity.',
    description: SIMULATOR_DISCLAIMER,
  })
  getPortfolio(@CurrentUser() user: RequestUser) {
    return this.simulator.getPortfolio(user.sub);
  }

  @Post('orders')
  @Strict(PlaceOrderDto)
  @ApiOperation({
    summary: 'Place a simulated order (fills immediately at the simulated price).',
    description: `${SIMULATOR_DISCLAIMER} Idempotent — replays return the original result.`,
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'Client-generated key; replays return the original result.',
  })
  placeOrder(
    @Body() dto: PlaceOrderDto,
    @CurrentUser() user: RequestUser,
    @Headers('idempotency-key') idempotencyKey?: string
  ) {
    return this.simulator.placeOrder(user.sub, dto, idempotencyKey);
  }

  @Get('orders')
  @ApiOperation({
    summary: 'My simulated order history, newest first.',
    description: SIMULATOR_DISCLAIMER,
  })
  listOrders(@Query() query: PaginationDto, @CurrentUser() user: RequestUser) {
    return this.simulator.listOrders(user.sub, query.page, query.limit);
  }
}
