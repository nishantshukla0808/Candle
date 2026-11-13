import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { AppConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { CommonModule } from './common/common.module';
import { EventsModule } from './common/events/events.module';
import { IdempotencyModule } from './common/idempotency/idempotency.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { StrictValidationInterceptor } from './common/interceptors/strict-validation.interceptor';
import { TimeoutInterceptor } from './common/interceptors/timeout.interceptor';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { RateLimitMiddleware } from './common/middleware/rate-limit.middleware';
import { createGlobalValidationPipe } from './common/pipes/validation.pipes';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { HealthModule } from './modules/health/health.module';
import { LearningModule } from './modules/learning/learning.module';
import { QuizModule } from './modules/quiz/quiz.module';
import { GamificationModule } from './modules/gamification/gamification.module';
import { AdminModule } from './modules/admin/admin.module';
import { SimulatorModule } from './modules/simulator/simulator.module';
import { OnboardingModule } from './modules/onboarding/onboarding.module';
import { RatingsModule } from './modules/ratings/ratings.module';
import { QuestionBankModule } from './modules/question-bank/question-bank.module';
import { DuelsModule } from './modules/duels/duels.module';
import { FriendChallengeModule } from './modules/friend-challenge/friend-challenge.module';
import { TradingSprintModule } from './modules/trading-sprint/sprint.module';
import { CrisisDuelModule } from './modules/crisis-duel/crisis.module';
import { WeeklyBattleModule } from './modules/weekly-battle/weekly.module';

/**
 * AppModule — the module registry (blueprint §4).
 * Adding a feature = one line in `imports` (blueprint §5). Nothing else in
 * this file may change for a feature.
 *
 * Global pipeline (blueprint §9), in order:
 *  1-4. RequestId, Helmet, CORS, RateLimit  -> middleware (configure() + main.ts)
 *  5.   LoggingInterceptor                   -> APP_INTERCEPTOR
 *  6.   JwtAuthGuard                         -> APP_GUARD
 *  7.   RolesGuard                           -> APP_GUARD
 *  8.   ValidationPipe                       -> APP_PIPE
 *  9.   TimeoutInterceptor                   -> APP_INTERCEPTOR
 *  10.  ResponseInterceptor                  -> APP_INTERCEPTOR
 *  11.  GlobalExceptionFilter                -> APP_FILTER
 *
 * Interceptor order note: Nest runs interceptors in registration order
 * on the way in and REVERSE order on the way out. Registered as
 * [Logging, Timeout, Response, Strict] so the response path is
 * Strict -> Response -> Timeout -> Logging. StrictValidationInterceptor
 * only acts on routes marked @Strict(Dto) and passes everything else
 * through untouched.
 */
@Module({
  imports: [
    AppConfigModule,
    DatabaseModule,
    CommonModule,
    EventsModule,
    IdempotencyModule,
    AuthModule,
    UsersModule,
    HealthModule,
    LearningModule,
    QuizModule,
    GamificationModule,
    AdminModule,
    SimulatorModule,
    OnboardingModule,
    RatingsModule,
    QuestionBankModule,
    DuelsModule,
    FriendChallengeModule,
    TradingSprintModule,
    CrisisDuelModule,
    WeeklyBattleModule,
  ],
  providers: [
    RequestIdMiddleware,
    RateLimitMiddleware,
    // 11. Exception filter — outermost catch, always last.
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    // 5. Logging (in), then 9/10 unwind after it.
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    { provide: APP_INTERCEPTOR, useClass: TimeoutInterceptor },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    // 8b. Strict-mode rejection runs before the ValidationPipe (§8).
    { provide: APP_INTERCEPTOR, useClass: StrictValidationInterceptor },
    // 6-7. Guards run after middleware, before pipes.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    // 8. Validation at the boundary.
    { provide: APP_PIPE, useValue: createGlobalValidationPipe() },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Steps 1 & 4. Helmet (2) and CORS (3) are wired in main.ts.
    consumer.apply(RequestIdMiddleware, RateLimitMiddleware).forRoutes('*');
  }
}
