-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "billingCustomerId" TEXT,
ADD COLUMN     "billingSubscriptionId" TEXT,
ADD COLUMN     "extraSites" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "plan" TEXT NOT NULL DEFAULT 'FREE',
ADD COLUMN     "trialEndsAt" TIMESTAMP(3);

-- Workspaces made before plans existed keep full access (they are the owner's own).
UPDATE "Organization" SET "plan" = 'AGENCY' WHERE "createdAt" < now();
