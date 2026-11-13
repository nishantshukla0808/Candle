import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../common/services/redis.service';

/**
 * HealthService — dependency checks for /health/ready.
 * Returns per-dependency status; never throws (a failing check is data,
 * not an exception — the controller maps it to 503).
 */
export interface DependencyStatus {
  ok: boolean;
  latencyMs: number;
}

export interface ReadinessReport {
  status: 'ready' | 'not_ready';
  dependencies: {
    database: DependencyStatus;
    redis: DependencyStatus;
  };
}

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService
  ) {}

  async checkLiveness(): Promise<{ status: 'ok'; uptimeSeconds: number }> {
    return { status: 'ok', uptimeSeconds: Math.floor(process.uptime()) };
  }

  async checkReadiness(): Promise<ReadinessReport> {
    const [database, redis] = await Promise.all([this.checkDatabase(), this.checkRedis()]);
    return {
      status: database.ok && redis.ok ? 'ready' : 'not_ready',
      dependencies: { database, redis },
    };
  }

  private async checkDatabase(): Promise<DependencyStatus> {
    const started = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { ok: true, latencyMs: Date.now() - started };
    } catch {
      return { ok: false, latencyMs: Date.now() - started };
    }
  }

  private async checkRedis(): Promise<DependencyStatus> {
    const started = Date.now();
    const ok = await this.redis.ping();
    return { ok, latencyMs: Date.now() - started };
  }
}
