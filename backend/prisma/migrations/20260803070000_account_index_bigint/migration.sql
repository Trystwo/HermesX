-- Lighter accountIndex can exceed INT4 (e.g. 281474976504068)
ALTER TABLE "api_configs" ALTER COLUMN "accountIndex" TYPE BIGINT;
