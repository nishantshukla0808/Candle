import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type RequestUser } from '../../common/decorators/current-user.decorator';
import { Strict } from '../../common/decorators/route.decorators';
import { IdParamDto } from '../../common/dto/id-param.dto';
import { CreateChallengeDto, InviteCodeParamDto } from './dto/challenge.dto';
import { CHALLENGES_DISCLAIMER, FriendChallengeService } from './friend-challenge.service';

/**
 * FriendChallengeController — docs/17 (Phase 12).
 *
 * Thin: every endpoint validates at the boundary, calls one service
 * method, and returns its result. The response envelope is applied by
 * the global interceptor — never hand-built here (blueprint §7).
 *
 * A Friend Challenge is an invite-only start-mode for an existing 1v1
 * duel, not the friends system (doc 06): no friend requests, lists,
 * or chat live here. The creator names one opponent by userId and one
 * of the six 1v1 duel types; the invitee accepts (the duel starts
 * immediately, rated, via the existing engine) or declines. Invites
 * expire after 24 hours. Every endpoint carries the educational
 * disclaimer (blueprint §16).
 *
 * Route order matters: /incoming, /outgoing, and /invite/:code are
 * registered before /:id, so a literal segment is never swallowed as
 * an id.
 */
@ApiTags('challenges')
@Controller('challenges')
export class FriendChallengeController {
  constructor(private readonly challenges: FriendChallengeService) {}

  @Post()
  @Strict(CreateChallengeDto)
  @ApiOperation({
    summary: 'Challenge one opponent to a duel (invite, 24 h expiry).',
    description:
      `${CHALLENGES_DISCLAIMER} Duel type must be one of LIVE, BLITZ, CASE, CHART, SPRINT, ` +
      'or CRISIS — DAILY and WEEKLY are season-based and cannot be challenged, BOT is practice. ' +
      'One pending challenge per pair per duel type; max 10 creates per hour. The invite carries ' +
      'both players’ Ratings, so the opponent sees the stakes before accepting. Rated by default — there is no unrated option.',
  })
  create(@Body() dto: CreateChallengeDto, @CurrentUser() user: RequestUser) {
    return this.challenges.createChallenge(user.sub, dto);
  }

  @Get('incoming')
  @ApiOperation({
    summary: 'My pending incoming challenges (I am the invitee), newest first.',
    description: `${CHALLENGES_DISCLAIMER} Expired invites are flipped to EXPIRED on read and left out of this list.`,
  })
  listIncoming(@CurrentUser() user: RequestUser) {
    return this.challenges.listIncoming(user.sub);
  }

  @Get('outgoing')
  @ApiOperation({
    summary: 'My pending outgoing challenges (I am the creator), newest first.',
    description: `${CHALLENGES_DISCLAIMER} Expired invites are flipped to EXPIRED on read and left out of this list.`,
  })
  listOutgoing(@CurrentUser() user: RequestUser) {
    return this.challenges.listOutgoing(user.sub);
  }

  @Get('invite/:code')
  @ApiOperation({
    summary: 'Open an invite link (by its unguessable code).',
    description:
      `${CHALLENGES_DISCLAIMER} Only the invitee can open it — anyone else gets the same 404 ` +
      'as a bad code. The invite link is /duels/challenge?code={inviteCode}.',
  })
  getByInviteCode(@Param() params: InviteCodeParamDto, @CurrentUser() user: RequestUser) {
    return this.challenges.getByInviteCode(user.sub, params.code);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'One challenge (creator or invitee only).',
    description: `${CHALLENGES_DISCLAIMER} A challenge that is not mine is 403; an expired one reads as EXPIRED.`,
  })
  getOne(@Param() params: IdParamDto, @CurrentUser() user: RequestUser) {
    return this.challenges.getChallenge(user.sub, params.id);
  }

  @Post(':id/accept')
  @ApiOperation({
    summary: 'Accept a challenge — the duel starts immediately (rated).',
    description:
      `${CHALLENGES_DISCLAIMER} Invitee only. The duel is created at once via the existing ` +
      'live/trading engine (no matchmaking queue) and the challenge becomes PLAYED with the duel id. ' +
      'The response carries playUrl — the variant’s play page, which resumes the active duel on load. ' +
      'Expired invites cannot be accepted; a 5-minute rematch cooldown applies to the pair.',
  })
  accept(@Param() params: IdParamDto, @CurrentUser() user: RequestUser) {
    return this.challenges.acceptChallenge(user.sub, params.id);
  }

  @Post(':id/decline')
  @ApiOperation({
    summary: 'Decline a challenge (invitee only).',
    description:
      `${CHALLENGES_DISCLAIMER} A declined challenge is closed and never counts toward any cap — ` +
      'the creator can send a fresh one.',
  })
  decline(@Param() params: IdParamDto, @CurrentUser() user: RequestUser) {
    return this.challenges.declineChallenge(user.sub, params.id);
  }
}
