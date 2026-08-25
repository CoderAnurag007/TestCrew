-- AlterEnum
ALTER TYPE "RunStatus" ADD VALUE 'AUTHENTICATING';
ALTER TYPE "RunStatus" ADD VALUE 'FINALIZING';

-- CreateEnum
CREATE TYPE "ActionRisk" AS ENUM ('SAFE', 'CAUTION', 'DESTRUCTIVE');

-- AlterTable
ALTER TABLE "Project"
ADD COLUMN "maxPages" INTEGER NOT NULL DEFAULT 40,
ADD COLUMN "maxActions" INTEGER NOT NULL DEFAULT 80,
ADD COLUMN "maxDepth" INTEGER NOT NULL DEFAULT 8,
ADD COLUMN "maxDurationMs" INTEGER NOT NULL DEFAULT 300000,
ADD COLUMN "allowDestructive" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "allowPrivateTargets" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Run"
ADD COLUMN "currentUrl" TEXT,
ADD COLUMN "currentAction" TEXT,
ADD COLUMN "pagesDiscovered" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "statesDiscovered" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "actionsExecuted" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "flowsDiscovered" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "lastScreenshotKey" TEXT;

-- AlterTable
ALTER TABLE "Page"
ADD COLUMN "screenshotKey" TEXT,
ADD COLUMN "domStorageKey" TEXT,
ADD COLUMN "a11yStorageKey" TEXT;

-- AlterTable
ALTER TABLE "State"
ADD COLUMN "url" TEXT,
ADD COLUMN "title" TEXT,
ADD COLUMN "screenshotKey" TEXT,
ADD COLUMN "metadata" JSONB,
ADD COLUMN "visited" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "depth" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Action"
ADD COLUMN "target" TEXT,
ADD COLUMN "input" TEXT,
ADD COLUMN "sourceStateId" TEXT,
ADD COLUMN "destinationStateId" TEXT,
ADD COLUMN "success" BOOLEAN,
ADD COLUMN "durationMs" INTEGER,
ADD COLUMN "riskLevel" "ActionRisk" NOT NULL DEFAULT 'SAFE',
ADD COLUMN "reason" TEXT;

-- CreateTable
CREATE TABLE "RunEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "url" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RunEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RunEvent_organizationId_idx" ON "RunEvent"("organizationId");

-- CreateIndex
CREATE INDEX "RunEvent_runId_createdAt_idx" ON "RunEvent"("runId", "createdAt");

-- AddForeignKey
ALTER TABLE "RunEvent" ADD CONSTRAINT "RunEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunEvent" ADD CONSTRAINT "RunEvent_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;
