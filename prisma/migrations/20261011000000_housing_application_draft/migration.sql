CREATE TABLE "HousingApplicationDraft" (
 "id" SERIAL PRIMARY KEY, "userId" INTEGER NOT NULL UNIQUE,
 "roomId" INTEGER, "data" JSONB NOT NULL DEFAULT '{}', "status" TEXT NOT NULL DEFAULT 'OPEN',
 "version" INTEGER NOT NULL DEFAULT 1, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "HousingApplicationDraft_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);
ALTER TABLE "Payment" ADD COLUMN "housingDraftId" INTEGER;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_housingDraftId_fkey" FOREIGN KEY ("housingDraftId") REFERENCES "HousingApplicationDraft"("id") ON DELETE SET NULL;
CREATE INDEX "Payment_housingDraftId_idx" ON "Payment"("housingDraftId");
