-- CreateEnum
CREATE TYPE "SimOrderSide" AS ENUM ('BUY', 'SELL');

-- CreateTable
CREATE TABLE "sim_instruments" (
    "id" UUID NOT NULL,
    "symbol" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "basePrice" DECIMAL(18,2) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sim_instruments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sim_portfolios" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "cash" DECIMAL(18,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sim_portfolios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sim_holdings" (
    "portfolioId" UUID NOT NULL,
    "instrumentId" UUID NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "avgCost" DECIMAL(18,2) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sim_holdings_pkey" PRIMARY KEY ("portfolioId","instrumentId")
);

-- CreateTable
CREATE TABLE "sim_orders" (
    "id" UUID NOT NULL,
    "portfolioId" UUID NOT NULL,
    "instrumentId" UUID NOT NULL,
    "side" "SimOrderSide" NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "price" DECIMAL(18,2) NOT NULL,
    "totalValue" DECIMAL(18,2) NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sim_orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sim_instruments_symbol_key" ON "sim_instruments"("symbol");

-- CreateIndex
CREATE UNIQUE INDEX "sim_portfolios_userId_key" ON "sim_portfolios"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "sim_orders_idempotencyKey_key" ON "sim_orders"("idempotencyKey");

-- CreateIndex
CREATE INDEX "sim_orders_portfolioId_createdAt_idx" ON "sim_orders"("portfolioId", "createdAt");

-- AddForeignKey
ALTER TABLE "sim_portfolios" ADD CONSTRAINT "sim_portfolios_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sim_holdings" ADD CONSTRAINT "sim_holdings_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "sim_portfolios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sim_holdings" ADD CONSTRAINT "sim_holdings_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "sim_instruments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sim_orders" ADD CONSTRAINT "sim_orders_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "sim_portfolios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sim_orders" ADD CONSTRAINT "sim_orders_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "sim_instruments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

