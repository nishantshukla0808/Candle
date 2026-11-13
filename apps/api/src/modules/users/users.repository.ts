import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import type { TxClient } from '../../database/tx-client';

/**
 * UsersRepository — the ONLY file that touches Prisma for users
 * (blueprint §4: repositories hold Prisma access only, no other file
 * touches Prisma). Methods accept an optional transaction client
 * (ADR 0002/9).
 */

export interface UserPublicRow {
  id: string;
  displayName: string | null;
  avatarKey: string | null;
  createdAt: Date;
}

export interface UserPrivateRow extends UserPublicRow {
  email: string;
  roles: string[];
  emailVerifiedAt: Date | null;
  countryCode: string | null;
  countryCodeChangedAt: Date | null;
}

@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: TxClient): TxClient {
    return tx ?? this.prisma;
  }

  /** Public profile — safe to show to anyone. Never includes email/hash. */
  findPublicById(id: string, tx?: TxClient): Promise<UserPublicRow | null> {
    return this.db(tx).user.findUnique({
      where: { id },
      select: { id: true, displayName: true, avatarKey: true, createdAt: true },
    });
  }

  /** Private profile — the owner only (service enforces ownership). */
  findPrivateById(id: string, tx?: TxClient): Promise<UserPrivateRow | null> {
    return this.db(tx).user.findUnique({
      where: { id },
      select: {
        id: true,
        displayName: true,
        avatarKey: true,
        createdAt: true,
        email: true,
        roles: true,
        emailVerifiedAt: true,
        countryCode: true,
        countryCodeChangedAt: true,
      },
    });
  }

  /** Legacy Phase 0 shape (id + email). Kept for compatibility. */
  findById(id: string, tx?: TxClient): Promise<{ id: string; email: string } | null> {
    return this.db(tx).user.findUnique({
      where: { id },
      select: { id: true, email: true },
    });
  }

  findByEmail(email: string, tx?: TxClient): Promise<{ id: string; email: string } | null> {
    return this.db(tx).user.findUnique({
      where: { email },
      select: { id: true, email: true },
    });
  }

  async updateProfile(
    id: string,
    data: {
      displayName?: string | null;
      countryCode?: string | null;
      countryCodeChangedAt?: Date | null;
    },
    tx?: TxClient
  ): Promise<UserPrivateRow> {
    return this.db(tx).user.update({
      where: { id },
      data,
      select: {
        id: true,
        displayName: true,
        avatarKey: true,
        createdAt: true,
        email: true,
        roles: true,
        emailVerifiedAt: true,
        countryCode: true,
        countryCodeChangedAt: true,
      },
    });
  }

  async setAvatarKey(id: string, avatarKey: string | null, tx?: TxClient): Promise<void> {
    await this.db(tx).user.update({ where: { id }, data: { avatarKey } });
  }
}
