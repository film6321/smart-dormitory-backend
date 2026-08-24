# Face Verification QA Checklist

## Scope

ทดสอบ flow สำหรับผู้พักอาศัย:

1. Login ด้วยบัญชี `ADMIN` สำหรับการจัดการ enrollment และ monitor
2. บันทึกรูปใบหน้าให้ `userId` ที่มีอยู่ในฐานข้อมูล
3. ตรวจสอบว่า `FaceEnrollmentPhoto` และไฟล์ภาพถูกสร้างจริง
4. ส่งภาพผ่าน `verify-image`
5. เปิดข้อมูล monitor เพื่อตรวจสอบ camera/device status, scan history และ events
6. ทดสอบคำสั่งเปิด/ล็อกประตูจาก access control

> ข้อจำกัดปัจจุบัน: `POST /api/face-verification/register` อนุญาตเฉพาะ `ADMIN` และ `verify-image` จะใช้ mock fallback หากไม่มี `FACE_API_URL` กับ `FACE_API_KEY` ดังนั้นผล biometric จริงต้องทดสอบเมื่อเชื่อม Face API หรือ FaceGate.Edge แล้วเท่านั้น

## Preconditions

- [ ] Backend ทำงานที่ `http://127.0.0.1:3000`
- [ ] PostgreSQL ทำงานและ `DATABASE_URL` ชี้ไปยังฐานข้อมูลทดสอบ
- [ ] `npx prisma migrate deploy` หรือ schema ที่ใช้งานอยู่เป็น version ล่าสุด
- [ ] มีบัญชี `ADMIN` ที่ login ได้
- [ ] มี `userId` ของผู้พักอาศัยที่มีอยู่จริงใน `User`
- [ ] มีภาพทดสอบ JPG/PNG/WebP ขนาดไม่เกิน 5 MB
- [ ] ไม่ใช้ภาพใบหน้าจริงของบุคคลอื่นโดยไม่มีความยินยอม
- [ ] หากทดสอบ biometric จริง ให้ตั้งค่า `FACE_API_URL` และ `FACE_API_KEY`
- [ ] บันทึก `userId`, เวลาเริ่มทดสอบ, commit/version และ environment ไว้ใน test report

## A. Authentication and authorization

- [ ] `POST /api/auth/login` ด้วย ADMIN ได้ HTTP 200 และเก็บ `data.token`
- [ ] Login ด้วยรหัสผ่านผิดได้ HTTP 401 และไม่คืน token
- [ ] `POST /api/face-verification/register` ไม่มี token ได้ HTTP 401
- [ ] `POST /api/face-verification/register` ด้วย STUDENT token ได้ HTTP 403
- [ ] `GET /api/face-verification/devices` ด้วย ADMIN token ได้ HTTP 200
- [ ] `GET /api/face-verification/scan-history` ด้วย ADMIN token ได้ HTTP 200
- [ ] token หมดอายุ/ไม่ถูกต้องไม่สามารถเรียก admin endpoints ได้

## B. Face enrollment

- [ ] ส่ง `userId` ที่มีอยู่จริงพร้อมไฟล์ JPG ได้ HTTP 201
- [ ] response มี `statusCode: 201`, `data.id`, `data.user_id`, `created_at`
- [ ] ตรวจสอบ DB พบ row ใหม่ใน `FaceEnrollmentPhoto` ที่ `userId` ตรงกัน
- [ ] `photoPath` ชี้ไปยังไฟล์ที่มีอยู่จริงใน `uploads/face-photo`
- [ ] ส่ง `userId` ที่ไม่มีอยู่จริงได้ HTTP 404
- [ ] ไม่ส่งไฟล์ได้ HTTP 400
- [ ] ส่งไฟล์ชนิดที่ไม่อนุญาต เช่น PDF ได้ HTTP 400
- [ ] ส่งไฟล์เกิน 5 MB ได้ HTTP 400
- [ ] ลงทะเบียนรูปซ้ำแล้วระบบไม่ทำให้ server ล้ม; บันทึกผลตาม policy ที่ทีมกำหนด
- [ ] ทดสอบมุมหน้า, ซ้าย, ขวา, ก้ม และเงย แล้วบันทึก photo IDs แยกกัน
- [ ] ยืนยันว่าการเก็บภาพหลายมุมไม่ผูกกับ `userId` ผิดคน

## C. Face verification

- [ ] ส่งภาพคนเดียวกับ enrollment ผ่าน `POST /api/face-verification/verify-image` ได้ HTTP 200
- [ ] response มี `data.matched`, `data.user_id`, `data.similarity`, `data.processing_time_ms`
- [ ] ภาพคนละคนต้องได้ `matched: false` เมื่อใช้ Face API จริงและ threshold ที่กำหนด
- [ ] ภาพไม่มีใบหน้าต้องถูกปฏิเสธหรือคืน `matched: false` ตาม contract ของ Face API
- [ ] ส่ง threshold ต่ำกว่า 0 หรือสูงกว่า 1 ได้ HTTP 400
- [ ] ส่งไฟล์หายได้ HTTP 400
- [ ] ส่ง request เกิน rate limit ได้ HTTP 429 และมี retry guidance
- [ ] ตรวจสอบ access log/ระบบ observability ว่าการ verify ถูกบันทึกโดยไม่มีข้อมูลภาพหรือ secret หลุดใน log
- [ ] เมื่อ Face API ล่ม ระบบคืน fallback/error ตาม runtime policy และแสดงสถานะให้ผู้ดูแลทราบ
- [ ] ยืนยันชัดเจนว่า local mock fallback ไม่ถูกนับเป็น biometric pass ในผล QA จริง

## D. Monitor and recognition flow

- [ ] เปิด `/access-control` ใน frontend ด้วยบัญชี ADMIN
- [ ] กล้องขอ permission และแสดงภาพ live ได้
- [ ] ปฏิเสธ camera permission แล้ว UI แจ้งข้อผิดพลาดและยังเลือกอัปโหลดภาพได้
- [ ] capture frame ได้ภาพที่ไม่ดำ/ไม่ว่าง
- [ ] monitor แสดง device status และสถานะ offline เมื่อไม่มี heartbeat
- [ ] monitor โหลด scan history ได้โดยไม่ทำให้หน้า crash
- [ ] เมื่อมี scan event ระบบแสดง recognition result, confidence, user/student และเวลา
- [ ] SSE `/api/face-verification/events` เปิด connection ได้ และปิด connection เมื่อออกจากหน้า
- [ ] live stream/device feed ไม่สร้าง request ซ้ำหลัง unmount หรือ refresh
- [ ] ผลจากภาพที่ match และไม่ match แสดงคนละสถานะอย่างชัดเจน

## E. Door control

- [ ] `POST /api/face-verification/door-command` ด้วย ADMIN และ `action: unlock` ได้ HTTP 200
- [ ] response มี `data.device_code`, `data.action: unlock`, `data.status: opened`
- [ ] `action: lock` ได้ `data.status: locked`
- [ ] ไม่ส่ง `device_code` ได้ HTTP 400
- [ ] ส่ง action อื่น เช่น `open` ได้ HTTP 400
- [ ] ไม่มี ADMIN token ได้ HTTP 401/403 ตาม middleware
- [ ] backend ล้มเหลวแล้ว frontend ไม่ค้างสถานะ UNLOCKED
- [ ] ทุกคำสั่งมี timestamp และ device code ที่ตรวจสอบย้อนหลังได้
- [ ] ยืนยันว่าคำสั่งเป็นเพียง status/API layer หากยังไม่มี hardware adapter; ห้ามรายงานว่าเปิดประตูจริงจนกว่าจะทดสอบอุปกรณ์

## F. Negative, security, and resilience

- [ ] ป้องกัน path traversal ผ่านชื่อไฟล์ upload
- [ ] ไม่บันทึก JWT, API key หรือภาพ base64 เต็มลง log
- [ ] request body ใหญ่ผิดปกติถูกจำกัด
- [ ] concurrent register/verify requests ไม่สร้างข้อมูลข้าม user
- [ ] refresh/reload monitor แล้ว camera tracks เดิมถูกหยุดและไม่รั่ว
- [ ] network disconnect แล้ว UI แสดงสถานะ offline และกลับมา reconnect ได้ตาม policy
- [ ] PostgreSQL unavailable แล้ว endpoint คืน error มาตรฐาน ไม่คืน stack trace
- [ ] Face API timeout/error ไม่ทำให้ worker หรือ Express process หยุด

## Evidence and exit criteria

- [ ] แนบ request/response ของ login, register, verify, devices, scan-history และ door-command
- [ ] แนบ screenshot หน้า monitor ตอน match และ no-match
- [ ] แนบ DB query result ของ `FaceEnrollmentPhoto`
- [ ] แนบ path/hash ของไฟล์ enrollment ที่ถูกสร้าง
- [ ] ระบุว่า verify ใช้ real Face API หรือ mock fallback
- [ ] Backend `npm test` ผ่าน
- [ ] Backend `npm run build` ผ่าน
- [ ] Frontend `npm run build` ผ่าน
- [ ] ไม่มี Critical/High defect ค้างอยู่

## Suggested DB evidence query

```sql
SELECT id, "userId", "photoPath", "createdAt"
FROM "FaceEnrollmentPhoto"
WHERE "userId" = <USER_ID>
ORDER BY "createdAt" DESC;
```
