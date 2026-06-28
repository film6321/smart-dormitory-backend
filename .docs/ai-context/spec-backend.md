# Backend API Specifications (Node.js / Express / TypeScript)

เอกสารกำหนดคู่มือและมาตรฐานทางเทคนิคสำหรับผู้พัฒนาและ AI ในการแก้ไข Backend

**Version:** 1.0.0 | **Updated:** 2026-06-29

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

สถาปัตยกรรม **Modular Monolith**:

```text
src/
  modules/
    auth/             ← controller, service, routes
    users/            ← ข้อมูลนักศึกษาและผู้ดูแล
    visitor/          ← บันทึกและตรวจสอบผู้ติดต่อ
    billing/          ← สร้างบิลและตรวจสลิป
    maintenance/      ← คิวและสถานะงานซ่อม
    ocr/              ← Wrapper ยิง External OCR API
    face-verification/ ← Wrapper ยิง External Face API
  shared/
    api-response.ts   ← Wrapper response กลาง
    middlewares/      ← Auth, Rate limiter, Trace, Validation
  workers/            ← Background jobs
  database/           ← Prisma client instance
  app.ts              ← Router & Middleware registration
  index.ts            ← HTTP Server & Socket.IO startup
```

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
