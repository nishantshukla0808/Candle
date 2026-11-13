import { Module } from '@nestjs/common';
import { GamificationModule } from '../gamification/gamification.module';
import { SimulatorController } from './simulator.controller';
import { SimulatorRepository } from './simulator.repository';
import { SimulatorService } from './simulator.service';

/**
 * SimulatorModule — risk-free trading simulator (blueprint §17, ADR 0003).
 *
 * One-directional link to GamificationModule: executed trades emit
 * `trade.executed`, and the gamification module grants idempotent XP.
 * Gamification never imports the simulator, so no forwardRef is needed.
 */
@Module({
  imports: [GamificationModule],
  controllers: [SimulatorController],
  providers: [SimulatorService, SimulatorRepository],
  exports: [SimulatorService, SimulatorRepository],
})
export class SimulatorModule {}
