import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AppConfig, loadConfig } from './configuration';

/**
 * Global configuration module. Imported once in AppModule.
 * Other modules inject the typed config via the CONFIG token.
 */
export const CONFIG = 'CANDLE_CONFIG';

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // Fail fast at boot — loadConfig throws on invalid env (blueprint §13).
      load: [(): { candle: AppConfig } => ({ candle: loadConfig() })],
    }),
  ],
  providers: [
    {
      provide: CONFIG,
      useFactory: (configService: ConfigService): AppConfig => {
        const candle = configService.get<AppConfig>('candle');
        if (!candle) {
          throw new Error('[config] candle config missing after validation');
        }
        return candle;
      },
      inject: [ConfigService],
    },
  ],
  exports: [CONFIG],
})
export class AppConfigModule {}
