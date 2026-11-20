-- AlterTable
ALTER TABLE "Finding" ADD COLUMN     "ticketProvider" TEXT,
ADD COLUMN     "ticketUrl" TEXT;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "brandColor" TEXT,
ADD COLUMN     "brandFooter" TEXT,
ADD COLUMN     "brandLogoUrl" TEXT,
ADD COLUMN     "brandName" TEXT;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "alertSettings" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "monitorCadence" TEXT,
ADD COLUMN     "monitorDevices" JSONB NOT NULL DEFAULT '["desktop"]',
ADD COLUMN     "monitorEnvironmentId" TEXT,
ADD COLUMN     "monitorHourUtc" INTEGER NOT NULL DEFAULT 6,
ADD COLUMN     "monitorWeekday" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "nextMonitorAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Run" ADD COLUMN     "alertsSentAt" TIMESTAMP(3),
ADD COLUMN     "device" TEXT NOT NULL DEFAULT 'desktop',
ADD COLUMN     "shareToken" TEXT,
ADD COLUMN     "sharedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ProjectIntegration" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "secretCiphertext" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectIntegration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectIntegration_organizationId_idx" ON "ProjectIntegration"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectIntegration_projectId_provider_key" ON "ProjectIntegration"("projectId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "Run_shareToken_key" ON "Run"("shareToken");

-- CreateIndex
CREATE INDEX "Run_status_createdAt_idx" ON "Run"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "ProjectIntegration" ADD CONSTRAINT "ProjectIntegration_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
