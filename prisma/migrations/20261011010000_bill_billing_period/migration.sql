-- Additive only: existing bills retain null until their period is reviewed.
ALTER TABLE "Bill" ADD COLUMN "billingPeriod" VARCHAR(7);
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_billingPeriod_format_check"
CHECK ("billingPeriod" IS NULL OR "billingPeriod" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');
CREATE UNIQUE INDEX "Bill_tenantId_roomId_billingPeriod_key" ON "Bill"("tenantId", "roomId", "billingPeriod");
