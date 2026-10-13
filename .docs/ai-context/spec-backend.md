# Backend API Specifications (Node.js / Express / TypeScript)

เอกสารกำหนดคู่มือและมาตรฐานทางเทคนิคสำหรับผู้พัฒนาและ AI ในการแก้ไข Backend

**Version:** 1.0.1 | **Updated:** 2026-10-04

---

## 1. Active Stack
* **Language & Runtime:** Node.js (TypeScript)
* **Framework:** Express.js 5+
* **Database & ORM:** PostgreSQL 16 + Prisma ORM
* **Realtime Server:** Socket.IO
* **Caching & Limiters:** Redis (ผ่าน `ioredis` และ `rate-limit-redis`)
* **Logging:** `pino` + `pino-pretty`
* **Validation:** `class-validator` + `class-transformer`

---

## 2. Directory & Component Ownership

ใช้ **Modular Architecture** ใน Backend แบบ **Modular Monolith**: แบ่งไฟล์ตามฟีเจอร์ และแยกหน้าที่ภายในโมดูลตามความจำเป็น ผังนี้แสดงตำแหน่งปัจจุบัน ไม่ใช่คำสั่งให้สร้างโฟลเดอร์เพิ่มหรือย้ายตามรูปแบบใหม่:

```text
src/
  modules/
    auth/             ← controller, service, routes
    users/            ← ข้อมูลนักศึกษาและผู้ดูแล
    tenants/          ← ผู้เช่าและการชำระเงินเอกสารเข้าพัก
    rooms/            ← ห้องพัก
    visitor/          ← บันทึกและตรวจสอบผู้ติดต่อ
    billing/          ← สร้างบิลและตรวจสลิป
    maintenance/      ← คิวและสถานะงานซ่อม
    notifications/    ← การแจ้งเตือนและผู้ให้บริการส่งข้อความ
    audit/            ← ประวัติการดำเนินงาน
    settings/         ← การตั้งค่าระบบ
    analytics/        ← รายงานและการวิเคราะห์
    ocr/              ← Wrapper ยิง External OCR API
    face-verification/ ← FaceGate.Edge integration (embeddings, scan, enrollment)
  middlewares/        ← JWT, Roles, Access Log, Error Handler และ DTO Validation
  shared/
    api-response.ts   ← Wrapper response กลาง
    state-transitions.ts ← กฎการเปลี่ยนสถานะกลาง
    ...               ← env, Redis, cache, rate limit, presence และ date utilities
  workers/            ← Background jobs
  database/           ← Prisma client instance
  realtime/           ← Socket.IO notification gateway
  routes/             ← health endpoints
  setup/              ← Security, Swagger และ Observability initialization
  logger.ts           ← logger กลาง
  app.ts              ← Router & Middleware registration
  index.ts            ← HTTP Server & Socket.IO startup
```

- ภายในโมดูลใช้ไฟล์ `<module>.routes.ts`, `.controller.ts`, `.service.ts`, `.repository.ts`, `.dto.ts` หรือ `.types.ts` เท่าที่มีการใช้งานจริง; ไม่จำเป็นต้องมีครบทุกแบบหรือสร้าง subfolders เพิ่มทุกโมดูล.
- Validation middleware อยู่ที่ `src/middlewares/dto-validation.ts` และถูกใช้จาก routes ของ Billing, Maintenance, Notifications และ Visitor. คง export `validateDto` และพฤติกรรมตรวจคำขอเดิม.
- Swagger สร้างจาก annotations ใน `src/modules/**/*.routes.ts` ผ่าน `src/setup/setupSwagger.ts` และแสดงที่ `/api-docs`.
- HTTP routes ลงทะเบียนใน `src/app.ts`; HTTP server, Socket.IO และ workers เริ่ม/หยุดใน `src/index.ts`. การจัดโครงสร้างต้องรักษา public routes และจุดเริ่มระบบเหล่านี้.
- โค้ด React/Vite อยู่ใน repo `smart-dormitory-frontend` แยกต่างหาก ไม่สร้าง Frontend หรือ engine OCR/Face Verification ซ้ำใน Backend.
- ดูหน้าที่โฟลเดอร์นอก src ที่ [README](../../README.md#project-structure) และแผนงานที่ยังไม่ลงมือย้ายใน [Backend Architecture](../architecture/03-backend-architecture.md).

### ⚠️ กฎ Isolation บังคับ
* **Thin Controller Rule:** Controller ทำได้เฉพาะ ตรวจสิทธิ์ Role, กรอง DTO, แปลง Payload — ห้ามเขียน Business Logic และห้ามเรียก `prisma.*` โดยตรง
* **Database Access:** ทุก Query/Mutation ผ่าน Service ที่ใช้งาน Prisma จาก `src/database/db.ts`

---

## 3. Standard API Response

ทุก Endpoint ใช้ Wrapper `ApiResponse<T>` เสมอ:

```json
{ "statusCode": 200, "success": true, "message": "Success", "data": {} }
```

Error format:
```json
{
  "statusCode": 400, "success": false,
  "message": "Validation Failed", "data": null,
  "errors": [{ "property": "email", "constraints": { "isEmail": "..." } }]
}
```
**HTTP Status Code ของ Express ต้องตรงกับ `statusCode` ใน body เสมอ**

---

## 4. Database Concurrency & OCC

* ใช้ฟิลด์ `version` ในโมเดลสำคัญเพื่อทำ Optimistic Concurrency Control
* ตัวอย่าง:
  ```typescript
  await prisma.bill.update({
    where: { id: billId, version: currentVersion },
    data: { status: "PAID", version: { increment: 1 } }
  })
  // Prisma P2025 error = conflict → catch & retry
  ```
* ห้ามบันทึก citizenId ซ้ำ: ตรวจผ่าน `IdCardVerification.citizenIdHash`

---

## 5. Prisma Migration Policy

* `prisma/migrations/` คือประวัติ DB — ห้ามลบหรือ squash ที่เคยใช้ใน Production
* ทุกการแก้ `schema.prisma` ต้องรัน `npx prisma migrate dev` เพื่อสร้าง migration file

---

## 6. Security & Observability

* **Auth:** JWT Access Token + HttpOnly Cookie สำหรับ Admin Dashboard
* **Rate Limits:** Redis Dynamic Limiter บน Login และ OCR Upload
* **Logs:** ทุก log ต้องมี `correlationId`, `userId`, `roomId` (ถ้ามีค่า)

## 7. Account retention rollout

Implementation: `src/modules/users/account-retention.service.ts` and `src/workers/accountRetentionWorker.ts`. When inactivity retention is explicitly enabled, the account worker runs once at startup and every 24 hours, prevents overlap within a process, locks/rechecks each User, and uses serializable transactions. Multiple processes serialize on the same User; failed/conflicting accounts are skipped and retried on a later run.

- Apply `20261007000000_retention_nullable_ledger_owner` before using the removal flow. It makes Transaction.userId and PaymentBatch.payerUserId nullable so ledger amounts can remain after clearing the owner. No amounts or existing rows are changed by this migration.
- `ACCOUNT_RETENTION_MODE=`: inactive-account removal disabled (default). Already committed file/face deletion jobs retry every 60 seconds independently of this mode; this does not authorize new account removals.
- `ACCOUNT_RETENTION_MODE=dry-run`: report eligible/skipped counts without deleting candidate accounts. The independent worker may still finish previously authorized file/face deletions.
- `ACCOUNT_RETENTION_MODE=delete`: automatically delete eligible accounts without advance notification; retry the file queue after processing.
- The cutoff is the current time minus one calendar year, compared against last successful login; createdAt is used only if lastLogin is null. Auth must fail if that timestamp cannot be persisted. Never use presence/heartbeat as inactivity evidence.
- Exclude ADMIN accounts, active/pending stays, unpaid bills, unfinished repairs, active visitors, pending OCR/payments and shared/other-payer batches. Preserve anonymous paid financial amounts and idempotency identifiers; remove personal documents and face enrollment. User profile remains on manual tenant deletion.
- Deployment order: inspect migration status and back up the local database; apply the reviewed migration, regenerate/build, run dry-run, review counts, then select delete mode and restart the backend. Do not claim activation from code changes alone.

Validation for this change uses mocked database clients and temporary test-only files. Real account removal and the migration have not been performed during implementation. The existing housing OCR suite still needs its test database credentials configured before all backend tests can pass.

### Validation snapshot — 7 October 2026

- Backend and Frontend builds passed; lint passed for changed Backend files and the Frontend project. Prisma schema validation passed.
- Targeted retention/login/move-out/face-cleanup/access tests: 53/53 passed with mocked database clients and test-only files. Earlier full Backend run: 128/132 passed; four existing housing OCR cases require valid test database credentials.
- Frontend suite: 59/59 passed. Pending cleanup → status failure → retry → completion passed in both resident/account pages at 375, 768 and 1440px with intercepted API responses and no DELETE requests. Chrome with intercepted mock APIs passed move-out → historical list → tenant removal at 375, 768 and 1440px; no User-delete request was sent.
- Read-only local database dry-run: candidates 0, eligible 0, deleted 0, skipped 0. This does not certify real deletion against the live database.
- Migration status confirms `20261007000000_retention_nullable_ledger_owner` is the only pending migration. It has not been applied; the automatic deletion worker has not been enabled. Actual tenant/account removal requires the reviewed ledger migration above. Backend and Python deployments are needed to activate the updated coordinated cleanup flow.

Python owner-cleanup validation: one SQLite in-memory integration test passed, verifying repeat deletion, template/cache removal, owner-log anonymization, and preservation of another owner. No live deletion requests were sent during this validation.


### แยก identity OCR และเบอร์บัญชีใน flow สมัครเข้าพัก

verifyIdentity ตรวจบัญชีมีอยู่จริง ชนิด/ขนาดภาพ และผล OCR บัตร ไม่บังคับ phone ก่อนส่ง OCR; registeredPhone คงเป็น string เพื่อรองรับผู้ใช้เดิม แต่คืนค่าว่างได้เมื่อบัญชีไม่มีเบอร์ ข้อมูลบัตรและ ownership verification ใช้การตรวจเดิม เบอร์บัญชีไม่ใช่ข้อมูล OCR และไม่สร้างเบอร์จำลอง verifyHousingPayment และ submitApplication ยังตรวจเบอร์ที่ลงทะเบียนตามเดิม
