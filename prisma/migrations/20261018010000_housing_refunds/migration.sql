CREATE TABLE "HousingRefund" (
  "id" SERIAL PRIMARY KEY,
  "draftId" INTEGER NOT NULL REFERENCES "HousingApplicationDraft"("id") ON DELETE CASCADE,
  "amount" DECIMAL(10,2) NOT NULL CHECK ("amount" > 0),
  "reference" VARCHAR(100) NOT NULL UNIQUE,
  "idempotencyKey" TEXT NOT NULL UNIQUE,
  "proofHash" TEXT NOT NULL UNIQUE,
  "proofPath" TEXT NOT NULL,
  "recordedById" INTEGER REFERENCES "User"("id") ON DELETE SET NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "HousingRefund_draftId_idx" ON "HousingRefund"("draftId");
