import { Global, Module } from '@nestjs/common';
import { EventBus } from './event-bus';
import { OutboxRepository } from './outbox.repository';
import { OutboxRelayService } from './outbox-relay.service';

/**
 * EventsModule — global domain-event infrastructure (blueprint §3).
 * EventBus, outbox repository, and relay are cross-cutting: feature
 * modules inject them without imports.
 */
@Global()
@Module({
  providers: [EventBus, OutboxRepository, OutboxRelayService],
  exports: [EventBus, OutboxRepository, OutboxRelayService],
})
export class EventsModule {}
