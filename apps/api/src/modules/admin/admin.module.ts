import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminRepository } from './admin.repository';
import { AdminService } from './admin.service';
import { AuditService } from './audit.service';

/**
 * AdminModule — content management CMS (blueprint §15/§17).
 * All routes require the ADMIN role. Every mutation is audited.
 */
@Module({
  controllers: [AdminController],
  providers: [AdminService, AdminRepository, AuditService],
  exports: [AuditService],
})
export class AdminModule {}
