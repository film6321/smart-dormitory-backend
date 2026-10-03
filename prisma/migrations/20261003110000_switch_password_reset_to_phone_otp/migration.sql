ALTER TABLE "User" RENAME COLUMN "passwordResetTokenHash" TO "passwordResetOtpHash";
ALTER TABLE "User" RENAME COLUMN "passwordResetExpiresAt" TO "passwordResetOtpExpiresAt";
ALTER INDEX "User_passwordResetTokenHash_key" RENAME TO "User_passwordResetOtpHash_key";

ALTER TABLE "User"
  ADD COLUMN "passwordResetOtpAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "passwordResetGrantHash" TEXT,
  ADD COLUMN "passwordResetGrantExpiresAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "User_passwordResetGrantHash_key" ON "User"("passwordResetGrantHash");
