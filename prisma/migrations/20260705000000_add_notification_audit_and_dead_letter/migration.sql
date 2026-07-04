-- CreateTable
CREATE TABLE "NotificationAuditLog" (
    "id" SERIAL NOT NULL,
    "notificationId" INTEGER NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationDeadLetter" (
    "id" SERIAL NOT NULL,
    "notificationId" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "details" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationDeadLetter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NotificationAuditLog_notificationId_idx" ON "NotificationAuditLog"("notificationId");

-- CreateIndex
CREATE INDEX "NotificationAuditLog_eventType_idx" ON "NotificationAuditLog"("eventType");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationDeadLetter_notificationId_key" ON "NotificationDeadLetter"("notificationId");

-- CreateIndex
CREATE INDEX "NotificationDeadLetter_reason_idx" ON "NotificationDeadLetter"("reason");

-- AddForeignKey
ALTER TABLE "NotificationAuditLog"
ADD CONSTRAINT "NotificationAuditLog_notificationId_fkey"
FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationDeadLetter"
ADD CONSTRAINT "NotificationDeadLetter_notificationId_fkey"
FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;
