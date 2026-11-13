import { Controller, Get } from '@nestjs/common';
import { Public } from '../../common/decorators/route.decorators';
import { AppError } from '../../common/errors/app-error';
import { HealthService, ReadinessReport } from './health.service';

/**
 * Health endpoints — blueprint §13.
 * - GET /health       liveness: is the process alive? (public, no auth)
 * - GET /health/ready readiness: are DB + Redis reachable? (public)
 *
 * Neither endpoint exposes internals: readiness reports ok/not_ready
 * with latencies only — no versions, no connection strings, no errors.
 * A failing dependency returns 503 SERVICE_UNAVAILABLE, still enveloped.
 */
@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  liveness(): Promise<{ status: 'ok'; uptimeSeconds: number }> {
    return this.health.checkLiveness();
  }

  @Get('ready')
  async readiness(): Promise<ReadinessReport> {
    const report = await this.health.checkReadiness();
    if (report.status !== 'ready') {
      throw AppError.serviceUnavailable();
    }
    return report;
  }
}
