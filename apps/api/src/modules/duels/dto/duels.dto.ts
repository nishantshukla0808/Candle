import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, IsUUID, Matches, Max, Min } from 'class-validator';
import { DUELS } from '@candle/shared';
import { PaginationDto } from '../../../common/dto/pagination.dto';

/**
 * Duels DTOs — docs/05 §1, docs/07 (Phase 4 Step 2).
 *
 * Boundary validation only: types, shapes, ranges. Whether an answer
 * may be recorded (duel live, question next, first answer only) or a
 * duel may start (Bot cap, Daily 1/day) is a DOMAIN rule checked by
 * the service, never a validation error (blueprint §8).
 *
 * Timing note (ADR 0006/5): answers carry the client-reported
 * `timeMs` for the question (0–15000). The server validates the
 * range and scores from it; the 15 s limit is enforced on the
 * reported time. A live server-side timer arrives with live duels
 * (Step 3) — this REST step cannot observe wall-clock per question.
 */

/** POST /duels/bot/:id/answer and POST /duels/daily/:id/answer. */
export class AnswerDuelDto {
  @ApiProperty({
    description: 'Bank question id (must be the next unanswered question).',
    format: 'uuid',
  })
  @IsUUID('4')
  questionId!: string;

  @ApiProperty({ description: 'Selected option id (must belong to the question).', format: 'uuid' })
  @IsUUID('4')
  optionId!: string;

  @ApiProperty({
    description: 'Time taken for this question in ms (0–15000).',
    example: 4200,
    minimum: 0,
    maximum: DUELS.QUESTION_TIME_LIMIT_MS,
  })
  @IsInt()
  @Min(0)
  @Max(DUELS.QUESTION_TIME_LIMIT_MS)
  timeMs!: number;
}

/** POST /duels/daily/settle-unpaired — ADMIN: settle a day's unpaired players vs the bot. */
export class SettleUnpairedDto {
  @ApiProperty({
    description:
      'Asia/Kolkata calendar date to settle (YYYY-MM-DD). Only run for a date whose day has ended (23:59 IST) — settling today early pairs players against the bot while others may still join.',
    example: '2026-11-11',
  })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must look like "2026-11-11"' })
  date!: string;
}

/** GET /duels/history — paginated, newest first. */
export class DuelHistoryQueryDto extends PaginationDto {}
