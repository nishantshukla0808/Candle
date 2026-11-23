import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { AuthModule } from '../auth/auth.module';
import { ProfilesModule } from '../profiles/profiles.module';
import { SettingsController } from './settings.controller';
import { SettingsRepository } from './settings.repository';
import { SettingsService } from './settings.service';

/**
 * SettingsModule — docs/06 §2, docs/18, ADR 0015 (Phase 13, Step B).
 *
 * Account, sessions, notifications, appearance, language + timezone,
 * DPDP export/delete. It imports ProfilesModule (the export reuses
 * the owner profile view), AuthModule (sessions over the existing
 * refresh-token families, password hashing/verification) and
 * AdminModule (AuditService only — deletion requests/cancels/purges
 * are written to the append-only audit log, docs/06 §6.6).
 *
 * No new table for sessions or login history: sessions are a view
 * over RefreshToken families; login history is deferred (ADR 0015
 * §10) and has no table in this phase.
 */
@Module({
  imports: [ProfilesModule, AuthModule, AdminModule],
  controllers: [SettingsController],
  providers: [SettingsService, SettingsRepository],
  exports: [SettingsService],
})
export class SettingsModule {}
