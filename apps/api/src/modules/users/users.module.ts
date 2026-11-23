import { Module } from '@nestjs/common';
import { ProfilesModule } from '../profiles/profiles.module';
import { UsersController } from './users.controller';
import { UsersRepository } from './users.repository';
import { UsersService } from './users.service';

/**
 * UsersModule — profile + avatar (blueprint §4/§10/§11).
 * Exports UsersService for other modules that need public profiles.
 *
 * Imports ProfilesModule: the profile itself (GET/PATCH /users/me,
 * GET /users/:id) lives there in Phase 13 — this module keeps only
 * avatar handling. One-directional: ProfilesModule never imports
 * UsersModule (it reads the User table through its own repository),
 * so there is no cycle.
 *
 * The RatingsModule import is GONE (Phase 13, ADR 0015 §2): country
 * is locked after signup, so nothing in users syncs country to
 * ratings any more.
 */
@Module({
  imports: [ProfilesModule],
  controllers: [UsersController],
  providers: [UsersRepository, UsersService],
  exports: [UsersService, UsersRepository],
})
export class UsersModule {}
