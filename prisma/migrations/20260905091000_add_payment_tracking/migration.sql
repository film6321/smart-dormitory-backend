-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'VERIFYING', 'PAID', 'FAILED', 'MANUAL_REVIEW');

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('THUNDER');

-- CreateTable
CREATE TABLE "Payment" (
    "id" SERIAL NOT NULL,
    "billId" INTEGER NOT NULL,
    "payerUserId" INTEGER,
    "amount" DECIMAL(10,2) NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "provider" "PaymentProvider" NOT NULL DEFAULT 'THUNDER',
    "providerTransactionId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "slipHash" TEXT,
    "providerResponse" TEXT,
    "failureReason" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Payment_providerTransactionId_key" ON "Payment"("providerTransactionId");
CREATE UNIQUE INDEX "Payment_idempotencyKey_key" ON "Payment"("idempotencyKey");
CREATE UNIQUE INDEX "Payment_slipHash_key" ON "Payment"("slipHash");
CREATE INDEX "Payment_billId_idx" ON "Payment"("billId");
CREATE INDEX "Payment_payerUserId_idx" ON "Payment"("payerUserId");
CREATE INDEX "Payment_status_idx" ON "Payment"("status");
CREATE INDEX "Payment_createdAt_idx" ON "Payment"("createdAt");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_billId_fkey"
  FOREIGN KEY ("billId") REFERENCES "Bill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_payerUserId_fkey"
  FOREIGN KEY ("payerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;