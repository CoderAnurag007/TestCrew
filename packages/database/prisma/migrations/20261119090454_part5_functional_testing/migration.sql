-- CreateEnum
CREATE TYPE "EnvironmentKind" AS ENUM ('PRODUCTION', 'STAGING');

-- AlterTable
ALTER TABLE "Environment" ADD COLUMN     "kind" "EnvironmentKind" NOT NULL DEFAULT 'PRODUCTION',
ADD COLUMN     "safetyMode" "SafetyMode";

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "testPlan" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "verifiedHosts" JSONB NOT NULL DEFAULT '[]';
