ALTER TABLE "HousingApplicationDraft" ADD COLUMN "roomHoldExpiresAt" TIMESTAMP(3);
CREATE INDEX "HousingApplicationDraft_roomId_status_roomHoldExpiresAt_idx"
ON "HousingApplicationDraft"("roomId", "status", "roomHoldExpiresAt");
