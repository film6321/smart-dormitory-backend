-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "housingRoomId" INTEGER,
ADD COLUMN     "housingTenantId" INTEGER,
ADD COLUMN     "housingVerificationId" INTEGER,
ALTER COLUMN "billId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "Payment_housingRoomId_idx" ON "Payment"("housingRoomId");

-- CreateIndex
CREATE INDEX "Payment_housingVerificationId_idx" ON "Payment"("housingVerificationId");

-- CreateIndex
CREATE INDEX "Payment_housingTenantId_idx" ON "Payment"("housingTenantId");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_housingRoomId_fkey" FOREIGN KEY ("housingRoomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_housingVerificationId_fkey" FOREIGN KEY ("housingVerificationId") REFERENCES "IdCardVerification"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_housingTenantId_fkey" FOREIGN KEY ("housingTenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A payment belongs either to a bill or to a housing application, never neither/both.
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_target_check" CHECK (
  ("billId" IS NOT NULL AND "housingRoomId" IS NULL AND "housingVerificationId" IS NULL AND "housingTenantId" IS NULL)
  OR ("billId" IS NULL AND "housingRoomId" IS NOT NULL AND "housingVerificationId" IS NOT NULL AND "payerUserId" IS NOT NULL)
);
