import { Module, forwardRef } from '@nestjs/common';
import { GamificationModule } from '../gamification/gamification.module';
import { LearningModule } from '../learning/learning.module';
import { QuizController } from './quiz.controller';
import { QuizRepository } from './quiz.repository';
import { QuizService } from './quiz.service';

/**
 * QuizModule — question bank, attempts, grading (blueprint §17).
 * Exports QuizService: the learning module's completion gate reads
 * passed attempts through it (ADR 0002/13).
 */
@Module({
  imports: [forwardRef(() => LearningModule), forwardRef(() => GamificationModule)],
  controllers: [QuizController],
  providers: [QuizService, QuizRepository],
  exports: [QuizService, QuizRepository],
})
export class QuizModule {}
