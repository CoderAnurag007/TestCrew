-- CreateEnum
CREATE TYPE "SafetyMode" AS ENUM ('READ_ONLY', 'FULL');

-- CreateEnum
CREATE TYPE "FindingChange" AS ENUM ('NEW', 'RECURRING', 'REGRESSED');

-- CreateEnum
CREATE TYPE "FailureClass" AS ENUM ('APP_BUG', 'TEST_BUG', 'ENVIRONMENT', 'FLAKY');

-- AlterEnum
ALTER TYPE "CredentialType" ADD VALUE 'STORAGE_STATE';

-- AlterTable
ALTER TABLE "Finding" ADD COLUMN     "change" "FindingChange" NOT NULL DEFAULT 'NEW',
ADD COLUMN     "suppressed" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "blockedPathPatterns" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "intents" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "resetHookUrl" TEXT,
ADD COLUMN     "safetyMode" "SafetyMode" NOT NULL DEFAULT 'READ_ONLY',
ADD COLUMN     "verificationToken" TEXT,
ADD COLUMN     "verifiedAt" TIMESTAMP(3),
ADD COLUMN     "verifiedHost" TEXT;

-- AlterTable
ALTER TABLE "Run" ADD COLUMN     "baseUrlOverride" TEXT,
ADD COLUMN     "effectiveSafetyMode" "SafetyMode",
ADD COLUMN     "previousRunId" TEXT,
ADD COLUMN     "replayOfRunId" TEXT,
ADD COLUMN     "testsFlaky" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "trigger" TEXT NOT NULL DEFAULT 'manual';

-- AlterTable
ALTER TABLE "TestCase" ADD COLUMN     "intentId" TEXT,
ADD COLUMN     "quarantined" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'generated',
ADD COLUMN     "testKey" TEXT,
ALTER COLUMN "steps" DROP DEFAULT,
ALTER COLUMN "expectedResults" DROP DEFAULT;

-- AlterTable
ALTER TABLE "TestRun" ADD COLUMN     "failureClass" "FailureClass";

-- CreateTable
CREATE TABLE "FindingSuppression" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "reason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FindingSuppression_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestHistory" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "testKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passes" INTEGER NOT NULL DEFAULT 0,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "flakes" INTEGER NOT NULL DEFAULT 0,
    "quarantined" BOOLEAN NOT NULL DEFAULT false,
    "lastStatus" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TestHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiToken" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FindingSuppression_organizationId_idx" ON "FindingSuppression"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "FindingSuppression_projectId_signature_key" ON "FindingSuppression"("projectId", "signature");

-- CreateIndex
CREATE INDEX "TestHistory_organizationId_idx" ON "TestHistory"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "TestHistory_projectId_testKey_key" ON "TestHistory"("projectId", "testKey");

-- CreateIndex
CREATE UNIQUE INDEX "ApiToken_tokenHash_key" ON "ApiToken"("tokenHash");

-- CreateIndex
CREATE INDEX "ApiToken_organizationId_idx" ON "ApiToken"("organizationId");

-- CreateIndex
CREATE INDEX "ApiToken_projectId_idx" ON "ApiToken"("projectId");

-- AddForeignKey
ALTER TABLE "FindingSuppression" ADD CONSTRAINT "FindingSuppression_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestHistory" ADD CONSTRAINT "TestHistory_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiToken" ADD CONSTRAINT "ApiToken_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
