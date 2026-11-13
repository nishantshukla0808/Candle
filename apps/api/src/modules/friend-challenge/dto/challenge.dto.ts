import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, IsUUID, Matches } from 'class-validator';
import { CHALLENGE_DUEL_TYPES } from '../challenge-rules';

/**
 * Friend Challenge DTOs — docs/17 (Phase 12).
 *
 * Boundary validation only: types, shapes, allowed duel types.
 * Whether a challenge may be created (opponent exists, not yourself,
 * no pending duplicate, neither player busy, rate limit) or accepted
 * (invitee only, not expired, cooldown) is a DOMAIN rule checked by
 * the service, never a validation error (blueprint §8).
 */

/** POST /challenges — create an invite for one specific opponent. */
export class CreateChallengeDto {
  @ApiProperty({
    description:
      'The opponent’s user id. Must be an existing user, never yourself. ' +
      'The opponent is named by id here because there is no friends system yet (doc 06 waits for Profiles + Settings) — the web UI takes the id from a past duel or a shared link.',
    format: 'uuid',
  })
  @IsUUID('4')
  opponentId!: string;

  @ApiProperty({
    description:
      'The duel type to play: LIVE (Speed Quiz), BLITZ (Myth vs Fact), CASE (Case Duel), ' +
      'CHART (Chart Detective), SPRINT (Paper Trading Sprint), or CRISIS (Crisis Duel). ' +
      'DAILY and WEEKLY are season-based and cannot be challenged; BOT is practice, never a challenge.',
    enum: CHALLENGE_DUEL_TYPES,
    example: 'LIVE',
  })
  @IsString()
  @IsIn(CHALLENGE_DUEL_TYPES)
  duelType!: string;
}

/** GET /challenges/invite/:code — open an invite link. */
export class InviteCodeParamDto {
  @ApiProperty({
    description: 'The unguessable invite token from the link (/duels/challenge?code=…).',
    example: 'a1b2c3d4e5f6a7b8',
  })
  @IsString()
  @Matches(/^[0-9a-f]{16}$/, { message: 'code must be 16 lowercase hex characters' })
  code!: string;
}
