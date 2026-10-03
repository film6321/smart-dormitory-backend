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
  "message": "Validation Failed",
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
