import type { PrismaClient } from '@prisma/client';

/**
 * TxClient — the Prisma surface available inside a `$transaction` block
 * (ADR 0002/9).
 *
 * Repository methods accept an optional `TxClient`; services orchestrate
 * `$transaction` blocks and pass the client down. Repositories remain the
 * ONLY files that touch Prisma (blueprint §4) — the service never calls
 * `prisma.<model>` directly.
 */
export type TxClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;
