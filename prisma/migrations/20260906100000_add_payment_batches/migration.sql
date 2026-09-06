-- CreateEnum
CREATE TYPE "PaymentBatchStatus" AS ENUM ('PENDING', 'VERIFYING', 'PAID', 'FAILED', 'MANUAL_REVIEW');

-- AlterTable
ALTER TABLE "Bill"
ADD COLUMN "rentAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN "electricAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN "waterAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN "penaltyAmount" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "PaymentBatch" (
    "id" SERIAL NOT NULL,
    "payerUserId" INTEGER NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "status" "PaymentBatchStatus" NOT NULL DEFAULT 'PENDING',
    "provider" "PaymentProvider" NOT NULL DEFAULT 'THUNDER',
    "idempotencyKey" TEXT NOT NULL,
    "slipHash" TEXT,
    "providerTransactionId" TEXT,
    "providerResponse" TEXT,
    "failureReason" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentBatchItem" (
    "batchId" INTEGER NOT NULL,
    "billId" INTEGER NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentBatchItem_pkey" PRIMARY KEY ("batchId", "billId")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentBatch_idempotencyKey_key" ON "PaymentBatch"("idempotencyKey");
CREATE UNIQUE INDEX "PaymentBatch_slipHash_key" ON "PaymentBatch"("slipHash");
CREATE UNIQUE INDEX "PaymentBatch_providerTransactionId_key" ON "PaymentBatch"("providerTransactionId");
CREATE INDEX "PaymentBatch_payerUserId_idx" ON "PaymentBatch"("payerUserId");
CREATE INDEX "PaymentBatch_status_idx" ON "PaymentBatch"("status");
CREATE INDEX "PaymentBatch_createdAt_idx" ON "PaymentBatch"("createdAt");
CREATE INDEX "PaymentBatchItem_billId_idx" ON "PaymentBatchItem"("billId");

-- AddForeignKey
ALTER TABLE "PaymentBatch" ADD CONSTRAINT "PaymentBatch_payerUserId_fkey"
  FOREIGN KEY ("payerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentBatchItem" ADD CONSTRAINT "PaymentBatchItem_batchId_fkey"
  FOREIGN KEY ("batchId") REFERENCES "PaymentBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PaymentBatchItem" ADD CONSTRAINT "PaymentBatchItem_billId_fkey"
  FOREIGN KEY ("billId") REFERENCES "Bill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;