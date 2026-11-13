import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { AppLogger } from '../services/logger.service';
import { CONFIG } from '../../config/config.module';
import type { AppConfig } from '../../config/configuration';
import { EventBus, type DomainEventPayload, type DomainEventType } from './event-bus';
import { OutboxRepository } from './outbox.repository';

/**
 * OutboxRelayService — drains the outbox table (blueprint §3, ADR 0002/3).
 *
 * Polls every OUTBOX_POLL_MS, claims pending rows, dispatches each to the
 * EventBus, then marks it processed. Handlers MUST be idempotent: a row is
 * marked processed only after dispatch, so a crash between dispatch and
 * marking replays the event.
 *
 * Controllers that need post-event state in the response call `drain()`
 * directly instead of waiting for the poll.
 */
@Injectable()
export class OutboxRelayService implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private draining = false;

  constructor(
    private readonly outbox: OutboxRepository,
    private readonly bus: EventBus,
    private readonly logger: AppLogger,
    @Inject(CONFIG) private readonly config: AppConfig
  ) {}

  onModuleInit(): void {
    if (this.config.NODE_ENV === 'test') return; // tests call drain() explicitly
    this.timer = setInterval(() => {
      void this.drain().catch((err: unknown) =>
        this.logger.error('Outbox drain failed', {
          err: err instanceof Error ? err.message : String(err),
        })
      );
    }, this.config.OUTBOX_POLL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Processes all currently-pending rows. Safe to call concurrently. */
  async drain(): Promise<number> {
    if (this.draining) return 0;
    this.draining = true;
    try {
      let total = 0;
      for (;;) {
        const rows = await this.outbox.claimPending(100);
        if (rows.length === 0) break;
        for (const row of rows) {
          await this.bus.emit(row.type as DomainEventType, row.payload as DomainEventPayload);
          await this.outbox.markProcessed(row.id);
          total += 1;
        }
      }
      return total;
    } finally {
      this.draining = false;
    }
  }
}
