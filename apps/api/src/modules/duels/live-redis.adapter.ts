import { INestApplication } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import type { AppConfig } from '../../config/configuration';

/**
 * Socket.IO Redis adapter — docs/05 §3.4, docs/09 §7 (Phase 5).
 *
 * Lets a message to a room (`duel:{duelId}`) reach players connected
 * to DIFFERENT API servers: the adapter is pub/sub fan-out, not a
 * database — duel state still lives in Redis keys + Postgres.
 *
 * This adapter alone does NOT make multi-server work. WebSocket
 * connections are persistent: the load balancer MUST use sticky
 * sessions (cookie-based affinity, not just IP hash) so a client
 * always hits the same server for the life of its connection, or the
 * upgrade fails. Single-server v1 runs WITHOUT this adapter
 * (WS_REDIS_ADAPTER_ENABLED=false, the default); enabling it without
 * sticky sessions is a misconfiguration, not a scaling step.
 *
 * Installed in main.ts only when WS_REDIS_ADAPTER_ENABLED=true.
 */
export class LiveRedisAdapter extends IoAdapter {
  constructor(
    app: INestApplication,
    private readonly config: AppConfig
  ) {
    super(app);
  }

  createIOServer(port: number, options?: Record<string, unknown>): unknown {
    const server = super.createIOServer(port, options) as unknown as {
      adapter: (adapter: unknown) => void;
    };
    const pub = new Redis(this.config.REDIS_URL, { maxRetriesPerRequest: 2 });
    const sub = pub.duplicate();
    // The adapter is pub/sub fan-out only (ioredis publish/subscribe);
    // duel state still lives in Redis keys + Postgres (docs/09 §7).
    server.adapter(createAdapter(pub, sub));
    return server;
  }
}
