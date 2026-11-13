import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import type { TxClient } from '../../database/tx-client';
import type { DomainEventPayload, DomainEventType } from './event-bus';

export interface OutboxRow {
  id: string;
  type: string;
  payload: unknown;
  attempts: number;
}

/**
 * OutboxRepository — the ONLY file that touches Prisma for outbox_events
 * (blueprint §4).
 *
 * Rows are written in the SAME transaction as the domain change, so an
 * event is never lost on crash. The relay claims rows with
 * `FOR UPDATE SKIP LOCKED` so multiple API instances can share the work.
 */
@Injectable()
export class OutboxRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Writes an event row. Call with the transaction client (ADR 0002/3). */
  async append(type: DomainEventType, payload: DomainEventPayload, tx?: TxClient): Promise<void> {
    const client = tx ?? this.prisma;
    await client.outboxEvent.create({
      // Prisma Json columns need an InputJsonValue; the payload union is
      // JSON-compatible by construction (event-bus types).
      data: { type, payload: payload as unknown as Prisma.InputJsonValue },
    });
  }

  /** Claims up to `limit` unprocessed rows, oldest first. */
  async claimPending(limit: number): Promise<OutboxRow[]> {
    // Prisma has no SKIP LOCKED API; raw SQL is the documented escape hatch
    // for this exact pattern, and it stays inside the repository.
    const rows = await this.prisma.$queryRaw<OutboxRow[]>`
      UPDATE "outbox_events"
      SET "attempts" = "attempts" + 1
      WHERE "id" IN (
        SELECT "id" FROM "outbox_events"
        WHERE "processedAt" IS NULL
        ORDER BY "createdAt" ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING "id", "type", "payload", "attempts"`;
    return rows;
  }

  async markProcessed(id: string): Promise<void> {
    await this.prisma.outboxEvent.update({
      where: { id },
      data: { processedAt: new Date() },
    });
  }
}
