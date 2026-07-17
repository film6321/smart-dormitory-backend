# REST API Contracts

**Base Path:** `/api`

---

## 1. Standard Response Wrapper

ทุก Endpoint ต้องคืนค่าด้วย `ApiResponse<T>`:

```json
{ "statusCode": 200, "success": true, "message": "สำเร็จ", "data": {} }
```

Validation Error:
```json
{
  "statusCode": 400, "success": false, "message": "Validation Failed",
  "errors": [{ "property": "email", "constraints": { "isEmail": "email must be an email" } }]
}
```

**กฎ:** HTTP Status Code ของ Express ต้องตรงกับ `statusCode` ใน body เสมอ รวมถึงใน Error Middleware

---

## 2. Authentication — `/api/auth`

```text
POST /api/auth/login          — Rate limit: 5 ครั้ง / 5 นาที
POST /api/auth/register       — Rate limit: 3 ครั้ง / 1 ชั่วโมง
GET  /api/auth/me             — ต้องการ JWT Token
GET  /api/auth/admin-only     — ต้องการ JWT + Role: ADMIN
```

**Login Request:**
```json
{ "email": "student@dorm.ac.th", "password": "Password123" }
```
**Login Response `data`:**
```json
{
  "token": "JWT_ACCESS_TOKEN",
  "user": { "id": 1, "email": "...", "role": "STUDENT", "firstName": "สมชาย", "lastName": "เรียนดี" }
}
```

---

## 3. OCR Verification — `/api/ocr`

```text
POST /api/ocr/verify-id-card                  — Synchronous, Rate limit: 10/นาที
POST /api/ocr/verify-id-card/jobs             — Async job, Rate limit: 10/นาที
GET  /api/ocr/verify-id-card/jobs/:jobId      — ตรวจสอบผล
GET  /api/ocr/id-card-verifications           — ADMIN only: ดูประวัติทั้งหมด
GET  /api/ocr/id-card-verifications/:id       — ADMIN only: ดูรายการเดียว
GET  /api/ocr/id-card-verifications/:id/image — ADMIN only: ดูภาพต้นฉบับ
DELETE /api/ocr/id-card-verifications/:id     — ADMIN only: ลบรายการ
```

**Request Format:** Multipart Form-data (ฟิลด์: `file` | `image` | `idCard` | `document`, ≤5MB, JPG/PNG/WebP)

**Sync Response `data`:**
```json
{
  "isThaiIdCard": true,
  "fullNameTh": "นาย สมชาย เรียนดี",
  "citizenIdMasked": "1-2345-XXXXX-XX-X",
  "citizenIdHash": "SHA256_HASH",
  "birthDateTh": "2543-01-01",
  "idPresent": true,
  "idChecksumValid": true
}
```

**Async Job Response `data`:**
```json
{ "jobId": "uuid", "status": "PENDING", "createdAt": "2026-06-29T12:00:00Z" }
```

---

## 4. Billing — `/api/billing`

```text
GET    /api/billing                   — ดูบิล (STUDENT: เฉพาะตัวเอง, ADMIN: ทั้งหมด)
GET    /api/billing/:id               — ดูบิลรายการเดียว
POST   /api/billing/:id/upload-slip   — ผู้เช่าส่งสลิป (Multipart, ฟิลด์: slipImage)
PATCH  /api/billing/:id/status        — ADMIN: แก้ไขสถานะ Manual
```

**Upload Slip Response `data`:**
```json
{ "billId": 101, "status": "VERIFYING", "message": "ส่งสลิปสำเร็จ รอ OCR ตรวจสอบ" }
```

---

## 5. Maintenance — `/api/maintenance`

```text
POST   /api/maintenance           — STUDENT: แจ้งซ่อมใหม่
GET    /api/maintenance           — ADMIN: ดูทั้งหมด | STUDENT: เฉพาะของตัวเอง
GET    /api/maintenance/:id       — ดูรายการเดียว
PATCH  /api/maintenance/:id/status — ADMIN: เปลี่ยนสถานะ
```

**Create Request:**
```json
{
  "roomNumber": "402",
  "category": "PLUMBING",
  "description": "ท่อน้ำรั่วในห้องน้ำ",
  "contactTime": "2026-06-30T10:00:00Z"
}
```

**Status Update Request (ADMIN):**
```json
{ "status": "APPROVED", "assignedTechnicianId": 12, "note": "ส่งช่างโสภณ" }
```

---

## 6. Visitor — `/api/visitor`

```text
POST /api/visitor/register         — ลงทะเบียนนัดล่วงหน้า
GET  /api/visitor                  — ADMIN: ดูรายการผู้ติดต่อทั้งหมด
GET  /api/visitor/:id              — ดูรายการเดียว
POST /api/visitor/:id/checkin      — สแกนผ่านประตู (APPROVED → CHECKED_IN)
POST /api/visitor/:id/checkout     — สแกนออก (CHECKED_IN → CHECKED_OUT)
```

**Register Request:**
```json
{
  "guestName": "นาย ขยัน มาเยือน",
  "purpose": "ส่งพัสดุ",
  "roomNumber": "305",
  "expectedEntryTime": "2026-06-30T13:00:00Z"
}
```

---

## 7. Face Verification & FaceGate.Edge — `/api/face-verification`

### 7.1 Web Dashboard (JWT Auth)

```text
POST /api/face-verification/register          — ADMIN: ลงทะเบียนใบหน้า (Multipart: file/image)
POST /api/face-verification/verify            — Rate limit: 20/นาที, ตรวจเทียบใบหน้า (Multipart)
GET  /api/face-verification/:templateId       — ADMIN: ดูข้อมูล embedding
PUT  /api/face-verification/:templateId       — ADMIN: อัปเดตใบหน้า (Multipart)
DELETE /api/face-verification/:templateId     — ADMIN: ลบ template
```

### 7.2 C# FaceGate.Edge (Bearer Token: FACE_API_KEY)

```text
GET  /api/face-verification/embeddings                   — ดึง embedding ทั้งหมด (?since=ISO8601)
GET  /api/face-verification/enrollment/pending            — รายชื่อที่รอสร้าง embedding
GET  /api/face-verification/enrollment/photo/:id          — สตรีมไฟล์รูป enroll
POST /api/face-verification/enrollment/:studentId/embeddings — รับ embedding จาก Edge
POST /api/face-verification/attendance/scan               — รับผลสแกนจาก Edge
POST /api/face-verification/devices/heartbeat             — heartbeat กล้อง
POST /api/face-verification/devices/live-frame            — เฟรมสดจากกล้อง
```

**Scan Request:**
```json
{
  "student_code": "user_99",
  "direction": "IN",
  "confidence": 0.95,
  "scanned_at": "2026-07-18T12:00:00Z",
  "device_code": "CAMERA_01",
  "snapshot_base64": "optional_base64_string"
}
```

**Store Embeddings Request:**
```json
{
  "model_version": "buffalo_l",
  "embeddings": [[0.1, 0.2, ...]],
  "quality_scores": [0.95]
}
```

---

## 8. HTTP Error Status Codes

| Code | ความหมาย |
| ---: | :--- |
| 400 | Validation ไม่ผ่าน หรือข้อมูลผิดรูปแบบ |
| 401 | ไม่มี Token หรือ Token หมดอายุ |
| 403 | Role ไม่เพียงพอ |
| 404 | ไม่พบทรัพยากรที่ร้องขอ |
| 409 | สลิปซ้ำ หรือ OCC Conflict |
| 429 | เกิน Rate Limit |
| 500 | Server Error ที่ไม่คาดคิด |
| 503 | External API (OCR/Face) ไม่พร้อมใช้งาน |

