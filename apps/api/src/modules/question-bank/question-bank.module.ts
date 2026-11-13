import { Module } from '@nestjs/common';
import { QuestionBankController } from './question-bank.controller';
import { QuestionBankRepository } from './question-bank.repository';
import { QuestionBankService } from './question-bank.service';
import { SelectionService } from './selection.service';

/**
 * QuestionBankModule — docs/05 §2 (Duels Step 1, Phase 3).
 *
 * Self-contained: it imports no other feature module. Admin audit rows
 * are written to the shared append-only `audit_log` table through its
 * own repository (same row shape as the admin CMS — ADR 0005 §15).
 * RedisService, TransactionService, and AppLogger are global.
 *
 * Exports QuestionBankService (and SelectionService) so the future
 * duels module can call `selectSet` / `recordExposure` directly
 * instead of going through the HTTP select endpoint.
 */
@Module({
  controllers: [QuestionBankController],
  providers: [QuestionBankService, QuestionBankRepository, SelectionService],
  exports: [QuestionBankService, SelectionService],
})
export class QuestionBankModule {}
