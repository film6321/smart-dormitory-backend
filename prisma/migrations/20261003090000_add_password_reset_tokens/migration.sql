ALTER TABLE "User"
ADD COLUMN "passwordResetTokenHash" TEXT,
ADD COLUMN "passwordResetExpiresAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "User_passwordResetTokenHash_key"
ON "User"("passwordResetTokenHash");
