-- CreateTable
CREATE TABLE "AiPlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "userRequest" TEXT NOT NULL,
    "planJson" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "planningMode" TEXT NOT NULL,
    "primaryProvider" TEXT NOT NULL,
    "reviewerProvider" TEXT,
    "contextSnapshotId" TEXT,
    "riskLevel" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "approvedAt" DATETIME,
    "rejectedAt" DATETIME
);

-- CreateIndex
CREATE INDEX "AiPlan_shop_createdAt_idx" ON "AiPlan"("shop", "createdAt");
