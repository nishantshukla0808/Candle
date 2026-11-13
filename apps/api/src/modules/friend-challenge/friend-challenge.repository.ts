import { Injectable } from '@nestjs/common';
import { ChallengeStatus, DuelType } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import type { TxClient } from '../../database/tx-client';

/**
 * FriendChallengeRepository — the ONLY file that touches Prisma for
 * challenges (blueprint §4). The service does all the math and rule
 * checks; the repository only persists.
 */

export interface ChallengeRow {
  id: string;
  creatorId: string;
  inviteeId: string;
  duelType: DuelType;
  status: ChallengeStatus;
  inviteCode: string;
  duelId: string | null;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateChallengeInput {
  creatorId: string;
  inviteeId: string;
  duelType: DuelType;
  inviteCode: string;
  expiresAt: Date;
}

export interface UpdateChallengeInput {
  status?: ChallengeStatus;
  duelId?: string | null;
}

/** A challenge that still blocks a new one for the pair + type (docs/17 §5). */
const BLOCKING_STATUSES: ChallengeStatus[] = [ChallengeStatus.PENDING, ChallengeStatus.ACCEPTED];

@Injectable()
export class FriendChallengeRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: TxClient): TxClient {
    return tx ?? this.prisma;
  }

  async create(input: CreateChallengeInput, tx?: TxClient): Promise<ChallengeRow> {
    return this.db(tx).challenge.create({ data: input });
  }

  async findById(id: string, tx?: TxClient): Promise<ChallengeRow | null> {
    return this.db(tx).challenge.findUnique({ where: { id } });
  }

  async findByInviteCode(code: string, tx?: TxClient): Promise<ChallengeRow | null> {
    return this.db(tx).challenge.findUnique({ where: { inviteCode: code } });
  }

  /**
   * A PENDING or ACCEPTED challenge between the two players for this
   * duel type, in EITHER direction (A→B blocks B→A too — docs/17 §5).
   * The partial unique index in migration 0014 is the race guard for
   * this same rule; the service check is what returns the clean 409.
   */
  async findBlockingBetween(
    userAId: string,
    userBId: string,
    duelType: DuelType,
    tx?: TxClient
  ): Promise<ChallengeRow | null> {
    return this.db(tx).challenge.findFirst({
      where: {
        duelType,
        status: { in: BLOCKING_STATUSES },
        OR: [
          { creatorId: userAId, inviteeId: userBId },
          { creatorId: userBId, inviteeId: userAId },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** My pending invites FROM others, newest first (lazy expiry runs in the service). */
  async listPendingIncoming(userId: string, tx?: TxClient): Promise<ChallengeRow[]> {
    return this.db(tx).challenge.findMany({
      where: { inviteeId: userId, status: ChallengeStatus.PENDING },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** My pending invites TO others, newest first. */
  async listPendingOutgoing(userId: string, tx?: TxClient): Promise<ChallengeRow[]> {
    return this.db(tx).challenge.findMany({
      where: { creatorId: userId, status: ChallengeStatus.PENDING },
      orderBy: { createdAt: 'desc' },
    });
  }

  async update(id: string, data: UpdateChallengeInput, tx?: TxClient): Promise<ChallengeRow> {
    return this.db(tx).challenge.update({ where: { id }, data });
  }
}
