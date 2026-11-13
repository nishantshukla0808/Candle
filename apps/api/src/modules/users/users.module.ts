import { Module } from '@nestjs/common';
import { RatingsModule } from '../ratings/ratings.module';
import { UsersController } from './users.controller';
import { UsersRepository } from './users.repository';
import { UsersService } from './users.service';

/**
 * UsersModule — profile + avatar (blueprint §4/§10/§11).
 * Exports UsersService for other modules that need public profiles.
 *
 * Imports RatingsModule so a country change can keep the denormalised
 * countryCode on rating rows in sync (ADR 0005/8). One-directional:
 * RatingsModule imports nothing from users, so there is no cycle.
 */
@Module({
  imports: [RatingsModule],
  controllers: [UsersController],
  providers: [UsersRepository, UsersService],
  exports: [UsersService, UsersRepository],
})
export class UsersModule {}
