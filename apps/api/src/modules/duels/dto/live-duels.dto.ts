import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import type { LiveDuelVariant } from '../live-duel-variants';

/**
 * Live duel socket payloads — docs/09 (Phase 5).
 *
 * Every client→server socket payload is validated at the boundary with
 * the same class-validator DTOs the REST pipeline uses (blueprint §8):
 * an invalid payload gets a `live:error` with code VALIDATION_FAILED,
 * never a crash and never a silent accept. Socket payloads carry NO
 * timeMs — the server grades from its own clock (docs/05 §3.1).
 */

/** Client → server: `live:answer`. */
export class LiveAnswerSocketDto {
  @ApiProperty({ description: 'Live duel id.', format: 'uuid' })
  @IsUUID('4')
  duelId!: string;

  @ApiProperty({ description: 'Current question id (must be the open question).', format: 'uuid' })
  @IsUUID('4')
  questionId!: string;

  @ApiProperty({ description: 'Selected option id (must belong to the question).', format: 'uuid' })
  @IsUUID('4')
  optionId!: string;
}

/** Client → server: `live:rematch` and `live:leave-duel`. */
export class LiveDuelIdSocketDto {
  @ApiProperty({ description: 'Live duel id.', format: 'uuid' })
  @IsUUID('4')
  duelId!: string;
}

/** Client → server: `live:join-queue` (variant selects the queue; the server reads the rating). */
export class LiveJoinQueueSocketDto {
  @ApiProperty({
    required: false,
    enum: ['LIVE', 'BLITZ', 'CASE', 'CHART'],
    default: 'LIVE',
    description:
      'Live variant: LIVE = Speed Quiz Duel (7 questions, 15 s each), ' +
      'BLITZ = Myth vs Fact Blitz (10 true/false, 10 s each), ' +
      'CASE = Case Duel (5 cases, 45 s each, rubric scoring), ' +
      'CHART = Chart Detective (5 charts, 30 s each, standard scoring + annotation reveal). Defaults to LIVE. ' +
      'Each variant has its own queue — a LIVE waiter is never matched into a Blitz, Case, or Chart duel.',
  })
  @IsOptional()
  @IsEnum(['LIVE', 'BLITZ', 'CASE', 'CHART'])
  variant?: LiveDuelVariant;

  @ApiProperty({
    required: false,
    description: 'Reserved. Any value is ignored; the server uses the caller’s Learning Rating.',
  })
  @IsOptional()
  @IsString()
  ignored?: string;
}

/**
 * Client → server: `live:reason` (Case Duel only, ADR 0009 §4).
 *
 * Sent after the action, inside the reason window: the player's
 * one-line reason for the action they picked (a reason chip), or
 * null when they skip it. The reason is NEVER scored — it is
 * recorded on the DuelAnswer row only. A missing reason is stored
 * as null, never a lost answer. Sending a reason for a question
 * the player never answered, or after the reason window closed,
 * is rejected with VALIDATION_FAILED.
 */
export class LiveReasonSocketDto {
  @ApiProperty({ description: 'Live duel id.', format: 'uuid' })
  @IsUUID('4')
  duelId!: string;

  @ApiProperty({ description: 'Current question id (must be the open case).', format: 'uuid' })
  @IsUUID('4')
  questionId!: string;

  @ApiProperty({
    required: false,
    description:
      'One-line reason for the picked action (a reason chip), or null to skip. ' +
      'At most 80 characters; anything longer is rejected.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  reason?: string | null;
}
