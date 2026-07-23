-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_configs" (
    "id" TEXT NOT NULL,
    "exchange" TEXT NOT NULL DEFAULT 'BINANCE',
    "environment" TEXT NOT NULL DEFAULT 'TESTNET',
    "apiKey" TEXT NOT NULL,
    "apiSecret" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "strategies" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "cycleInterval" TEXT NOT NULL DEFAULT '5m',
    "quantity" DOUBLE PRECISION NOT NULL,
    "quantityType" TEXT NOT NULL DEFAULT 'BY_QUANTITY',
    "leverage" INTEGER NOT NULL DEFAULT 10,
    "takeProfitPct" DOUBLE PRECISION NOT NULL DEFAULT 1.5,
    "stopLossPct" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "maxPositions" INTEGER NOT NULL DEFAULT 5,
    "marginMode" TEXT NOT NULL DEFAULT 'ISOLATED',
    "apiConfigId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'IDLE',
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "strategies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "positions" (
    "id" TEXT NOT NULL,
    "strategyId" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "entryPrice" DOUBLE PRECISION NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "takeProfitPrice" DOUBLE PRECISION,
    "stopLossPrice" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "realizedPnl" DOUBLE PRECISION,
    "cycleOpenTime" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "price" DOUBLE PRECISION,
    "stopPrice" DOUBLE PRECISION,
    "quantity" DOUBLE PRECISION NOT NULL,
    "filledQty" DOUBLE PRECISION,
    "exchangeOrderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trade_logs" (
    "id" TEXT NOT NULL,
    "positionId" TEXT,
    "action" TEXT NOT NULL,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trade_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "api_configs_exchange_environment_key" ON "api_configs"("exchange", "environment");

-- CreateIndex
CREATE INDEX "strategies_symbol_isActive_idx" ON "strategies"("symbol", "isActive");

-- CreateIndex
CREATE INDEX "positions_strategyId_status_idx" ON "positions"("strategyId", "status");

-- CreateIndex
CREATE INDEX "positions_cycleId_idx" ON "positions"("cycleId");

-- CreateIndex
CREATE INDEX "orders_positionId_idx" ON "orders"("positionId");

-- CreateIndex
CREATE INDEX "trade_logs_positionId_idx" ON "trade_logs"("positionId");

-- AddForeignKey
ALTER TABLE "strategies" ADD CONSTRAINT "strategies_apiConfigId_fkey" FOREIGN KEY ("apiConfigId") REFERENCES "api_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "positions" ADD CONSTRAINT "positions_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "strategies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "positions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_logs" ADD CONSTRAINT "trade_logs_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "positions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
