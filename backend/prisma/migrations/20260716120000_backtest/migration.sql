-- CreateTable
CREATE TABLE "backtest_jobs" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "symbol" TEXT NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "config" JSONB NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "backtest_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backtest_results" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "sampleType" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "stats" JSONB NOT NULL,
    "trades" JSONB,
    "rank" INTEGER,
    "isTop" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "backtest_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "backtest_jobs_status_createdAt_idx" ON "backtest_jobs"("status", "createdAt");

-- CreateIndex
CREATE INDEX "backtest_results_jobId_sampleType_idx" ON "backtest_results"("jobId", "sampleType");

-- AddForeignKey
ALTER TABLE "backtest_results" ADD CONSTRAINT "backtest_results_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "backtest_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
