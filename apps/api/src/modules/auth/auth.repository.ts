import { Injectable } from '@nestjs/common';
import { EmailTokenType, Role, type User } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import type { TxClient } from '../../database/tx-client';

/**
 * AuthRepository — the ONLY file that touches Prisma for auth
 * (blueprint §4). Every method accepts an optional transaction client;
 * services orchestrate transactions (ADR 0002/9).
 */

export interface CreateUserInput {
  email: string;
  passwordHash: string;
  displayName?: string;
  roles: Role[];
}

export interface EmailTokenRow {
  id: string;
  userId: string;
  type: EmailTokenType;
  expiresAt: Date;
  usedAt: Date | null;
  user: User;
}

export interface RefreshTokenRow {
  id: string;
  userId: string;
  familyId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  user: User;
}

@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: TxClient): TxClient {
    return tx ?? this.prisma;
  }

  // --- users ---------------------------------------------------------------

  createUser(input: CreateUserInput, tx?: TxClient): Promise<User> {
    return this.db(tx).user.create({
      data: {
        email: input.email,
        passwordHash: input.passwordHash,
        displayName: input.displayName,
        roles: input.roles,
      },
    });
  }

  findUserByEmail(email: string, tx?: TxClient): Promise<User | null> {
    return this.db(tx).user.findUnique({ where: { email } });
  }

  findUserById(id: string, tx?: TxClient): Promise<User | null> {
    return this.db(tx).user.findUnique({ where: { id } });
  }

  async setEmailVerified(userId: string, tx?: TxClient): Promise<void> {
    await this.db(tx).user.update({
      where: { id: userId },
      data: { emailVerifiedAt: new Date() },
    });
  }

  async updatePassword(userId: string, passwordHash: string, tx?: TxClient): Promise<void> {
    await this.db(tx).user.update({
      where: { id: userId },
      data: { passwordHash },
    });
  }

  // --- email tokens (verification + password reset) --------------------------

  async createEmailToken(
    input: { userId: string; type: EmailTokenType; tokenHash: string; expiresAt: Date },
    tx?: TxClient
  ): Promise<void> {
    await this.db(tx).emailToken.create({ data: input });
  }

  findValidEmailToken(
    tokenHash: string,
    type: EmailTokenType,
    tx?: TxClient
  ): Promise<EmailTokenRow | null> {
    return this.db(tx).emailToken.findFirst({
      where: { tokenHash, type, usedAt: null, expiresAt: { gt: new Date() } },
      include: { user: true },
    });
  }

  async markEmailTokenUsed(id: string, tx?: TxClient): Promise<void> {
    await this.db(tx).emailToken.update({ where: { id }, data: { usedAt: new Date() } });
  }

  async deleteEmailTokens(userId: string, type: EmailTokenType, tx?: TxClient): Promise<void> {
    await this.db(tx).emailToken.deleteMany({ where: { userId, type } });
  }

  // --- refresh tokens (rotation families) -------------------------------------

  async createRefreshToken(
    input: { userId: string; familyId: string; tokenHash: string; expiresAt: Date },
    tx?: TxClient
  ): Promise<void> {
    await this.db(tx).refreshToken.create({ data: input });
  }

  findRefreshTokenByHash(tokenHash: string, tx?: TxClient): Promise<RefreshTokenRow | null> {
    return this.db(tx).refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
  }

  async revokeRefreshToken(id: string, tx?: TxClient): Promise<void> {
    await this.db(tx).refreshToken.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
  }

  /** Revokes every token in the family — refresh reuse response (blueprint §11). */
  async revokeFamily(familyId: string, tx?: TxClient): Promise<void> {
    await this.db(tx).refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Revokes everything for the user — password reset / "log out everywhere". */
  async revokeAllUserRefreshTokens(userId: string, tx?: TxClient): Promise<void> {
    await this.db(tx).refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
