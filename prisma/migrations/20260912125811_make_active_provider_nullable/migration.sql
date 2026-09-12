-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_StoreSetting" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "activeProvider" TEXT,
    "activeModel" TEXT,
    "developerMode" BOOLEAN NOT NULL DEFAULT false,
    "requireApproval" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_StoreSetting" ("activeModel", "activeProvider", "createdAt", "developerMode", "id", "requireApproval", "shop", "updatedAt") SELECT "activeModel", "activeProvider", "createdAt", "developerMode", "id", "requireApproval", "shop", "updatedAt" FROM "StoreSetting";
DROP TABLE "StoreSetting";
ALTER TABLE "new_StoreSetting" RENAME TO "StoreSetting";
CREATE UNIQUE INDEX "StoreSetting_shop_key" ON "StoreSetting"("shop");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
