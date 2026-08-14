-- AlterTable: ApiConfig Lighter credentials
ALTER TABLE "api_configs" ADD COLUMN "accountIndex" INTEGER;
ALTER TABLE "api_configs" ADD COLUMN "apiKeyIndex" INTEGER;

-- AlterTable: Strategy short-leg ApiConfig
ALTER TABLE "strategies" ADD COLUMN "shortApiConfigId" TEXT;

-- AddForeignKey
ALTER TABLE "strategies" ADD CONSTRAINT "strategies_shortApiConfigId_fkey" FOREIGN KEY ("shortApiConfigId") REFERENCES "api_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
