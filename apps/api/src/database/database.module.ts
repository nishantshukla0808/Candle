import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { TransactionService } from './transaction.service';

/**
 * DatabaseModule — global, provides PrismaService to every module.
 * Repositories are the ONLY files that inject PrismaService
 * (blueprint §4). Feature modules never provide it themselves.
 * TransactionService is the only sanctioned way to open a transaction.
 */
@Global()
@Module({
  providers: [PrismaService, TransactionService],
  exports: [PrismaService, TransactionService],
})
export class DatabaseModule {}
