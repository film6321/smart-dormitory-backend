-- Add nullable lastLogin to User
ALTER TABLE "User" ADD COLUMN "lastLogin" TIMESTAMP(3);
