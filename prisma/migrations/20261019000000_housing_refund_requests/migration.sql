CREATE TABLE "HousingRefundRequest" (
  "id" SERIAL PRIMARY KEY,
  "draftId" INTEGER NOT NULL REFERENCES "HousingApplicationDraft"("id") ON DELETE CASCADE,
  "amount" DECIMAL(10,2) NOT NULL CHECK ("amount" > 0),
  "reason" VARCHAR(500),
  "status" TEXT NOT NULL DEFAULT 'PENDING' CHECK ("status" IN ('PENDING', 'COMPLETED', 'REJECTED')),
  "adminNote" VARCHAR(500),
  "resolvedById" INTEGER REFERENCES "User"("id") ON DELETE SET NULL,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3)
);
CREATE INDEX "HousingRefundRequest_draftId_status_requestedAt_idx"
  ON "HousingRefundRequest"("draftId", "status", "requestedAt");
