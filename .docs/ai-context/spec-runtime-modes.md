# Runtime Modes

**Version:** 1.0.0 | **Updated:** 2026-06-29

เอกสารนี้กำหนดพฤติกรรมของระบบในแต่ละสภาพแวดล้อม เพื่อให้ AI Agent และนักพัฒนาทราบว่าโหมดไหนอนุญาตให้ทำอะไรได้บ้าง

---

## DEVELOPMENT MODE (`NODE_ENV=development`)

* Rate Limit ผ่อนปรน (เพิ่ม limit สูงขึ้นสำหรับการทดสอบ)
* สามารถใช้ OCR Mock / Stub แทน External API จริงได้
* เปิด `pino-pretty` สำหรับ Log แบบอ่านง่าย
* Swagger UI เปิดให้เข้าถึงได้ที่ `/api-docs`
* ยอมรับ `CORS` จากทุก Origin (`*`)
* **ห้าม commit `.env` ที่มีค่า dev ลง git**

---

## STAGING MODE (`NODE_ENV=staging`)

* JWT Auth จริงทุก Endpoint — ห้ามใช้ Mock token
* Redis Lock จริงสำหรับ Visitor CHECKED_IN และ OCR Double Submit
* เรียก External OCR API และ Face Verification API จริง
* Rate Limit เต็มรูปแบบเหมือน Production
* CORS จำกัดเฉพาะ Domain ที่กำหนดใน `ALLOWED_ORIGINS`
* Log ในรูปแบบ JSON (ไม่ใช้ pino-pretty)

---

## PRODUCTION MODE (`NODE_ENV=production`)

* ทุกอย่างเต็มระบบ — ไม่มีการผ่อนปรนใดๆ
* **ห้ามเปิด Swagger UI** (`/api-docs`) ออก Public
* **ห้ามมี `console.log`** หรือ debug code ใดๆ ใน codebase
* Rate Limit เข้มงวดสูงสุด: Login 5 ครั้ง/5 นาที, OCR 10 ครั้ง/นาที
* Redis ต้องเปิด AOF persistence
* HTTPS บังคับผ่าน Nginx (ห้าม HTTP ตรง)
* Secrets ทุกตัวมาจาก Environment Variables เท่านั้น — ห้าม hardcode

---

## กฎบังคับทุกโหมด (Absolute Rules)

* ❌ ห้ามเขียน OCR Engine หรือ Face Detection เองในทุกโหมด
* ❌ ห้ามบันทึก JWT Secret หรือ DATABASE_URL ลงใน Log
* ❌ ห้ามเปลี่ยน `NODE_ENV` ใน Runtime โดยไม่ restart container
* ✅ `prisma/schema.prisma` คือ Source of Truth เสมอในทุกโหมด
* ✅ ทุก state change ต้อง persist PostgreSQL ก่อน broadcast Socket.IO ในทุกโหมด
