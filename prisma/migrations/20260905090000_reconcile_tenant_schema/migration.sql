-- Reconcile Tenant columns that exist in the live database but were not recorded
-- in the original migration history. These statements are safe for both states.
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "address" TEXT;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "birthDate" TEXT;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "citizenId" TEXT;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "contractData" TEXT;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "course" TEXT;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "email" TEXT;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "emergencyName" TEXT;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "emergencyRelation" TEXT;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "idCardImagePath" TEXT;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "notes" TEXT;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "paymentSlipPath" TEXT;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "preferredRoomType" TEXT;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'PENDING';
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "studentId" TEXT;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "yearLevel" TEXT;

DROP INDEX IF EXISTS "Tenant_roomId_key";