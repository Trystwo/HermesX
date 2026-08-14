-- Allow multiple API configs per exchange+environment; add display name

-- Backfill name before making column NOT NULL
ALTER TABLE "api_configs" ADD COLUMN "name" TEXT;

UPDATE "api_configs"
SET "name" = "exchange" || ' ' || "environment"
WHERE "name" IS NULL OR "name" = '';

ALTER TABLE "api_configs" ALTER COLUMN "name" SET NOT NULL;

-- Drop unique constraint on (exchange, environment)
DROP INDEX IF EXISTS "api_configs_exchange_environment_key";
