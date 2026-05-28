-- CreateTable
CREATE TABLE "IdCardVerification" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER,
    "imagePath" TEXT,
    "isThaiIdCard" BOOLEAN NOT NULL,
    "citizenIdMasked" TEXT,
    "citizenIdHash" TEXT,
    "fullNameTh" TEXT,
    "birthDateTh" TEXT,
    "issueDate" TEXT,
    "expiryDate" TEXT,
    "idDetected" BOOLEAN NOT NULL DEFAULT false,
    "idPresent" BOOLEAN NOT NULL DEFAULT false,
    "idChecksumValid" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "ocrJobId" TEXT,
    "processingTimeMs" INTEGER,
    "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdCardVerification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IdCardVerification_userId_idx" ON "IdCardVerification"("userId");

-- CreateIndex
CREATE INDEX "IdCardVerification_citizenIdHash_idx" ON "IdCardVerification"("citizenIdHash");

-- CreateIndex
CREATE INDEX "IdCardVerification_verifiedAt_idx" ON "IdCardVerification"("verifiedAt");

-- AddForeignKey
ALTER TABLE "IdCardVerification" ADD CONSTRAINT "IdCardVerification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
