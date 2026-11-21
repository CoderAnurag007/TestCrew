-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "designReview" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Run" ADD COLUMN     "bugAudit" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "designReport" JSONB,
ADD COLUMN     "designReview" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "designScore" DOUBLE PRECISION;
