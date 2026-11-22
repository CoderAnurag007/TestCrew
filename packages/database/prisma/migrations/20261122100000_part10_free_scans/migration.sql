-- CreateTable
CREATE TABLE "FreeScan" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "ipHash" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "claimedAt" TIMESTAMP(3),
    "claimedOrganizationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FreeScan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FreeScan_token_key" ON "FreeScan"("token");

-- CreateIndex
CREATE UNIQUE INDEX "FreeScan_runId_key" ON "FreeScan"("runId");

-- CreateIndex
CREATE INDEX "FreeScan_ipHash_createdAt_idx" ON "FreeScan"("ipHash", "createdAt");

-- CreateIndex
CREATE INDEX "FreeScan_createdAt_idx" ON "FreeScan"("createdAt");

-- AddForeignKey
ALTER TABLE "FreeScan" ADD CONSTRAINT "FreeScan_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;
