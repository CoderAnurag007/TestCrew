-- AlterEnum
ALTER TYPE "FindingStatus" ADD VALUE 'CONFIRMED';
ALTER TYPE "FindingStatus" ADD VALUE 'IGNORED';
ALTER TYPE "FindingCategory" ADD VALUE 'VISUAL';

-- CreateEnum
CREATE TYPE "TestCategory" AS ENUM (
  'HAPPY_PATH',
  'NEGATIVE',
  'VALIDATION',
  'BOUNDARY',
  'NAVIGATION',
  'ERROR_HANDLING',
  'PERMISSION',
  'EMPTY_STATE',
  'LOADING_STATE',
  'RESPONSIVE',
  'ACCESSIBILITY',
  'REGRESSION'
);

CREATE TYPE "TestPriority" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- AlterTable
ALTER TABLE "Project"
ADD COLUMN "recordVideo" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Run"
ADD COLUMN "storageStateKey" TEXT,
ADD COLUMN "aiCostUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN "browserDurationMs" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "storageBytesEstimate" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "qualityScore" DOUBLE PRECISION,
ADD COLUMN "testsGenerated" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "testsPassed" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "testsFailed" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Action"
ADD COLUMN "label" TEXT,
ADD COLUMN "category" TEXT,
ADD COLUMN "href" TEXT,
ADD COLUMN "selectors" JSONB;

-- AlterTable
ALTER TABLE "TestCase"
ADD COLUMN "category" "TestCategory" NOT NULL DEFAULT 'HAPPY_PATH',
ADD COLUMN "priority" "TestPriority" NOT NULL DEFAULT 'MEDIUM',
ADD COLUMN "risk" "ActionRisk" NOT NULL DEFAULT 'SAFE',
ADD COLUMN "preconditions" JSONB,
ADD COLUMN "steps" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN "expectedResults" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN "promptVersion" TEXT,
ADD COLUMN "model" TEXT,
ADD COLUMN "promptTokens" INTEGER,
ADD COLUMN "completionTokens" INTEGER,
ADD COLUMN "latencyMs" INTEGER,
ADD COLUMN "estimatedCostUsd" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "TestRun"
ADD COLUMN "durationMs" INTEGER,
ADD COLUMN "retryCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "screenshotBeforeKey" TEXT,
ADD COLUMN "screenshotFailureKey" TEXT,
ADD COLUMN "screenshotAfterKey" TEXT,
ADD COLUMN "traceKey" TEXT,
ADD COLUMN "videoKey" TEXT,
ADD COLUMN "consoleKey" TEXT,
ADD COLUMN "networkKey" TEXT,
ADD COLUMN "assertions" JSONB,
ADD COLUMN "actualResults" JSONB;

-- AlterTable
ALTER TABLE "Finding"
ADD COLUMN "duplicateOfId" TEXT,
ADD COLUMN "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
ADD COLUMN "expected" TEXT,
ADD COLUMN "actual" TEXT,
ADD COLUMN "recommendation" TEXT,
ADD COLUMN "steps" JSONB,
ADD COLUMN "signature" TEXT,
ADD COLUMN "component" TEXT,
ADD COLUMN "url" TEXT,
ADD COLUMN "rootCauseHypothesis" TEXT,
ADD COLUMN "mergedCount" INTEGER NOT NULL DEFAULT 1;

CREATE INDEX "Finding_signature_idx" ON "Finding"("signature");
CREATE INDEX "Finding_duplicateOfId_idx" ON "Finding"("duplicateOfId");

ALTER TABLE "Finding"
ADD CONSTRAINT "Finding_duplicateOfId_fkey"
FOREIGN KEY ("duplicateOfId") REFERENCES "Finding"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "Evidence"
ADD COLUMN "testRunId" TEXT,
ADD COLUMN "byteLength" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "Evidence_testRunId_idx" ON "Evidence"("testRunId");

ALTER TABLE "Evidence"
ADD CONSTRAINT "Evidence_testRunId_fkey"
FOREIGN KEY ("testRunId") REFERENCES "TestRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "Report"
ADD COLUMN "payload" JSONB,
ADD COLUMN "promptVersion" TEXT,
ADD COLUMN "model" TEXT;

-- CreateTable
CREATE TABLE "AiUsage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "promptVersion" TEXT,
    "model" TEXT NOT NULL,
    "promptTokens" INTEGER NOT NULL DEFAULT 0,
    "completionTokens" INTEGER NOT NULL DEFAULT 0,
    "latencyMs" INTEGER NOT NULL DEFAULT 0,
    "estimatedCostUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiUsage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AiUsage_organizationId_idx" ON "AiUsage"("organizationId");
CREATE INDEX "AiUsage_runId_idx" ON "AiUsage"("runId");

ALTER TABLE "AiUsage"
ADD CONSTRAINT "AiUsage_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AiUsage"
ADD CONSTRAINT "AiUsage_runId_fkey"
FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;
