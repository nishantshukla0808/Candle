import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import type { TxClient } from '../../database/tx-client';

/**
 * IdempotencyRepository — the ONLY file that touches Prisma for
 * idempotency_records (blueprint §4, ADR 0002/7).
 */
@Injectable()
export class IdempotencyRepository {
  constructor(private readonly prisma: PrismaService) {}

  async find(key: string, userId: string, tx?: TxClient): Promise<unknown> {
    const client = tx ?? this.prisma;
    const row = await client.idempotencyRecord.findUnique({
      where: { key_userId: { key, userId } },
      select: { response: true, expiresAt: true },
    });
    if (!row) return null;
    if (row.expiresAt.getTime() < Date.now()) return null;
    return row.response;
  }

  async store(
    key: string,
    userId: string,
    response: unknown,
    ttlSeconds: number,
    tx?: TxClient
  ): Promise<void> {
    const client = tx ?? this.prisma;
    await client.idempotencyRecord.upsert({
      where: { key_userId: { key, userId } },
      update: {
        response: response as object,
        expiresAt: new Date(Date.now() + ttlSeconds * 1000),
      },
      create: {
        key,
        userId,
        response: response as object,
        expiresAt: new Date(Date.now() + ttlSeconds * 1000),
      },
    });
  }
}
