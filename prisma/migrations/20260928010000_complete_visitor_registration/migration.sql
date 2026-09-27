-- Add missing registration fields without deleting existing visitors.
ALTER TABLE "Visitor"
ADD COLUMN "phone" TEXT,
ADD COLUMN "citizenId" TEXT,
ADD COLUMN "citizenIdMasked" TEXT,
ADD COLUMN "relationship" TEXT,
ADD COLUMN "age" INTEGER,
ADD COLUMN "birthDate" TEXT,
ADD COLUMN "address" TEXT,
ADD COLUMN "idCardImagePath" TEXT,
ADD COLUMN "pdpaConsent" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "pdpaConsentAt" TIMESTAMP(3),
ADD COLUMN "expiresAt" TIMESTAMP(3),
ADD COLUMN "cancelledAt" TIMESTAMP(3),
ADD COLUMN "qrCodeData" TEXT;
CREATE INDEX "Visitor_expiresAt_idx" ON "Visitor"("expiresAt");
