-- CreateEnum
CREATE TYPE "OcrJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "OcrJob" (
    "id" TEXT NOT NULL,
    "userId" INTEGER,
    "status" "OcrJobStatus" NOT NULL DEFAULT 'PENDING',
    "imagePath" TEXT NOT NULL,
    "resultVerificationId" INTEGER,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "OcrJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OcrJob_userId_idx" ON "OcrJob"("userId");

-- CreateIndex
CREATE INDEX "OcrJob_status_idx" ON "OcrJob"("status");

-- CreateIndex
CREATE INDEX "OcrJob_createdAt_idx" ON "OcrJob"("createdAt");

-- AddForeignKey
ALTER TABLE "OcrJob" ADD CONSTRAINT "OcrJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
