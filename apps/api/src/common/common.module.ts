import { Global, Module } from '@nestjs/common';
import { AppLogger } from './services/logger.service';
import { RedisService } from './services/redis.service';
import { LocalStorageService, StorageService } from './services/storage.service';

/**
 * CommonModule — global infrastructure providers (blueprint §4 core).
 * Logger, Redis, and Storage are cross-cutting: every feature module
 * may inject them without importing anything.
 */
@Global()
@Module({
  providers: [AppLogger, RedisService, { provide: StorageService, useClass: LocalStorageService }],
  exports: [AppLogger, RedisService, StorageService],
})
export class CommonModule {}
