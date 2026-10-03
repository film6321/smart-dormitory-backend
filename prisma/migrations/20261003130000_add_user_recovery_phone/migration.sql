ALTER TABLE "User" ADD COLUMN "phone" TEXT;

CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");
