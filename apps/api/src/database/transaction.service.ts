import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import type { TxClient } from './tx-client';

/**
 * TransactionService — the single place that opens Prisma transactions
 * (ADR 0002/9).
 *
 * Services orchestrate `$transaction` blocks here and pass the TxClient
 * down into repositories. Repositories remain the ONLY files that touch
 * Prisma (blueprint §4) — services never call `prisma.<model>` directly.
 *
 * In tests this provider is overridden with a fake that runs the callback
 * against an in-memory store, so service logic is exercised without a
 * live database.
 */
@Injectable()
export class TransactionService {
  constructor(private readonly prisma: PrismaService) {}

  async run<T>(fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => fn(tx as TxClient));
  }
}
