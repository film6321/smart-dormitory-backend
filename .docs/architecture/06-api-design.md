# 06. API Design

ตรวจจาก `src/app.ts` และไฟล์ `*.routes.ts` วันที่ 8 ต.ค. 2569 ตารางนี้เป็นเส้นทางหลัก ไม่ใช่รายการครบทุก alias

| งาน | ตัวอย่างเส้นทางจริง | สิทธิ์ |
| --- | --- | --- |
| เข้าสู่ระบบ | `POST /api/auth/login` | สาธารณะ + limiter/validation |
| ห้อง | `GET /api/rooms`, `PATCH /api/rooms/:id` | อ่าน Admin/Student; แก้ Admin |
| สมัครเข้าพัก | `POST /api/tenants/upload-documents`, `POST /api/tenants/apply` | บัญชีที่เข้าสู่ระบบ |
| โปรไฟล์ตนเอง | `GET /api/tenants/me` | ผู้ใช้ตนเอง |
| จัดการผู้พัก | `GET /api/tenants`, `PATCH /api/tenants/:id`, `DELETE /api/tenants/:id` | Admin |
| บิล | `GET /api/billing`, `POST /api/billing/generate-room-bill` | อ่านตามเจ้าของ; สร้าง Admin |
| สลิปบิล | `POST /api/billing/:id/upload-slip` | ผู้มีสิทธิ์บิลนั้น |
| แจ้งซ่อม | `POST /api/maintenance`, `GET /api/maintenance` | ผู้ใช้; รายการตามสิทธิ์ |
| สถานะงานซ่อม | `PATCH /api/maintenance/:id/status` | Admin |
| ผู้มาติดต่อ | `POST /api/visitor/register` | สาธารณะ + OCR/consent/Idempotency-Key |
| รายการผู้มาติดต่อ | `GET /api/visitor` | Admin |
| ใบหน้า | `/api/face-verification/*` | ตรวจแต่ละ route; ไม่ควรเหมารวมว่าเปิดสาธารณะทั้งหมด |

REST JSON ใช้ `{ statusCode, success, message, data }` และ HTTP status ต้องตรงกับ `statusCode` ค่าไม่มีข้อมูลใช้ `data: null` ข้อยกเว้นเชิงรูปแบบ เช่น ไฟล์ภาพ, SSE และสตรีม ต้องอธิบายแยกจาก JSON

Login ส่ง token ผ่าน HttpOnly cookie และส่งข้อมูลผู้ใช้ใน body ฝั่งเว็บใช้ Axios พร้อม credentials ไม่ต้องรับ token จาก body หรือเก็บใน localStorage

`400` ข้อมูลไม่ถูกต้อง, `401` ไม่มี session ที่ใช้ได้, `403` ไม่มีสิทธิ์, `409` ขัดสถานะ/รายการค้าง, `429` เกินโควตา ควรทดสอบทั้งค่าที่สำเร็จและถูกปฏิเสธ อ้างอิงสัญญาปัจจุบันที่ [API contracts](../ai-context/contracts/api-contracts.md)

## Privacy endpoints (14 ต.ค. 2569)

GET /api/users/me/privacy-consent/:purpose ส่งคำชี้แจงและ acceptedAt ของบัญชีปัจจุบัน; POST /api/users/me/privacy-consent รับ purpose, version และ accepted:true เฉพาะ STUDENT Purpose แยก HOUSING/FACE_ENROLLMENT ไม่ใช้ userId จาก payload เป็นเจ้าของหลักฐาน รายละเอียด validation และ guard ดู [API contract](../ai-context/contracts/api-contracts.md)
