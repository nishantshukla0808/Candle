import { Injectable } from '@nestjs/common';
import { AppLogger } from '../../common/services/logger.service';
import type { TxClient } from '../../database/tx-client';
import { AdminRepository } from './admin.repository';

/**
 * AuditService — append-only admin audit log (blueprint §9/§15).
 *
 * Every admin mutation records: who, what, which entity, before/after
 * summary, IP, timestamp. The table has no update/delete path —
 * history is immutable by construction.
 */
@Injectable()
export class AuditService {
  constructor(
    private readonly repo: AdminRepository,
    private readonly logger: AppLogger
  ) {}

  async log(
    input: {
      actorId: string;
      action: string;
      entityType: string;
      entityId: string;
      before?: unknown;
      after?: unknown;
      ip?: string;
    },
    tx?: TxClient
  ): Promise<void> {
    await this.repo.appendAudit(input, tx);
    this.logger.info('Admin action', {
      actorId: input.actorId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
    });
  }
}
