import { Module } from '@nestjs/common';
import { RatingsModule } from '../ratings/ratings.module';
import { SimulatorModule } from '../simulator/simulator.module';
import { ProfilesController } from './profiles.controller';
import { ProfilesRepository } from './profiles.repository';
import { ProfilesService } from './profiles.service';

/**
 * ProfilesModule — docs/06 §1, docs/18, ADR 0015 (Phase 13, Step A).
 *
 * Profiles extend the users module; they do not replace it. The
 * module owns the profile view (privacy filtering, career title,
 * duel history, simulator showcase) and reads — never writes —
 * other modules' tables for that view. It imports RatingsModule
 * (ratings overview) and SimulatorModule (showcase valuation).
 * It does NOT import UsersModule: the profile row is read through
 * its own repository, so there is no cycle when UsersModule imports
 * this module for GET/PATCH /users/me.
 *
 * Exports ProfilesService so UsersService and SettingsService can
 * build on the same profile view.
 */
@Module({
  imports: [RatingsModule, SimulatorModule],
  controllers: [ProfilesController],
  providers: [ProfilesService, ProfilesRepository],
  exports: [ProfilesService, ProfilesRepository],
})
export class ProfilesModule {}
