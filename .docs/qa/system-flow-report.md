# รายงานตรวจ flow ระบบ

วันที่ตรวจ: **8 ต.ค. 2569** สภาพแวดล้อม local Docker ผ่าน `http://127.0.0.1:3002` ข้อมูลที่ได้รับอนุญาต: `test01@gmail.com` (User 25, Tenant 57) ไม่ทดสอบชำระเงินจริงในรอบนี้

## ขอบเขตและสถานะก่อนทดสอบ

ผู้ใช้รายงานว่าขั้นสมัคร/ชำระทดสอบปกติแล้ว รอบนี้ตรวจ API/RBAC, สถานะงานซ่อมที่จบแล้ว และลบโปรไฟล์หลังย้ายออก Tenant 57 อยู่ INACTIVE และ roomId null ตั้งแต่ก่อนทดสอบ ไม่ได้สร้างบัญชีอื่นหรือปรับข้อมูลผู้พักอื่น

พบ Docker image เดิมใช้ flow ลบเก่า (`409` มีประวัติแล้วลบไม่ได้) และฐานข้อมูลยังไม่ใช้ migration สองรายการ หลังตรวจ SQL จึง deploy `20261007000000_retention_nullable_ledger_owner` และ `20261007010000_add_visitor_requested_tenant_name` แล้ว rebuild เฉพาะ Backend การเปลี่ยนนี้ไม่ reset DB และไม่เปิด ACCOUNT_RETENTION_MODE=delete

## API จริงที่ยืนยันแล้ว

| กรณี | Expected | Actual | ผล |
| --- | --- | --- | --- |
| Login Student | 200 + cookie | 200, HttpOnly, ไม่มี token ใน body | ผ่าน |
| Anonymous GET tenants/me, maintenance, visitor, tenants, billing | 401 | 401 ทุกเส้นทาง | ผ่าน |
| Admin GET tenants/maintenance/visitor/billing | 200 | 200 | ผ่าน |
| Student GET tenants รวม / visitor รวม | 403 | 403 | ผ่าน |
| Student GET maintenance/billing | 200 ตามสิทธิ์ | 200 | ผ่านการตอบสนอง; ไม่พิสูจน์การกรองหลายเจ้าของครบทุกกรณี |
| Student PATCH maintenance/244/status | 403 | 403 | ผ่าน |
| Student DELETE tenants/57 | 403 | 403 | ผ่าน |
| Admin PATCH งาน CLOSED 244 เป็น CANCELLED | 409 | 409 ไม่แก้สถานะ | ผ่าน |
| Admin DELETE งาน CLOSED 244 / CANCELLED 245 | 409 | 409 | ผ่าน |
| Public POST visitor/register ข้อมูลว่าง | 400 | 400 Validation Failed | ผ่าน |
| Public POST visitor/scan-id-card ไม่มีภาพ | 400 | 400 | ผ่าน |
| Admin DELETE tenants/57 หลัง deploy | 200/202 ตาม cleanup | 202 ล้าง PII แล้วรอ cleanup | ผ่าน |
| Student GET tenants/me หลังลบ | ไม่มีโปรไฟล์ผูกบัญชี | 200, data null | ผ่าน |
| GET cleanup/face-cleanup:user:25 ภายหลัง | COMPLETE | 200, COMPLETE | ผ่าน |
| Login บัญชี test01 หลังลบโปรไฟล์ | บัญชียังอยู่ | 200 | ผ่าน |
| GET api/health หลัง deploy | 200 | 200 | ผ่าน |
| Student ไม่มีโปรไฟล์ POST maintenance หลังลบ | ไม่สร้างงาน | 404 Tenant profile not found | ผ่าน |

ทุก response ที่ตรวจในรอบนี้มี statusCode/success/message/data และ statusCode ตรง HTTP status ไม่ได้หมายความว่าตรวจครบทุก endpoint ของระบบแล้ว

## ยืนยันจาก PostgreSQL หลังลบ

- User 25 ยังอยู่ 1 บัญชี
- Tenant 57 เป็น ARCHIVED, userId และ roomId เป็น null
- fullName/email/citizenId/contractData/idCardImagePath เป็น null ตาม query ที่ตรวจ
- MaintenanceTicket ของ Tenant นี้เหลือ 0
- Bill ของ Tenant นี้มี 0 จึงไม่ได้ทดสอบการตัดข้อมูลส่วนบุคคลจากบิล PAID ด้วยข้อมูลจริง
- งาน `face-cleanup:user:25` เป็น DONE และ API แสดง COMPLETE
- ไม่พบคิว RETENTION_FILES ค้าง ณ เวลาตรวจ

COMPLETE ในกรณีนี้ยืนยันงานของเจ้าของทดสอบสำเร็จ ไม่ใช่หลักฐานว่าได้ลบไฟล์ภาพจริงทุกชนิด เพราะชุดข้อมูลนี้อาจไม่มีภาพชนิดนั้น ต้องสร้างกรณีที่มีไฟล์ก่อนตรวจเพิ่มเติม

## ข้อผิดพลาดที่แก้ในรอบนี้

`VisitorService.scanVisitorIdCard` อ่าน verificationId ได้จาก OCR แต่ mapping เดิมไม่คืน field นี้ ขณะที่ register ต้องใช้ idCardVerificationId แก้ให้คืน verificationId และเพิ่ม assertion ใน `tests/unit/visitor-flow.test.ts` เส้นทาง Frontend ผู้มาติดต่อปัจจุบันใช้ `/ocr/identity-card` อยู่แล้ว จึงไม่ได้สรุปว่าข้อนี้เป็นสาเหตุที่หน้าปัจจุบันล้มทุกครั้ง

เพิ่ม guard งานซ่อมใน repository เดิม ตรวจผู้พักที่มีสิทธิ์และห้องตนเองใน transaction ล็อก User → Tenant พร้อม regression tests และไม่ใช้โควตาเมื่อถูกปฏิเสธ

## Regression

| คำสั่ง | ผลรอบนี้ |
| --- | --- |
| `npm run build` | ผ่าน |
| `npm test` | 161 tests, 19 suites; fail/skipped/todo = 0 |
| `npm run test:typecheck` | ผ่าน |
| `npx eslint "src/**/*.ts" "tests/**/*.ts"` | ผ่าน ไม่มี auto-fix |
| `git diff --check` | ผ่าน มีเพียงคำเตือน LF/CRLF ของไฟล์เดิม |
| `npm run db:migrate:deploy` | migration ค้าง 2 รายการใช้สำเร็จ |
| `docker compose up -d --build --no-deps backend` | build และเริ่ม Backend สำเร็จ |

Frontend 66 tests และการตรวจ UI สมัครที่ 375/768/1440px เป็นหลักฐาน **จากรอบก่อน** ที่ใช้ mock API ไม่ได้รัน Frontend tests ใหม่ในรอบนี้ ไม่มีการแก้โค้ด Frontend รอบนี้

Build image รายงาน dependency vulnerabilities 5 รายการ (moderate 1, high 3, critical 1) ยังไม่ได้แก้ในงานนี้ ไม่ใช้ `npm audit fix --force` หรือแก้ lockfile ระหว่างทดสอบ flow

## ผลตรวจต่อ: HTTP และ PostgreSQL ในฐานข้อมูลแยก

ตรวจวันที่ 8 ต.ค. 2569 ผู้ใช้ยืนยันว่าบัญชี test01 ยังไม่ได้สมัครใหม่ จึงไม่สร้างโปรไฟล์/สถานะชำระแทนผู้ใช้ใน projectdb ใช้ `maintenance_flow_test` ที่สร้างแยกและลง migration 27 รายการ ติดตั้ง schema เดียวกับแอปจริง

ชุดทดสอบ [maintenance-flow.test.ts](../../tests/integration/maintenance-flow.test.ts) ใช้ Express routes, JWT cookie สำหรับบัญชี fixture, Controller, Service และ PostgreSQL จริง ไม่ mock query ไม่เรียก OCR/Face/Payment และไม่เริ่ม notification/cleanup worker จึงไม่ส่ง SMS หรือสั่งลบใบหน้าภายนอก

| กรณี | ผล |
| --- | --- |
| สร้างงาน → APPROVED → IN_PROGRESS → RESOLVED → CLOSED | 201/200; สถานะตรง DB และรายการ CLOSED ยังอยู่ในประวัติ |
| ยกเลิก/ลบหลัง RESOLVED หรือ CLOSED | 409 |
| ส่งพร้อมกัน 4 requests | สร้าง 3 รายการ (201) ปฏิเสธ 1 (429); บันทึกโควตาถาวร 3 รายการ |
| ลบงาน PENDING แล้วส่งใหม่ในวันเดิม | ยัง 429 โควตาไม่คืน |
| เลื่อน createdAt ของ fixture ไปวันก่อนเพื่อจำลองข้ามวันไทย | ส่งใหม่ได้ 201; เป็นการจัด fixture ไม่ใช่รอเวลา 24 ชั่วโมงจริง |
| ส่งงานให้ห้องคนอื่น / contactTime ผิด | 403/400; ไม่สร้างงานและไม่ใช้โควตา |
| Student อ่านงานของอีกบัญชี / แก้สถานะ / ลบ | ไม่เห็นงานคนอื่น; แก้หรือลบ 403; ไม่มี session 401 |
| ACTIVE → INACTIVE | คืนห้อง roomId null, isActive false, checkOutDate มีค่า, ห้อง AVAILABLE |
| ผู้ย้ายออกส่งงาน / เปิดการเข้าพักเดิม | 403/409 |
| ย้ายออกเมื่อมีบิล UNPAID | 409; ACTIVE และห้องเดิมไม่เปลี่ยน |
| ลบผู้พัก ACTIVE / ลบหลังย้ายออกแต่มีงานซ่อมค้าง | 409 และข้อมูลบัญชียังผูกอยู่ |
| ปิดงานแล้วลบข้อมูลผู้พัก | 200/202; ARCHIVED ตัด userId/PII, งานซ่อมหาย, User ยังอยู่, tenants/me เป็น null |
| บิล PAID ที่ตั้งไว้เป็น fixture | ยอด/สถานะอยู่ แต่ description/reason และเจ้าของที่เป็นข้อมูลส่วนบุคคลถูกตัด; ไม่ได้ทดสอบโอนเงินหรือ verify slip |

**ผ่าน 9 tests, fail/skipped/todo = 0** ผลนี้ยืนยัน HTTP และ transaction ในฐานข้อมูลแยก ไม่แทนการกดหน้าเว็บกับภาพบัตรจริง การใช้ JWT fixture ไม่ใช่ผลทดสอบ login ใหม่ งาน cleanup ถูก enqueue แต่ไม่เรียกบริการภายนอกในชุดนี้

หลังรัน query ยืนยัน users/tenants/rooms/tickets/quotaLogs/bills/notifications เป็น 0 ทั้งหมด ล้างเฉพาะ IDs ของ fixture และงาน cleanup ของ fixture ที่ติดตามไว้ ฐานข้อมูลทดสอบยังอยู่พร้อม schema เพื่อรันครั้งถัดไป

### วิธีรันซ้ำ

1. ตั้ง `DATABASE_URL` ไป PostgreSQL local ฐาน `maintenance_flow_test` และใช้ migration ปัจจุบันด้วย `npm run db:migrate:deploy` ตรวจชื่อฐานก่อนรัน ห้ามใช้ projectdb
2. ตั้ง `NODE_ENV=test`, `DISABLE_REDIS_RATE_LIMITS=true`, `RATE_LIMIT_STORE=memory`, `TS_NODE_PROJECT=tsconfig.test.json`, `TS_NODE_FILES=true` และ JWT_SECRET เฉพาะการทดสอบ ไม่ใช้ secret/session จริง
3. รัน `node --require ts-node/register --test tests/integration/maintenance-flow.test.ts`
4. ตรวจ cleanup เมื่อทดสอบเสร็จ ชุดนี้ไม่อยู่ใน `npm test` ปกติ เพราะต้องเตรียม PostgreSQL แยกและ migration ก่อน

ผ่าน `npm run build`, `npm run test:typecheck` และ ESLint ในรอบนี้ด้วย ไม่ได้แก้ source production เพิ่มในรอบนี้ ผล suite ปกติ 161 tests เป็น suite ปกติ ส่วน 9 tests ฐานข้อมูลแยกรันเพิ่มเติม ไม่อ้างว่า npm test ปกติมี 170 tests

ผลทดสอบขีดจำกัดเก็บตาม AGENTS.md ที่ [final report](../../tests/load/logs/2026-10-08/final_report.md) และ stats.csv/run.log ในโฟลเดอร์เดียวกัน เป็น functional concurrency test 4 คำขอ ไม่ใช่ performance benchmark ไม่มีการวัด CPU/RAM/throughput จึงไม่ใช้ค่าที่ไม่ได้วัด

## ตรวจต่อ: ผู้มาติดต่อและการส่งซ้ำ

วันที่ 8 ต.ค. 2569 เพิ่ม [visitor-registration.test.ts](../../tests/integration/visitor-registration.test.ts) ใช้ HTTP/Express, PostgreSQL ฐาน maintenance_flow_test และ Redis local จริง ผล OCR เป็น fixture ที่สร้างเฉพาะในฐานทดสอบ ไม่เรียก engine OCR หรือใช้บัตรจริง

### ข้อผิดพลาดที่ยืนยันและแก้

1. ส่ง key เดิมซ้ำหลังสำเร็จสร้าง Visitor เพิ่ม: บันทึก request hash/visitor ID ใน PostgreSQL ร่วม transaction และใช้ advisory transaction lock; ส่งข้อมูลเดิมคืนรายการเดิม ข้อมูลต่างกันตอบ 409 ไม่มี schema/table ใหม่ และ metadata ไม่ออกในหน้า Settings
2. การตรวจ masked citizen ID ยอมรับเลขกลางที่เปลี่ยน: ตรวจ citizenIdHash เต็มจาก OCR ผลเก่าที่ไม่มี hash ต้องสแกนใหม่
3. วันที่ไม่ถูกต้องไปถึง Prisma แล้วตอบ 500 และอายุ Infinity ผ่าน validation: ใช้ ISO validation และจำกัดอายุจำนวนเต็ม 0–120 ตอบ 400 ก่อนบันทึก
4. VisitorStatus มี CANCELLED ใน schema แต่ migration เดิมไม่มี: เพิ่ม `20261008000000_add_visitor_cancelled_status` แบบ ADD VALUE IF NOT EXISTS ทดสอบฐานแยกแล้ว deploy local สำเร็จ ไม่ reset หรือลบแถวข้อมูล
5. นัดหมายหน้า Frontend ไม่มี offset และวันเริ่มต้นคำนวณจาก UTC: เปลี่ยนวันตาม Asia/Bangkok และส่ง +07:00 เช่น 10:00 ไทยเก็บเป็น 03:00Z
6. Frontend lint เดิมพบ setState ทันทีใน effect ของหน้าสแกน: ใช้ timer callback ที่ cleanup ได้ และซ่อน countdown เมื่อไม่มี deadline ตามเงื่อนไขเดิม

### ผลเพิ่มเติม

**ผ่าน 10 tests, fail/skipped/todo = 0** ครอบคลุม receipt ไม่มีเลขบัตร/ที่อยู่/pathภาพ, retry key เดิมได้ ID เดิม/log เดียว, key เดิม payload ต่างกัน 409, ส่งพร้อมกัน 3 คำขอสร้าง Visitor เพียงหนึ่ง, เปลี่ยนเลขกลางปฏิเสธ, ข้อมูลวัน/อายุผิด 400, consent/key/path ไม่ตรงปฏิเสธ, รายละเอียด Admin เท่านั้น, ยกเลิกซ้ำ log เดียว และ expiry ทำซ้ำไม่เพิ่ม log

ทดสอบ 10:00+07:00 เป็น 03:00Z จริงใน DB และผล OCR fixture ที่ไม่มี hash ถูกปฏิเสธ ไม่มีการยืนยันความแม่นยำ OCR จากผลเหล่านี้ การหมดอายุจำลองผ่านการปรับเวลาของ fixture ไม่ได้รอ 24 ชั่วโมงจริง ไม่เปิดประตูหรือเรียก SMS/Face/Payment ภายนอก

วิธีรันใช้ environment ฐานข้อมูลแยกตามชุด maintenance ด้านบน เพิ่ม REDIS_URL ไป Redis local แล้วรัน `node --require ts-node/register --test tests/integration/visitor-registration.test.ts` ต้องใช้ migration ปัจจุบัน 28 รายการ ชุดนี้ไม่อยู่ใน npm test ปกติ

ยังต้องทดสอบภาพบัตรจริงและ UI ครบ flow จึงไม่ทำเครื่องหมายว่าผู้มาติดต่อเสร็จทั้งหมด Backend suite ปกติผ่าน 161 tests และ integration ผู้มาติดต่อผ่าน 10 tests แยกกัน Frontend ผ่าน 66 tests พร้อม build/lint; Backend build/typecheck/lint ผ่าน เพิ่ม migration และ rebuild Backend local แล้ว Smoke test health=200 และ visitor payload ว่าง=400 ผ่าน ไม่มีการสมัครผู้มาติดต่อใหม่ในฐาน projectdb

## ตรวจหน้าผู้มาติดต่อด้วย Chrome และ API จำลอง — 8 ต.ค. 2569

รอบนี้ตรวจขั้นที่ 4 ตามแผนหลัก และย้อนแก้ข้อผิดพลาดของขั้นที่ 1/3 ใน `VisitorRegistrationPage.tsx` ใช้ Chrome headless กับ Vite พอร์ต 5187 ดัก API ด้วย Chrome DevTools Protocol และตอบ fixture เท่านั้น ไม่เรียก OCR/Payment จริง ไม่ส่งข้อมูลลง projectdb และไม่สร้างโปรไฟล์ ACTIVE ให้ test01

| กรณี | ผลที่ยืนยัน |
| --- | --- |
| หน้ายินยอม ฟอร์ม และใบรับคำขอ ที่ 375/768/1440px | ไม่ล้นจอในทุกมุมมองที่ตรวจ |
| ส่ง form สองครั้งในจังหวะเดียว | ก่อนแก้เกิด POST 2 ครั้ง; หลังแก้เกิด 1 ครั้ง |
| ส่งล้มเหลวแล้วลองใหม่ | แสดง error และส่งใหม่ด้วย Idempotency-Key เดิม |
| OCR ล้มเหลวแล้วสแกนใหม่ | แสดง error และกลับมาเติมข้อมูลได้ |
| สแกนใหม่ล้มเหลวหลังเคยสำเร็จ | ไม่ใช้ verification เก่า และไม่ส่งลงทะเบียน |
| เลือก SVG หรือ PNG เกิน 5 MB | ปฏิเสธก่อนยิง OCR; JPG/PNG/WebP ใช้เพดาน 5 MB ตรงกับ Backend |
| เปลี่ยนภาพขณะ OCR ยังไม่ตอบ | ยกเลิกคำขอเก่า และคำตอบเก่าไม่ทับข้อมูลจากภาพล่าสุด |
| ออกจากหน้าระหว่าง OCR/ส่งคำขอ | ยกเลิกคำขอ และคืน Blob URL ของภาพตัวอย่าง |
| API ตอบ receipt ไม่ครบ | คงฟอร์มและแสดงข้อผิดพลาด ไม่แสดงว่าสำเร็จ |
| API คืนคำขอเดิมสถานะ CANCELLED | แสดง “ยกเลิกแล้ว” ไม่แสดงเป็นรายการรอตรวจ |

ลดการส่งภาพซ้ำใน multipart จาก `file` และ `image` เหลือ `file` ช่องเดียวตาม alias ที่ API รองรับ สถานะ receipt ใช้ REGISTERED/VERIFYING/APPROVED/REJECTED/CHECKED_IN/CHECKED_OUT/EXPIRED/CANCELLED ตาม enum จริง ไม่ใช้ PENDING ของงานซ่อม

Frontend `npm run build`, `npm run lint`, `npm run test` ผ่าน (66 tests, fail 0) ส่วน browser flow เป็นการตรวจเพิ่มด้วยสคริปต์ชั่วคราว `dorm-visitor-ui.cjs` ไม่รวมอยู่ใน 66 tests และไม่ติดตั้ง package ใหม่ Chrome ไม่พบ Runtime exception ในชุดนี้ การตรวจความกว้างไม่ใช่การรับรอง accessibility หรือ responsive ของทุกหน้าทั้งระบบ

ผลนี้ยืนยันการจัดการคำขอและสถานะหน้าจอด้วยข้อมูลจำลอง ไม่ยืนยันความแม่นยำ OCR หรือการยืนยันตัวตนด้วยบัตรจริง ยังต้องทดสอบ OCR จริง → Admin ตรวจคำขอผ่านระบบจริงตามรายการที่ค้าง ส่วนการชำระเงินจริงยังให้ผู้ใช้จัดการตามเดิม

## ตรวจข้อมูลหลังลบผู้พักและรายการแจ้งซ่อม — 8 ต.ค. 2569

ตรวจแบบ read-only ในฐาน local โดยใช้บัญชี test01@gmail.com (User 25) และโปรไฟล์เดิม Tenant 57 ตามข้อมูลทดสอบที่ผู้ใช้อนุญาต ไม่ลบบัญชีหรือข้อมูลผู้พักอื่นในรอบนี้

| ข้อมูลที่ตรวจ | ผล |
| --- | --- |
| User 25 | ยังอยู่; ไม่มี Tenant ปัจจุบัน ตามกติกาเก็บบัญชีไว้ |
| Tenant 57 | ARCHIVED, userId/roomId เป็น null; ช่องข้อมูลส่วนบุคคล เอกสารและสัญญาที่ตรวจเป็น null ทั้งหมด |
| MaintenanceTicket ของ Tenant 57 | 0 |
| Bill/Visitor/Payment/PaymentBatch/Transaction ที่ยังผูก User 25 หรือ Tenant 57 | 0 |
| OCR jobs และ IdCardVerification ของ User 25 | 0 |
| Notification/Preference และ FaceEmbedding/EnrollmentPhoto ของ User 25/Tenant 57 | 0 |
| คิวล้างใบหน้า User 25 | DONE, paths ว่าง; ไม่มี RETENTION_FILES ค้าง ณ เวลาตรวจ |
| AccessLog ของ User 25 | 8; เป็น log method/path ของบัญชีที่ยังอยู่ ไม่ใช่แถวงานซ่อม ไม่ได้ลบเพิ่มรอบนี้ |
| งานซ่อมที่ยังอยู่ในฐาน | #242 APPROVED และ #243 CLOSED เป็นของ Tenant 56/User 2 ไม่ใช่ test01 |

AccessLog สองรายการมีเวลาก่อน updatedAt ของ Tenant ที่ถูก archive และอ้าง route แก้สถานะงาน #244/ลบ Tenant 57 จึงไม่อ้างว่าข้อมูลทุกตารางเหลือเพียง User แถวเดียว ระบบมีการบันทึก AccessLog ผ่านคิว ต้องแยกการกำหนดอายุ log บัญชีจากการลบข้อมูลสมัครเข้าพัก ยังไม่ล้างคิวหรือประวัติบัญชีอื่น

### จุดที่แก้ในรอบนี้

1. หลังลบหรือเปลี่ยนสถานะผู้พัก StudentsPage เดิมโหลดเฉพาะ tenants และรอ Socket สำหรับข้อมูลเกี่ยวข้อง: ให้โหลด tenants/rooms/maintenance โดยตรง รอผลทุกคำขอและแยก “บันทึกสำเร็จแต่โหลดใหม่ไม่สำเร็จ” จาก mutation ไม่สำเร็จ
2. คำตอบ maintenance เก่าที่มาช้าอาจคืนรายการที่ถูกลบ: เพิ่ม request sequence ตามแนวทาง rooms/tenants เดิม ให้เฉพาะคำตอบล่าสุดแก้ state
3. purgeTenant เดิมลบ ticket แต่ไม่เข้าคิวล้างภาพ `[IMAGE:filename]` ใน description: เก็บ path ภาพก่อนลบ ticket เข้าคิว RETENTION_FILES ใน transaction เดิม ปฏิเสธ path traversal และตรวจว่าไม่มี ticket หรือข้อมูลอื่นอ้างไฟล์ก่อน worker ลบจริง

ผลตรวจ: Backend build/test:typecheck/ESLint ผ่าน และ suite 163 tests ผ่าน; integration maintenance HTTP/PostgreSQL ฐานแยก 9 tests ผ่าน; Frontend build/lint และ suite 68 tests ผ่าน มี regression สำหรับ refresh โดยไม่พึ่ง Socket, คำตอบเก่าไม่คืน ticket, queue ภาพก่อนลบ และเก็บภาพที่อีก ticket ใช้อยู่ก่อนลบหลังหมด references อัปเดต Backend local โดยไม่ reset DB; gateway health 200

ยังไม่สามารถระบุว่าไฟล์เก่าทุกไฟล์ใน uploads ที่ไม่มี DB reference เป็นของบัญชีใด หลังความสัมพันธ์เดิมถูกลบแล้ว จึงไม่ลบไฟล์เหล่านั้นโดยเดา และยังรอผู้ใช้ระบุว่ารายการแจ้งซ่อมที่เห็นเป็นของ test01 หรือผู้พักห้อง 304 ก่อนทำ mutation ข้อมูลเพิ่มเติม

## ความพร้อมสำหรับทดสอบบัตรจริงและผู้พักที่มีสิทธิ์ — 8 ต.ค. 2569

ผู้ใช้ยืนยันว่ายังไม่ได้สมัครใหม่ ตรวจ local พบ User 25 ยังอยู่แต่ไม่มี Tenant ปัจจุบัน จึงยังไม่มีผู้พัก test01 ที่มีห้องเพื่อทดสอบงานซ่อมจริง ไม่สร้างโปรไฟล์หรือสถานะ PAID จำลองใน projectdb และไม่เปลี่ยนผู้พักบัญชีอื่นแทน

ตรวจ gateway `/api/health` ได้ 200 และเรียก OCR `/api/v1/health` จาก container Backend ผ่าน URL ที่ตั้งค่าไว้ได้ 200/status healthy พร้อมยืนยันว่ามี OCR_API_KEY โดยไม่แสดงค่า key Health route ไม่ตรวจ API key หรือประมวลผลภาพ จึงยังไม่ยืนยันว่าการอ่านบัตรจริง/โมเดล OCR ผ่าน

การอนุมัติผ่าน UI ปัจจุบันส่ง APPROVED ไม่ใช่ ACTIVE เสมอไป Service แจ้งซ่อมยอมรับทั้ง APPROVED และ ACTIVE เมื่อ isActive=true และมี roomId จริง ต้องรายงานสถานะจริงที่พบและไม่แก้เป็น ACTIVE ด้วย SQL เพียงเพื่อให้ผ่านเงื่อนไขทดสอบ

### ขั้นตอนรับข้อมูลสำหรับรอบถัดไป

1. ผู้ใช้ล็อกอิน test01@gmail.com ที่ gateway local เปิด `/apply` อัปโหลดบัตรจริง ตรวจ/แก้ข้อมูล OCR เลือกห้อง และทำการทดสอบชำระเงิน/ส่งใบสมัครตาม flow ปัจจุบัน
2. Admin ตรวจและอนุมัติใบสมัครจนแสดงว่าเข้าพักแล้ว จากนั้นตรวจ status, isActive และ roomId ใน DB/API โดยไม่แสดงข้อมูลบัตรในรายงาน
3. ทดสอบงานซ่อมด้วย test01 ตั้งแต่สร้างรายการ → อนุมัติ → กำลังดำเนินการ → เสร็จ → ปิด พร้อมเช็คเวลานัดหมาย สิทธิ์ ห้องจริง และป้องกันแก้/ลบรายการสิ้นสุด บันทึก ID ก่อนดำเนินการ
4. การตรวจโควตา 3 ครั้ง/วันต้องนับรายการทดสอบที่สร้างไปแล้วในวันไทยเดียวกัน ไม่ใช้ลบ ticket เพื่อคืนโควตา และไม่เปลี่ยน timestamp ข้อมูลจริงเพื่อให้ผ่าน
5. ผู้ใช้เปิด `/visitor` ยินยอมและสแกนภาพบัตรจริง ตรวจข้อมูล/ชื่อผู้พัก/เลขห้อง ส่งคำขอและแจ้งเลขคำขอเพื่อระบุ fixture ที่อนุญาต จากนั้นตรวจ receipt, visibility ฝั่ง Admin และการยกเลิกเฉพาะคำขอนั้น การหมดอายุ 24 ชั่วโมงต้องรอตามเวลาจริงหากใช้ฐาน projectdb ไม่ปรับเวลาแถวจริง

ภาพบัตร รหัสผ่านและ token ไม่ต้องส่งในแชต ใช้หน้าระบบสำหรับข้อมูลดังกล่าว การทดสอบ OCR ภาพจริงและงานซ่อมกับผู้พัก APPROVED/ACTIVE ยังไม่เริ่มในรอบนี้ ไม่มีการรัน suite ซ้ำเพราะไม่มี source code เปลี่ยน; การตรวจ readiness ไม่ใช่ผล flow สำเร็จ

## ตำแหน่งตามแผนหลัก 6 ขั้น

| ขั้น | สถานะหลังรอบนี้ |
| --- | --- |
| 1. ตรรกะ | มีผลตรวจ state/ownership/quota/ย้ายออกมากขึ้น ยังต้องตรวจบริการภายนอกและข้อมูลกรณีอื่น |
| 2. UX/UI | ปรับบางส่วน ยังต้องตรวจรับทุกหน้า |
| 3. Loading/Empty/Error | ปรับบางส่วน ยังต้องตรวจแต่ละหน้า |
| 4. ทดสอบจริงและบันทึก | กำลังทำ; maintenance 9 และ visitor 10 integration tests ผ่าน พร้อมตรวจหน้าผู้มาติดต่อด้วย mock API 3 ขนาดจอ; flow บัตรจริงยังไม่ครบ |
| 5. เอกสาร 5 บท | มีร่างและเติมผลที่ยืนยันแล้ว ยังไม่ใช่เล่มสมบูรณ์ |
| 6. คำแนะนำค้นหา | ยังไม่เริ่มตามลำดับที่ตกลง |

## กรณีที่ยังไม่ครบและลำดับต่อไป

- [ ] บัญชีผู้พัก ACTIVE สร้างงานใหม่ครบ PENDING → APPROVED → IN_PROGRESS → RESOLVED → CLOSED ผ่าน API จริง
- [ ] โควตา 3 ครั้งต่อวันด้วย concurrent requests จริง; HTTP/PostgreSQL ในฐานแยกผ่าน 4 คำขอพร้อมกันแล้ว; ยังไม่รันบนระบบผ่าน Nginx/Redis กับบัญชีที่สมัครจริง
- [x] Guard ผู้พัก INACTIVE และ roomId คนอื่น: แก้ใน transaction แล้ว ผ่านทั้ง unit และ HTTP/PostgreSQL ฐานข้อมูลแยก; ยังต้องตรวจ UI ด้วยโปรไฟล์ทดสอบจริง
- [ ] ผู้มาติดต่อใช้ภาพบัตรจริง OCR → ลงทะเบียน → Admin ตรวจ → ยกเลิก/หมดอายุ 24 ชั่วโมง โดยไม่ bypass OCR
- [ ] เปลี่ยน ACTIVE → INACTIVE ด้วย API จริง; local รอบก่อนเริ่ม INACTIVE; ฐานแยกรอบนี้ทดสอบ ACTIVE → INACTIVE ผ่านแล้ว
- [ ] ลบโปรไฟล์ที่มีบิล PAID, ตรวจ block บิลค้าง/งานชำระค้าง และ shared payer โดยใช้ข้อมูลทดสอบตรงกรณี
- [ ] Cleanup ที่มีไฟล์จริงและ retry เมื่อ Face API ใช้งานไม่ได้
- [ ] Annual retention: มี unit tests แต่ไม่เปิดกวาดข้อมูล local อัตโนมัติ
- [ ] ตรวจ dependency vulnerabilities และ UI/Responsive หน้าที่เหลือก่อนรับรอง production
- [ ] เพิ่มคำแนะนำค้นหาหลัง flow หลักและการค้นหาเดิมยืนยันครบตามแผน

ไม่สร้างสถานะ PAID ปลอมเพื่อให้ผ่าน guard และไม่ใช้ผลทดสอบจำลองแทนการชำระเงินจริง การสร้างโปรไฟล์ทดสอบ ACTIVE ใหม่ต้องผ่านการสมัคร/ชำระที่ผู้ใช้รับผิดชอบ

เอกสารเล่ม: [บท 1 และสารบัญทั้ง 5 บท](../system/01-introduction.md) ข้อมูลรายงานนี้ไม่มี cookie/token/เลขบัตรประชาชนหรือภาพบัตร

หลังทดสอบ visitor query ยืนยัน users/rooms/visitors/visitorLogs/verifications/metadata ในฐานแยกเหลือ 0 ทั้งหมด Frontend timer patch ตรวจ build/lint ผ่าน ไม่ได้ทดสอบกล้องจริงหรือสั่งประตูจากการแก้ lint ครั้งนี้


## แก้ Skeleton ฝั่งผู้พักสองช่วง — 8 ต.ค. 2569

สาเหตุ: root Suspense แสดงข้อความ “กำลังโหลดหน้าจอ...” ก่อน lazy page โหลดสำเร็จ แล้วหน้าผู้พักใช้ Skeleton แบบทั่วไประหว่างรอ API จึงเห็นหน้าขาวก่อนและรูปร่างเปลี่ยนอีกครั้งเมื่อข้อมูลพร้อม

การแก้: หน้าหลักผู้พักโหลดโครงหน้าทันที; route fallback ของบิล แจ้งซ่อม เอกสาร สมัครเข้าพัก และลงทะเบียนใบหน้าแสดง Skeleton เฉพาะหน้า ผ่าน StudentPageSkeleton เดิมของฝั่งผู้พัก ส่วน API loading ของหน้าหลัก/บิล/แจ้งซ่อม/เอกสารใช้ StudentLoadingContent และ CSS container ของหน้าจริงร่วมกัน ปรับ gap ของสรุปบิลให้การ์ดรายการไม่ขยับด้านบนเมื่อข้อมูลพร้อม และหน้าเอกสารไม่แสดงสัญญาจริงซ้อนกับ Skeleton ระหว่างรอไฟล์แนบ ไม่มีการเปลี่ยน endpoint หรือ flow การชำระเงิน

ผลยืนยัน:

- Frontend build และ lint ผ่าน; unit tests 69/69 ผ่าน รวมการตรวจ containers ของการ์ดห้อง บิล งานซ่อม และกระดาษสัญญา ตลอดจน accessibility และการไม่มีปุ่มดำเนินการกับข้อมูลจำลอง
- Chrome headless ตรวจ 6 หน้า × 3 ความกว้าง (375/768/1440px) รวม 18 กรณี โดยหน่วง lazy chunk และพัก API responses: ไม่พบข้อความ loader ทั่วไปและ runtime exception ไม่เกิดการล้นแนวนอน
- หน้าหลัก/บิล/แจ้งซ่อม/เอกสารตรวจความกว้างและตำแหน่ง x/y ของ container ก่อนและหลังข้อมูลพร้อม คลาดเคลื่อนไม่เกิน 1px; บิล/แจ้งซ่อม/เอกสารตรวจว่า route Skeleton และ API Skeleton มีตำแหน่ง ขนาด และความสูงตรงกัน
- ตรวจภาพ Skeleton บิลบนจอ 375px: มีกรอบสรุป การ์ดบิล ไอคอน ข้อความ ช่องเลือก และบริเวณ pagination/action ตามโครงจริง ไม่ใช่เส้นเต็มจอสามเส้น
- ความสูงหลังแสดงข้อมูลจริงขึ้นกับข้อความ จำนวนรายการ และสัญญา: การ์ดทั่วไปต่างเล็กน้อยและกระดาษสัญญาขยายตามข้อความ ไม่อ้างว่าความสูงทั้งหมดเท่ากัน

การตรวจ UI ใช้ข้อมูลจำลองผ่าน browser interception เท่านั้น ไม่สร้างผู้พัก ACTIVE/PAID ใน projectdb ไม่ส่งบัตรจริงหรือชำระเงิน งาน OCR บัตรจริงและ flow ของ test01 หลังสมัคร/อนุมัติยังรอผู้ใช้ตามส่วนความพร้อมข้างต้น รายการตรวจนี้ไม่ได้ปิดงานทดสอบจริงดังกล่าว


## ปรับฟอร์มสมัคร: ขั้นตอนและอ่านบัตรอัตโนมัติ — 8 ต.ค. 2569

- แก้ Stepper ที่กำหนด 4 คอลัมน์ตายตัวเป็นจำนวนขั้นจริง ทั้ง 3 ช่องกว้างเท่ากันและอยู่เต็มความกว้างแถบ บนมือถือให้ข้อความตัดบรรทัดโดยไม่แยกขั้นไปคนละแถว
- ย้าย DocumentUpload โหมด identity เข้าใน PersonalInformationForm ใช้หัวข้อข้อมูลส่วนตัวและยืนยันตัวตนร่วมกัน เลือก JPG/PNG/WebP ที่ไม่เกิน 10 MB แล้วส่งบัตรที่เพิ่งเลือกไปยัง endpoint เดิมทันที ไม่รอ state อัปเดตและไม่ต้องกดตรวจบัตร
- คง synchronous lock, validation, abort และการละทิ้งผลหลังออกจากหน้า ไม่เริ่มตรวจสลิปอัตโนมัติ ปุ่มลองอ่านบัตรอีกครั้งแสดงเฉพาะเมื่ออ่านไม่สำเร็จ
- ทั้ง 3 ขั้นของหน้าสมัครใช้กรอบหลักชั้นเดียว เอาพื้นหลัง/เงา/padding ของ section ย่อยออก ปรับ Skeleton ขั้นแรกตามโครงใหม่ คงกรอบช่องอัปโหลดและกระดาษสัญญาที่มีหน้าที่จริง
- Frontend build/lint ผ่าน; unit tests 72/72 ผ่าน เพิ่ม regression เลือกไฟล์ใหม่เริ่ม OCR ทันทีแม้ prop เก่ายัง verified, กันคำขอซ้อน, ปฏิเสธไฟล์ผิด/เกินขนาด, locked/PAID ไม่ส่ง และ abort ไม่เติมข้อมูลจากคำตอบล่าช้า
- Chrome ทดสอบที่ 375/768/1440px ผ่าน: สามขั้นกว้างเท่ากัน บัตรอยู่ใน section ส่วนตัว OCR 1 คำขอต่อการเลือกและเติมช่องชื่อได้ ปุ่มถัดไป disabled ระหว่างอ่าน ผ่านไปขั้นผู้ติดต่อและขั้นห้อง/สลิปได้ ไม่มีกรอบซ้อนหรือล้นจอ และไม่มี runtime exception; ตรวจกรณี OCR 503 แล้วกด retry สำเร็จด้วย
- OCR ในการตรวจนี้เป็น browser fixture ไม่ส่งบัตรจริง ไม่ทำชำระเงินหรือสมัครจริง และไม่ยืนยันความแม่นยำ OCR ภายนอก ขอบเขตการเอากรอบซ้อนออกคือทุกขั้นของหน้าสมัครตามภาพ ไม่ได้เปลี่ยนกรอบทุกหน้าของระบบโดยไม่มีการตรวจรายหน้า


## ภาพบัตรและสถานะอ่านในกรอบเดียว — 9 ต.ค. 2569

ผู้ใช้ยืนยัน response 400 ของ POST /api/tenants/upload-documents เป็น Registered account phone number was not found ตรงกับ guard ใน TenantsService.verifyIdentity ก่อนเรียก OCR ไม่ใช่หลักฐานว่าภาพอ่านไม่ออก ผู้ใช้เลือกคงบัญชีไว้และจะเพิ่มเบอร์เอง จึงไม่แก้ข้อมูลบัญชีหรือถอด guard

ปรับ DocumentUpload ให้ภาพที่เลือกแสดงด้วย Blob URL และ object-fit: contain; รองรับลากไฟล์วางผ่าน validation/lock เดียวกัน; สถานะอ่านบัตรซ้อนอยู่ในกรอบภาพ ไม่มีแผงโหลดแยกด้านล่าง ปุ่มลองอ่านอีกครั้งสูง 36px ชิดขวาใต้ภาพ พร้อมข้อความ error ภาษาไทยเฉพาะกรณีบัญชีไม่มีเบอร์โทร เปลี่ยน transition ให้ animate เฉพาะสีเพื่อไม่ให้ padding/ขนาดภาพขยับขณะอ่าน คงการตรวจสลิปแบบกดส่ง

ผลตรวจ: Frontend build/lint ผ่านและ unit tests 73/73 ผ่าน รวมการคืน preview URL และคำอธิบาย phone 400; Chrome ที่ 375/768/1440px ตรวจลากภาพแสดงพรีวิว โหลดภายในภาพ กรอบไม่เปลี่ยนความสูงหลัง error ปุ่ม retry ไม่เกิน 200px สูง 36px และชิดขวา ไม่ล้นจอ จำลอง phone 400 → retry 200 → เติมข้อมูลได้ และคืน Blob URL เมื่อกลับหน้าหลัก ไม่มี runtime exception

ใช้ภาพกราฟิกและ API fixture ใน browser เท่านั้น ไม่ส่งภาพบัตรจริงหรือเปลี่ยนเบอร์ในฐานข้อมูล ข้อผิดพลาด 400 ของบัญชีจริงยังเกิดได้จนกว่าจะเพิ่มเบอร์โทรตามที่ผู้ใช้เลือก ไม่รายงานว่าทดสอบ OCR บัตรจริงผ่านแล้ว


## แยกการตรวจเบอร์ออกจาก identity OCR — 9 ต.ค. 2569

ตามคำสั่งเพิ่มเติมของผู้ใช้ แก้จากพฤติกรรมที่บันทึกก่อนหน้า: บัญชีที่ไม่มีเบอร์สามารถอ่านบัตรได้แล้ว TenantsService.verifyIdentity ตรวจว่ามีบัญชีแทนการบังคับ phone และยังตรวจรูป/ผล OCR/verification ownership เดิม registeredPhone คืน string ว่างได้โดยรักษา response shape Frontend ไม่ใช้เบอร์เป็นเงื่อนไขยอมรับ identity OCR และไม่ล้าง tenantPhone เดิมเมื่อ response ไม่มีเบอร์

ขั้น verifyHousingPayment และ submitApplication ยังต้องมีเบอร์บัญชี ไม่เปลี่ยนข้อมูลบัญชีหรือสร้างเบอร์แทนผู้ใช้ ไม่ย้าย engine OCR เข้ามาใน Backend

Backend build/test:typecheck/scoped ESLint ผ่าน และ unit tests 164/164 ผ่าน มี regression บัญชี phone=null อ่าน OCR ได้ แต่การชำระเงินยังตอบ 400 โดยไม่เรียก payment wrapper Frontend build/lint ผ่านและ unit tests 74/74 ผ่าน รวม identity response เบอร์ว่าง; browser fixture ที่ 375/768/1440px คืน registeredPhone ว่างแล้วเติมชื่อและไปขั้นผู้ติดต่อ/ห้องได้ ไม่ล้นจอและไม่มี runtime exception ใช้ mock OCR ไม่ทดสอบชำระเงินจริงหรือยืนยันความแม่นยำบัตรจริง


## พรีวิวพอดีภาพและแยกคำนำหน้าชื่อ — 9 ต.ค. 2569

ปรับกรอบบัตรเป็น fit-content ตามภาพ มี padding 8px จำกัดภาพสูง 280px และปรับตามความกว้างจอโดยไม่ตัดภาพ ข้อความ error ไม่ขยายความกว้างพรีวิว personalFromIdentity ตัดคำนำหน้าไทยก่อนแยกชื่อ/นามสกุล ทั้งแบบเว้นวรรคและติดกับชื่อ ไม่เปลี่ยน OCR ต้นฉบับ ใช้การเทียบชื่อเดิมที่จัดการคำนำหน้าได้อยู่แล้ว

เอาข้อความวันที่แสดงซ้ำใต้ date input ออก คง validation error เมื่อวันเกิดไม่ถูกต้อง เพิ่ม “กรุณาตรวจสอบข้อมูลทั้งหมดให้ถูกต้องก่อนกดขั้นตอนถัดไป” ใต้ส่วนภาพ

Frontend build/lint ผ่าน และ unit tests 75/75 ผ่าน รวม regression คำนำหน้าทั้งเต็ม/ย่อ/ติดชื่อ ไม่มีชื่อ และไม่มีคำนำหน้า Chrome ใช้กราฟิกจำลองทั้งแนวนอนและแนวตั้งที่ 375/768/1440px ผ่าน: กรอบกว้างกว่ารูปเฉพาะ padding/border ไม่เกิน 20px โหลดในภาพ retry ชิดขวา ไม่ล้นจอ และคืน Blob URL ตรวจ OCR fixture “นาย + ชื่อ + นามสกุล” เติมชื่อสองช่องถูกต้อง วันเกิดถูกต้องไม่มี small สีแดง และคำแนะนำแสดงอยู่ ไม่มี runtime exception ไม่ใช้หรือเก็บภาพบัตรจริงในการทดสอบนี้


## แยกหน้าสัญญาออกจากชำระเงิน — 9 ต.ค. 2569

เปลี่ยน flow สมัครจากสามขั้นเป็นสี่ขั้นตามคำสั่งล่าสุด: ยืนยันตัวตน/ข้อมูลส่วนตัว → ผู้ติดต่อ/ข้อมูลเข้าพัก → เลือกห้อง/ชำระเงิน → ตรวจสัญญา/ยอมรับ/ยื่นใบสมัคร ย้าย ContractReview และ consent ไปขั้นสุดท้าย หน้าชำระเงินไม่มีหนังสือสัญญาหรือปุ่มยื่นใบสมัคร ปุ่มตรวจสัญญา disabled จนมี verified payment และ hook ตรวจห้อง/เอกสาร/ชำระซ้ำก่อนข้ามขั้น

แยก validateStep สำหรับ consent ให้ตรวจเฉพาะขั้นสุดท้าย ส่วน handleSubmit ตรวจข้อมูลทุกขั้นก่อนส่ง ถ้าชำระหรือข้อมูลก่อนหน้าไม่ครบให้ย้อนกลับไปขั้นที่เกี่ยวข้อง ย้อนกลับจากสัญญายังคงผลชำระและล็อกห้อง/หลักฐานตามเดิม ปรับ route Skeleton และ active frontend spec ให้เป็นสี่ขั้น ไม่เปลี่ยน API หรือกลไกชำระเงิน Backend

Frontend build/lint ผ่านและ unit tests 76/76 ผ่าน เพิ่ม regression ไม่ผ่าน payment ข้ามไปสัญญาไม่ได้, payment ผ่านเข้าขั้นสัญญาได้โดยยังไม่ consent, ส่งก่อน consent ไม่ได้ และย้อนกลับไม่ล้าง payment Chrome 375/768/1440px ตรวจสี่ขั้นกว้างเท่ากัน ชำระและสัญญาอยู่คนละหน้า ปุ่มตรวจสัญญาเปิดหลัง API fixture PAID ปุ่มยื่นเปิดหลังยอมรับ ไม่มี runtime exception หรือล้นจอ การตรวจนี้ใช้ข้อมูล OCR/PAID จำลองผ่าน browser interception ไม่สร้างธุรกรรมหรือยื่นใบสมัครจริง


## 2026-10-09 — Admin dashboard / business reports / system analysis

- ปรับ Dashboard เป็นภาพรวมปฏิบัติงาน: สรุปผู้พัก ห้องรับเพิ่มได้ งานซ่อมยังไม่ปิด ยอดค้างชำระ งานที่ต้องจัดการ กราฟวงแหวนพร้อมรายละเอียดห้อง กราฟแท่งตามรอบบิล และประวัติแจ้งเตือนจริง
- เพิ่มเมนูรายงานธุรกิจ (/reports) สำหรับอัตราใช้ความจุและรายละเอียดรายอาคาร สรุปบิล และสถานะงานซ่อม ตัวกรองอาคารจำกัดการเข้าพัก ส่วนบิล/งานซ่อมระบุชัดว่ารวมทุกอาคาร
- วิเคราะห์ระบบ (/analysis) แสดง Backend/API metrics และ telemetry เดิม แยกจากข้อมูลธุรกิจ ไม่อ้างว่า Socket ต่อได้แปลว่าฐานข้อมูล/OCR/ผู้ให้บริการชำระเงินปกติทั้งหมด
- แก้สูตร: ห้องมีที่ว่างบางส่วนยังรับเพิ่มได้; ไม่รวมห้องซ่อมในความจุพร้อมใช้; RESOLVED ยังไม่ปิดจนเป็น CLOSED; อัตราชำระคิดตามยอดเงินและไม่รวมบิลยกเลิก ไม่มีบิลแสดงไม่มีข้อมูล
- กราฟแท่งแบ่งตามกำหนดชำระใน Asia/Bangkok พร้อมปี พ.ศ. เรียงเดือนจริงและแยกคนละปี ไม่ใช่วันที่รับเงินหรือกำไรสุทธิ ไม่ใช้วันสร้างบิลแทนวันที่กำหนดชำระที่หายไป
- กิจกรรมอ่าน PostgreSQL ผ่าน API notifications ที่มีอยู่ แสดง IN_APP สูงสุด 12 รายการจากข้อมูลล่าสุด 50 รายการ ตัด ID ซ้ำ ไม่แสดง payload ส่วนบุคคล ไม่สร้างรายการเข้าสู่ระบบจาก online status และไม่ถือ SENT เป็นปิดงาน
- Socket ใช้กระตุ้น HTTP refresh; debounce 200 ms, refresh หลัง reconnect และตรวจซ้ำทุก 30 วินาที พร้อม cleanup/abort เมื่อออกจากหน้า
- Frontend npm run build และ npm run lint ผ่าน; npm test ผ่าน 81/81 รวม regression 5 ข้อด้านห้อง บิล เดือน ประวัติกิจกรรม และ subscription cleanup
- Chrome browser fixture ผ่าน Dashboard/Reports ที่ 375, 768, 1440 px: กราฟแสดงจริง ไม่มี horizontal overflow ตัวกรองอาคารใช้งานได้ รวม empty/error ของกิจกรรม ไม่มี runtime exception
- ใช้ API interception สำหรับตรวจ UI ไม่ได้สร้างบัญชีผู้พัก ACTIVE หรือทดสอบชำระเงินจริง ผลนี้ไม่ใช่หลักฐาน OCR บัตรจริงหรือธุรกรรมชำระเงิน
- ข้อจำกัด: ประวัติกิจกรรมครอบคลุมเฉพาะเหตุการณ์ที่มี notification; ยังไม่ใช่ audit ของทุกกิจกรรม และยังไม่มี snapshot อัตราเข้าพักย้อนหลังสำหรับแนวโน้มรายเดือน


## 2026-10-09 — ยอดรับตอนสมัคร / รายห้อง / วันที่รับเงิน / งานเร่งด่วน

- เพิ่ม data.business ใน GET /api/analytics/dashboard เดิม คง verifyToken + ADMIN role และ response wrapper โดยไม่แก้ schema หรือ flow ตรวจชำระ
- ยอดมัดจำอ่าน Payment ที่ PAID, billId=null และผูก housingRoomId; บิล PAID นับยอดต่อใบครั้งเดียว ไม่รวม Payment เดี่ยว/รวมซ้ำในยอดบิล เงินยังเก็บความละเอียดสตางค์
- ยอดรับรวม = บิลชำระแล้ว + มัดจำรับแล้ว ไม่ใช่กำไรหรือมัดจำคงเหลือหลังคืนเงิน รายงานรวมบัญชีการเงินที่ยังเก็บหลังล้างข้อมูลส่วนบุคคล
- Dashboard เพิ่มมัดจำรับแล้ว ยอดรับรวม ยอดรับเดือนนี้ จำนวนผู้มาติดต่อ REGISTERED ที่ยังไม่หมดอายุ บิลเลยกำหนด และงานซ่อม RESOLVED รอยืนยันปิด
- Reports เพิ่มตารางรายห้องพร้อม Pagination เดิม แยกยอดบิล มัดจำ ยอดรับรวม ค้าง/รอตรวจ; bill.roomId=null แสดงไม่ผูกห้อง ไม่เดาห้องจากที่อยู่ปัจจุบันของผู้พัก ตัวกรองอาคารใช้กับตารางรายห้องด้วย
- เพิ่มกราฟยอดรับตามวันโอนเมื่อมีข้อมูลใน PAID Payment/PaymentBatch มิฉะนั้นใช้ bill.paidAt; มัดจำใช้ transferAt หรือ verifiedAt แยกจากกราฟตามเดือนกำหนดชำระเดิม
- ยอดไม่มีวันที่รับยังรวมยอดทั้งหมด แต่แยก undatedReceived และไม่ใส่เดือนปัจจุบัน/กราฟโดยเดา
- กิจกรรมเพิ่มสมัครเข้าพัก ย้ายออก บันทึกชำระบิล รับมัดจำ แจ้งซ่อมและซ่อมเสร็จจาก createdAt/checkOutDate/paidAt/resolvedAt ที่บันทึกจริง ใช้ username เมื่อมีข้อมูล; ไม่ใช้ updatedAt แทนวันอนุมัติ และไม่แสดงโปรไฟล์ ARCHIVED
- การโหลด business แยก error/retry เก็บยอดเดิมพร้อมคำเตือน ป้องกันผลคำขอเก่าทับใหม่ ยกเลิกคำขอและ subscription เมื่อออกจากหน้า; refresh ด้วย Socket/reconnect และ 30-second polling
- Backend build, test:typecheck และ ESLint ไฟล์ที่แก้ผ่าน; full regression 165/165 ผ่าน และ analytics 6/6 ผ่านซ้ำหลังเพิ่มวันโอนจาก PaymentBatch
- Frontend build/lint ผ่าน; full suite 83/83 ผ่าน ตรวจ Chrome ด้วย API fixtures ที่ 375/768/1440 px: ตารางและกราฟใหม่แสดง ไม่มี page overflow ไม่มี runtime exceptions รวม empty/error และตัวกรองอาคาร
- Rebuild backend Docker สำเร็จ; อ่าน business analytics กับ PostgreSQL จริงได้ (41 room rows, 1 receipt month, 4 activities) ยอดรับรายห้องตรงยอดรวมและทุกยอดเป็น finite number; health HTTP 200; analytics ที่ไม่ล็อกอิน HTTP 401
- ไม่สร้างบัญชี ACTIVE ไม่เพิ่มธุรกรรม ไม่ทดสอบโอนเงินจริงแทนผู้ใช้ การอ่าน DB ยืนยัน query/runtime เท่านั้น
- ข้อจำกัด: ไม่มีประวัติวันอนุมัติและทุกการเปลี่ยนสถานะครบถ้วน จึงไม่แสดง audit ที่เดาขึ้นมา; วันยืนยันชำระที่ใช้แทนวันโอนถูกระบุใน UI; ยังไม่มี ledger คืนมัดจำ รายจ่ายจริง และ occupancy snapshots ย้อนหลัง


## 2026-10-09 — ตรวจข้อมูลที่ดูตกค้างและประวัติแจ้งเตือน

- อ่านฐานข้อมูลจริงเฉพาะความสัมพันธ์/สถานะ: มัดจำ PAID 2 รายการมีบัญชีผู้ชำระอยู่ แต่ housingTenantId=null จึงยังไม่มีใบสมัคร; ไม่ใช่ผู้พัก ACTIVE และไม่ใช่บัญชีไร้เจ้าของ
- งานซ่อมที่เหลือ 1 รายการเป็น CLOSED ของ Tenant INACTIVE ที่ย้ายออกแล้ว ยังไม่ถูกลบโปรไฟล์; ไม่พบงานซ่อมผูก Tenant ARCHIVED (0 รายการ)
- ไม่ลบบัญชี ไม่ลบหรือแก้สถานะรายการรับเงินจริง ไม่สร้างใบสมัครแทนผู้ใช้
- business.housingPayments แยก AWAITING_APPLICATION / APPLICATION_LINKED / RETAINED_HISTORY / NEEDS_REVIEW พร้อม username ห้อง ยอด และเลขรายการ; urgent เพิ่ม paidAwaitingApplication และ housingPaymentsNeedReview
- Dashboard แสดงจ่ายแล้วรอส่งใบสมัคร; Reports มีตารางรายการมัดจำแบ่งหน้าร่วมเดิม ชี้แจงว่าจ่ายก่อนส่งใบสมัครได้และยังไม่ถือว่าจอง/เข้าพักสำเร็จ
- Maintenance เริ่ม OPEN (งานยังไม่ปิด รวม RESOLVED รอยืนยัน) เลือก ALL เพื่อดูประวัติปิด/ยกเลิกได้ รายห้อง OPEN ไม่พ่วงงานปิดแล้ว; ประวัติผู้แจ้ง INACTIVE ระบุย้ายออกแล้ว
- Backend maintenance list และ business repair activity ป้องกันโปรไฟล์ ARCHIVED กลับมาแสดง โดยยังเก็บประวัติที่ถูกต้องของ INACTIVE จนกว่าจะใช้ flow ลบโปรไฟล์จริง
- ประวัติแจ้งเตือนแสดงข้อความจริงที่บันทึก ช่อง SMS/EMAIL เวลา ประเภทงาน และสถานะส่งในหน้า Dashboard; เอาลิงก์ไป Analysis ออกจากส่วนประวัติ แยก SENT จากปิดงาน และปกปิดเลขบัตร/เบอร์โทร/email/token ในข้อความ
- แก้ข้อจำกัดเดิมที่กรอง IN_APP เท่านั้น: schema จริงมี SMS/EMAIL จึงต้องอ่านช่องที่มีอยู่ ไม่อนุมานว่าประวัติว่างเพราะไม่ใช่ IN_APP
- Backend build/typecheck/ESLint ผ่าน; regression 167/167 ผ่าน. Frontend build/lint ผ่าน; regression 85/85 ผ่าน
- Chrome fixtures ผ่าน Dashboard/Reports/Maintenance ที่ 375/768/1440 px รวมรายจ่ายรอสมัคร ข้อความแจ้งเตือนในหน้าเดิม และการสลับ OPEN/ALL เพื่อดูประวัติ ไม่มี runtime exceptions หรือ page overflow
- Rebuild Docker แล้ว อ่าน business จริงยืนยัน paidAwaitingApplication=2, paymentsNeedReview=0, archivedTenantRepairs=0, movedOutClosedHistory=1; Health HTTP 200
- การพบรายการรับเงินก่อนใบสมัครไม่พิสูจน์ว่าต้องลบหรือคืนเงินอัตโนมัติ รายการยังปรากฏให้ผู้ดูแลตรวจสอบและติดตามผู้ชำระได้ ส่วนการโอนเงินจริงยังเป็นงานทดสอบของผู้ใช้


### มัดจำเริ่มใหม่และนับหลัง Admin ยืนยัน (2026-10-09)

- ตามคำสั่งผู้ใช้ ล้าง Payment มัดจำเดิมทั้งหมด 6 รายการ (FAILED 4, PAID 2) และไฟล์สลิปที่ไม่มีรายการอื่นอ้างอิง 6 ไฟล์ ไม่ล้างฐานข้อมูลทั้งระบบ; ตรวจจำนวนบิลและบัญชีผู้ใช้ก่อน/หลังแล้วไม่เปลี่ยน
- ใช้ migration `20261009000000_housing_deposit_admin_approval` เพิ่ม Payment.housingApprovedAt; deploy แล้ว
- เมื่อ Admin อนุมัติใบสมัครเป็น APPROVED/ACTIVE บันทึกวันยืนยันบนมัดจำ PAID ที่ผูกใบสมัคร ภายใน transaction เดียวกัน และไม่เขียนทับวันเดิม
- ยอดรวม รายห้อง กราฟรายเดือน และกิจกรรมรับมัดจำ นับเฉพาะ PAID ที่มี housingApprovedAt; จ่ายสำเร็จแต่ยังไม่ส่งใบสมัคร/รอ Admin ยังแสดงในรายการติดตาม แต่ไม่รวมยอดรับ
- อ่านระบบ Docker หลัง rebuild: housingPayments=0, depositPaid=0, received=0 และรายการรอติดตามมัดจำ=0
- Backend build/typecheck และ regression 168/168 ผ่าน; ทดสอบ analytics/tenant approval หลังปรับ fixture ล่าสุด 15/15 ผ่าน; Frontend build/lint และ test 85/85 ผ่าน
- Chrome ตรวจ Dashboard/Reports/ประวัติซ่อมที่ 375/768/1440px ด้วย API fixture: 9 กรณีผ่าน ไม่มีหน้าล้นหรือ runtime exception; empty/error ผ่าน แยกมัดจำ Admin ยืนยัน/รอยืนยันชัดเจน
- การตรวจหน้าจอใช้ข้อมูลจำลอง ไม่ได้โอนเงินหรือสร้างผู้พัก ACTIVE จริง; OCR บัตรจริงและ flow บัญชี ACTIVE ยังเป็นงานทดสอบค้างตามเดิม


### ล้างข้อมูลการใช้งานทั้งหมดเพื่อเริ่มใหม่ (2026-10-09)

- ผู้ใช้ยืนยันเก็บ User อาคาร/ห้องพักและการตั้งค่าไว้ ล้างข้อมูลการใช้งานทั้งหมด โดยหยุด Backend ระหว่างงานเพื่อกันคำขอ/worker เขียนข้อมูลแทรก
- เก็บบัญชี 664 บัญชี ตรวจ hash ข้อมูลบัญชีรวมรหัสผ่าน/สิทธิ์/lastLogin ไม่เปลี่ยน (ยกเว้น faceRevokedAt/updatedAt สำหรับเจ้าของใบหน้าที่ถูกเพิกถอน); เก็บห้อง 41 ห้องและการตั้งค่าจริง 11 รายการครบ คืนสถานะห้องเป็น AVAILABLE
- ล้าง Tenant 2, MaintenanceTicket 1, IdCardVerification 99, Notification 202, NotificationAuditLog 344 และ AccessLog 37,422 รายการ; ตารางการใช้งานอื่นตรวจเป็นศูนย์แล้วทั้งหมด
- เพิกถอนใบหน้าด้วย FaceCleanupService/API เดิม: ล้าง photo metadata 5 รายการและ external templates 5 รายการ; ล้างประวัติ FaceLog ภายนอก 351 รายการ หลังยืนยัน template เป็นศูนย์ และ restart บริการเพื่อเคลียร์ memory cache
- สำรวจเส้นทางจริงใน /app/uploads และปฏิเสธ symlink/เส้นทางนอก root ก่อนล้าง: ไฟล์อัปโหลด 187 ไฟล์ถูกล้าง รวมไฟล์เก่าที่ไม่มี metadata โดยใช้คิวล้างไฟล์เดิมและตรวจ reference; เหลือไฟล์ข้อมูล 0 และ cleanup tasks 0
- ล้าง Redis DB ของโปรเจกต์ หลังเปิดระบบ presence/rate-limit หรือ log ใหม่อาจเกิดตามการใช้งานปกติ ไม่ใช่ข้อมูลเก่าตกค้าง
- ตรวจผ่าน service จริงใน Docker หลังเปิดระบบ: ผู้พัก ACTIVE/PENDING=0, งานซ่อม pending/inProgress/resolved=0, มัดจำ/บิล/ยอดค้าง=0, notifications=0, uploads=0; external face templates/logs=0; backend /health ตอบ 200
- งานนี้ล้างข้อมูลตามคำสั่งเฉพาะครั้ง ไม่เปลี่ยนโค้ด Schema การตั้งค่าหรือ Migration และไม่ลบบัญชี User; ผู้ใช้ต้องสมัคร/ลงทะเบียนใบหน้าใหม่เมื่อเริ่มทดสอบ flow


### แยกโหลดหน้าและโหลดคำสั่ง (2026-10-10)

- Frontend เพิ่ม ActionSpinner ร่วม (รองรับ reduced motion) และ loading prop ของ Button ฝั่งผู้พัก; หน้าเปิดใหม่/โหลดข้อมูลทั้งหน้าคงใช้ Skeleton ตามโครงเนื้อหา
- เติม Spinner/aria-busy ให้ปุ่มผู้พัก แจ้งซ่อม ผู้มาติดต่อ บิล จัดการบัญชี ตรวจ cleanup และส่งใบหน้าเดิม; Spinner แสดงเฉพาะคำสั่งสถานะที่กด ปุ่มอื่นยังถูกล็อกระหว่างรอ
- แก้ Loader2 ของตั้งค่า/สร้างบิลที่ใช้ animate-spin โดยไม่มี CSS รองรับ ให้ใช้ Spinner ร่วม; ปุ่มดูรายละเอียดบิลโหลดที่ปุ่มแทน overlay ทั้งจอ
- Refetch หลัง mutation และ Socket/poll ใช้ silent=true คงข้อมูลเดิม ไม่เปลี่ยนกลับเป็น Skeleton; การเปิดหน้า/สั่งโหลดใหม่ใช้ Skeleton ตามเดิม
- Logout รอ API สำเร็จก่อนล้าง auth/navigate ป้องกันคำขอซ้ำด้วย Promise; หากล้มเหลวแสดง error และให้ลองใหม่โดยคงหน้าปัจจุบัน
- Chrome/API fixture บนมือถือ: อนุมัติผู้พักแสดง Spinner และไม่มี Skeleton ระหว่าง PATCH และ GET หลังบันทึก, กดซ้ำไม่ส่ง PATCH ซ้ำ; logout failure คง session และ retry สำเร็จ; login แสดง Spinner ก่อนเปลี่ยนหน้า; runtime exceptions=0
- Regression browser Dashboard/Reports/Maintenance ที่ 375/768/1440px ผ่าน 9 กรณี ไม่มี overflow; empty/error ผ่าน
- Frontend build และ ESLint ผ่าน; regression tests 85/85 ผ่าน ปรับ test harness ให้โหลด ActionSpinner จริงและตรวจข้อความปุ่มแยกจากไอคอน
- ใช้ API จำลองสำหรับ browser checks ไม่สร้าง/อนุมัติข้อมูลจริงและไม่ทดสอบโอนเงินจริง; ไม่เปลี่ยนฐานข้อมูลหรือ API ในงานนี้


## 11 ต.ค. 2569 — QA และนโยบายลบที่ยืนยันล่าสุด

ส่วนนี้แทนข้อสรุปการเก็บ anonymous ledger/ARCHIVED ในผลทดสอบก่อนหน้า นโยบายใหม่ลบ Tenant บิล การชำระเงิน payment batches/items และ Transaction ของเจ้าของจริง เก็บ User หลัง DELETE ผู้พักไว้ พร้อมลบงานซ่อม ประวัติผู้มาติดต่อ เอกสาร OCR และข้อมูลส่วนบุคคลที่ผูกตาม flow เดิม ยอดที่ลบจะถูกนำออกจากรายงานย้อนหลัง ไม่สร้าง ARCHIVED ใหม่ คิวไฟล์และ owner-wide face cleanup ยังคงอยู่จนสำเร็จ

- 168 regression tests ผ่าน; HTTP/PostgreSQL/Redis แยก 24 tests ผ่าน
- ตรวจ paid bill/single payment/deposit/batch/items/transaction/OCR verification หายจาก DB พร้อมกัน และ User ยังอยู่; OCR list cache ถูกล้าง
- ตรวจ shared batch คืน 409 และไม่ลบบางส่วน; ตรวจ legacy anonymous ARCHIVED ลบได้ และ DELETE ซ้ำคืน 404
- ตรวจ closed repairs ลบพร้อมผู้พัก; active stay, unpaid bills, unfinished repairs ยังถูกป้องกัน
- Visitor ตรวจ consent/validation/OCR identity hash/idempotency/concurrency/expiry/cancellation; 12 รายการ throughput บันทึก Visitor และ REGISTERED logs ครบ
- แก้ CORS origin ไม่อนุญาตจาก 500 เป็น 403 และ general limiter ใช้ ApiResponse wrapper
- Backend build/typecheck/targeted lint และ frontend build/lint ผ่าน; Docker backend deploy แล้ว health 200 / anonymous tenants 401 / untrusted origin 403
- อ่านจำนวนฐานข้อมูลหลัก: User 664, Room 41; ข้อมูลการใช้งาน Tenant/Bill/Payment/PaymentBatch/PaymentBatchItem/Transaction/MaintenanceTicket/Visitor/VisitorLog/IdCardVerification/OcrJob/FaceEnrollmentPhoto/FaceEmbedding ทั้งหมด 0 ไม่ล้างข้อมูลใหม่ในรอบนี้
- รายงาน RPS/TPS/cache/memory และข้อจำกัด: [final_report.md](../../tests/load/logs/2026-10-11/final_report.md)

ยังไม่ได้ทดสอบ OCR บัตรจริง/ชำระเงินจริง/flow บัญชี ACTIVE เนื่องจาก test01 ยังไม่ได้สมัครใหม่; ไม่อ้างว่า 24 cases ครอบคลุมทุก endpoint หรือผ่าน security ทุกประเภท ต้องทำ sustained/soak test และตรวจ network exposure ก่อนสรุปพร้อม production


## 11 ต.ค. 2569 — ตรวจ flow ผู้พัก ACTIVE ต่อ

ผู้ใช้ยืนยันว่าทดสอบ OCR และ payment แล้วปกติ บันทึกเป็นผลทดสอบที่ผู้ใช้รายงาน ไม่ใช่การเรียก OCR/payment จริงโดย agent รอบนี้

ตรวจฐานข้อมูล Docker ที่ใช้งานอยู่แบบอ่านอย่างเดียว: test01@gmail.com มีบัญชี User แต่ไม่มี Tenant; จำนวน Tenant ที่ status ACTIVE และ isActive=true เป็น 0 จึงยังยืนยัน flow บัญชีจริงในสภาพแวดล้อมนี้ไม่ได้ รอระบุระบบ/บัญชีที่ใช้ทดสอบและการส่งใบสมัคร/อนุมัติผ่านระบบ ไม่สร้าง ACTIVE หรือ PAID จำลองในฐานข้อมูลหลัก

ระหว่างรอเพิ่มการทดสอบ HTTP/PostgreSQL/Redis ใน maintenance_flow_test:

| กรณี | ผล |
|---|---|
| PENDING แจ้งซ่อม | 403 |
| Student อนุมัติตนเอง | 403 |
| Admin PATCH เป็น ACTIVE | 200; GET tenants/me คืนผู้พักและห้องของตนเอง |
| มัดจำจำลองเมื่อ Admin อนุมัติ | housingApprovedAt ถูกบันทึก; อนุมัติซ้ำไม่เปลี่ยนเวลาครั้งแรก |
| ACTIVE แจ้งซ่อมห้องตนเอง | 201; ระบุห้องผู้อื่นคืน 403 |
| Student ดูรายละเอียดผู้พักอื่น / Admin ลบผู้พัก ACTIVE | 403 / 409 |
| Admin ออกบิลห้องผู้พัก ACTIVE | 201; rent 100 + electric 2 x 8 + water 100 = 216 บาทใน PostgreSQL |
| Student ออกบิล | 403 |
| รายการบิลของผู้พักสองบัญชี | ผู้พักเห็นเฉพาะบิลของตนเอง |
| ขอบัญชี QR บิลของผู้พักอื่น | 403 ก่อนเรียก payment provider |
| ย้ายออกเมื่อบิล UNPAID | 409; Tenant ยัง ACTIVE |

รวมชุด integration ที่รัน 26/26 ผ่าน TypeScript test:typecheck, targeted ESLint และ npm run build ผ่าน สิ่งนี้พิสูจน์ API กับฐานข้อมูลทดสอบ ไม่ครอบคลุมการกดหน้าจอจริง/กล้อง/Face API/ชำระจริงหรือการเชื่อมต่อ real-time ในบัญชีจริง การอนุมัติและมัดจำใน testDB เป็น fixture เท่านั้น

รายการที่ควรตรวจถัดไปจากโค้ด: generateRoomBills ยังไม่มีการตรวจซ้ำตามรอบเดือนใน service และตัวกรองผู้พักสำหรับออกบิลใน BillingRepository ใช้ isActive=true เพียงอย่างเดียว จึงต้องตรวจการออกบิลซ้ำ/ผู้พัก PENDING ในรอบแก้ตรรกะบิลต่อ โดยไม่สรุปว่าชำระเงินจริงมีข้อผิดพลาด


## 11 ต.ค. 2569 — สลิปถูกบล็อกเพราะเบอร์บัญชีว่างและปรับช่องอัปโหลด

ผู้ใช้พบ 400 Registered account phone number was not found ที่ขั้นอัปโหลดสลิป เหตุเกิดใน TenantsService.verifyHousingPayment ก่อนเรียก provider ตรวจสลิป ไม่ได้แปลว่าสลิปโอนใหม่ไม่ถูกต้อง

แก้ขั้นตรวจสลิปให้ต้องมี User จริงและบัตรที่ตรวจผ่านเป็นของ User นั้น แต่ไม่บังคับ User.phone; registeredPhone คืน empty string ได้ ยังคงตรวจบัญชีผู้รับ/จำนวนเงิน/ธุรกรรมและป้องกันใช้สลิปซ้ำตามเดิม Final submitApplication ยังต้องมีเบอร์บัญชี ไม่เติมเบอร์หรือแก้ข้อมูล User ให้เอง

Frontend เลือกหรือลากวางสลิปแล้วส่งตรวจทันที แสดงภาพขนาดพอดีพร้อม Spinner ภายในภาพ เอา loading panel และปุ่มตรวจขนาดใหญ่ออก วาง error และปุ่ม retry เล็กด้านล่าง ใช้ request lock ป้องกันส่งซ้ำ AbortController และ revokeObjectURL เมื่อออกจากหน้า ไม่ทับเบอร์ในสัญญาด้วยค่าว่างจากผลตรวจสลิป

ผลตรวจ: Backend regression 169/169, frontend 87/87; backend build/test:typecheck/targeted lint และ frontend build/lint ผ่าน สร้างและอัปเดต backend Docker หลังทดสอบ ไม่มีการโอนเงินจริงหรือส่งสลิปจริงโดย agent ในรอบนี้ ยังต้องให้ผู้ใช้ตรวจสลิปของตนอีกครั้ง


## 11 ต.ค. 2569 — กู้ใบสมัครและชำระส่วนต่างเมื่อเปลี่ยนห้อง

เพิ่ม HousingApplicationDraft ใน PostgreSQL และ Payment.housingDraftId โดย migration แบบเพิ่มข้อมูลโครงสร้าง ไม่ reset ฐานข้อมูลหลัก หน้าสมัครกู้ข้อมูลส่วนตัว ผู้ติดต่อ ห้อง สัญญาและขั้นตอน บันทึกอัตโนมัติหลังหยุดแก้ประมาณ 500 ms ยอด PAID คำนวณจากรายการของเจ้าของบัญชีบน server ไม่ใช้ยอดจาก browser; เงินที่โอนแล้วแต่ยังไม่ได้ตรวจสลิปผ่านต้องส่งสลิปเดิมตรวจ ไม่ถือว่า backend รู้ยอดจากธนาคารโดยอัตโนมัติ

การทดสอบ HTTP/PostgreSQL ใน maintenance_flow_test ใช้ข้อมูลและภาพจำลอง และ mock เฉพาะ payment provider; ไม่สร้าง PAID/ACTIVE จำลองในฐานข้อมูลหลัก:

- กู้ห้องและข้อมูลฟอร์มหลัง GET ใหม่; แยกเจ้าของฉบับร่าง; ไม่มี cookie ได้ 401; version เก่าได้ 409; ยอดที่ส่งจาก client ไม่มีผลต่อเครดิต
- ธนาคารรอยืนยัน: ปิด QR ใหม่และการเปลี่ยนห้อง แต่ใช้สลิปเดิมตรวจซ้ำหลัง cooldown ได้
- มัดจำเดิม 100 บาท เปลี่ยนห้องราคา 200 บาท: QR/สลิปเรียกเก็บเฉพาะ 100 บาท; เมื่อผ่านแล้วรวมยอดเป็น 200 บาท; transfer เดิมยังเก็บจำนวนและห้องต้นทางเดิม
- ส่งสลิปเพิ่มหลังครบแล้วได้ 409; เปลี่ยนเป็นห้องถูกกว่าแสดงส่วนเกินและไม่พร้อมยื่นใบสมัคร
- ส่งใบสมัครผูก PAID ทั้งสองรายการกับ Tenant เดียว; ส่งซ้ำคืน Tenant เดิม; Admin อนุมัติยืนยันทั้งสองยอด; ย้ายออกแล้วลบหมดทั้ง Payment/Draft/Tenant โดยเก็บ User
- Frontend จำลอง hook ทดสอบกู้ฟอร์ม/เครดิต การเปลี่ยนห้องโดยไม่เสียยอดเดิม การล็อกเปลี่ยนบัตรหลังชำระ และ retry หลังโหลดผิดพลาด

ผลตรวจ: backend regression 169/169, integration 28/28, frontend 89/89 ผ่าน; build ทั้งสองโปรเจกต์, test:typecheck และ ESLint ผ่าน ไม่มี package ใหม่หรือแก้ lockfile รอบนี้ ตรวจจริงผ่านหน้าจอพร้อมสลิปจริงและการคืนเงิน/ย้ายห้องหลัง Admin อนุมัติยังไม่อยู่ในผลทดสอบนี้ การบันทึกฟอร์มต้องรอ server สำเร็จ; ข้อมูลที่ปิดหน้าในช่วง debounce ยังอาจไม่ทันบันทึก แต่ PAID ที่ commit แล้วคงอยู่

นำ migration ฉบับร่างขึ้นฐานข้อมูลหลักและ deploy Docker backend สำเร็จ; health 200, ไม่ล็อกอิน GET draft ได้ 401, ตรวจพบตารางและ service ใหม่ใน runtime; frontend dist ล่าสุด build แล้วสำหรับ Nginx ไม่มีการรีเซ็ตฐานข้อมูลหรือทดสอบโอนเงินจริงรอบนี้


## 11 ต.ค. 2569 — OCR หน้าแรกถูกล็อกเมื่อกู้ยอดมัดจำเดิม

ตรวจสถานะฐานข้อมูลแบบอ่านอย่างเดียวพบ OPEN draft มี PAID ที่ยังไม่ผูก Tenant เงื่อนไข frontend ล็อกบัตรทั้งจาก verifiedPayment และ paidAmount จึงเลือก/ลากวางภาพไม่ได้ตั้งแต่เปิดหน้า แก้ให้ flow draft ตรวจบัตรซ้ำได้ และความผิดพลาดการบันทึก draft ไม่ล็อกการเลือกบัตรโดยไม่จำเป็น; ยังล็อกช่วง OCR ทำงานหรือมีการชำระรอตรวจสอบ พร้อมข้อความบอกเหตุผล

เพิ่ม POST /api/tenants/draft/upload-identity ใช้ OCR wrapper เดิม เมื่อผ่านแล้ว service ล็อก User ตรวจ draft OPEN/ไม่มีรายการรอตรวจ และเทียบข้อมูลบัตรกับ verification ที่ผูกกับ PAID เดิม ก่อนเปลี่ยน housingVerificationId ของรายการที่ยังไม่ถูกใช้ส่งใบสมัคร ไม่เปลี่ยนจำนวนเงิน สถานะ paid transaction หรือห้องของ transfer ถ้ามี citizenIdHash เดิมต้องตรงกัน; กรณีข้อมูลเก่าไม่มี hash ใช้ชื่อที่ normalize แล้วตามข้อกำหนด identity เดิม และห้ามชื่อว่าง/มีเครื่องหมายปกปิด รายการที่ส่งใบสมัครแล้วไม่ถูก rebind

ทดสอบ frontend เลือกไฟล์และลากวางเมื่อ PAID, immediate OCR และการคง draft credit; integration mock OCR ตรวจบัตร hash ไม่ตรงได้ 409 โดย PAID ยังผูกบัตรเดิม, บัตรเดิม hash ตรงได้ 200 และทั้งสอง transfer ยังคงยอดรวม 200 ส่งสมัคร/อนุมัติ/ย้ายออก/purge ต่อได้ Backend 169/169, integration 28/28, frontend 90/90 ผ่าน พร้อม build/typecheck/lint นำขึ้น Docker แล้ว health 200, identity recheck ไม่ล็อกอินได้ 401 ไม่มีการแก้ข้อมูลบัตรหรือยอดจริงในฐานข้อมูลหลัก และยังไม่ได้ใช้ภาพบัตรจริงเรียก OCR รอบนี้


## 11 ต.ค. 2569 — เบอร์บัญชีว่างเมื่อยืนยันใบสมัคร

400 Registered account phone number was not found มาจาก submitApplication ซึ่งยังต้องใช้ User.phone เป็นข้อมูลติดต่อและเบอร์ในสัญญา ไม่ได้มาจากตรวจ OCR หรือสลิป รอบนี้คงข้อมูลบัญชีตามคำสั่งผู้ใช้ก่อนหน้าที่ให้ผู้ใช้เพิ่มเบอร์เอง ไม่เติมหรือเดาเบอร์ และไม่ใช้เบอร์ผู้ติดต่อฉุกเฉินแทน

Draft summary เพิ่ม registeredPhone จาก User เท่านั้น Frontend แสดงช่องเบอร์บัญชีแบบอ่านอย่างเดียวและแจ้งตั้งแต่เปิดใบสมัครถ้าเบอร์ว่าง พร้อมปุ่มโหลดข้อมูลบัญชีใหม่หลัง Admin แก้เบอร์ Validate ขั้นตอนแรกก่อนส่งใบสมัคร และใช้เบอร์บัญชีล่าสุดในหน้าสัญญาโดยไม่ให้ข้อมูล draft เก่าทับเบอร์ Account Backend เปลี่ยนข้อความ 400 เป็นภาษาไทยพร้อมยืนยันว่ายอดเดิมยังอยู่ เงื่อนไขต้องมีเบอร์บัญชีไม่ถูกยกเลิก

ทดสอบในฐานข้อมูลแยก: หลังชำระรวม 200 แล้วล้างเบอร์ fixture การยืนยันได้ 400 ไม่มี Tenant และ PAID 2 รายการยังไม่ถูกใช้; เพิ่มเบอร์ fixture แล้ว GET draft โหลดเบอร์ใหม่ ส่งสมัครต่อได้ Frontend ทดสอบไม่ยิง submit เมื่อเบอร์ว่าง แจ้งที่ขั้นตอนแรก และกู้ยอดพร้อมเบอร์ใหม่ได้ Backend 169/169, integration 28/28, frontend 91/91 ผ่าน build/typecheck/lint ผ่าน Deploy Docker backend และ frontend dist แล้ว ผู้ใช้จริงยังต้องให้ Admin เพิ่มเบอร์ในบัญชี จากนั้นโหลดข้อมูลบัญชีใหม่ ไม่มีการแก้ User.phone หรือยอดการเงินจริงโดย agent รอบนี้


## 11 ต.ค. 2569 — เพิ่มช่องเบอร์โทรในจัดการบัญชี

ตรวจพบว่า AdminPanel ไม่มีช่องเบอร์โทร และ UsersService ไม่ส่ง phone ไปบันทึก ถึงแม้ User.phone มีใน schema แล้ว เพิ่มช่องเบอร์โทรใน modal แก้ไขและรายละเอียดบัญชี พร้อม map phone ใน context ใช้ API เดิมที่อนุญาต Admin เท่านั้น ตรวจรูปแบบและ normalize ช่องว่าง/ขีดก่อนบันทึก กรณีเบอร์ซ้ำคืน 409 แสดงข้อความใน modal ปุ่มบันทึกใช้ spinner และ lock กันส่งซ้ำ ไม่แก้เบอร์ของบัญชีจริงแทนผู้ใช้

แก้ select ของ UsersRepository ให้คืน phone และ role เพื่อไม่ให้ UI แสดงหรือส่งบทบาทผิดระหว่างแก้ไข พร้อมไม่คืน password hash ในผล update Integration ทดสอบผ่าน HTTP/PostgreSQL ฐานข้อมูลแยก: ไม่ล็อกอิน 401, Student 403, เบอร์ผิดชนิด/รูปแบบ 400, เบอร์มีขีด normalize ถูกต้อง, เบอร์ซ้ำ 409 โดยบัญชีอื่นไม่เปลี่ยน, DB/list/draft แสดงเบอร์ใหม่ และยังเป็น STUDENT ไม่ส่ง password Backend 169/169, integration 29/29, frontend 91/91 ผ่าน พร้อม build/typecheck/lint เฉพาะไฟล์ที่แก้

วิธีใช้งาน: Admin → จัดการบัญชีผู้ใช้ → แก้ไข → เบอร์โทรศัพท์ → บันทึกข้อมูล จากนั้นผู้สมัครกดโหลดข้อมูลบัญชีใหม่ในใบสมัคร ไม่ต้องสร้างบัญชีใหม่หรือชำระซ้ำ

Deploy Docker backend สำเร็จ ตรวจโค้ด validatePhone ใน container แล้ว Gateway :3002 health 200, PATCH users ไม่ล็อกอิน 401 และ frontend เสิร์ฟ bundle ใหม่ 200 ไม่ได้แก้เบอร์โทรหรือยอดชำระในฐานข้อมูลหลัก


## 11 ต.ค. 2569 — flow บัญชีที่อนุมัติแล้วในระบบจริง

ผู้ใช้ยืนยันว่าเข้าพักสำเร็จและส่ง session ของ Student/Admin สำหรับทดสอบ ใช้บัญชี test01 เดิม (User 25, Tenant 66, ห้อง 201) เท่านั้น ไม่เก็บ token ในรายงาน จากฐานข้อมูลพบสถานะ APPROVED และ isActive=true ซึ่งเป็นสถานะผู้พักที่มีสิทธิ์ตามโค้ดจริง ไม่เปลี่ยนให้เป็น ACTIVE เพียงเพื่อให้ชื่อสถานะตรงข้อความ การชำระเข้าพักเดิมเป็น PAID และมี housingApprovedAt จาก Admin

### ผล API ที่ใช้งานจริง

| กรณี | ผล |
| --- | --- |
| Student เปิด tenants/me, maintenance, billing | 200; ผู้พักและห้องของตนเองถูกต้อง |
| Student เปิด tenants รวม, visitor รวม, users | 403 |
| เปิดเอกสาร id-card และ payment-slip ของตนเอง | 200, image/jpeg ทั้งสองรายการ ไม่บันทึกภาพในรายงาน |
| แจ้งซ่อมระบุห้องอื่น / description สั้น | 403 / 400; ไม่สร้างงาน |
| แจ้งซ่อมห้องตนเอง | 201, งาน 247 และ Notification ถูกบันทึกใน PostgreSQL |
| Student เปลี่ยนสถานะ/ลบงาน | 403 |
| Admin ปิดงาน | APPROVED → IN_PROGRESS → RESOLVED → CLOSED ได้ 200 |
| ยกเลิกหลัง RESOLVED / ลบหลัง CLOSED | 409 |
| ลบผู้พักก่อนย้ายออก | 409 |
| Admin ออกบิลทดสอบ / Student ดูบิล | 201 / 200; ใช้ค่าเช่าห้องจริงและตั้งรอบ QA ชัดเจน |
| บิล UNPAID ป้องกันย้ายออก | 409; ยังพักอยู่ |
| Student เปลี่ยนบิลเป็น PAID | 403; ไม่แก้สถานะ PAID จำลองในฐานข้อมูลหลัก |
| QR สำหรับบิลตนเอง | 200, image/png; ตรวจ PNG signature ไม่ได้โอนเงินจริงเพิ่ม |
| ลบบิลทดสอบ UNPAID | 200; บิล 57 หายจาก PostgreSQL ก่อนย้ายออก |
| ผู้มาติดต่อส่งข้อมูลว่าง | 400; ไม่สร้างผู้มาติดต่อหรือใช้บัตรผู้พักแทนบุคคลอื่น |
| Admin ย้ายออก / เปิดการเข้าพักเดิมอีก | 200 / 409 |
| แจ้งซ่อมหลังย้ายออก | 403 |
| Admin ลบโปรไฟล์หลังปิดงาน | 202, commit ลบแล้ว รอ cleanup worker |
| cleanup worker ทำงานเอง | ทั้ง 8 tasks COMPLETE; ไม่สั่งลบข้าม guard ด้วย SQL |
| Student หลังลบโปรไฟล์ | tenants/me 200 data null; session บัญชีเดิมยังใช้ได้ |
| WebSocket anonymous / session Student | rejected / connected; disconnect หลังตรวจ |

QR เป็น binary response ตามสัญญาของ endpoint จึงไม่อ่านเป็น JSON wrapper สคริปต์ QA รอบแรกหยุดเพราะพยายาม parse PNG เป็น JSON แก้ขั้นตรวจให้ตรวจ Content-Type/PNG signature แล้วลบบิลทดสอบต่อสำเร็จ ไม่ใช่บั๊กใน QR endpoint

### การลบถึงฐานข้อมูลและไฟล์

ก่อนลบติดตามไฟล์ของบัญชีนี้ 7 เส้นทาง พบไฟล์จริงทั้ง 7 ใน volume หลัง cleanup worker ทำงานพบ 0 เส้นทางที่ยังมีไฟล์อยู่ ไม่เปิดหรือพิมพ์ข้อมูลบัตร/สลิป ตัวเลขนี้ครอบคลุมไฟล์ที่อ้างอิงก่อนลบ ไม่ใช่การยืนยันทุกไฟล์ที่เคยอัปโหลดโดยไม่มีร่องรอยอ้างอิง

หลังลบ Tenant, Bill, MaintenanceTicket, Visitor, Payment, PaymentBatch, Transaction, IdCardVerification, OcrJob, HousingApplicationDraft, FaceEnrollmentPhoto, FaceEmbedding และ Notification ของเจ้าของนี้เป็น 0 ทั้งหมด AccessLog ที่ติดตามก่อนลบเหลือ 0; การเรียก API/Socket ครั้งใหม่อาจมี log ใหม่ตามปกติ บัญชี User 25 ยังอยู่และ fingerprint ของ email/username/phone/password/role ตรงก่อนลบ ห้องเดิมยังอยู่และเป็น AVAILABLE งาน cleanup ที่ DONE เก็บเป็นหลักฐานปฏิบัติการ ไม่มีข้อมูลบัตรในรายงาน

ไม่มี face photo/embedding ของบัญชีนี้ก่อนทดสอบ จึงไม่อ้างว่ารอบนี้พิสูจน์การลบภาพใบหน้าจริงครบทุกชนิด การลบ owner ภายนอกได้รับการยืนยันตาม receipt แล้ว

Dashboard หลังลบ: totalActive/pendingApplications, unpaidCount/paidCount, totalPaidAmount/totalUnpaidAmount, maintenance pending/inProgress/resolved, billPaid/depositPaid และ paidAwaitingApplication/paidAwaitingAdminApproval เป็น 0 ไม่มีตัวเลขจากผู้พักที่ลบตกค้าง

### บั๊กที่แก้ระหว่างตรวจ

1. scheduleNotification ใช้ nested user/tenant connect แต่ schema Notification เก็บ scalar userId/tenantId ทำให้ Prisma ปฏิเสธและประวัติไม่ถูกเก็บ แก้ payload ให้ตรง schema เดิม ไม่เปลี่ยน schema
2. ประวัติผู้พักกรองเฉพาะ userId จึงไม่แสดงรายการที่ผูก tenantId เพิ่มการกรอง OR เฉพาะ User และ Tenant ของผู้เรียก รวมทั้งผูก userId ในรายการใหม่ ไม่มีสิทธิ์อ่านเจ้าของอื่น
3. Endpoint ส่ง/สร้าง notification และ dead-letter/audit เดิมมีเพียง JWT เพิ่ม ADMIN guard; GET ประวัติของผู้พักยังใช้ได้ตามเจ้าของ Provider webhook ยังเป็นคนละเส้นทาง ไม่ได้ยืนยัน signature provider ในรอบนี้

Integration แยกเพิ่มการตรวจ Notification ถาวร, การมองเห็นตามเจ้าของ และ Student/anonymous ถูกปฏิเสธที่ endpoint จัดการ ผ่าน 30/30; backend regression 169/169, build/test:typecheck และ lint เฉพาะไฟล์ที่แก้ผ่าน Deploy Docker ล่าสุดแล้ว health 200; ตรวจ Student audit/dead-letters 403 และ Admin audit 200 จริง

### ขอบเขตที่ยังต้องทำต่อ

รอบนี้เป็น flow ผ่าน API จริงและอ่านยืนยันฐานข้อมูล/ไฟล์ ไม่ใช่การกดทุกหน้าจอ Visitor ครบวงจรและบิลชำระจริงใช้ fixture/provider mock ใน integration เท่านั้น การใช้บัตรผู้มาติดต่อจริง เปิดประตูจริง และการจ่ายบิลรายเดือนผ่านธนาคารยังไม่ถูกรันทดสอบรอบนี้ ไม่สรุปว่าครอบคลุมทุก endpoint/security ทุกประเภท หรือเป็น sustained load

ประเด็นออกบิลซ้ำตามรอบเดือน/การปัดเศษหารหลายคนที่ระบุไว้ก่อนหน้ายังต้องแก้และทดสอบเฉพาะเรื่อง ก่อนสรุปพร้อมใช้งานจริง หลังจบการทดสอบลบ test01 เหลือบัญชี User ตามคำสั่งผู้ใช้ หากทดสอบการเข้าพักรอบใหม่ต้องยื่นใบสมัครใหม่ตาม flow ปกติ ไม่สร้าง ACTIVE หรือยอด PAID แทนผู้ใช้


## 11 ต.ค. 2569 — แก้ออกบิลซ้ำและเศษสตางค์

ประเด็นออกบิลซ้ำ/ปัดเศษที่ค้างจาก flow ACTIVE แก้แล้ว เพิ่ม Bill.billingPeriod แบบ nullable และ migration 20261011010000_bill_billing_period พร้อม unique tenantId/roomId/billingPeriod และตรวจรูปแบบ YYYY-MM ไม่ reset หรือแก้ยอดบิลเก่า Main DB ก่อน/หลัง migration: User 664, Room 41, Bill 0 เท่าเดิม

Service normalize เดือนภาษาไทย/พ.ศ./ค.ศ./เลขไทย และ Gregorian YYYY-MM ให้เป็นรอบเดียวกัน ใช้เดือนปัจจุบันตาม Asia/Bangkok เมื่อไม่ได้ส่งมา ออกบิลใน transaction ล็อก User → Tenant → Room แล้วอ่านผู้พักที่ APPROVED/ACTIVE และ isActive=true ซ้ำก่อนคำนวณ หากมีบิลห้อง/เดือนเดิมคืน 409 แม้เปลี่ยนยอดหรือวันครบกำหนด หากข้อมูลบิลเก่าไม่ระบุรอบให้ตรวจสอบก่อน ไม่เดารอบจาก createdAt และไม่ลบทิ้ง

คำนวณแต่ละหมวดเป็นจำนวนเต็มสตางค์แล้วกระจายเศษวนตาม Tenant ID ที่เรียงไว้ ทำให้ผลรวมค่าเช่า ค่าไฟ ค่าน้ำ ตรงทุกหมวด และยอดบิลแต่ละคนต่างไม่เกิน 1 สตางค์ Frontend นับผู้พักตามเงื่อนไขเดียวกัน แสดงช่วงยอดต่อคนเมื่อมีเศษ และแจ้งว่ายอดรวมถูกปรับให้ตรง ไม่แสดงทุกคนต้องจ่ายเท่ากันเมื่อยอดจริงต่างกัน

### ผลทดสอบ PostgreSQL/HTTP แยก

- ส่งพร้อมกัน 4 requests ด้วย 2026-11, พฤศจิกายน 2569, พฤศจิกายน 2026 และ พฤศจิกายน ๒๕๖๙: 201 เพียงครั้งเดียว อีก 3 ครั้ง 409 มีบิล 3 ใบให้ผู้พัก 3 คน ผู้พัก PENDING ไม่ถูกนับ
- ค่าเช่า 100.01 + ค่าไฟ 0.01 หน่วย x 8 = 0.08 + ค่าน้ำ 0.01 รวม 100.10 บาท ผลรวม rentAmount=100.01, electricAmount=0.08, waterAmount=0.01, amount=100.10 ทุกใบมี amount เท่ากับผลรวมหมวดของตน ยอดสูงสุด-ต่ำสุดไม่เกิน 0.01 บาท
- เปลี่ยนยอดแต่เดือนเดิมยัง 409 จำนวนบิลไม่เพิ่ม; เดือนถัดไป 201; bypass service ด้วย Prisma เจอ P2002 จาก unique constraint
- null/object/boolean/empty/nonfinite/negative ตัวเลข เดือน 00/13 หรือข้อความรอบไม่ถูกต้อง และวันครบกำหนดผิด คืน 400 ไม่มีบิลถูกสร้าง
- ห้องที่มีแต่ผู้พัก PENDING คืน 400; บิลเก่า PAID ที่รอบว่างคืน 409 และคงยอด/สถานะ/บิลเดิม
- ออกบิลแข่งกับย้ายออก: หากบิลชนะ ย้ายออก 409 และผู้พักยังอยู่; หากย้ายออกชนะ ไม่มีบิลใหม่ ผู้พัก INACTIVE และ roomId null ไม่เกิดหนี้ให้ผู้ย้ายออกสำเร็จ

Integration 34/34, backend regression 169/169, frontend regression 91/91 ผ่าน พร้อม backend/frontend build, test:typecheck, Prisma validate, lint เฉพาะไฟล์ที่แก้ และ diff check นำ migration และ Docker backend ขึ้นแล้ว Gateway health 200; ไม่ล็อกอินออกบิล 401, Admin เดือนผิด 400, ห้อง 201 ไม่มีผู้พักที่อนุมัติแล้ว 400 ไม่สร้างบิล Main DB ไม่เพิ่ม PAID/ACTIVE หรือทำการโอนเงินทดสอบ Frontend เสิร์ฟ bundle ใหม่ 200

ขอบเขต: กรณีออกบิลพร้อมกันและหารหลายคนใช้ผู้พัก/บิล fixture ใน maintenance_flow_test ไม่สร้างข้อมูลปลอมใน projectdb การจ่ายบิลรายเดือนผ่านธนาคาร ผู้มาติดต่อด้วยบัตรจริง และการกดทุกหน้าเว็บยังเป็นการทดสอบแยก ไม่อ้างว่า security/sustained load ครบระบบจากผลนี้


## 12 ต.ค. 2569 — หัวข้อกิจกรรม Dashboard

ตรวจ source Dashboard ล่าสุดไม่พบหัวข้อ/ข้อความอธิบายประวัติแจ้งเตือนซ้ำในภาพแล้ว คงหัวข้อกิจกรรมและความเคลื่อนไหวล่าสุดเพียงหัวข้อเดียว เพิ่ม aria-labelledby ให้ region และปรับสถานะเป็นอัปเดตสด/รอเชื่อมต่อเรียลไทม์ พร้อม empty state สั้น ไม่ลบข้อมูลแจ้งเตือนจาก DB และไม่เปลี่ยนการรับ realtime Build และ lint ไฟล์ที่แก้ผ่าน ตรวจ bundle มีหัวข้อกิจกรรมครั้งเดียว ไม่มีประวัติแจ้งเตือนซ้ำ Gateway เสิร์ฟ bundle ล่าสุด 200 รอบนี้ยังไม่ได้เปลี่ยนราคาห้อง/ตั้งค่า หรือเพิ่มกราฟการเข้าออก เพราะผู้ใช้กำลังขอคำแนะนำการออกแบบส่วนเหล่านั้น

## 12 ต.ค. 2569 — ราคาห้อง ตั้งค่า และ Dashboard

- เพิ่มแก้ค่าเช่าในรายละเอียดห้องผ่าน PATCH /api/rooms/:id เดิม (Admin เท่านั้น) ใช้ Spinner และ ref lock กันส่งซ้ำ โหลดห้องใหม่แบบ silent หลังบันทึก หากโหลดซ้ำล้มเหลวแจ้งว่าบันทึกแล้ว ไม่ส่ง mutation ซ้ำ
- ตรวจราคาเป็นค่าบวก ทศนิยมไม่เกิน 2 ตำแหน่ง และขอบเขต Decimal(10,2) ล็อก Room ใน transaction ปฏิเสธ 409 หากมี Tenant ที่ไม่ใช่ ARCHIVED, OPEN draft หรือรายการชำระที่เกี่ยวข้อง ยังไม่รองรับเปลี่ยนราคาในห้องที่มีผู้พักด้วยวันมีผลในอนาคต ไม่เปลี่ยนสัญญา บิล หรือยอดที่จ่ายแล้ว เพิ่ม Room lock ที่เลือกห้องใน draft และ claim สลิปเพื่อ serialize กับการแก้ราคา
- ตั้งค่าแบ่งการศึกษา/การเข้าพัก ความปลอดภัย และทางไปจัดการราคา/รายงาน เปิดแก้ maxOccupants และ sessionTimeoutMinutes ซึ่งมี reader จริง ส่งเฉพาะค่าที่แสดง ไม่เปิด toggle 2FA/notification ที่ยังไม่ได้เชื่อม ไม่เปลี่ยนค่าในฐานใช้งานจริง เวลาเช็คอิน/เช็คเอาท์เป็นเวลาอ้างอิง ไม่ใช่สิทธิ์ผ่านประตู ตรวจชนิดข้อมูล เวลา HH:mm และข้อความว่างก่อนเขียน
- เอาแท็บรายงานซ้ำใน AdminPanel ออก ใช้ลิงก์ไป Reports เดิม ลดแถวสรุปการเงิน Dashboard ที่ซ้ำ รายงานธุรกิจยังแยกจากวิเคราะห์ระบบ ไม่มีเพิ่มการส่งออกหรือประวัติอัตราเข้าพักที่ระบบยังไม่ได้เก็บ
- เพิ่มกราฟสแกนเข้า–ออกผู้พักข้างกราฟบิล เลือก 7/30 วัน ใช้ PostgreSQL FACE_GATE IN/OUT ของ STUDENT เท่านั้น รวมวันตาม Asia/Bangkok และเติมวันที่ไม่มีรายการเป็นศูนย์ นับครั้งไม่ใช่คน ไม่รับรองประตูจริงเปิดแล้ว ไม่รวม Visitor/Admin/heartbeat/denied ใช้ faceGateActivity เดิมและ polling 30 วินาที พร้อม cleanup ไม่แก้ Face engine หรือ flow
- ตรวจ Backend unit/regression 171/171, Frontend 92/92, PostgreSQL integration ฐาน maintenance_flow_test 37/37 ผ่าน Build ทั้งสองฝั่ง TypeScript และ lint ไฟล์ที่แก้ผ่าน รวมตรวจ PostgreSQL ก่อน/หลังเที่ยงคืนไทย สิทธิ์แก้ราคา ห้องมีผู้พัก/ฉบับร่าง และ validation ตั้งค่า
- bounded visitor regression ใน integration เก็บผลตามวันที่ปัจจุบันที่ tests/load/logs/2026-10-12/ มี stats.csv, run.log, final_report.md เป็นการตรวจ 12 synthetic requests concurrency 4 ไม่ใช่ผล sustained capacity
- Build/recreate เฉพาะ backend container เสร็จ Gateway 3002 เสิร์ฟ frontend bundle ล่าสุด 200, /api/health 200, analytics ไม่ล็อกอิน 401 และ response wrapper ตรง HTTP ตรวจ main DB แบบอ่านอย่างเดียว: User 664, Room 41, Tenant 0, Bill 0; กราฟมี 30 วันและวันล่าสุดเป็นศูนย์ ไม่สร้างข้อมูลผู้พัก/ชำระจริง ไม่เพิ่ม package หรือ migration รอบนี้ ยังไม่ได้ยืนยันภาพด้วย browser ที่ขนาด 375/768/1440px

### 12 ต.ค. 2569 — จัดกรอบ Dashboard ให้พอดีเนื้อหา

ย้ายตัวเลือกประวัติสแกน 7/30 วันเข้า headerActions ของกราฟสแกนเข้า–ออก ใช้ compact ของ ChartCard เฉพาะ Dashboard ไม่เปลี่ยนขนาดกราฟเดิมใน Reports ย้ายข้อความประกอบเข้า footer ของกล่องกราฟเพื่อให้กราฟคู่เริ่มจากแนวเดียวกัน ลดความสูงกราฟเหลือ 260px พร้อมหัวข้อที่ห่อบรรทัดได้ แก้ overview grid ให้ align start และ card height auto เพื่อไม่ยืดกล่องการเงินตามกล่องห้องพัก จัด donut 200px กับรายละเอียดข้างกันบนจอกว้างและเรียงลงบนจอเล็ก ลดช่องว่างและใช้ลิงก์สีเดียวกัน ตรวจ Frontend build/lint ผ่าน tests 92/92 และ Gateway 3002 เสิร์ฟ bundle ล่าสุด 200 ไม่เปลี่ยน API ข้อมูลหรือการคำนวณ ยังไม่ได้ตรวจภาพจริงผ่าน browser ที่ viewport 375/768/1440px

### 12 ต.ค. 2569 — ระยะระหว่างส่วนข้อมูล Admin

ปรับ gap ของ page และ grid กลุ่มข้อมูลใน Dashboard/Reports, ห้องพัก, ผู้พัก, ผู้มาติดต่อ, แจ้งซ่อม, บิล, สัญญา, วิเคราะห์ระบบ, Monitor และตั้งค่าให้ใช้ --space-2 (12px) และระยะ toolbar ถึงตาราง/การ์ดรายห้องใน ManagementHistory เป็น 12px ไม่แก้ padding แถวตาราง ปุ่ม หรือเอกสาร ไม่แก้ token ระยะทั้งระบบ Frontend Build ผ่าน และ regression 92/92 ผ่าน ไม่เปลี่ยน API หรือข้อมูล

### 12 ต.ค. 2569 — ช่องว่างจากการรอความสูง grid

ภาพล่าสุดยังมีช่องว่างใต้การเงิน เพราะ overview และกราฟเป็น grid คนละแถว แม้ gap 12px แถวกราฟยังรอห้องพักที่สูงกว่า แก้ Dashboard เป็นสองคอลัมน์อิสระ: ห้องพักแล้วกราฟบิลทางซ้าย การเงินแล้วกราฟเข้า–ออกทางขวา ใช้ gap 12px และไม่ยืด article บนมือถือเรียงคอลัมน์เป็นชุดข้อมูลตามลำดับ DOM ไม่ใช้ CSS order ย้าย focus ไม่เปลี่ยน Reports หรือ API Build/lint ผ่าน และ frontend regression 92/92 ผ่าน ยังไม่ได้ยืนยันภาพจริงผ่าน browser

### Dashboard: ขยายกราฟสแกนเต็มความสูงคอลัมน์ (12 ต.ค. 2569)
- ให้คอลัมน์ภาพรวมห้องพักและการเงินสูงเท่ากัน แล้วขยายการ์ดสแกนรับพื้นที่ที่เหลือด้านขวา เพื่อให้ขอบล่างเสมอกับกราฟบิล
- พื้นที่กราฟสแกนขยายตามการ์ดด้วย โดยคงความสูงขั้นต่ำ 260px; จอแคบยังเรียงเป็นคอลัมน์เดียวตามเดิม
- ตรวจ ESLint เฉพาะ TSX ที่แก้และ frontend build ผ่าน; ยังไม่ได้ยืนยันภาพในเบราว์เซอร์จริง

## ตรวจ flow ผู้มาติดต่อจนถึง endpoint (12 ต.ค. 2569)

ขอบเขต: ตรวจหน้าลงทะเบียน/Admin จาก source และรัน HTTP/Express + PostgreSQL ฐาน maintenance_flow_test + Redis local ไม่กด UI ในเบราว์เซอร์ ไม่ใช้บัตรจริง และไม่เปิดประตูจริง การทดสอบ /api/ocr/identity-card ใช้ mock เฉพาะ OcrService.verifyIdCard แล้วส่งผลที่ตรง fixture ไป /api/visitor/register; จึงยืนยันรอยต่อ multipart/API แต่ไม่ยืนยันความแม่นยำหรือ availability ของ OCR ภายนอก

| ขั้นตอน | Endpoint/ส่วนที่เกี่ยวข้อง | ผลและขอบเขต |
|---|---|---|
| ยินยอมและวางภาพ | VisitorRegistrationPage; POST /api/ocr/identity-card | UI ตรวจ consent/JPG-PNG-WebP/5MB อ่านทันที มี abort และ revokeObjectURL; multipart ผ่านรอยต่อ OCR mock จน register 201 |
| ตรวจแก้และส่งคำขอ | POST /api/visitor/register | ตรวจชื่อ/เลขบัตร hash/ภาพ/verification/ห้อง/consent; เก็บ Visitor + REGISTERED log + idempotency metadata ใน transaction; receipt ไม่ส่งเลขบัตร/ที่อยู่/ภาพ/QR |
| ข้อมูลซ้ำและ retry | Idempotency-Key + Redis lock + PostgreSQL advisory lock | key เดิมคืนรายการเดิม; payload ต่าง 409; ส่งพร้อมกันไม่เพิ่มซ้ำสำหรับ key เดียว |
| Admin ตรวจคำขอ | GET /api/visitor, /:id, /:id/pass | Admin 200; public 401; Student 403; ID ผิด 400/ไม่พบ 404; UI polling 60 วินาที |
| ยกเลิก | POST /:id/cancel หรือ PATCH /:id/status CANCELLED | สถานะและ CANCELLED log บันทึกจริง; POST ซ้ำไม่เพิ่ม log; การอนุมัติ/เช็คอินหรือสถานะไม่รองรับถูกปฏิเสธ 409 |
| หมดอายุ | VisitorService.expirePendingVisitors / visitorExpiryWorker | 24 ชั่วโมงจาก createdAt; EXPIRED บันทึกหนึ่งครั้ง; ย้อนสถานะและยกเลิกหลังหมดอายุไม่ได้; synthetic DOOR_ACCESS_GRANTED ป้องกัน expiry |
| อนุญาตเข้าและจบการเข้าพบ | Monitor POST /api/face-verification/door-command | ยังไม่ครบวงจรผู้มาติดต่อ: MONITOR_DOOR เป็นจำลองเปิด–ปิดโดย Admin ไม่ผูก visitorId และไม่ใช่หลักฐานเข้าพบ/ออกของบุคคล |

### ปัญหาที่ต้องแก้ต่อ (ยังไม่ได้แก้ production ในรอบตรวจนี้)

1. **ยังไม่มี endpoint/UI สำหรับบันทึกการอนุญาตเข้าที่ผูกผู้มาติดต่อและจบการเข้าพบ**: DOOR_ACCESS_GRANTED ถูกอ่านใน expiry แต่ค้น source ไม่พบผู้เขียนเหตุการณ์นี้ใน flow แผนกต้อนรับ ส่วน CHECK_IN/CHECK_OUT ของ Face เป็น legacy ไม่ใช่ flow ใหม่ ดังนั้นห้ามสรุปว่า Monitor เปิดประตูแล้วคำขอถูกใช้งานหรือผู้มาติดต่อออกแล้ว
2. **รีเฟรช/เริ่มหน้าใหม่อาจส่งซ้ำ**: registrationKeyRef เป็น random UUID ต่อ mount ไม่มีการเก็บ receipt/key หลัง refresh; probe ในฐานแยกส่งข้อมูล/OCR เดิมด้วยสอง key ได้ Visitor 2 แถวจริง ระบบกันซ้ำเฉพาะ key เดียว การออกแบบแก้ควรให้กู้คำขอเดิมด้วยหลักฐานที่ปลอดภัยและไม่เก็บภาพ/เลขบัตรเต็มใน browser; การมาครั้งใหม่ต้องยังทำได้
3. **ลบ OCR ที่มี Visitor อ้างอิงได้**: probe เรียก OcrService.deleteIdCardVerification ในฐานแยกได้สำเร็จ ขณะ Visitor สองแถวยังถือ idCardImagePath เดิม; OCR repository guard ตรวจ payment แต่ไม่ตรวจ Visitor ที่ใช้ภาพ การลบจริงอาจลบไฟล์หลักฐานด้วย ควรป้องกันลบหลักฐานที่ยังใช้งานก่อนทำ cleanup แบบครอบคลุมผู้มาติดต่อ
4. **ค้นชื่อผู้เช่าที่ขอพบไม่ได้**: useVisitorHistory แสดง requestedTenantName แต่ search ไม่รวมฟิลด์นี้; ควรรวมในการค้นหาแทนการอาศัย tenant.fullName เพราะคำขอปัจจุบันไม่ผูก Tenant โดยตั้งใจ
5. **เวลานัดหมายอาจอยู่หลังวันหมดอายุ**: UI/API ไม่จำกัดเวลานัดหมายในกรอบ 24 ชั่วโมง แต่ expiresAt นับจากส่งคำขอ ควรแสดงข้อจำกัดและตรวจบน server ตามนโยบายเดิม เพื่อไม่รับนัดที่คำขอจะหมดอายุก่อนถึงเวลา
6. **ยกเลิก/หมดอายุไม่ใช่ลบข้อมูลส่วนบุคคล**: เก็บ Visitor/VisitorLog/ภาพ OCR เพื่อประวัติ และไม่มี DELETE Visitor ใน routes ปัจจุบัน ต้องกำหนด retention/วิธี cleanup ผู้มาติดต่อและ metadata ก่อนอ้างว่าล้างข้อมูลได้ครบ อย่านำแค่ DELETE ผู้พักมาใช้แทน เพราะทะเบียนผู้มาติดต่อใหม่ tenantId เป็น null

### ผลตรวจและข้อมูลคงเหลือ

- เพิ่มกรณีใน tests/integration/visitor-registration.test.ts: 19/19 ผ่าน รวมเส้นทาง OCR ที่ UI เรียก, protected endpoints, invalid IDs/status, no partial writes, cancellation, expiry, idempotency/concurrency
- Backend regression 171/171 ผ่าน; npm run build, npm run test:typecheck และ ESLint เฉพาะไฟล์ทดสอบผ่าน
- Gateway ที่รันจริง: health 200; public visitor list 401; register/visitor scan/OCR payload ว่าง 400 ไม่ส่งภาพหรือ session จริง
- Query หลัง suite/probe ยืนยันฐานแยก User/Room/Visitor/VisitorLog/IdCardVerification และ VISITOR_IDEMPOTENCY เป็น 0; probe ล้างข้อมูลตาม IDs ที่สร้างเท่านั้น
- อ่านฐานหลัก projectdb: User 664, Room 41, Visitor/VisitorLog/IdCardVerification/visitor idempotency metadata 0 ไม่สร้าง/ล้างรายการจริงในรอบนี้
- Bounded 12 synthetic registrations concurrency 4 ผ่าน 12 commits และ 12 REGISTERED logs; ผลล่าสุดอยู่ tests/load/logs/2026-10-12/ ไม่ใช่ sustained benchmark และไม่ใช้ยืนยันความจุระบบจริง

ลำดับแก้ที่แนะนำ: ป้องกันลบหลักฐาน OCR และคำขอซ้ำก่อน ตามด้วยค้นชื่อ/เวลานัดหมาย จากนั้นออกแบบการบันทึกอนุญาตเข้า–จบการเข้าพบที่ผูก visitorId โดยคงสถานะคำขอแยกจากเหตุการณ์เข้าถึงตาม contract แล้วทดสอบบัตรจริง/UI/อุปกรณ์แยกจาก API fixture

## แก้สองจุดแรกของ flow ผู้มาติดต่อ (12 ต.ค. 2569)

แทนผล audit ข้อ 2–3 ด้านบนสำหรับ implementation ล่าสุด:
- กันคำขอซ้ำหลัง refresh/สแกนใหม่ใน Backend: citizenId เดิม + Room เดิม + requestedTenantName ที่ trim แล้วตรงกัน และยัง REGISTERED ไม่หมดอายุ จะคืน Visitor เดิม ไม่ต่ออายุ ไม่แก้ payload เดิม และไม่สร้าง REGISTERED log/แจ้งเตือนซ้ำ ระบบลง fingerprint ให้ key ใหม่ด้วย; หลังยกเลิก/หมดอายุส่งด้วย key ใหม่ได้ ไม่เก็บเลขบัตร/ภาพใน browser และไม่เปิด public pass reads
- OcrRepository ปฏิเสธ DELETE หลักฐานเป็น 409 เมื่อ Visitor สถานะใดก็ตามยังอ้างอิง imagePath นั้น รวมประวัติ CANCELLED/EXPIRED; OCR ที่ไม่ได้ใช้อยู่ยังลบได้ ใช้ row lock IdCardVerification เดียวกับ transaction ลงทะเบียนเพื่อไม่ให้เกิดช่องว่างระหว่าง validation กับ commit
- แก้เฉพาะ Visitor service/OCR repository และชุดทดสอบ ไม่แก้ OCR engine, auth, schema, signature หรือ face/door flow ไม่ล้างคำขอซ้ำเก่าบนฐานหลัก
- integration 25/25 ผ่าน: key เดิม/ใหม่, OCR ใหม่, concurrent ต่าง key, ยกเลิก/หมดอายุแล้วส่งใหม่, HTTP DELETE OCR 409, ตรวจไฟล์หลักฐานจำลองยังอยู่จริง และการแข่งขัน register/delete ไม่มี Visitor ที่ทำสำเร็จแต่หลักฐานหาย
- regression 171/171, Backend build/typecheck และ ESLint ไฟล์ที่แก้ผ่าน; Frontend build ผ่าน
- หลัง suite ฐาน maintenance_flow_test User/Room/Visitor/VisitorLog/IdCardVerification/visitor idempotency metadata = 0; ไฟล์หลักฐานจำลองที่สร้างถูกลบใน finally ของ test ฐานหลักยัง User 664/Room 41 และ Visitor/VisitorLog/IdCardVerification/metadata = 0
- Docker backend build และ recreate local แล้ว ยืนยัน compiled code ใหม่ใน container; health 200, public visitor GET 401 และ payload ว่าง register 400 โดย body statusCode ตรง HTTP

ยังเหลือจาก audit: ค้น requestedTenantName, นโยบายเวลานัดหมายในกรอบอายุคำขอ, retention/cleanup ผู้มาติดต่อ และ flow บันทึกอนุญาตเข้า–จบการเข้าพบที่ผูก visitorId ต้องดำเนินงานถัดไป บัตรจริง/เบราว์เซอร์/อุปกรณ์ประตูจริงยังไม่ได้ทดสอบรอบนี้

## ต่อ flow ผู้มาติดต่อ: อนุญาตเข้าและจบการเข้าพบ (12 ต.ค. 2569)

- เพิ่ม ADMIN-only POST /api/visitor/:id/access ด้วย DTO class-transformer/class-validator: action GRANT_ENTRY หรือ COMPLETE_VISIT และ detailsConfirmed=true เท่านั้น
- Admin กดยืนยันชื่อผู้มาติดต่อ/ผู้เช่า/ห้องก่อนบันทึกอนุญาตเข้า และยืนยันออกก่อนจบการเข้าพบ เก็บ VisitorLog DOOR_ACCESS_GRANTED และ VISIT_COMPLETED พร้อม UserId เจ้าหน้าที่และเวลา server; transaction ล็อก Visitor row เพื่อกันบันทึกซ้ำ/ชนกับยกเลิกหรือหมดอายุ
- Visitor.status ยังเป็น REGISTERED ตาม contract; list/pass แสดง visitStage WAITING/ADMITTED/COMPLETED และเวลาแต่ละเหตุการณ์ การบันทึกเป็น manual โดยเจ้าหน้าที่ ไม่สั่งเปิดประตู ไม่สร้าง face scan และไม่ยืนยันผลอุปกรณ์จริง
- ไม่ยกเลิกหลังอนุญาตเข้า ไม่อนุญาตเข้าหลังคำขอหมดอายุ ไม่จบก่อนเข้า ไม่อนุญาตซ้ำหลังจบ กดซ้ำแต่ละคำสั่งไม่เพิ่ม log จบการเข้าพบได้แม้เกิน 24 ชั่วโมง และระหว่างยังเข้าพบอยู่การส่งใหม่คืนรายการเดิมแม้อายุลงทะเบียนผ่านแล้ว หลังจบส่งคำขอใหม่ได้
- Expiry worker และ Dashboard waitingVisitors ไม่นับผู้ที่บันทึกอนุญาตเข้าแล้ว; ตรวจกรองก่อน take เพื่อไม่ให้รายการที่เข้าพบแล้วขวาง batch หมดอายุ
- Frontend เพิ่มปุ่มและ modal ร่วม ใช้ Spinner เฉพาะปุ่มที่กด และเก็บตารางระหว่าง silent refresh; ค้น requestedTenantName ได้แล้ว ป้องกันนัดหมายเกิน 24 ชั่วโมงทั้ง UI/API พร้อมคำอธิบายใกล้วันนัด เวลานัดในอดีตยังรับได้ตาม compatibility เดิม ไม่อ้างว่าเป็นระบบนัดหมายเต็มรูปแบบ
- Integration ฐาน maintenance_flow_test 29/29 ผ่าน รวม entry/completion ซ้ำพร้อมกัน, Student/public denied, DTO, cancellation after entry, expiry exemption, completion after 24h, same visitor recovery while admitted, new visit after completion, appointment bound
- Backend regression 171/171 และ Frontend 92/92 ผ่าน Build/typecheck และ ESLint ไฟล์ที่แก้ผ่าน; ไม่เพิ่ม schema/migration/package และไม่แก้ face engine
- หลังทดสอบฐานแยก User/Room/Visitor/VisitorLog/IdCardVerification และ visitor idempotency metadata = 0 ไฟล์หลักฐานจำลองถูกล้าง ในฐานหลักอ่านพบ User 664/Room 41/Visitor 1/VisitorLog 2/IdCardVerification 2/metadata 1 ระหว่างมีการใช้งานจริง จึงไม่สรุปว่าฐานหลักยังไม่มีรายการ และไม่ล้างรายการเหล่านี้
- อัปเดต backend Docker local ล่าสุดแล้ว health=200; POST access แบบไม่ล็อกอิน=401 body ตรง HTTP และยืนยัน route/lifecycle ใหม่ใน compiled container

ขอบเขตที่ยังต้องตรวจจริง: การกดหน้า Admin ใน browser กับผู้มาติดต่อ/บัตรจริงและกระบวนการเจ้าหน้าที่จริง การเปิดประตูฮาร์ดแวร์ยังไม่เชื่อมจาก manual record; นโยบายเก็บ/ล้างประวัติผู้มาติดต่อและหลักฐานยังไม่ได้กำหนดหรือเพิ่มอัตโนมัติในรอบนี้

## UX/UI หลักฐานส่งคำขอผู้มาติดต่อและดาวน์โหลด (12 ต.ค. 2569)

- หน้าสำเร็จแสดงเลขอ้างอิง VIS-id ชื่อผู้มาติดต่อ ห้อง ผู้เช่าที่ขอพบ วัตถุประสงค์ เวลาส่งจาก server เวลานัดและหมดอายุ จัดเป็นรายการอ่านง่ายและรองรับมือถือ
- เพิ่ม useVisitorReceipt ในโมดูลเดิมเพื่อรวม logic sessionStorage/ดาวน์โหลด แยกจาก view เก็บเฉพาะ receipt ที่ผ่าน validation ใน sessionStorage ของแท็บ ไม่เก็บภาพ/เลขบัตรเต็ม/ที่อยู่/เบอร์โทร/verification credential ไม่เปิด public endpoint ดู pass และไม่เพิ่ม package
- รีเฟรชหลังส่งสำเร็จยังเปิดหลักฐานในแท็บเดิมได้โดยไม่ต้องกรอกใหม่หรือยินยอมเพื่ออ่านข้อความเดิม ฟอร์มที่ยังไม่ส่งไม่ได้ถูกบันทึก; ปิดแท็บ/ล้างข้อมูลเบราว์เซอร์อาจทำให้สำเนาหาย จึงมีคำแนะนำให้ดาวน์โหลด หาก storage ไม่พร้อมยังแสดงหลักฐานบนจอและเตือนให้ดาวน์โหลด
- ดาวน์โหลดไฟล์ HTML standalone เปิดอ่านออฟไลน์และสั่งพิมพ์ได้ เพิ่มปุ่มพิมพ์/บันทึก PDF บนจอใช้ browser native print โดย print CSS ใช้เฉพาะเมื่อหน้า receipt อยู่ใน DOM ไม่กระทบหน้าอื่น ข้อมูลผู้ใช้ใน HTML escape ป้องกัน injection และไม่โหลด asset ภายนอก
- ระบุว่าเป็นสำเนา ณ ตอนส่งคำขอ ไม่ใช่สถานะล่าสุดหรือบัตรอนุญาตเข้า ปุ่มเริ่มคำขอใหม่ใช้ modal ยืนยันให้ดาวน์โหลดก่อน และล้างเฉพาะสำเนา/ฟอร์มบน browser ไม่ยกเลิกหรือลบคำขอใน PostgreSQL
- API registration receipt เพิ่ม createdAt/expectedEntryTime/purpose จาก Visitor ที่บันทึกจริง กรณีกู้คำขอเดิมใช้ค่าของรายการเดิม ไม่เติมจากฟอร์มรอบใหม่
- Frontend regression 96/96 (เพิ่ม 4 tests: refresh/privacy, storage corruption, storage unavailable, export XSS/Thai date), integration PostgreSQL 29/29 พร้อมตรวจวันที่ receipt ตรง DB ผ่าน; Build ทั้งสองฝั่งและ lint ไฟล์ที่แก้ผ่าน
- อัปเดต backend Docker และ frontend dist แล้ว health=200 และ gateway ส่ง frontend bundle ล่าสุด ไม่ได้ยืนยันภาพ responsive/download/native PDF dialog ในเบราว์เซอร์จริงรอบนี้

### เปลี่ยนหลักฐานดาวน์โหลดเป็น PNG (12 ต.ค. 2569)
- ปุ่มดาวน์โหลดหน้า receipt เปลี่ยนจาก HTML เป็น visitor-receipt-VIS-id.png; สร้างภาพผ่าน Canvas ในเบราว์เซอร์ ไม่ส่งข้อมูลไปบริการภายนอก ไม่เพิ่ม package ใช้เลขอ้างอิงและฟิลด์ receipt เดิม พร้อมข้อความว่าเป็นสำเนาตอนส่งคำขอ
- รอ font พร้อม ตัดบรรทัดตาม Thai grapheme และปรับความสูงตามข้อความ; จำกัดขนาดภาพกรณีข้อความยาวเพื่อลด memory บนมือถือ ปุ่มมี Spinner/ล็อกกันกดซ้ำและ error ถ้าสร้างภาพไม่ได้ ใช้ cleanup guard ไม่อัปเดต state หรือเริ่มดาวน์โหลดหลังออกจากหน้า และ revoke Blob URL หลังใช้งาน
- sessionStorage/การกู้หลัง refresh และปุ่มพิมพ์/บันทึก PDF คงอยู่ ไม่มีภาพบัตร/เลขบัตรเต็มใน PNG
- Frontend build และ lint ผ่าน regression 97/97 ผ่าน รวม Thai grapheme wrapping และ mock Canvas ตรวจ MIME image/png เลขอ้างอิง/ไม่มีฟิลด์บัตรส่วนตัว ไม่อ้างว่าได้เปิด PNG หรือกดดาวน์โหลดใน browser จริงแล้ว ไม่มี API/DB เปลี่ยนรอบนี้

## ผู้ใช้ยืนยันผู้มาเยือนผ่าน และตรวจ flow แจ้งซ่อมต่อ (12 ต.ค. 2569)

ผู้ใช้รายงานว่าตรวจ flow ผู้มาเยือนผ่านแล้ว บันทึกเป็นผลตรวจด้วยผู้ใช้ ไม่อนุมานว่าทดสอบฮาร์ดแวร์ประตูจริงหรือทุกกรณี OCR/PNG ครบจากคำยืนยันนี้

ตรวจพบและแก้:
- เดิมมีเพียง Admin ปิดงาน เพิ่ม STUDENT-only POST /api/maintenance/:id/confirm รับ confirmed=true ผ่าน class-transformer/class-validator ตรวจ ID และ ownership ใน transaction ล็อกแถวงาน RESOLVED → CLOSED งานคนอื่น/ไม่พบคืน 404 งานยังไม่เสร็จคืน 409 การยืนยันซ้ำของเจ้าของคืนผลเดิม 200 และไม่ส่ง Admin alert ซ้ำ
- เพิ่มปุ่มยืนยันปิดงานในประวัติผู้พักเฉพาะ RESOLVED ใช้ modal เดิม พร้อม Spinner และ ref lock กันกดซ้ำ โหลดใหม่แบบ silent คงข้อมูลเดิม แยกบันทึกสำเร็จแต่โหลดใหม่ไม่สำเร็จ และมี unmount guard
- repository เดิมกันเฉพาะ terminal states จึงอาจเขียนจากการอ่านเก่าที่ไม่ตรงขั้น แก้ PostgreSQL update ให้รับเฉพาะสถานะต้นทางที่ผ่าน canTransitionMaintenanceStatus โดยคง signature และพฤติกรรม Admin เดิม ไม่เปลี่ยน schema

ผลทดสอบ:
- HTTP/Express + PostgreSQL ฐาน maintenance_flow_test 28/28 ผ่าน รวม create → APPROVED → IN_PROGRESS → RESOLVED → ผู้พัก confirm CLOSED; anonymous/Admin/เจ้าของอื่น/DTO ผิดถูกปฏิเสธ; ยืนยันพร้อมกัน 3 ครั้งยัง CLOSED; database ปฏิเสธข้าม PENDING → RESOLVED/CLOSED
- suite เดิมตรวจ quota รายวัน/คำขอพร้อมกัน, ห้องอื่น, ยกเลิก/ลบหลังซ่อมเสร็จ, ย้ายออก, ลบข้อมูลผู้พักและเก็บ User รวมถึง billing fixture ใช้การชำระจำลองในฐานแยก ไม่โอนเงินจริง
- Backend regression 171/171, Frontend 98/98 ผ่าน พร้อม build สองฝั่ง, test:typecheck และ lint ไฟล์ที่เกี่ยวข้อง เพิ่ม frontend test กดปิดงานซ้ำและโหลดใหม่ล้มเหลว ไม่ได้กด UI ใน browser จริง
- หลัง suite User/Tenant/Room/MaintenanceTicket/Notification/Bill/Payment/AccessLog ในฐานแยกเป็น 0 ทั้งหมด ไม่ล้างฐานหลัก ไม่ใช้ session หมดอายุ
- อัปเดต backend Docker local และ frontend dist แล้ว

ยังเหลือ: ลองปุ่มปิดงานใน browser ด้วยบัญชี ACTIVE จริง; ภาพแนบอัปโหลดก่อนสร้างงานจึงอาจเหลือไฟล์หากส่งงานล้มเหลว; การเปลี่ยนสถานะยังใช้ Admin alert ยังไม่ได้ยืนยันการแจ้งผู้พักทันทีเมื่อ RESOLVED หรือส่ง SMS จริง จึงยังไม่สรุปว่าครบทุกด้านของระบบแจ้งซ่อม

## คำแนะนำขณะพิมพ์ในช่องค้นหา (12 ต.ค. 2569)

- เพิ่ม SearchInput/useSearchSuggestions ที่ใช้ร่วมกัน แสดงสูงสุด 6 คำจากฟิลด์ที่ค้นหาได้ในข้อมูลที่หน้าได้รับตามสิทธิ์ของ API เดิม ไม่อ่าน object ทั้งก้อน ไม่เรียก API เพิ่มระหว่างพิมพ์ ไม่เก็บคำค้นใน storage ไม่แก้ backend/ฐานข้อมูล/เพิ่ม dependency
- รองรับช่องค้นหาที่พบทั้งหมด: ห้องพัก ผู้พัก ผู้มาติดต่อ แจ้งซ่อม บิล และช่องค้นหา DataTable (ปัจจุบันใช้จัดการบัญชีผู้ใช้) รวมตัวกรอง Method ของบันทึกกิจกรรม ฝั่งผู้พักยังไม่มีช่องค้นหาข้อความในหน้าที่ตรวจ จึงไม่ได้เพิ่มช่องค้นหาใหม่โดยพลการ
- คำขึ้นต้นมาก่อนคำที่มีข้อความตรงกัน ตัดคำซ้ำ ไม่แนะนำตอนคำค้นว่าง รองรับไทย/ตัวพิมพ์เล็กใหญ่/เลขห้องเรียงตามตัวเลข และ escape ผ่าน React คำแนะนำอิงข้อมูลที่โหลดอยู่ ไม่ใช่การค้นทั้งฐานข้อมูลหรือแก้คำสะกดด้วย AI
- combobox/listbox พร้อมชื่อที่อ่านได้ เลือกด้วยเมาส์ ลูกศร/Enter และ Escape ปิดคำแนะนำ; Enter ระหว่าง IME composition ไม่เลือกคำ ไม่บังคับเลือกคำแทนผู้ใช้เมื่อพิมพ์เอง ตัวกรองและการแบ่งหน้าเดิมคงอยู่
- Frontend regression 102/102 ผ่าน รวมไทย/case/dedup/ลำดับ/จำกัดผล/คำว่าง/ไม่พบ/คีย์บอร์ด/IME/เมาส์/blur และ regression เลือกค้นหาห้องแล้วกลับหน้าแรก ตรวจ build และ lint ไฟล์ที่เกี่ยวข้อง ไม่อ้างผลจาก browser จริง; ยังต้องตรวจตำแหน่ง dropdown และการแตะบนมือถือด้วย UI จริง

## ซ่อนช่องเบอร์โทรบัญชีในข้อมูลส่วนตัว (13 ต.ค. 2569)

เอาช่องอ่านอย่างเดียว “เบอร์โทรศัพท์จากบัญชี” และคำอธิบายใต้ช่องออกจากขั้นข้อมูลส่วนตัว พร้อมเอา prop ที่ไม่ได้ใช้จาก component/จุดเรียกออก ช่องชื่อจริง–นามสกุลจึงเริ่มแถวแรกของ grid ไม่แก้ข้อมูลบัญชีหรือการนำเบอร์ไปใช้ในสัญญา; ข้อความแจ้งบัญชีขาดเบอร์พร้อมปุ่มโหลดข้อมูลใหม่ที่ระดับหน้าสมัครยังคงทำงาน

## จัดการคณะและหลักสูตรจากฐานข้อมูล (13 ต.ค. 2569)

- เพิ่มรายการ faculties/programs พร้อม ID ถาวร, active และ revision ใน SystemSetting key academic-catalog/category ACADEMIC_CATALOG ใช้ PostgreSQL เป็นแหล่งข้อมูล ไม่เพิ่ม schema/migration/package และไม่สร้างรายชื่อสถาบันโดยเดา
- GET /api/settings/academics ต้องล็อกอิน: Admin อ่านทั้งรายการ ผู้ใช้ทั่วไปอ่านเฉพาะคณะและหลักสูตรที่เปิดใช้งาน POST เส้นทางเดียวกันจำกัด ADMIN ใช้ action SAVE/DELETE, kind FACULTY/PROGRAM, revision และข้อมูลรายการ ตรวจ payload ด้วย class-transformer/class-validator และ whitelist
- บันทึกใน transaction พร้อม advisory lock และ revision conflict ป้องกันเขียนทับจากข้อมูลเก่า ชื่อหลักสูตรห้ามซ้ำทั้งรายการเพราะ Tenant เดิมอ้างอิงด้วยข้อความ ลบคณะที่มีหลักสูตรไม่ได้ ลบ/เปลี่ยนชื่อ/ย้ายคณะของหลักสูตรที่ Tenant หรือฉบับร่างใช้อยู่ไม่ได้ แต่ปิดใช้งานได้ รายการทั่วไปใน Settings GET ไม่รวม JSON catalogue
- เพิ่มส่วนคณะและหลักสูตรในตั้งค่าระบบ Admin: เพิ่ม/แก้ไข/เปิด–ปิด/ลบพร้อม confirmation และสถานะโหลด/ผิดพลาด/รายการว่าง หน้าสมัครเลือกคณะแล้วพิมพ์หลักสูตรผ่าน SearchInput เดิม โหลดครั้งเดียวผ่าน hook พร้อม abort/cleanup
- ตรวจหลักสูตรก่อนผ่านขั้นข้อมูลส่วนตัว จึงไม่รอให้จ่ายเงินก่อนพบว่ากรอกผิด Server ตรวจชื่อ/คณะที่เปิดใช้งานอีกครั้งใน transaction ของ submit และเก็บชื่อคณะ/หลักสูตรเป็น snapshot ใน contractData; ไม่เปลี่ยนข้อมูลผู้พักเดิมอัตโนมัติ การจับคู่ชื่อเก่าทำเฉพาะ exact match ในรายการชื่อที่ไม่ซ้ำ
- เพื่อรองรับข้อมูลเดิม กรณียังไม่เคยตั้งค่า catalogue (revision=0) ยังกรอกหลักสูตรข้อความเดิมได้ เมื่อตั้งค่าแล้วสมัครใหม่ต้องใช้รายการที่เปิดใช้งาน Admin ควรเพิ่มคณะและหลักสูตรให้ครบก่อนเปิดให้สมัคร ไม่มีการ migrate/เดาคณะของผู้พักเก่า
- PostgreSQL/HTTP integration ฐานแยก 29/29, Backend regression 171/171, Frontend 104/104 ผ่าน รวม RBAC, invalid payload, revision conflict, ชื่อซ้ำ, ห้ามลบรายการที่ใช้, ปิดใช้งาน, เลือกผิดคณะและ frontend loading/error ก่อนชำระเงิน Build/test:typecheck/lint ที่เกี่ยวข้องผ่าน ไม่ทดสอบกด UI ด้วย browser จริง
- ข้อจำกัด MVP: Tenant.course ยังเป็นข้อความ ไม่ใช่ foreign key โปรแกรม จึงจำกัดการเปลี่ยนชื่อ/คณะเมื่อถูกใช้งาน และไม่ได้เติม faculty ของผู้พักเก่าที่หลักสูตรยังไม่ตรงรายการสำหรับรายงานย้อนหลัง

## แก้ความเข้าใจ: พิมพ์ค้นหาคณะ ไม่มีช่องหลักสูตร (13 ต.ค. 2569)

คำสั่งล่าสุดแทนรูปแบบหน้าสมัครก่อนหน้า: เหลือช่องคณะช่องเดียว ใช้ SearchInput พิมพ์และแสดงคำแนะนำจากคณะที่เปิดใช้งาน เอา faculty dropdown และช่องหลักสูตรออก Admin ตั้งค่าจัดการคณะเท่านั้น ไม่มีตัวเลือกประเภท/หลักสูตรใน UI ตรวจคณะที่เลือกตั้งแต่ขั้นแรกและ server รองรับ faculty name/ID พร้อมป้องกันลบหรือเปลี่ยนชื่อคณะที่ Tenant/ฉบับร่างอ้างอิง

คงชื่อฟิลด์ course ใน payload/Tenant เพื่อ compatibility แต่ค่าของการสมัครใหม่คือชื่อคณะ ไม่แก้ข้อความหลักสูตรของผู้พักเก่าย้อนหลัง API catalogue ยังรองรับรายการหลักสูตรเดิมเพื่อไม่ทำลายข้อมูล/รอยต่อเดิม รายการเก่าไม่ได้ถูก bulk delete

Frontend build/lint และ regression 104/104 ผ่าน; isolated HTTP/PostgreSQL integration 29/29 ผ่าน รวมเลือกคณะได้โดยไม่มีหลักสูตร และห้ามลบ/เปลี่ยนชื่อคณะที่ใช้แล้ว ยังไม่ได้ทดสอบกด UI ใน browser จริง

### 2026-10-13 — UX/UI จัดการคณะฝั่ง Admin

- จัดหัวข้อ คำอธิบาย และปุ่มเพิ่มคณะให้เป็นสัดส่วน ใช้รายการตารางชั้นเดียว (ชื่อคณะ / สถานะ / จัดการ) พร้อมสถานะเปิด–ปิด และแบ่งหน้าละ 12 ด้วย Pagination เดิม
- ย้ายฟอร์มเพิ่ม/แก้ไขไป Modal เดิม ลดความแน่นของหน้าตั้งค่า; รักษาสถานะเดิมเมื่อแก้ชื่อ ปิด Modal ระหว่างบันทึกไม่ได้ และยืนยันก่อนลบ
- โหลดครั้งแรกใช้ ContentSkeleton ตาราง 3 คอลัมน์; เพิ่ม/แก้ไข/เปิด–ปิด/ลบใช้ ActionSpinner ในปุ่มที่กำลังทำงานและป้องกันส่งซ้ำ โดยคงรายการบนหน้าจอ
- โหลดใหม่หลังข้อผิดพลาดใช้สถานะ refreshing และ Spinner โดยรักษารายการเดิม; ไม่แสดงว่าไม่มีคณะเมื่อ API โหลดล้มเหลว ไม่ให้ reload กับ save ทำงานทับกัน และไม่อัปเดต catalogue จาก save ที่จบหลังออกจากหน้า
- ไม่เปลี่ยน endpoint หรือ schema และไม่เพิ่ม dependency
- ตรวจสอบ: frontend npm run build ผ่าน, ESLint ไฟล์ที่แก้ผ่าน, frontend npm test ผ่าน 107/107 (เพิ่ม 3 กรณีตรวจ async loading, duplicate save และ unmount)
- ขอบเขตการยืนยัน: ทดสอบ hook และ regression โดยไม่แก้ข้อมูลจริง; ยังไม่ได้ตรวจภาพ UI/การใช้งาน Modal บนเบราว์เซอร์จริง

### 2026-10-13 — ลด Loading feedback ที่ซ้ำใน action ทั้ง Admin/User

- ActionSpinner กลางหน่วงการแสดง 250ms ด้วย CSS: งานที่จบเร็วไม่เห็น Spinner; ไม่มี timer/state ใหม่ และถอด component เมื่อ action จบเพื่อเริ่ม delay ใหม่ในงานถัดไป รองรับ reduced motion โดยแสดงตัวบอกสถานะคงที่
- คงชื่อปุ่มเดิมขณะทำงาน: เข้าสู่ระบบ สมัครสมาชิก OTP เปลี่ยนรหัสผ่าน ออกจากระบบ สมัครเข้าพัก แจ้งซ่อม จัดการคณะ ตรวจสถานะการลบ ลงทะเบียนผู้มาติดต่อ ดาวน์โหลด PNG และยืนยัน/บันทึกใบหน้า
- ปุ่มชำระบิลรายใบและชุดบิล รวมถึงปุ่มผู้มาติดต่อ/ใบหน้า ใช้ ActionSpinner กลางแทน Spinner เฉพาะหน้า; แก้ Spinner สร้าง QR บิลรายใบให้ผูกกับ generatingQrId ที่กำลังร้องขอจริง
- เอาข้อความบันทึกฉบับร่างเบื้องหลังและข้อความบันทึกงานซ่อมที่ซ้ำกับปุ่มออก; ป้ายข้อความของ ContentSkeleton ยังคงอยู่สำหรับ screen reader แต่ไม่แสดงเป็นข้อความบนจอ
- รักษา disabled/aria-busy และกลไกกันส่งซ้ำเดิมทันที ไม่หน่วง request หรือการล็อกปุ่ม; รักษาข้อผิดพลาด ข้อความผลที่จำเป็น และสถานะงานระยะยาว OCR/สลิป/รออนุมัติ
- ตรวจแล้ว refresh หลัง mutation ของผู้พัก ผู้มาติดต่อและงานซ่อมใช้ silent refresh เดิม จึงไม่เปลี่ยนการโหลดเหล่านี้
- ตรวจสอบ: frontend build ผ่าน, ESLint ของไฟล์ TSX ที่แก้ผ่าน, regression tests ผ่าน 107/107; ไม่มีการเปลี่ยน backend/schema/dependency หรือข้อมูลจริง
- ขอบเขต: การหน่วงภาพ Spinner เป็น CSS ยังไม่ได้ตรวจ timing/ภาพ UI ด้วยเบราว์เซอร์จริง; OCR และ flow ชำระเงินจริงไม่ได้ทดสอบซ้ำในงาน UI นี้


## ตรวจ flow ถึง API/ฐานข้อมูลและจุดก้ำกึ่ง — 13 ต.ค. 2569

### หลักฐานและขอบเขต

ตรวจเส้นทางหน้า React → service/hook → Express route → service → PostgreSQL จากโค้ดปัจจุบัน รัน flow บน Express HTTP จริงกับฐานข้อมูลแยก และตรวจ protected GET ผ่าน gateway ที่กำลังทำงาน ไม่ใช้ session/token ที่ส่งในแชต ไม่เปลี่ยนข้อมูลใช้งานจริง ไม่ได้กดหน้าจอด้วยเบราว์เซอร์หรือเรียก OCR/ธนาคาร/ฮาร์ดแวร์จริงในรอบนี้

- Backend regression 171/171, frontend regression 107/107 ผ่าน
- HTTP/PostgreSQL integration: maintenance-flow 31/31, visitor-registration 29/29, housing-payment 27/27 รวม 87 กรณี ผ่าน
- Backend build และ test:typecheck ผ่าน; ESLint ไฟล์ทดสอบที่ปรับผ่าน
- เพิ่มการทดสอบสมัครบัญชี → password hash → login ผ่าน HttpOnly cookie → /auth/me → heartbeat ไม่เปลี่ยน lastLogin → logout และสิทธิ์ Admin/Student ใน dashboard/settings/audit/users/billing report
- ปรับ fixture payment เก่าให้มีเบอร์บัญชีตามข้อกำหนดปัจจุบัน และทดสอบปฏิเสธใบสมัครก่อนลบแทนลบ PENDING โดยตรง ปิด Redis ใน teardown เพื่อให้ชุดทดสอบจบจริง ไม่เปลี่ยนตรรกะ production เพื่อให้ test ผ่าน
- พบ route declarations ใต้ /api จำนวน 121 จุด รวม alias; inventory ไม่ใช่คำยืนยันว่าแต่ละจุดผ่าน flow สำเร็จแล้วทั้งหมด ดู [รายการ endpoint และผลตรวจจริง](endpoint-audit-2026-10-13.json)
- Protected GET 48 จุดผ่าน http://127.0.0.1:3002 คืน 401 เมื่อไม่มี session ครบ 48/48 ผลนี้ยืนยัน auth boundary ฝั่ง unauthenticated เท่านั้น ไม่ยืนยัน authorized CRUD หรือ ownership ของทุก endpoint

### ขอบเขตปัจจุบันตามคำสั่งผู้ใช้

การปรับขอบเขตนี้ใช้กับงานทดสอบและแผนต่อจากรายงานนี้ ข้อความในบันทึกเก่าที่ระบุว่ารออุปกรณ์หรือบริการภายนอกยังคงเป็นประวัติ ไม่เป็นเงื่อนไขค้างของงานในขอบเขตปัจจุบัน

**In scope:** UX/UI และ flow ของเว็บ Admin/User, API validation/authorization, การบันทึกและลบข้อมูลใน PostgreSQL, ไฟล์ในระบบ, draft/payment credit, idempotency, การจัดการข้อผิดพลาดและการกู้คืน รวมถึงการทดสอบสัญญาการเชื่อมต่อผ่าน mock โดยไม่เรียกบริการจริง

**Out of scope:**

- กล้องจริง: การขอสิทธิ์กล้องบนอุปกรณ์ คุณภาพภาพ และการจับภาพจริง
- ประตูและอุปกรณ์ face gate/edge จริง: การสแกนบนอุปกรณ์และการเปิด–ปิดประตูทางกายภาพ
- SMS จริง: การส่ง OTP/ข้อความผ่านผู้ให้บริการและการรับข้อความบนโทรศัพท์
- Provider ภายนอกจริง: OCR/Face API, ธนาคารหรือ payment provider, และ notification provider รวมการรับเงิน/settlement และการส่งถึงผู้รับจริง

รายการ Out of scope ไม่ถูกนับเป็นงานค้างหรือเงื่อนไขผ่านของ flow หลัก และไม่ได้หมายความว่าทดสอบผ่านแล้ว ตรรกะของเว็บ/API การตรวจสิทธิ์ การบันทึกผล การล้างไฟล์ และการรับมือ timeout/retry ที่ขอบเขตการเชื่อมต่อยังอยู่ใน scope การทดสอบด้วย mock

### Flow ที่ไล่ตรวจและปลายทาง

| ส่วน | เส้นทางหลัก/ผลปลายทาง | สิ่งที่ยืนยันได้และสิ่งที่ยังเหลือ |
|---|---|---|
| สมัครบัญชี/เข้าสู่ระบบ | POST /auth/register → POST /auth/login → GET /auth/me → POST /auth/logout | HTTP จริงในฐานแยกยืนยัน User/hash/phone/role STUDENT, token อยู่ใน cookie ไม่มีใน body; logout ล้าง cookie แต่ยังไม่ revoke cookie ที่คัดลอกไว้ |
| กู้รหัสผ่าน | /auth/forgot-password → /verify-reset-otp → /reset-password | มี tests ที่ใช้ mock และ flow UI; local PASSWORD_RESET_SMS_MODE=mock ส่ง OTP ใน response ยังไม่ใช่ SMS จริง และไม่อนุญาต mock ใน production/staging |
| สมัครเข้าพัก | GET/PATCH /tenants/draft → /draft/upload-identity → /draft/payment-qr/:roomNumber → /draft/upload-slip → POST /tenants/apply → Admin PATCH /tenants/:id | บันทึก draft/credit ข้าม reload, จ่ายเฉพาะส่วนต่าง, ส่งซ้ำไม่เพิ่ม Tenant/Payment, capacity race และอนุมัติมัดจำครั้งเดียวผ่านฐานแยก; มีช่องว่าง consent/DOB แบบ legacy ตามรายการด้านล่าง |
| เอกสารผู้พัก | GET /tenants/me → /tenants/me/documents/:documentType; Admin /tenants/:id/documents/:documentType | source wiring และ auth boundary ตรวจแล้ว; การเปิด/พิมพ์ไฟล์จริงใน browser ยังต้องใช้โปรไฟล์พร้อมเอกสาร |
| บิลรายเดือน/ชำระหลายบิล | /billing/room-info → /generate-room-bill → /payment-batches → /:id/payment-qr → /:id/upload-slip → /:id/status; Admin /billing/:id/status | บิลไม่ซ้ำตามเดือน/ผู้พักและยอดรวมครบสตางค์, owner isolation, paid transaction reuse และ race กับย้ายออกผ่าน; provider ใน integration เป็น mock ตาม scope; settlement ธนาคารจริงอยู่ใน Out of scope |
| แจ้งซ่อม | POST /maintenance/upload → POST /maintenance → Admin PENDING/APPROVED/IN_PROGRESS/RESOLVED → POST /maintenance/:id/confirm → CLOSED | transition, quota, ownership, concurrency, confirmation ซ้ำ และลบหลังย้ายออกผ่าน; upload ก่อนสร้างงานยังไม่มี atomic cleanup เมื่อสร้างงานไม่สำเร็จ |
| ผู้มาติดต่อ | OCR /ocr/identity-card → POST /visitor/register → Admin GET /visitor/:id → POST /visitor/:id/access GRANT_ENTRY → COMPLETE_VISIT หรือ /cancel | เอกสาร/idempotency/expiry/สิทธิ์ Admin และ durable VisitorLog ผ่าน; receipt/PNG มี unit tests และผู้ใช้เคยยืนยันใช้งานผ่าน การเปิดประตูฮาร์ดแวร์จริงอยู่ใน Out of scope |
| ย้ายออก/ลบข้อมูล | PATCH /tenants/:id INACTIVE/REJECTED → DELETE /tenants/:id → cleanup receipt | ป้องกันหนี้/งานไม่จบ/บิลร่วม, physically purge Tenant/Bill/Payment/Batch/ข้อมูลผูกเจ้าของโดยคง User ผ่าน; การเข้าคิว/สถานะ cleanup และการล้างไฟล์ภายในอยู่ใน scope; การล้างที่ provider จริงอยู่ใน Out of scope |
| คณะ/ราคาห้อง/ตั้งค่า | /settings/academics GET/POST, /rooms/:id PATCH, /settings GET/PATCH | faculty active/revision/used-name guard และราคา occupied/draft lock ผ่าน; บาง toggle บันทึกได้แต่ยังไม่มีผู้ใช้ค่าจริง |
| Dashboard/รายงาน/วิเคราะห์/audit | /analytics/dashboard, /billing/report, /audit-logs, /analytics/observability | authorized overview/report/audit/settings HTTP+DB ผ่าน และ unit คำนวณผ่าน; observability/metrics จริงตรวจได้เพียง unauthenticated boundary ในรอบนี้ |
| แจ้งเตือน | /notifications, /notifications/preferences, send/webhook/dead-letter retry | history ownership/Admin-only delivery endpoints มี tests; provider ส่งจริงอยู่ใน Out of scope; endpoint retry/webhook และการบันทึกผลภายในยังต้องทดสอบด้วย mock ให้ครบ |
| ใบหน้า/เข้า–ออก | /face-verification/register → edge enrollment/embeddings → /attendance/scan → scan-history/events/door-command | backend unit/route tests ใช้ mock; ตรรกะ API/metadata/ไฟล์อยู่ใน scope ส่วนกล้อง → edge → ประตูจริงอยู่ใน Out of scope |

### ข้อค้นพบก่อนแก้ flow (เก็บเป็นหลักฐานของการตรวจรอบแรก)

| ลำดับ | ความสำคัญ | พบอะไร | หลักฐาน/ผลกระทบ | แนวทางถัดไป |
|---|---|---|---|---|
| 1 | สูง | API สมัครเข้าพักบังคับยอมรับสัญญาเฉพาะเมื่อส่ง birthDate | tenants.dto.ts:58–71; legacy integration สมัครสำเร็จโดยไม่มี personal birthDate และไม่มี contractAccepted จึงข้ามกติกาหน้าจอใหม่ได้ | บังคับวันเกิด/ข้อมูลตัวตน/consent ใน endpoint ใหม่โดยตรง และระบุแผนยุติ legacy ให้ชัด ไม่พึ่ง UI validation |
| 2 | สูง | logout ยังไม่ revoke session ฝั่ง server | integration ส่ง copied pre-logout cookie ไป /auth/me ได้ HTTP 200 หลัง logout; controller มี clearCookie เท่านั้น | กำหนด session ID/revocation หรือ token version ที่ตรวจจริง ออกแบบนโยบายออกจากเครื่องเดียว/ทุกเครื่องก่อนแก้ auth |
| 3 | สูง | มี 2FA toggle แต่ login ไม่อ่านค่า | twoFactorAuthentication พบเฉพาะ settings definitions/validation; login ออก cookie หลังตรวจ password โดยไม่มี second factor | ซ่อนหรือระบุว่าไม่รองรับจนมี second-factor flow จริง ห้ามใช้คำว่าเปิดความปลอดภัยแล้วจากการบันทึก toggle |
| 4 | สูง | การสมัครมี validation ไม่เท่ากับ login | AuthController.register destructure body และตรวจ truthy email/password + phone, ยังไม่ตรวจรูปแบบ email/type ครบก่อน repository | เพิ่ม DTO validation และ malformed-input HTTP tests; ข้อนี้พบจาก source ยังไม่ได้ยิงสมัคร email ผิดรูปแบบในรอบนี้ |
| 5 | ปานกลาง | สมัครสมาชิก default จำกัด 1 ครั้งต่อ IP ต่อชั่วโมง | auth.routes.ts:65; env local ไม่ override; การสมัครซ้ำใน integration ถูก 429 แม้ตรวจ duplicate account ยังไม่ถึง service | ทบทวนจำนวน attempt และ NAT ของหอพัก: การกรอกผิด/ผู้ใช้หลายคนหลัง IP เดียวอาจถูกล็อก ให้แยก abuse protection จาก duplicate identity |
| 6 | ปานกลาง | ไฟล์แจ้งซ่อมอัปโหลดแล้วอาจตกค้าง | uploadImage เขียนไฟล์แล้วตอบชื่อ ก่อน POST งานซ่อมอีก request; ไม่มี cleanup ตอน submit ล้มเหลว/ออกจากหน้า | ผูก staged upload กับ owner และ TTL หรือรวม upload+create และมี compensating cleanup |
| 7 | ปานกลาง | ใบหน้า 5 มุมไม่ใช่ transaction เดียว | UserIdentityFlowPage.tsx:220 ส่ง 5 requests; catch แค่เปิดกล้องใหม่ ไม่มีลบมุมที่สำเร็จก่อนหน้า; backend เก็บ metadata ก่อนส่ง external | แสดง/กู้ความคืบหน้าจาก server และ resume/idempotency ตามมุม ไม่เรียกว่า rollback ข้อมูลทั้งหมด; รักษา external fallback เดิม |
| 8 | ปานกลาง | ข้อมูลผู้ให้เช่าและอัตราบริการเปิดให้ผู้สมัครแก้ในสัญญา | ContractReview มี input landlordName/address/phone, start/endDate, electricityRate/waterRate ในโหมดแก้สัญญา | แยกข้อมูลผู้สมัครที่แก้เองได้ออกจากเงื่อนไขที่ Admin เป็นผู้กำหนด ให้ดึง snapshot จาก server |
| 9 | ปานกลาง | สวิตช์ช่องทางแจ้งเตือนใน settings ไม่ตรงกับ delivery rule | emailNotifications/smsNotifications/pushNotifications ไม่พบการอ่านนอก settings; delivery อ่าน per-user preference/provider แทน | ผูกค่า global กับ delivery จริง หรือเลิกแสดงเป็นสวิตช์เปิด–ปิดการส่งที่ใช้ได้แล้ว |
| 10 | ปานกลาง | อายุและวันเกิดผู้มาติดต่อแก้ได้แยกกัน | VisitorRegistration มีช่อง age และ dateOfBirth; API เก็บทั้งสองค่า ไม่พบการคำนวณให้ตรงกัน | ใช้วันเกิดเป็นหลักและคำนวณอายุ ให้อายุกรอกเองเฉพาะกรณีไม่มีวันเกิด พร้อมระบุแหล่งข้อมูล |
| 11 | UX/ความหมาย | เมนู/route สัญญาเดิมไม่ได้เปิดสัญญา | /agreements redirect ไป /analysis; สัญญารายบุคคลอยู่ในผู้พัก/เอกสาร | เปลี่ยนชื่อ/ปลายทางหรือถอด alias จากเมนู ไม่ให้ผู้ใช้คาดว่าจะเปิดรายชื่อสัญญา |
| 12 | UX/ความหมาย | สถานะผู้มาติดต่อกับขั้นการเข้าพบเป็นคนละอย่าง | REQUEST status REGISTERED และ visitStage WAITING/ADMITTED/COMPLETED จาก log; เข้าพบจบแล้วไม่ได้ใช้ status เดียวแทนทุกอย่าง | แสดง visitStage พร้อมคำอธิบาย ใช้ status สำหรับ cancel/expire อย่านับ REGISTERED ทั้งหมดเป็นผู้รอเข้าพบ |
| 13 | ยังต้องยืนยันใน scope | browser flow/error/retry ด้วยบัญชี ACTIVE | tests ใช้ HTTP fixtures และยังไม่ได้กดหน้าจอจริงครบทุก flow | ทำ acceptance ของเว็บด้วยบัญชี ACTIVE และ mock ของบริการนอก scope พร้อมบันทึกแต่ละจุด ไม่ตีความจำนวน tests ว่าครบทุก endpoint |

### ข้อมูลที่กรอกซ้ำ / ข้อมูลที่แสดงซ้ำแต่มีเหตุผล

- สมัครสมาชิกใช้ username/email/phone/password; สมัครเข้าพักใช้ชื่อจริง/เลขบัตร/วันเกิด/ที่อยู่จาก OCR แล้วตรวจแก้ พร้อมรหัสนักศึกษา/คณะ/ชั้นปี: username กับชื่อจริงเป็นคนละความหมาย ไม่ใช่กรอกชื่อซ้ำ
- เบอร์โทรบัญชีไม่ต้องกรอกใหม่ในใบสมัคร: backend อ่าน User.phone; สัญญาใช้ค่าเดียวกัน บัญชีเก่าที่ไม่มีเบอร์ต้องให้ Admin เพิ่มแล้วกดโหลดข้อมูลเดิม จึงมี dependency ที่ผู้สมัครแก้เองไม่ได้ (ไม่ควรปล่อยให้เจอตอนชำระเงินหรือยื่นใบสมัคร)
- ชื่อ/เลขบัตร/ที่อยู่/อายุในสัญญาใหม่ดึงจากขั้นตอนแรกและแสดงเพื่อทบทวน ไม่ต้องพิมพ์ซ้ำ; backend ยังมี field contractData ซ้ำกับ personalInformation เพื่อ snapshot จึงต้องรักษา normalization/validation ให้เป็นแหล่งเดียว
- ห้องและยอดชำระแสดงอีกครั้งในสัญญาเพื่อยืนยัน ไม่ใช่เลือกหรือจ่ายใหม่: draft/credit และ partial upgrade ผ่าน integration แล้ว
- เบอร์ผู้ติดต่อฉุกเฉินเป็นข้อมูลของอีกบุคคล จึงไม่ควรคัดลอก User.phone อัตโนมัติ
- ผู้มาติดต่ออายุ/วันเกิดซ้ำในความหมายเดียวกันและอาจขัดกัน ควรแก้ตามข้อ 10
- ผู้มาติดต่อยังไม่ส่ง: form draft ไม่ถูก persist; reload ต้องกรอก/อ่านบัตรใหม่ ส่วน receipt หลังส่งอยู่ใน sessionStorage และดาวน์โหลด PNG ได้ ต้องแยกข้อความก่อนส่ง/หลังส่งให้ชัด
- StudentBilling.tsx แบบบิลรายใบยังอยู่ใน repo แต่ router ใช้ StudentBillingBatch; legacy API/alias ที่ยังอยู่ไม่เท่ากับหน้าที่ใช้งานจริง ห้ามนับเป็นสอง flow ที่ทดสอบหน้าจอผ่านแล้ว

### ข้อมูลหลังการทดสอบและผลสมรรถนะที่ตีความได้

ฐานแยก maintenance_flow_test หลัง cleanup: User/Tenant/Room/Bill/Payment/PaymentBatch/PaymentBatchItem/Transaction/MaintenanceTicket/Visitor/VisitorLog/IdCardVerification/HousingApplicationDraft/FaceEnrollmentPhoto/FaceEmbedding/AccessLog/Notification/NotificationPreference = 0 ทุกตารางที่ตรวจ ฐาน housing_payment_test ไม่เคยมีอยู่ก่อนรอบนี้ สร้างเฉพาะทดสอบและลบทิ้งแล้ว

ฐานหลักอ่านอย่างเดียว ณ รอบนี้: User=663, Tenant=0, Room=41, Bill/Payment/Batch/Transaction/MaintenanceTicket=0, Visitor=3, VisitorLog=7, IdCardVerification=5, HousingApplicationDraft=1, AccessLog=3882, FaceEnrollmentPhoto/FaceEmbedding/Notification=0 ตัวเลขนี้ไม่ใช่ข้อสรุปว่าเป็น orphan ทั้งหมด: visitor request/OCR/draft และประวัติล็อกอินมี lifecycle แยกและอาจเป็นรายการใหม่ที่กำลังทำอยู่ ไม่ลบอัตโนมัติหรือสรุปว่าตกค้างจากผู้พักที่ถูกลบโดยไม่มี linkage proof ขณะนี้ไม่มี Tenant ACTIVE ในฐานหลัก จึงยังไม่ได้ทดสอบ UI ด้วยผู้พักจริง

Visitor bounded write check: 12 requests, concurrency 4, committed=12, REGISTERED logs=12, RPS/TPS ≈153.42 บน Express/PostgreSQL/Redis local (ช่วงสั้นประมาณ 78ms) ใช้ OCR fixtures ไม่รวม gateway/real OCR/payment และไม่ใช่ sustained capacity benchmark ดู tests/load/logs/2026-10-13/{stats.csv,run.log,final_report.md} ไม่ใช้ค่านี้รับรองความจุ production

### Endpoint inventory ตามโมดูล

จำนวนด้านล่างคือ route declarations ที่ parser พบจาก router ที่ mount ใต้ /api ใน app.ts รวม alias ดู method/path/source และผล unauthenticated GET แต่ละรายการใน JSON ที่ลิงก์ไว้ ไม่ใช่จำนวนกรณีทดสอบสำเร็จ

| โมดูล | จำนวน route declarations |
|---|---|
| analytics | 3 |
| audit | 1 |
| auth | 9 |
| billing | 16 |
| face-verification | 26 |
| maintenance | 7 |
| notifications | 10 |
| ocr | 9 |
| rooms | 5 |
| settings | 4 |
| tenants | 16 |
| users | 5 |
| visitor | 10 |

### แผนก่อนรอบแก้ (สถานะล่าสุดดูส่วนแก้ flow ด้านล่าง)

1. ปิดช่องว่าง API consent/identity และกำหนด logout revocation รวมถึงจัดสถานะ 2FA ให้ตรงความสามารถจริง; การส่ง SMS จริงอยู่นอก scope
2. แก้ validation/register rate limit และการเก็บไฟล์ staged/face partial upload โดยมี tests ปลายทางและกู้จากความล้มเหลว
3. จำกัดสิทธิ์แก้เงื่อนไขสัญญา ผูก settings กับ delivery และลดข้อมูลอายุ/วันเกิดที่ซ้ำ
4. acceptance ด้วยบัญชี ACTIVE ใน browser: สมัคร/สัญญา/แจ้งซ่อม/บิล/เอกสาร/ย้ายออก/cleanup โดยใช้ mock สำหรับกล้อง/ประตู/SMS/provider ที่อยู่นอก scope

ข้อความส่วนนี้บันทึกผลตรวจรอบแรกก่อนแก้ production; ผลแก้ auth/consent/สัญญาให้ยึดส่วนแก้ flow ด้านล่าง; กล้อง/ประตู/SMS/provider จริงเป็น Out of scope จึงยังไม่สรุปว่า “ระบบทั้งหมดผ่านครบทุก endpoint”


## แก้ flow และปรับกฎให้ตรงระบบ — 13 ต.ค. 2569

ส่วนนี้เป็นสถานะล่าสุดแทนแผนและรายการพบในรอบตรวจด้านบน ไม่ลบประวัติผลทดสอบเดิม และไม่ลดกฎความปลอดภัยเพื่อให้เข้ากับบั๊ก

| เรื่อง | สิ่งที่แก้ในโค้ด |
|---|---|
| ใบสมัครข้าม consent/identity | API บังคับ birthDate, citizenId, address และ contractAccepted=true เสมอ รวม legacy payload; ข้อมูลสัญญาจากข้อมูลส่วนตัวที่ตรวจแล้ว |
| logout/session | เพิ่ม User.authSessionVersion แยกจาก User.version ของ OCC; REST/Socket ตรวจบัญชีจริง, role และ session version. logout ยกเลิกทุกเครื่องและ Socket เก่า, reset/Admin เปลี่ยนรหัสผ่านหรือ role จริงยกเลิก session; แก้เบอร์หรือส่ง role เดิมไม่ทำให้หลุด |
| Register | ตรวจ body/type/email/mobile/password/username ก่อน service, ไม่รับ role ที่ผู้ใช้กำหนด; limit default 10 attempts/IP/hour. Password ไม่ trim และจำกัดไม่เกิน 72 UTF-8 bytes |
| 2FA/Push | ไม่อ้างว่าเปิดใช้ได้: 2FA response=false, การเปิดตอบ 400; ไม่มี Push delivery setting ที่ใช้งานจริงจึงไม่รองรับ |
| เงื่อนไขสัญญา | Admin กรอกข้อมูลจริงในหมวด CONTRACT ผ่านหน้าตั้งค่าเดิม. Draft ส่ง contractTerms จาก server; ผู้สมัครอ่านอย่างเดียวและยอมรับ. ค่าตั้งต้นว่าง ไม่คัดลอกที่อยู่/โทร/วันสัญญาตัวอย่าง. สัญญาเปลี่ยนระหว่างตรวจตอบ 409 เก็บยอดเดิม; snapshot เดิมไม่ถูกแก้จาก settings ใหม่ |
| ก่อนจ่ายเงิน | การสร้าง QR ใหม่ถูกบล็อกถ้าสัญญายังตั้งค่าไม่ครบ; การอ่านยอดเดิม/ตรวจหลักฐานเดิมยังใช้ flow เดิม ไม่สั่งโอนซ้ำ |
| ภาพแจ้งซ่อม | อัปโหลดต้องเป็นผู้พักที่มีห้อง; metadata มี owner/TTL 24h, extension ตาม MIME. บันทึกงานใช้ภาพของเจ้าของและ consume metadata ใน transaction; ภาพหมดอายุล้างโดย worker ถ้าไม่มี ticket อ้างอิง. การ purge ผู้พักรวม staged files |
| Face retry | owner + hash ไฟล์ใช้ metadata เดิมเมื่อ retry ภาพเดิม, คง external forwarding/fallback; หน้าเดิมข้ามภาพที่ส่งสำเร็จและยกเลิก request/timer เมื่อ unmount. ไม่เรียกว่า rollback 5 ภาพทั้งหมด |
| แจ้งเตือน | emailNotifications/smsNotifications=false ยกเลิกการส่งก่อน provider และบันทึก CANCELLED; ไม่ลบ activity/history ในเว็บ |
| ผู้มาติดต่อ | มีวันเกิดให้คำนวณอายุจากวันเกิด, อายุกรอกเองเฉพาะไม่มีวันเกิด; ตรวจวันที่ไม่มีจริง. status/visitStage แยกกันตาม UI เดิมที่นับผู้รอถูกแล้ว |
| สัญญา route เก่า | /agreements ไป /students ที่เปิดเอกสารรายบุคคล แทน /analysis |

ปรับเอกสารเดิม: AGENTS.md, AI-INDEX.md, BLUEPRINT.md (ระบุผังเก่าเป็นแผน), contracts/api-contracts.md, contracts/state-machine.md, spec-consistency.md, spec-frontend.md, architecture/login-flow-study.md, architecture/07-business-workflow.md และกฎ Frontend ที่เกี่ยวข้อง. Service อยู่ในโมดูลจริง; Frontend อยู่ repo ข้างเคียง มีทั้ง src/modules และ src/componants ไม่สร้าง frontend/ หรือ services/ ซ้อนเพื่อให้ตรงผังเก่า

### การนำไปใช้และสิ่งที่ต้องทำต่อ

1. Migration 20261013000000_auth_session_version เป็นการเพิ่ม field โดยไม่ล้างข้อมูล; token เก่าที่ไม่มี sessionVersion ต้องเข้าสู่ระบบใหม่
2. Admin ต้องกรอกเงื่อนไขสัญญาจริงใน ตั้งค่าระบบ → เงื่อนไขสัญญาสำหรับใบสมัครใหม่ ก่อนรับสมัคร/สร้าง QR ใหม่. ไม่ได้เติมข้อมูลสมมติในฐานหลักหรือเปลี่ยนสัญญาที่ส่งแล้ว
3. ยังต้อง browser acceptance ด้วยบัญชี ACTIVE: ทบทวนสัญญา, error/retry, แจ้งซ่อมและเอกสาร. HTTP fixtures ไม่เท่ากับการกดหน้าจอจริง
4. Face progress ในหน้าเดิม retry ได้และ backend กันไฟล์ซ้ำ; หลัง reload ยังไม่ได้กู้ captures/สถานะทั้ง 5 มุมเป็น enrollment session. เป็นข้อจำกัดที่ระบุไว้ ไม่อ้างว่ามี multi-angle transaction
5. กล้อง/ประตู/Edge จริง, SMS จริง และ provider จริงเป็น Out of scope ของรอบนี้; app/API/file cleanup/mock-provider failure ยังอยู่ใน scope

### ผลยืนยันรอบแก้

Backend regression 175/175 และ Frontend regression 108/108 ผ่าน; HTTP/ฐานข้อมูลแยก maintenance-flow 35/35, visitor-registration 29/29, housing-payment 27/27 ผ่าน รวม 91 รายการ. Backend/Frontend build, Backend test typecheck และ lint ไฟล์ที่แก้ผ่าน. ไม่ใช้จำนวน endpoint inventory 121 มารับรอง E2E ทุกเส้นทาง; browser acceptance ยังต้องตรวจตามรายการด้านบน.

เพิ่ม validation role ตาม Prisma: ADMIN/STUDENT/VISITOR; STAFF ไม่รองรับ ตอบ 400 แทน Prisma error และเอาตัวเลือก STAFF ออกจากหน้าจัดการบัญชี. ทดสอบแล้วว่า role ไม่ถูกต้องไม่เปลี่ยนบัญชีหรือยกเลิก session.

นำ backend Docker รุ่นใหม่ขึ้นรันแล้ว: /api/health ตอบ 200 และ /api/auth/me แบบไม่มี session ตอบ 401 หลัง startup. Migration authSessionVersion ถูกใช้แล้ว; token เดิมต้องเข้าสู่ระบบใหม่. ไม่ได้ล้างข้อมูลใช้งานจริงในรอบนี้.

### ความพร้อมสำหรับทดสอบหน้าจอจริง — 13 ต.ค. 2569

ตรวจ runtime แบบอ่านอย่างเดียวหลังสร้างไฟล์สัญญาตัวอย่าง: health ตอบ 200; session Admin และ Student ที่บันทึกไว้ตอบ 401. ตรวจฐาน PostgreSQL ที่ compose ชี้ผ่าน POSTGRES_DB แล้วไม่พบบัญชี test01@gmail.com และค่าหมวด CONTRACT ครบถ้วน 0/12 ช่อง. จึงยังไม่เริ่ม browser acceptance หรือสร้างใบสมัคร/ยอดชำระ/สถานะ ACTIVE ใหม่. ไฟล์ sample-rental-contract.html และ JSON เป็นเอกสารตัวอย่าง ไม่ถูกนำไปแทนค่าจริงในฐานข้อมูล.

ก่อนทดสอบต่อ: Admin เข้าสู่ระบบใหม่และกรอกเงื่อนไขสัญญาจริงครบ 12 ช่อง; ระบุบัญชีผู้พัก ACTIVE ที่มีอยู่ หรือสมัครบัญชีทดสอบตาม flow แล้วอนุมัติผ่าน Admin. ใช้ session ใหม่ที่บันทึกในไฟล์ โดยไม่ส่ง token ในแชต. เริ่มตรวจสัญญา/ข้อมูลหลังรีเฟรช → แจ้งซ่อม → บิล/เอกสาร; การทดสอบย้ายออก/ลบให้ระบุบัญชีทดสอบที่ยอมให้ลบก่อนลงมือ. ยังไม่รับรองว่าการกดหน้าจอผ่านจากผล HTTP fixtures.

### แก้ช่องตั้งค่าสัญญาที่ไม่ปรากฏใน Admin — 13 ต.ค. 2569

ตรวจกรณีสร้าง QR ห้อง 402 ได้ 409: ห้อง AVAILABLE ชั้น 4 ราคา 50 บาท แต่ค่าหมวด CONTRACT ทั้ง 12 ช่องยังไม่มีในฐานที่ compose ใช้. พบว่าหน้า AdminPanel กำหนด contractSettingFields และ payload แล้ว แต่ไม่มี JSX แสดงช่องกรอกจริง; ข้อความก่อนหน้าที่ระบุว่าหน้าตั้งค่ามีช่องครบจึงคลาดเคลื่อน. เพิ่ม fieldset เงื่อนไขสัญญาสำหรับใบสมัครใหม่ครบ 12 ช่อง ใช้ save handler เดิม พร้อม required/type/range และข้อความผลต่อใบสมัครใหม่. Lint และ frontend build ผ่าน. ยังไม่เติมค่าตัวอย่างลงฐาน ไม่ข้าม guard QR และยังไม่รับรอง provider จริง. ผู้ดูแลต้องกรอกข้อมูลจริงและบันทึกก่อนลองสร้าง QR อีกครั้ง.

### ความครบของใบสมัครกับความพร้อมสัญญาส่วนกลาง

ตรวจโค้ดกรณีผู้สมัครกรอกครบแต่สร้าง QR 409: validation ข้อมูลส่วนตัวในขั้น 1 และผู้ติดต่อในขั้น 2 ไม่ได้ตรวจค่ากลางสัญญา; validation สัญญาเดิมอยู่ขั้น 3/4 จึงมาถึงหน้าชำระได้ก่อนพบปัญหา. แก้หน้าใบสมัครให้ตรวจ 12 เงื่อนไขกลางจาก draft.contractTerms ตั้งแต่มี draft และแจ้งชัดว่าข้อมูลผู้สมัครยังอยู่. หากค่ากลางไม่ครบไม่ร้องขอ QR ใหม่ และมีปุ่ม refresh อ่านค่าจาก server เมื่อ Admin บันทึกแล้ว. การตรวจนี้ไม่พึ่งเลขห้อง ชั้น หรือค่าเช่าก่อนเลือกห้อง. ไม่เติมค่าทางการสมมติ ไม่แก้ยอดชำระ และยังอนุญาตตรวจสลิปเดิมเพื่อกู้ยอดที่โอนแล้ว. Frontend regression 108/108 ผ่าน; lint/build ตรวจในรอบนี้.

### ข้อความตรวจยอดที่ค้างโดยไม่มี request

พบว่า RoomPreferences ใช้ paymentAmount=null แทนหลายเหตุการณ์ แต่แสดง “กำลังตรวจยอดเดิม…” ทุกกรณี รวมสัญญาส่วนกลางไม่พร้อม, draft error และ pending payment ซึ่งไม่ใช่การรอ API. เพิ่ม paymentUnavailableReason จากหน้าใบสมัคร แยกสัญญาไม่ครบ/โหลดล้มเหลว/รายการรอตรวจ/บันทึกห้อง และเปลี่ยนข้อความ fallback ให้ไม่อ้างว่ากำลังโหลด. ไม่ใช้ข้อความนี้สรุปว่า API ช้าหรือ DB มีปัญหา; ยังไม่ได้วัด latency ของ session ผู้พักจริง. Lint และ frontend build ผ่าน.

### สมัครใหม่ด้วยบัญชีเดิมหลังลบผู้พัก

ผู้ใช้ยืนยันขอบเขตว่าให้สมัครใหม่หลังลบผู้พัก ไม่ได้ขอเอาเงื่อนไขสัญญาออกจาก QR. ตรวจแล้ว AccountRetentionService.deleteTenant เรียก purgeUserArtifacts ซึ่งลบ HousingApplicationDraft เดิมและข้อมูลผู้พักโดยเก็บ User. เพิ่ม assertion ใน integration: ฉบับร่างเดิม SUBMITTED ถูกลบหลังย้ายออก/ปิดงานซ่อม/DELETE; session เดิมเรียก tenants/me ได้ null; GET draft สร้าง OPEN ใหม่ data={} ห้องว่าง เครดิต 0; PATCH draft เลือกห้องและบันทึกข้อมูลใหม่สำเร็จจริงใน PostgreSQL. maintenance-flow 35/35 ผ่านใน maintenance_flow_test ไม่มีข้อมูลจริงถูกลบ. ไม่จำเป็นต้องตั้ง flag สมัครใหม่ใน settings; เมื่อไม่มี Tenant แล้ว flow เดิมเริ่มใหม่ได้อัตโนมัติ. สัญญาส่วนกลางยังเป็นเงื่อนไขก่อนชำระเงินตามขอบเขตเดิม.

### วันสัญญาอัตโนมัติ 5 เดือน — 13 ต.ค. 2569

ตามคำขอผู้ใช้ getContractTerms กำหนดวันเริ่มเป็นวันที่ปัจจุบันใน Asia/Bangkok และวันสิ้นสุดบวก 5 เดือนปฏิทิน ปรับวันให้ไม่เกินวันสุดท้ายเดือนปลายทาง (รองรับ leap year). Admin ไม่แสดง/ไม่ส่งช่องวันที่สองช่องแล้ว เหลือค่ากลาง 10 ช่องที่ต้องกรอก; ค่าวันใน settings เก่าเก็บไว้เพื่อ compatibility แต่ไม่ใช้สร้างสัญญาใหม่. Snapshot สัญญาที่ส่งแล้วไม่เปลี่ยน. ตัวอย่างปรับเป็น 13 ต.ค. 2569–13 มี.ค. 2570. Backend 176/176 และ integration maintenance-flow 35/35 ผ่าน; build backend/frontend และ lint ไฟล์ที่แก้ผ่าน.

### ตรวจต่อหลังผู้ดูแลตั้งค่าสัญญา — 13 ต.ค. 2569

ตรวจฐานที่ compose ใช้แบบอ่านอย่างเดียว: เงื่อนไขสัญญากลางครบ 10 ช่องแล้ว; มีฉบับร่าง SUBMITTED ห้อง 402 และผู้พัก APPROVED/isActive=true 1 ราย. ตรวจ snapshot สัญญา: วันเริ่ม 2026-10-13 วันสิ้นสุด 2027-03-13, contractAccepted=true, ห้อง/ค่าเช่าตรง Room; payment PAID 50 บาทผูก Tenant และ housingApprovedAt มีค่า. ยังไม่เปลี่ยนเป็น ACTIVE หรือเติม checkInDate แทนการเข้าพักจริง (ตรวจพบ checkInDate ยังว่าง).

รัน housing-payment integration ในฐานชั่วคราวที่ migrate ใหม่ผ่าน 27/27 และลบฐานทดสอบหลังจบ ครอบคลุมอัปโหลดซ้ำ/เลข transaction ซ้ำ/ยอดและสิทธิ์ไม่ตรง/draft credit/retry ตามชื่อ tests. Provider/OCR เป็น mock ไม่อ้างว่า service จริงผ่านจากการทดสอบนี้. ไม่มีการสร้างยอดหรือแก้ใบสมัครจริง. รอบต่อไปตรวจหน้าผู้พัก: แสดงห้อง/สัญญา/ดาวน์โหลด → แจ้งซ่อมและ Admin ปิดงาน → บิล. การย้ายออก/ลบจริงต้องระบุรายการทดสอบก่อน เพราะปัจจุบันมีสัญญาและยอดชำระจริงผูกแล้ว.

## ตรวจตามลำดับ 6 ขั้น — 13 ต.ค. 2569

| ขั้น | หลักฐานและสถานะ |
|---|---|
| 1 Login/settings | ตรวจ session ที่บันทึกจริง Admin/Student ตอบ 401 ต้องบันทึก session ใหม่; ก่อนรอบนี้ตรวจฐานจริงค่าสัญญาครบ 10 ช่องแล้ว. การ register/login/logout ถูกทดสอบด้วย API ในฐานแยก ไม่อ้างว่าล็อกอินผ่าน browser แล้ว |
| 2 Draft/contract/credit | HTTP/DB ตรวจ reload ยอดเดิม, อัปเกรดห้องจ่ายส่วนต่าง, transaction/slip ซ้ำ, idempotent apply, terms tampering และ submitted draft เขียนใหม่ไม่ได้ ผ่าน |
| 3 Maintenance | HTTP สร้าง → APPROVED → IN_PROGRESS → RESOLVED → ผู้พักยืนยัน CLOSED; ตรวจสิทธิ์, quota, concurrency และ GET สถานะ ผ่าน |
| 4 Billing/documents | ออกบิลรายเดือนและตรวจยอด/สิทธิ์ผ่าน; เพิ่ม binary GET เอกสารบัตรและสลิปของผู้พักกับ Admin เปรียบเทียบ bytes กับไฟล์จริง ผ่าน; ไม่มี session ได้ 401 ผู้พักอื่นเรียก Admin endpoint ได้ 403 |
| 5 Move-out/delete | ในฐานแยก: หนี้/งานซ่อมค้างบล็อก; ลบ Tenant/บิล/รายการชำระ/ฉบับร่างโดยเก็บ User; เปิด draft ใหม่ได้. เพิ่มตรวจไฟล์จริงหลังเรียก worker flushFiles และ endpoint เอกสารหลังลบได้ 404 ผ่าน |
| 6 Report/fixes | อัปเดตรายงานนี้และเพิ่ม assertion ใน test เดิม. ไม่พบ production bug ใหม่จากชุดนี้; พบว่า test ต้องเดินต่อถึง cleanup worker ตาม flow จริง |

ผลรอบนี้ maintenance-flow 35/35 ผ่าน. รอบแรก 34/35 เพราะ assertion คาดว่าไฟล์ถูกลบทันทีหลัง DELETE; โค้ดจริงตอบพร้อม cleanup receipt และใช้ worker ล้างภายหลัง จึงแก้การทดสอบให้เรียก worker ต่อ ไม่แก้ production ให้รอ provider/file backlog. Provider/OCR/Face เป็น mock หรืออยู่นอก scope; file cleanup ในเครื่องทดสอบถูกยืนยันจริง. ไม่ลบรายการจริงห้อง 402 หรือสร้างบิลจริง. Browser acceptance การแสดง UI/พิมพ์สัญญา/ดาวน์โหลดจากปุ่มและ flow ด้วย session จริงยังรอ; ไม่มี browser automation tool ใน session นี้ จึงไม่ใช้ HTTP ผ่านแทนการกดหน้าจอ.

### ตรวจ API ด้วย session ผู้พักจริง — 13 ต.ค. 2569

session ผู้พักที่ได้รับตรวจผ่าน auth/me 200. tenants/me 200: APPROVED/isActive=true ห้อง 402, มี snapshot สัญญา 2026-10-13–2027-03-13 และ consent=true. billing 200 พบ UNPAID 1 รายการ; maintenance 200 พบ PENDING 1 รายการ. GET เอกสารของตน id-card และ payment-slip ตอบ 200 image/jpeg ขนาด 1,679,441 และ 133,308 bytes ตามลำดับ; ไม่บันทึกภาพ/ข้อมูลบัตร/token ลงรายงาน. นี่เป็น live HTTP acceptance ไม่ใช่ผลกด browser. ไม่ขอสร้าง QR มัดจำหรือโอนซ้ำเพราะใบสมัครส่งแล้ว. ขั้นถัดไปรอ session Admin สำหรับดำเนินงานซ่อม; บิลยังให้ผู้ใช้ชำระเอง ไม่เปลี่ยนสถานะ PAID แทนหลักฐาน. ห้ามย้ายออก/ลบจนกว่างานซ่อมและบิลค้างได้รับการจัดการตาม guard.

### รับงานซ่อมผ่าน session Admin จริง — 13 ต.ค. 2569

Admin auth/me และ GET maintenance ตอบ 200. งาน 248 ของ Tenant 67 เริ่ม PENDING; เรียก PATCH status ตามลำดับ APPROVED → IN_PROGRESS → RESOLVED ได้ 200 และ payload สถานะตรงทุกครั้ง; GET Admin ยืนยัน RESOLVED. Note ระบุว่าเป็นการทดสอบ flow ไม่ใช่หลักฐานการซ่อมจริง. ยังไม่เรียก confirm ด้วย Admin เพราะ route require STUDENT; รอผู้พักยืนยันผ่านหน้าจอเพื่อจบ CLOSED และยืนยัน browser acceptance ส่วนนี้. บิล/ยอดชำระ/ข้อมูลผู้พักยังไม่ถูกแก้หรือถูกลบ. ไม่บันทึก JWT ลงรายงาน.

### ผู้พักยืนยันปิดงานทดสอบแล้ว — 13 ต.ค. 2569

ผู้ใช้รายงานว่ากดปิดงานผ่านหน้าจอแล้ว; ตรวจ PostgreSQL ที่ระบบจริงใช้ยืนยัน MaintenanceTicket 248/Tenant 67 เป็น CLOSED และไม่เหลืองานซ่อมที่ไม่ CLOSED/CANCELLED ของผู้พักรายนี้. จึงผ่านขั้น Admin รับงาน/ดำเนินงาน/RESOLVED → ผู้พักยืนยัน CLOSED ทั้งรายงานจากหน้าจอและฐานข้อมูล. ผู้พักยัง APPROVED/isActive=true ห้องเดิม. พบ Bill 58 UNPAID 100.00 บาท จึงยังไม่ดำเนินย้ายออกหรือ DELETE เพราะมีบิลค้างตาม guard. ส่วนชำระเงินจริงให้ผู้ใช้จัดการตามคำสั่งเดิม ไม่ปรับ PAID หรือยอดเงินด้วย fixture.

### ทดสอบ guard ย้ายออกกับบิลค้างจริง — 13 ต.ค. 2569

ตรวจล่าสุด Bill 58 ยัง UNPAID 100 บาท; Payment PAID ที่ผูกผู้พักเป็นยอดสมัคร ไม่ใช้แทนบิลรายเดือน. Admin session ตรวจ 200; PATCH /api/tenants/67 {status:INACTIVE} ตอบ 409 “ต้องจัดการบิลค้างก่อนย้ายออก”. GET หลัง attempt ยืนยัน status=APPROVED,isActive=true,roomId=159 คงเดิม ไม่มีการปล่อยห้องหรือเปลี่ยนยอดเงิน. จึงผ่านการป้องกันย้ายออกที่มีหนี้ แต่ยังไม่ทดสอบย้ายออกสำเร็จ/DELETE กับรายการจริงจนบิลนี้จัดการผ่าน flow ปกติ.

### กระดิ่งแจ้งเตือน User — 13 ต.ค. 2569

เพิ่มกระดิ่งใน StudentHome และ UserPageHeader ของหน้าผู้พัก ใช้รายการบิลและงานซ่อมจาก GET /api/billing และ GET /api/maintenance ซึ่ง backend กรองเจ้าของบัญชีไว้แล้ว แสดงสถานะล่าสุดต่อรายการ รวมบิลใหม่และงาน RESOLVED ที่รอผู้พักยืนยัน จุดแดงอยู่บนกระดิ่งและมุมขวาบนของรายการที่ยังไม่อ่าน กดรายการเพื่ออ่านและเปิดหน้าบิล/แจ้งซ่อม หรือกดอ่านทั้งหมดได้

สถานะอ่านเก็บแยกตาม User ใน localStorage ของเบราว์เซอร์นี้ ไม่ใช่สถานะอ่านร่วมข้ามเครื่อง เมื่อสถานะบิล/งานซ่อมเปลี่ยนถือเป็นรายการใหม่ เมื่อ API ไม่คืนข้อมูลที่ถูกลบแล้ว รายการแจ้งเตือนนั้นหายจากผล refresh สำเร็จครั้งถัดไป ข้อมูลอัปเดตทุก 30 วินาทีและเมื่อ Socket เชื่อมต่อใหม่ ไม่อ้างว่าเป็น push ทันที เพราะ event เดิมส่งให้ Admin เป็นหลัก ยกเลิก HTTP และ timers เมื่อเปลี่ยนบัญชีหรือ unmount

Source review: ตรวจ route ปลายทางและ owner filter ของ API แล้ว Unit/mock: frontend ผ่าน 112/112 รวม 4 tests ใหม่เรื่องสถานะอ่าน/เปลี่ยนสถานะ/ลบข้อมูล/แยกบัญชี/cleanup; lint ไฟล์ที่แก้และ frontend build ผ่าน ยังไม่ได้ browser acceptance ของกระดิ่งผ่านบัญชีจริง และไม่มีการเรียก provider ภายนอกหรือแก้ยอดชำระในการทดสอบนี้


เพิ่มเติมกล่องเมนู User: แสดงจุดแดงมุมขวาบนของกล่องเมื่อมี alert ที่ยังไม่อ่านและ href ตรงกับเมนูนั้น กดกล่องเพื่ออ่านรายการของเมนูและเปิดหน้า ใช้สถานะร่วมกับกระดิ่ง รองรับเมนูบิล/เอกสาร/แจ้งซ่อม โดยยังไม่มี event เอกสารใหม่ จึงไม่แสดงจุดแดงปลอมในเมนูเอกสาร ตรวจ lint StudentHome และ frontend build ผ่าน; ยังไม่ได้ browser acceptance รอบนี้


### ปรับรายละเอียดบิล Admin — 13 ต.ค. 2569

ใช้ Modal ร่วมเพื่อรองรับ Escape, focus และหน้าจอเล็ก จัดยอดเรียกเก็บและสถานะไทยไว้ส่วนต้น แสดงข้อมูลผู้พัก/ห้อง/วันออกบิล/กำหนดชำระ/รายการเรียกเก็บเป็นหมวด แยกประวัติการชำระเงินกับภาพสลิป ตัดสถานะบิลที่ซ้ำและรหัส UNPAID ออกจากการแสดงผล เพิ่มวันที่ตรวจและเหตุผลที่ไม่ผ่านเมื่อมีข้อมูล ไม่แสดงยอด 0 แทนยอดรายการที่ไม่มีข้อมูล แยกสลิป 404 จากข้อผิดพลาดโหลดสลิปอื่น โดยกรณีอื่นแสดงข้อความให้เปิดใหม่ ไม่สรุปว่าไม่มีสลิป

ตรวจ lint ไฟล์ที่แก้และ frontend build ผ่าน ชุด unit/mock เดิมผ่าน 112/112 ไม่ได้เพิ่ม browser acceptance หรือแก้สถานะ/ยอดเงินจริงในรอบนี้


รายการเรียกเก็บในรายละเอียดบิล Admin เปลี่ยนเป็นตารางประเภท/รายละเอียด/จำนวนเงิน ใช้ rentAmount, electricAmount, waterAmount, penaltyAmount จากรายละเอียดบิล แสดงยอดของผู้พักรายนี้กับยอดรวมบิล ค่าไฟอธิบายหน่วยและอัตราจากข้อความ snapshot เดิม จำนวนผู้พักที่ใช้หารอ่านจาก snapshot ตอนออกบิล ไม่ใช้จำนวนผู้พักปัจจุบัน ถ้า fields ไม่มีหรือผลรวมไม่ตรงยอดบิล แสดงยอดตามบิลและแจ้งว่าไม่มีข้อมูลแยกประเภทที่ตรง ไม่แต่งยอดค่าใช้จ่ายขึ้นเอง ตรวจ build/lint ผ่านและตรวจ helper จริง 6 กรณี: ยอดศูนย์, ส่วนแบ่งที่บันทึก, ผลรวมไม่ตรง, legacy ขาด fields, ค่าผิดรูปแบบ, ค่าปรับ ยังไม่ได้ browser acceptance ของตารางรอบนี้


### สถานะบันทึกใบหน้าครบและการซ่อนเมนู User — 13 ต.ค. 2569

หลังหน้า UserIdentityFlow ส่งภาพครบ 5 รายการสำเร็จ เรียก POST /api/tenants/me/face-enrollment/complete โดยใช้ User จาก session เท่านั้น ไม่มี userId ใน body บันทึก marker FACE_ENROLLMENT_COMPLETE ใน AccessLog เดิมภายใต้ owner lock เฉพาะผู้พัก active/APPROVED หรือ ACTIVE ที่มีห้อง มีภาพอย่างน้อย 5 และไม่ faceRevokedAt เรียกซ้ำไม่เพิ่ม marker ซ้ำ GET /api/tenants/me คืน faceEnrollmentComplete โดยตรวจ marker ตรง Tenant ปัจจุบันและยังมีภาพครบ ไม่ส่ง accessLogs/_count ภายในออกไปกับ user profile เมนูบันทึกใบหน้าซ่อนเมื่อ true และเปิด URL เดิมจะกลับหน้าหลัก หากส่งภาพหรือบันทึก marker ไม่สำเร็จยังคง retry ได้ สถานะนี้เป็นสถานะ UI ของการบันทึก ไม่ใช้อนุญาตประตูหรือรับรองการทำงานของ provider

การ DELETE ผู้พักผ่าน guarded purge ลบ FaceEmbedding/FaceEnrollmentPhoto และ access logs พร้อม revoke ใบหน้า เก็บ User; งาน cleanup ล้างไฟล์และ provider ภายนอกแบบ retry จึงอาจตอบ PENDING จนล้างสำเร็จ การครบวัน endDate อย่างเดียวปัจจุบันไม่มี scheduler ลบใบหน้าอัตโนมัติ ต้องดำเนินย้ายออกและลบผู้พักตาม flow เดิม บัญชีที่เคย revoke ต้องผ่านการคืนสิทธิ์โดยผู้ดูแลก่อนลงทะเบียนใบหน้าใหม่ ไม่ปลด revoke อัตโนมัติจากการซ่อนเมนู

ตรวจ build/lint Backend และ Frontend ผ่าน Backend unit/mock 180/180 (เพิ่ม 4 กรณี completion/persistence/idempotency/privacy/incomplete/revoked/inactive/old tenant) Frontend 112/112 รอบนี้ไม่ได้ทดสอบกล้อง/ประตู/provider จริง และยังไม่มี browser acceptance ของ flow ใหม่


### ปิดช่องว่างการลบแล้วสมัครใหม่ — 13 ต.ค. 2569

ตรวจระบบจริงแบบอ่านอย่างเดียว: Admin session ที่ผู้ใช้ให้ตรวจ auth/me ได้ 200; GET /api/payment-batches/admin/bills/58/payment-details ได้ 200, บิล UNPAID 100 บาท ไม่มี payments/batches ของบิลนี้; GET /api/tenants/67 ได้ 200 สถานะ APPROVED ห้อง 402 ตาม PostgreSQL งาน 248 CLOSED ข้อมูลใบหน้า User 781 ยังไม่มีภาพ/template ตรวจดาวน์โหลด /api/tenants/67/documents/id-card และ payment-slip ได้ 200 image/jpeg ขนาด 1,679,441 และ 133,308 ไบต์ ไม่บันทึกไฟล์หรือ token ลงรายงาน session ผู้พักในไฟล์เดิมตอบ 401 จึงยังไม่ได้ทดสอบการกดหน้าจอผู้พักรอบนี้ ไม่ย้ายออก ลบ หรือแก้ยอดเงินจริงขณะที่บิลค้าง

พบบั๊ก: purge เก็บ User แต่ตั้ง faceRevokedAt ทำให้ผู้สมัครเดิมแม้สมัครใหม่และอนุมัติแล้วลงทะเบียนใบหน้าไม่ได้ แก้ใน transaction อนุมัติ Tenant ใหม่จาก PENDING ให้คืนสิทธิ์เฉพาะเมื่อ face-cleanup ของ User ตรงเจ้าของอยู่ phase DONE และไม่มี FaceEnrollmentPhoto/FaceEmbedding เก่า ถ้ายังล้างค้างตอบ 409 และ rollback การอนุมัติ ไม่คืนสิทธิ์เมื่อเพียงกรอกใบสมัคร ไม่ปลด revoke จากการแก้สถานะของผู้พัก ACTIVE เดิม

HTTP/PostgreSQL integration ฐานแยก maintenance_flow_test ผ่าน 36/36: ขยาย flow เดิมจนถึงลบผู้พัก → GET draft ใหม่ยอด 0 → อ่านบัตรแบบ mock → ตรวจสลิปแบบ mock ยอดครบ → POST apply ด้วย User เดิม → ล้าง owner ภายนอกแบบ mock → Admin อนุมัติ → faceRevokedAt กลับเป็น null และ faceEnrollmentComplete เป็น false ต้องบันทึกใบหน้าใหม่ เพิ่มตรวจ completion API 401/403, การส่ง userId คนอื่นไม่เปลี่ยนเจ้าของ, เรียกซ้ำมี marker เดียว, refresh อ่านสถานะได้, ไม่ส่ง metadata ภายใน, ลบภาพ/marker ครบ, ไฟล์ทดสอบทั้ง 5 หายจากดิสก์จริง, cleanup ค้างขวางอนุมัติและไม่เปลี่ยน PENDING

ตรวจข้อมูลหลัง suite: User/Tenant/Room/Bill/Payment/MaintenanceTicket/FaceEnrollmentPhoto/FaceEmbedding/HousingApplicationDraft/SystemSetting = 0 พบคิว RETENTION_FILES จากรอบทดสอบเก่า 81 รายการก่อนแก้ teardown; ปรับเก็บกวาดเฉพาะฐานทดสอบที่ไม่มีข้อมูลอ้างอิงและไฟล์ ENOENT โดยไม่ลบไฟล์จริงอื่น จึงไม่เหลือคิวทดสอบตกค้าง

Backend unit/mock 180/180 ผ่าน Build, lint ไฟล์ที่แก้ และ test:typecheck ผ่าน deploy backend Docker แล้ว ตรวจ endpoint completion แบบไม่มี cookie ตอบ 401 หลัง deploy Provider/กล้อง/ประตูจริงยัง Out of scope ไม่ใช่หลักฐาน browser acceptance ขั้นที่ยังต้องผ่านบัญชีจริง: ผู้ใช้ชำระบิล 58 ตามเดิม → ตรวจสถานะ PAID → ย้ายออก/ลบ/ล้างคิวครบ → สมัครใหม่ และตรวจ UI แจ้งเตือน/ตารางบิล/เมนูใบหน้าด้วย session ผู้พักใหม่
### ปรับแถบแบ่งหน้าบิลผู้พัก — 13 ต.ค. 2569

หน้า StudentBillingBatch แบ่งหน้าละ 5 บิลค้างชำระ และแสดงแถบแบ่งหน้าเฉพาะเมื่อมีเกิน 5 บิล; กรณี 0–5 บิลซ่อนทั้งสรุปช่วงรายการและปุ่มเปลี่ยนหน้า ใช้ hook เดิมที่ปรับเลขหน้าเมื่อจำนวนบิลลดลง Frontend build และ lint ผ่าน ยังไม่ได้ตรวจผ่าน browser รอบนี้ ผู้ใช้แจ้งว่าชำระเงินแล้ว แต่รอบแก้ UI นี้ยังไม่ได้ตรวจสถานะ PAID จาก API/ฐานข้อมูล

### แยกแจ้งเตือน User/Admin — 13 ต.ค. 2569

Deploy backend Docker สำเร็จ; GET /api/notifications แบบไม่มี cookie ตอบ HTTP 401/body 401 ตรวจฐานข้อมูลจริงแบบอ่านอย่างเดียวพบ Bill #58 สถานะ PAID ยอด 100 บาทแล้ว ไม่ได้เปลี่ยนสถานะหรือยอดด้วยสคริปต์

แก้ REST ให้ Admin รับเฉพาะ Notification ที่ไม่มีเจ้าของ User/Tenant; ผู้พักอ่านเฉพาะบัญชีตนเองหรือ legacy tenant-only ที่เป็นของตนเอง ไม่เปิดให้ query userId เปลี่ยนสิทธิ์ แก้ Socket ให้ข้อความส่วนบุคคลส่ง user:<id> ส่วนงานส่วนกลางส่ง admins ไม่ส่งข้อมูลส่วนตัวตามห้องร่วม Legacy tenant-only ไม่ broadcast เมื่อระบุบัญชีปลายทางไม่ได้

Frontend แยก storage ตาม role และ account ไม่ใช้ข้อมูลผสมเดิม; ผู้พักรับสถานะบิล งานซ่อม และสัญญาที่มีผลใกล้หมดอายุ 0–30 วันตาม Asia/Bangkok พร้อมลิงก์เอกสาร สัญญาไม่ถูกต้อง/หมดอายุ/ยังอีกเกิน 30 วันไม่สร้างแจ้งเตือน วันสัญญาใช้ snapshot ISO ของระบบ สถานะอ่านแล้วคงไว้จนข้อมูลเปลี่ยนหรือรายการหาย ตรวจทุก 30 วินาที/เมื่อ reconnect/เมื่อได้รับ owner notification ไม่อ้างว่าทุกการแก้บิลหรือซ่อม push ทันทีทุกกรณี Read state ยังแยกตาม browser ไม่ได้ sync ข้ามเครื่อง Admin ใช้ notificationAlert เป็นเหตุการณ์หลัก ลดซ้ำจาก alias บิล/ซ่อม/visitor; หน้างานอื่นยังใช้ alias ได้ เพิ่มแจ้งซ่อมใหม่รอรับงานให้ Admin และแก้ notification ตอนสร้างงานจาก MAINTENANCE_COMPLETED เป็น GENERIC

หลักฐาน: Backend unit/mock 182/182; Frontend unit/mock 115/115; HTTP/PostgreSQL isolated maintenance_flow_test 37/37 รวม anonymous 401, query userId ไม่เปลี่ยนเจ้าของ, owner/tenant legacy scope และ Admin ไม่ปะปนข้อมูลส่วนบุคคล Socket routing ทดสอบ transport mock ไม่ใช่ browser หรือ provider จริง Build/lint และ test:typecheck ผ่าน ไม่แก้ยอดชำระเงินจริงในงานนี้ Browser acceptance ของกระดิ่งยังต้องตรวจหน้าจอจริง

### เตรียมย้ายออกและพบ QR เก่าค้าง — 13 ต.ค. 2569

ตรวจ Batch 128 เพิ่มแล้ว: ไม่มีหลักฐานการโอนทุกช่อง เป็นของ User 781 และทุกบิลเป็น PAID ของ Tenant 67 จึงเข้าเงื่อนไข QR placeholder ที่แก้ Backend unit/mock 182/182 ผ่านและ deploy backend Docker สำเร็จแล้ว ยังไม่ลบจริงเพราะไม่มี session Admin ที่ใช้งานได้

ตรวจฐานข้อมูลจริงแบบอ่านอย่างเดียว: User 781/Tenant 67 APPROVED ห้อง id 159; Bill 58 PAID 100 บาท, Maintenance 248 CLOSED, Payment 9 PAID, Batch 129 PAID แต่ Batch 128 PENDING ยังผูกอยู่ ไม่มี visitor/OCR job/ภาพใบหน้า Draft 3 SUBMITTED พบไฟล์อ้างอิง 10 ไฟล์และมีอยู่จริงครบ เก็บเฉพาะรายการ path ชั่วคราวนอก repo เพื่อเทียบหลัง purge ไม่บันทึกข้อมูลเอกสารหรือ token ในรายงาน Cookie Admin เดิมตอบ 401 ยังไม่ได้ย้ายออกหรือลบข้อมูลจริง

พบ guard purge นับชุด QR ที่ยังไม่ส่งสลิปเป็นรายการเงินค้าง แม้บิลทั้งหมดจ่ายแล้ว แก้เฉพาะ purgeTenant ให้ชุด PENDING ที่เป็นของผู้พักคนเดียว ไม่มี slipHash/slipPath/slipAmount/transferAt/providerTransactionId/providerResponse/verifiedAt/failureReason และทุกบิล PAID สามารถถูกลบพร้อมชุดข้อมูลใน transaction เดิม ไม่เปลี่ยนยอดเงิน/สถานะ PAID ไม่เปิดให้ลบ shared batch, payer อื่น, unpaid, VERIFYING หรือรายการมีหลักฐาน

HTTP/PostgreSQL isolated maintenance_flow_test 38/38 ผ่าน เพิ่มทดสอบทีละชนิดหลักฐานแล้ว DELETE 409/profile คงอยู่; VERIFYING 409; หลังล้างหลักฐานเฉพาะ fixture จึง DELETE 200/202 และ Bill/Batch หาย User คงอยู่ Build, test:typecheck และ lint ไฟล์ที่แก้ผ่าน Provider ใช้ mock ในฐานทดสอบ การลบผ่านบัญชีจริงรอ session Admin ใหม่ ยังไม่ถือว่า real end-to-end purge ผ่าน

### ย้ายออกและ purge ผ่านระบบจริง — 13 ต.ค. 2569

ใช้ session Admin ที่ผู้ใช้ให้ตรวจ GET /api/auth/me 200 และ role ADMIN; ตรวจ GET /api/tenants/67 ว่าเป็น User 781 ก่อนดำเนินการ PATCH /api/tenants/67 {status: INACTIVE} ได้ 200 สถานะ INACTIVE, roomId null; DELETE endpoint เดิมได้ 202 และ cleanup receipt 11 tasks; GET /api/tenants/67 หลังลบ 404 ไม่ใช้การลบตรงฐานข้อมูลหรือเปลี่ยนยอดเงินด้วยสคริปต์

ตรวจฐานข้อมูลจริงหลัง worker ทำงาน: User 781 = 1; Tenant/Bill/Payment/PaymentBatch/PaymentBatchItem/MaintenanceTicket/Visitor/HousingApplicationDraft/IdCardVerification/OcrJob/FaceEnrollmentPhoto/FaceEmbedding/Notification/NotificationPreference/AccessLog/Transaction ของเจ้าของนี้ = 0 รวม Batch 128 ที่ไม่มีหลักฐานและ Batch 129 ที่ชำระแล้วถูก purge ตามนโยบาย ข้อมูลบัญชี User คงอยู่ ห้อง id 159 ยังอยู่ สถานะ AVAILABLE และไม่มี Tenant อ้างอิง

ไฟล์อ้างอิงก่อนลบ 10 ไฟล์มีอยู่จริงครบ หลังลบ fs.stat ได้ ENOENT ครบ 10/10 ไม่เหลือไฟล์ของชุดที่ตรวจ ตรวจ GET /api/face-verification/cleanup/:taskKey ครบทุก key ได้ 200/COMPLETE ทั้ง 11 tasks ไม่มี PENDING; face-cleanup:user:781 อยู่ phase DONE เป็น metadata ยืนยัน cleanup เพื่อให้อนุมัติใบสมัครใหม่และคืนสิทธิ์ใบหน้าได้ ไม่ใช่ภาพหรือ template User นี้ไม่มีภาพใบหน้าก่อนลบ จึงไม่อ้างว่ารอบนี้ทดสอบลบภาพใบหน้าจริงหรือ provider ภายนอกจริงผ่าน

ตรวจรายการผู้พักผ่าน GET /api/tenants ได้ 200 ไม่พบ Tenant 67/User 781; endpoint เอกสาร id-card และ payment-slip ของ Tenant 67 ตอบ 404 ทั้งคู่ เก็บ snapshot paths และ cleanup receipt ชั่วคราวใน TEMP เท่านั้น ไม่บันทึก token/ภาพ/ข้อมูลบัตรลงรายงาน ไม่แก้ข้อมูลบัญชีอื่น

ข้อจำกัด: รอบนี้ยืนยัน HTTP/DB/files จริง ไม่ใช่การคลิกผ่าน browser สถานะอ่านแจ้งเตือนยังอยู่ browser-local จนรอบ refresh อ่านข้อมูลล่าสุด การสมัครใหม่ผ่านหน้าเว็บด้วยบัญชีเดิมยังต้องให้ผู้ใช้ทำ OCR/ชำระเงินตามขอบเขตเดิม; flow สมัครใหม่และอนุมัติคืนสิทธิ์ใบหน้าในฐานทดสอบแยกผ่านแล้ว แต่ยังไม่ยืนยัน browser acceptance ของใบสมัครใหม่จริง

### ผู้ใช้ยืนยันสมัครใหม่ได้หลัง purge — 13 ต.ค. 2569

ผู้ใช้แจ้งว่าได้ทดสอบเรียบร้อยและสามารถสมัครใหม่ด้วยบัญชีเดิมได้ เป็นผล browser acceptance ที่ผู้ใช้ยืนยันต่อจาก HTTP/DB/files ของการย้ายออกและ purge จริงข้างต้น ยืนยันเฉพาะความสามารถในการสมัครใหม่ตามข้อความผู้ใช้ ไม่อนุมานว่าอนุมัติ ACTIVE ใหม่แล้ว ยอดเครดิตใหม่เป็นศูนย์ หรือการลงทะเบียนใบหน้าใหม่ผ่าน หากยังไม่มีหลักฐานของขั้นเหล่านั้น

### สรุปการยืนยันผู้ใช้และจัดเอกสารเล่ม — 13 ต.ค. 2569

หลังยืนยันสมัครใหม่ได้ ผู้ใช้แจ้งว่า “ทุกอย่างสามารถใช้งานได้ปกติ” บันทึกเป็น user acceptance รวมตามคำยืนยัน ไม่ใช่ checklist/ภาพรายกรณีของทุก endpoint และไม่รับรองกล้อง ประตู SMS หรือ provider จริงนอกขอบเขต

จัดเอกสาร .docs/system/README.md และ 11 โมดูลสำหรับรายละเอียดบทที่ 4 พร้อมปรับไฟล์เดิม .docs/thesis/01–05 ให้ตรงสมัคร 4 ขั้น guarded purge/เก็บ User วันสัญญา 5 เดือน และหลักฐานปัจจุบัน ตรวจไฟล์ Markdown 17 ไฟล์ ลิงก์ภายใน 124 จุดไม่พบลิงก์เสีย UTF-8 ไม่มี replacement character และ Backend build ผ่าน ไม่รันธุรกรรม/load test ใหม่เพื่อทำเอกสาร รูปประกอบและบรรณานุกรมตามหลักสูตรยังต้องเติมจากหลักฐานที่อนุญาตเผยแพร่


### จัดเอกสารเป็นโฟลเดอร์เดียว — 14 ต.ค. 2569

ย้ายไฟล์บทที่ 1–5 จาก `.docs/thesis/` ไป `.docs/system/` และปรับลิงก์สารบัญ/อ้างอิงให้ตรงกัน ไม่สร้างเนื้อหาซ้ำ ผลทดสอบเดิมยังอ้างอิงวันที่เดิม การปรับโครงสร้างเอกสารครั้งนี้ไม่ได้เป็นการทดสอบระบบใหม่

### ความยินยอมก่อนสมัครและบันทึกใบหน้า — 14 ต.ค. 2569

เพิ่มคำชี้แจงและการกดยินยอมแยก HOUSING/FACE_ENROLLMENT ก่อนโหลดฟอร์มหรือเปิดกล้อง เก็บหลักฐานใน AccessLog เดิม ตรวจบัญชี/รุ่นข้อความ/เวลา server และกันกดซ้ำด้วย transaction lock เพิ่ม guard ที่ API และ face service โดยไม่สร้างความยินยอมย้อนหลัง ไม่เพิ่มตารางหรือเปลี่ยน provider

ผล unit/mock และ HTTP routes กับฐานข้อมูลจำลอง: ระบบ 185/185 และเว็บ 119/119 ตรวจไม่ยินยอม, รุ่นเก่า, boolean ไม่ถูกต้อง, แอบใช้ userId อื่น, สิทธิ์ Admin, รีเฟรช, กดซ้ำ และยกเลิกคำขอ ไม่ใช่ browser acceptance หรือการทดสอบ provider จริง ผู้ใช้ยังต้องตรวจหน้าจอจริงหลัง deploy

Build/TypeScript และ lint ของไฟล์ที่เกี่ยวข้องผ่าน อัปเดตบริการ backend ใน Docker แล้ว Runtime smoke: GET /api/health = 200; GET /api/users/me/privacy-consent/HOUSING และ /FACE_ENROLLMENT โดยไม่มี session = 401 ไม่ได้บันทึก consent แทนผู้ใช้หรือเรียกกล้อง/provider จริงในรอบนี้

อัปเดตชุดเอกสารหลังเพิ่ม PDPA: README/สารบัญ บท 1–5 โมดูลผู้พัก ใบหน้า OCR การชำระเงิน สเปก/API และกฎ UI รวมเอกสารที่แก้ทั้งสอง repository 24 ไฟล์ ตรวจลิงก์ภายใน 163 จุดไม่พบลิงก์เสีย รอบจัดเอกสารอ้างผล regression 185/119 ที่รันหลัง implementation ในวันเดียวกัน ไม่ได้อ้างว่ารัน browser/provider/load ใหม่

### แผนภาพ Archify ประกอบเล่ม — 16 ต.ค. 2569

สร้างภาพรวมระบบ, flow สมัครถึงย้ายออก, ERD หลัก 10 ตาราง/161 คอลัมน์/17 FK และ System Architecture พร้อม HTML interactive และ canonical PNG/SVG จากเมนูส่งออกของ Archify อ้าง source ที่ commit c6897b6a50e7f7074b6d3321691788d92afda1ba ไม่ใช้เอกสารที่ยังไม่ commit เป็น source evidence

ทั้ง 4 ภาพผ่าน validate/deliver/strict check/browser-check ของเครื่องมือ เก็บ candidate และ receipts ใน .docs/system/diagrams/ มีหน้ารวม index.html และ exports.json สำหรับตรวจ hash ภาพ ERD มีบางเส้นอ้อมเพื่อหลบตาราง จึงควรซูมหรือใช้ SVG ข้อความภาพเป็นภาษาไทย ส่วน fixed Viewer UI และ HTML lang ยังใช้ English fallback การตรวจภาพไม่ใช่ผลทดสอบ flow ระบบหรือ provider จริง และ Docker daemon ไม่ทำงานในรอบสำรวจฐานข้อมูลก่อนสร้างภาพ

## ป้องกัน Race Condition ก่อนชำระมัดจำ — 18 ต.ค. 2569

- ผู้ใช้ให้ทำเรื่องนี้ก่อน และพักอีก 6 ข้อจาก source review ไว้ เพิ่ม roomHoldExpiresAt และ composite index ใน HousingApplicationDraft เดิม พร้อม migration 20261018000000_housing_room_hold ไม่มีตารางใหม่
- ก่อน QR: transaction ล็อก User -> Room ตรวจ reserving tenants + holds ของคนอื่นตามเวลา PostgreSQL และสถานะหลักฐานชำระ ผู้ขอสิทธิ์สุดท้ายพร้อมกันมีผู้ได้สิทธิ์เพียงคนเดียว provider เรียกเฉพาะผู้ได้สิทธิ์ 10 นาทีตามที่ผู้ใช้เลือก รีเฟรช QR ไม่ต่อ active expiry ส่วน legacy HTTP QR/อัปโหลดรวมใช้ draft flow เดียวกัน
- Holds ที่มีเงิน PAID/อยู่ระหว่างตรวจยังคุ้มครองหลังหมดเวลา ที่ยังไม่ส่งหลักฐานคืนโดยเงื่อนไขเวลา ไม่พึ่ง worker/Redis การยื่นสมัครเปลี่ยนเป็น Tenant PENDING และล้าง hold ใน transaction เดียว ไม่คิดจำนวนซ้ำ Admin เพิ่ม/ย้ายและการเปลี่ยนความจุ/ปิด/เปลี่ยนเลข/ลบห้องต้องเคารพ hold
- Late payment: ยังตรวจผ่าน provider และบันทึกเครดิตจริงจำลองได้ แม้ห้องถูกกันให้คนอื่นแล้ว แต่ล้าง hold ที่หมดสิทธิ์และไม่แย่งห้องกลับ เจ้าของใช้เครดิตกับห้องอื่นหรือให้ Admin ตรวจจัดการ ไม่มี auto refund และ QR ธนาคารที่บันทึกไปแล้วไม่ได้ถูกเพิกถอนจริงจากการซ่อนภาพบนเว็บ
- Frontend แสดงนับถอยหลังอิง serverTime/reservationExpiresAt ซ่อน QR เมื่อหมดเวลา ไม่ renew อัตโนมัติ ยังคงแนบสลิปเดิมได้และเตือนอย่าโอนซ้ำ cleanup timer เมื่อออกจากหน้า
- Regression backend 190/190 และ frontend 127/127 ผ่าน Build/TypeScript และ lint ผ่าน Integration ใหม่ tests/integration/housing-room-hold.test.ts 8/8 ผ่าน PostgreSQL ฐาน housing_room_hold_test แยกจริงพร้อม mock QR/slip ไม่มีการโอนเงินจริง รวมผู้ขอ QR พร้อมกัน Admin แข่งกับ QR สิทธิ์หมดอายุ สถานะตรวจเงิน ป้องกัน Admin ลบ/เปลี่ยนห้อง เปลี่ยนห้อง และผู้โอนสองคนยื่นสมัครพร้อมกันได้ที่พักเพียงคนเดียว ยอดอีกคนยังอยู่
- migration ทดสอบผ่านฐานแยกแล้วนำไปใช้ฐาน Compose เดิมสำเร็จโดยไม่ reset Deploy backend เสร็จ ตรวจ health ผ่าน nginx ได้ HTTP 200 ยืนยัน dist มี reserveForQr/roomHoldExpiresAt และ frontend เสิร์ฟ index-Dyd3ESXz.js คอลัมน์ roomHoldExpiresAt มีในฐานหลัก ไม่ใช้ tests นี้เป็นผล load test หรือ browser acceptance ของอุปกรณ์/ธนาคารจริง

## ตรวจรอยต่อ flow เพิ่มเติมหลังแก้ใบสมัครถูกปฏิเสธ — 18 ต.ค. 2569

ตารางนี้เป็นรายการที่พบจาก source review ก่อนแก้ไข สถานะล่าสุด: แก้ทั้ง 6 จุดแล้วตามผลตรวจหัวข้อท้ายรายงาน ไม่ใช่หลักฐาน browser acceptance

| ลำดับ | กรณีและผลที่เห็นจากโค้ด | สิ่งที่ควรแก้/ตรวจต่อ |
|---|---|---|
| 1 | กลับมาแก้ใบสมัครที่มีห้องเดิมเต็ม/ไม่พร้อมแล้ว: autosave ส่ง roomNumber เดิมทุกขั้น HousingDraftService.save ตรวจความพร้อมและคืน 409 จากนั้น draftError ล็อกปุ่มขั้นถัดไป แม้ผู้ใช้ยังอยู่ขั้นข้อมูลส่วนตัวและยังไปเลือกห้องใหม่ไม่ได้ | ให้เปลี่ยนห้องได้จากจุดที่ติด และแยกบันทึกข้อมูลส่วนตัวจากการเลือกห้องที่ต้องตรวจความพร้อม |
| 2 | เปิดสองแท็บแล้ว OCC ขัดแย้ง: ปุ่ม retry เรียก refreshDraft(false) รับ version ล่าสุดแต่เก็บ local fields เดิม จากนั้น autosave อาจส่งข้อมูลเก่าทับข้อมูลที่อีกแท็บเพิ่งบันทึก | แยก timeout จาก 409 และให้เลือกโหลดข้อมูลล่าสุด/ยืนยันเก็บข้อมูลของแท็บนี้ก่อนเขียนทับ |
| 3 | เปลี่ยนเป็นห้องราคาต่ำกว่ายอดที่จ่าย: summary แสดง excessAmount แต่ ready ต้อง credit === required และการยื่นปฏิเสธยอดส่วนเกิน หน้าสมัครจบที่ให้ติดต่อ Admin ในโมดูล housing/payment ที่ตรวจยังไม่พบขั้นปิดยอดส่วนเกิน | กำหนดนโยบายและ flow คืนเงิน/จัดการส่วนเกินให้จบ โดยไม่แก้ PAID หรือยอดจริงเพื่อให้ผ่าน |
| 4 | เงื่อนไขสัญญาเปลี่ยนจาก response autosave: applyDraft เปลี่ยน contractData จาก contractTerms แต่ไม่ได้ยกเลิก contractAccepted การอัปเดตเงื่อนไขจึงอาจคงช่องยอมรับเดิมไว้ แม้ server ยังตรวจ terms ล่าสุดตอนยื่น | ตรวจ snapshot ที่ยอมรับ หากเงื่อนไขเปลี่ยนต้องแสดงให้ตรวจและติ๊กยอมรับใหม่ |
| 5 | Admin อนุมัติ/ปฏิเสธขณะผู้พักเปิดหน้าหลักค้าง: StudentHome โหลด tenant ตอน mount หรือ retry หลัง error ไม่มี listener tenantStatusUpdated ในหน้านี้ เมนูและข้อความสถานะอาจค้างจน refresh | เพิ่ม reload ตาม event พร้อม cleanup และตรวจ reconnect/focus ให้เหมาะสม |
| 6 | ย้ายออก INACTIVE แต่ยังไม่ล้างข้อมูลเดิม: StudentHome ซ่อนเมนูสมัครเฉพาะ PENDING/APPROVED/ACTIVE จึงยังเปิดสมัครได้ แต่ service ไม่อนุญาตสมัครทับ INACTIVE และ draft เดิมยังส่งแล้ว | แสดงสถานะรอผู้ดูแลจัดการข้อมูลเดิมแทนชวนให้สมัคร และเปิดสมัครเมื่อ guarded purge เสร็จ |

อ้างอิง: HousingDraftService.save/summary, useTenantApplication.applyDraft/refreshDraft/autosave, TenantApplication ปุ่ม retry/ยอดส่วนเกิน, StudentHome เมนูและ effect โหลด tenant, TenantsService.submitApplication กรณี INACTIVE ยังไม่ใช้จำนวน regression ที่ผ่านเป็นหลักฐานว่ารอยต่อข้างต้นผ่านแล้ว

## ใบสมัครถูกปฏิเสธแล้วกลับมาแก้ไขไม่ได้ — 18 ต.ค. 2569

- ผู้ใช้ยืนยันว่า Admin ปฏิเสธใบสมัคร แล้ว URL สลับ /apply กับ /student Source review พบว่า Tenant เป็น REJECTED แต่ HousingApplicationDraft ยัง SUBMITTED และหน้าสมัคร redirect ทันทีเมื่อ draft ไม่ OPEN; ยังไม่ได้บันทึก browser trace ยืนยันตัวกระตุ้นการกลับเข้า /apply ทุกครั้ง
- แก้ HousingDraftService.locked ภายใต้ User lock เดิม: เปิดเฉพาะ SUBMITTED ของ Tenant REJECTED เป็น OPEN เริ่ม activeStep 0 เก็บข้อมูลเดิมและเพิ่ม version เพื่อรักษา OCC
- คืนการผูกเครดิตเฉพาะ PAID ของเจ้าของ/draft/Tenant เดียวกัน ที่ไม่ใช่บิลและยังไม่อนุมัติมัดจำ โดยไม่เปลี่ยนยอด สถานะชำระ transaction หรือหลักฐาน หากพบเจ้าของอื่น ยอดอนุมัติแล้ว หรือการผูกผิด ให้ 409 และรอผู้ดูแล ไม่เปิดให้ใช้ยอดซ้ำ
- ป้องกัน Admin เปลี่ยนใบสมัครเก่า REJECTED เป็น PENDING/APPROVED/ACTIVE ขณะที่ draft OPEN ต้องรอเจ้าของยื่นใหม่ก่อน ส่วน PENDING/APPROVED/ACTIVE/INACTIVE ไม่เปิด draft ให้อัตโนมัติ
- ฝั่งเว็บหยุด redirect อัตโนมัติเมื่อ draft ยังส่งแล้ว แสดงหน้าสถานะคงที่พร้อมตรวจสถานะล่าสุด และไม่ autosave draft ที่ไม่ OPEN เพิ่ม regression test กรณีนี้ไว้
- Backend targeted unit/mock 14/14 และ regression 190/190 (24 suites) ผ่าน รวมเปิดซ้ำอย่าง idempotent รักษายอด/ข้อมูล ปฏิเสธยอดผิดเจ้าของและป้องกันอนุมัติใบเก่า Build, test:typecheck และ lint ไฟล์ที่แก้ผ่าน
- ช่วงแรก frontend tests/build/lint ถูก automatic approval review ระงับเพราะโควตาการตรวจอนุมัติหมด ต่อมาผู้ใช้สั่งดำเนินการและรันสำเร็จ: frontend 125/125 รวมกรณี draft ส่งแล้วไม่ redirect/ไม่ autosave และกลับมาแก้หลังเปิด draft พร้อมรักษายอดเดิม Build/TypeScript และ lint ผ่าน
- Deploy รอบต่อมา 18 ต.ค. 2569: เปิด Docker Desktop ที่หยุดอยู่ แล้ว build/start backend พร้อม nginx/ngrok และบริการตาม dependency โดยใช้ volume เดิม ตรวจ health ผ่าน nginx ได้ HTTP 200 ยืนยัน backend dist มี rejected-draft recovery และ frontend เสิร์ฟ index-BpiArfet.js แล้ว ไม่ได้ใช้ session ผู้พักยิง flow สมัครจริงหรือสั่งชำระเงิน ต้องให้ผู้ใช้ลองเปิดใบสมัครที่ถูกปฏิเสธ แก้/refresh/ส่งใหม่ และตรวจว่าเป็น PENDING โดยไม่จ่ายยอดเดิมซ้ำ

## หน้าสมัครเรียก API Admin และปุ่มถัดไปค้าง — 18 ต.ค. 2569

- ผู้ใช้รายงาน GET /api/tenants และ /api/users ตอบ 403 พร้อมยืนยันว่าขั้นข้อมูลส่วนตัวปุ่มสีจาง และ PATCH /api/tenants/draft ค้าง Pending
- Source review: DashboardProvider ครอบ App ทั้งหมดและโหลดข้อมูลเมื่อมี session ทำให้หน้า STUDENT เรียก API รายชื่อ Admin ซึ่ง requireRole ADMIN ปฏิเสธถูกต้อง ย้าย provider ไปใต้ ProtectedRoute ของ Admin ไม่แก้ลดสิทธิ์ API
- ปุ่มถัดไป disabled เมื่อ draftSaving; คำขอ GET/PATCH draft เดิมไม่มี Axios timeout เพิ่ม 20 วินาที หยุด autosave หลัง error จนผู้ใช้ตรวจสถานะใหม่ และแสดง spinner บนปุ่มเดิม
- ปุ่มตรวจสถานะและลองบันทึกอีกครั้งรักษาข้อมูลที่กำลังกรอกเมื่อมี draft แล้ว ส่วนกู้ครั้งแรกยังคืนข้อมูลจาก server เพิ่มสรุป validation ใกล้ปุ่ม รวม accountPhone ที่เดิมไม่มีข้อความในฟอร์ม
- Unit/mock: frontend 124/124 ผ่าน รวมจำลอง save timeout และ retry ที่คงข้อมูล กับ render เส้นทางที่ยืนยัน DashboardProvider ไม่ mount ในหน้า STUDENT/สาธารณะ และ mount ใน Admin ที่มีสิทธิ์ Build/TypeScript และ lint ผ่าน
- Runtime read-only: nginx health ตอบสำเร็จ และ PostgreSQL ขณะตรวจมี connection idle 4 รายการ ไม่มี query รอ lock; ยังยืนยันต้นเหตุระดับเครือข่ายของ PATCH เดิมไม่ได้ ไม่ได้ใช้ session ผู้สมัครยิง PATCH จริง
- Build dist ใหม่แล้ว nginx เสิร์ฟ index-BLftjUwF.js การยืนยันว่าผู้ใช้กดถัดไปผ่านจาก browser/ngrok จริงยังรอผู้ใช้ทดสอบ ควรเก็บข้อความที่ยังไม่ได้บันทึกก่อน reload หน้าเก่า


## ปิดรอยต่อใบสมัคร 6 จุดและคืนส่วนเกิน — 18 ต.ค. 2569

| จุด | พฤติกรรมหลังแก้ |
|---|---|
| ห้องเดิมเต็ม/ปิดใช้งาน | บันทึกข้อมูลส่วนตัวต่อได้โดยไม่ตรวจห้องเดิมซ้ำ และมีทางไปเลือกห้องใหม่; การกันสิทธิ์/ยืนยันยังตรวจความจุจริง |
| สองแท็บแก้พร้อมกัน | 409 หยุด autosave และคิวเก่า ต้องเลือกโหลดข้อมูลระบบ หรือยืนยันใช้ข้อมูลในแท็บนี้ก่อนเขียนทับ |
| ห้องราคาถูกลง | เปลี่ยนห้องได้ รอ Admin คืนส่วนเกินจริงแล้วบันทึกยอด เลขอ้างอิงและภาพหลักฐานใน นักศึกษา/ผู้เช่า > ใบสมัครที่มียอดคืน ได้แม้ยังไม่มี Tenant/เอกสารใบสมัคร และไม่โอนเงินให้อัตโนมัติ |
| เงื่อนไข/วันสัญญาเปลี่ยน | ล้างการติ๊กยอมรับเมื่อ snapshot เปลี่ยน และโหลด terms ล่าสุดก่อนส่ง หากเปลี่ยนให้กลับไปอ่านและยอมรับใหม่ |
| สถานะหน้าหลักผู้พัก | รับ event เฉพาะเจ้าของ โหลดใหม่เมื่อกลับเข้าแท็บ/reconnect และตรวจซ้ำทุก 30 วินาที ยกเลิก request/listeners/timers เมื่อออกจากหน้า |
| ย้ายออกแล้วยังมีข้อมูลเดิม | ซ่อนเมนูสมัครของ INACTIVE และแสดงเหตุผลรอผู้ดูแลล้างข้อมูล ทั้งหน้าหลักและการเข้าหน้าสมัครโดยตรง |

การคืนเงินใช้ HousingRefund แยกจาก Payment เดิม: เครดิตสุทธิ = PAID เดิม − ยอดคืนที่บันทึก; ใช้เครดิตสุทธิตรวจยื่นใบสมัครและสรุปยอดการเงิน User/Room lock + draft version ป้องกันบันทึกแข่งกัน ตรวจยอดไม่เกินส่วนเกิน ไม่มีรายการรอตรวจ/เครดิตถูกใช้แล้ว และ reference/idempotencyKey/proof hash ไม่ซ้ำ เฉพาะ Admin อ่านและบันทึกหลักฐาน ไฟล์อยู่ private storage และ guarded purge ล้าง record/ไฟล์ตามเจ้าของโดยเก็บ User ไว้

ผลตรวจ: Backend unit/mock 190/190, Frontend unit/mock 132/132, PostgreSQL แยก 11/11 (8 กรณีจองห้องเดิม + 3 กรณีห้องใช้ไม่ได้/INACTIVE/คืนเงิน) ผ่าน กรณีคืนเงินตรวจสิทธิ์ Admin, คืนเกินยอด, บันทึกพร้อมกันและ retry, คง Payment.amount เดิม, ยื่นตรวจเครดิตสุทธิ และลบหลักฐานจริงจากพื้นที่ทดสอบโดย User ยังอยู่ การตรวจ cache ใช้ mock ไม่เรียก Redis จริงในชุดนี้; provider ชำระเงินจำลอง ไม่มีโอนหรือคืนเงินจริง

Build/TypeScript ทั้งสอง repository, backend test:typecheck, lint ฝั่งเว็บและไฟล์ backend ที่แก้ผ่าน Migration housing_refunds ใช้กับฐานข้อมูลแยกและ Compose projectdb แล้ว การยืนยันคลิกผ่าน browser หลัง deploy และการคืนเงินจริงยังไม่ใช่ผลผ่านของรอบนี้

Runtime หลัง deploy: rebuild/restart backend สำเร็จ ตรวจผ่าน nginx GET /api/health ได้ 200 healthy และ dist ใน container มี HousingRefundService/refundedAmount; frontend build เป็น index-CHAO-zRe.js ไม่ใช้ health หรือการมีไฟล์เป็นหลักฐานว่า browser acceptance ผ่าน


## Login ใหม่ยกเลิก session เก่า — 18 ต.ค. 2569

ผู้ใช้กำหนดให้บัญชีมี session จาก login ล่าสุดเท่านั้น ใช้กับ Admin/User เพิ่ม authSessionVersion และ lastLogin แบบ atomic โดยตรวจ password hash เดิมใน WHERE ก่อนออก JWT จากค่าที่ฐานข้อมูลคืน ไม่ใช้ค่า version ที่อ่านก่อนตรวจรหัสผ่าน และไม่กระทบ User.version ของ OCC ล็อกอินผิดไม่ยกเลิก session เดิม รหัสผ่านเปลี่ยนขณะตรวจให้ 401

REST ใช้การตรวจ session เดิมเพื่อตอบ 401 กับ token เก่า Socket ตัดเฉพาะรุ่นเก่าของ owner และตรวจซ้ำหลังเชื่อมเพื่อปิดช่อง handshake ชนกับ login ใหม่; ไม่ตัดรุ่นใหม่กว่าที่อาจเชื่อมแล้วระหว่าง login พร้อมกัน หลายแท็บ browser เดียวกันยังใช้ cookie ร่วมกัน จึงยังต้องใช้ OCC/locks/idempotency เดิม

ผล: Backend unit/mock 193/193 ผ่าน รวม HTTP login สองครั้ง cookie แรก 401/cookie ล่าสุด 200, รหัสผิดไม่ตัด session เดิม, concurrent login และ Socket รุ่นเก่า/ใหม่แบบ mock; PostgreSQL แยก 12/12 ผ่าน รวม login จริงสองคำขอพร้อมกันเหลือ token ที่ใช้ได้หนึ่งชุด version เพิ่ม 2 และ User.version ไม่เปลี่ยน รวมปฏิเสธ password hash ที่เปลี่ยนแล้ว Build/test:typecheck และ targeted ESLint ผ่าน ยังไม่ใช่การทดลองล็อกอินสองอุปกรณ์ผ่าน browser จริง

Deploy นโยบาย login ล่าสุด: rebuild/restart backend สำเร็จ และตรวจ nginx /api/health ได้ 200 healthy หลังเปลี่ยน image ไม่ได้ใช้บัญชีผู้ใช้จริงทดสอบการออกจากระบบสองเครื่อง


## Modal แจ้ง login ซ้อน — 18 ต.ค. 2569

เพิ่ม native dialog ระดับ AuthProvider มี X สีแดงขนาดใหญ่ตรงกลาง ข้อความบัญชีนี้มีการเข้าสู่ระบบจากที่อื่น และปุ่มเข้าสู่ระบบอีกครั้ง รับ sessionReplaced จาก Socket ก่อนตัดการเชื่อมต่อ ล้างสิทธิ์ทันทีและคง Modal หลัง protected route เปลี่ยนหน้า คำขอ 401 ซ้ำไม่สร้างหลายกล่อง/ไม่ลดระดับข้อความ login ซ้อน ล็อกอินใหม่สำเร็จล้าง Modal ได้ รองรับโฟกัส native dialog และ Escape กลับหน้า login

401 ของ API ยังคงเดิม ไม่เปลี่ยนเป็น 200 Middleware รักษาข้อความ session revoked เพื่อให้เว็บแยกจากหมดอายุได้ แต่ไม่กล่าวว่าเป็น login ซ้อนหากไม่มี event ยืนยัน เพราะ logout/reset password ก็ยกเลิก session ได้ ขณะ login/register/reset สาธารณะตอบ 401 จะไม่เปิด session Modal โดยไม่เกี่ยวกับบัญชีที่กำลังใช้อยู่

ผลทดสอบ: frontend 135/135, backend 193/193 ผ่าน รวม event replacement, HTTP 401 reason, wrong login ไม่ล้าง session และ Modal คงอยู่เมื่อมี 401 ซ้ำ Build/TypeScript ทั้งสอง repository, backend test:typecheck และ lint ผ่าน Deploy backend และ build frontend ใหม่แล้ว ยังไม่ได้ยืนยันภาพ/การคลิกด้วยสอง browser จริง


## ตรวจ type safety และคำสั่งปิดการตรวจ — 18 ต.ค. 2569

ขอบเขต: ซอร์ส TypeScript ของทั้งสอง repository, config TypeScript/ESLint, ชุดทดสอบ และตรวจสคริปต์เก่าที่พบ ไม่เพิ่มฟีเจอร์หรือเปลี่ยน schema ในรอบนี้

| ตรวจ | ผลหลังแก้ |
|---|---|
| explicit any ใน AST ของ src ทั้งสอง repo | 0 |
| as unknown as / as never ใน src | 0 |
| @ts-ignore / @ts-nocheck / @ts-expect-error / eslint-disable ใน src | 0 |
| TypeScript strict | Backend มีอยู่แล้ว; เปิดถาวรใน frontend app/node config ตรวจผ่าน |
| ป้องกันกลับมาปิดการตรวจ | ESLint noInlineConfig, ban-ts-comment และห้าม double assertion ผ่าน unknown ใน src; unused ตัวแปร backend ยกระดับเป็น error |

การแก้: AcademicRequestDto ใช้ชนิดตรงคำขอแทน cast จาก DTO string; notification ตรวจค่า channel/type เทียบ enum ก่อน query ไม่บังคับ string เป็น enum; webhook ตรวจชนิดเลขอ้างอิง; catch ใช้ Error narrowing; catalogue และ Prometheus ตรวจโครงสร้าง JSON จริงก่อนอ่าน ไม่เปลี่ยนข้อมูลผิดรูปเป็นยอดศูนย์; hook โหลดข้อมูลใช้ callback/dependencies ที่แน่นอน; ตารางใช้ core model กับ pagination/filter ที่ React ควบคุม จึงไม่ต้องปิด incompatibility warning หรือ React Compiler; สคริปต์ clear-face-data เปลี่ยน catch any เป็นตรวจ Error/code โดยไม่ได้รันสคริปต์ล้างข้อมูล

นำ fallback ที่มีไว้รองรับ mock ไม่ครบออกจาก notification audit/dead-letter และ housing refund queries หากระบบบันทึกจริงไม่ได้ต้องเกิด error; เพิ่ม mock delegates ให้ตรงสิ่งที่ใช้งาน แทนคืน record สำเร็จปลอมในโค้ดจริง

ข้อจำกัดที่เปิดเผย: unknown เป็นชนิดที่ต้องตรวจค่าก่อนใช้ ไม่ใช่คำสั่งปิด error จึงยังเก็บ unknown ตามขอบเขตข้อมูล/ข้อผิดพลาด ใน tests ยังมี double assertion 83 จุดสำหรับ partial Prisma/Express fixtures ไม่ได้เปลี่ยนเป็น any หรือซ่อนไว้ใน helper และไม่อ้างว่า mock เหล่านี้มี type safety เท่ากับ client จริง ตรวจเก็บกรณีฐานข้อมูลแยกเสริมไว้ การสแกน explicit any ไม่ได้แปลว่า implicit any จาก default generic ของไลบรารีทุกจุดถูกพิสูจน์ว่าหมดแล้ว skipLibCheck ยังตรวจข้าม declaration ของ dependency ตามเดิม ไม่ใช่การยกเว้นไฟล์ src

หลักฐาน: frontend 136/136 รวม table model จริงกรณีค้นหา เปลี่ยนหน้า ข้อมูลลดและไม่มีข้อมูล; PostgreSQL แยก 12/12 รวม login พร้อมกัน/จองห้อง/คืนส่วนเกินและ purge ผ่าน (cache/provider จำลอง) Build strict ทั้งสองฝั่งผ่านและ lint ไม่มี warnings/errors รายการนี้ไม่แทน browser acceptance ครบทุกหน้า

ผลตรวจสุดท้ายของรอบ type safety: backend 196/196 ผ่าน รวม malformed catalogue/metrics และ enum validation; frontend 136/136; PostgreSQL แยก 12/12; build/test:typecheck ผ่าน, ESLint backend --max-warnings 0 และ frontend lint ไม่มี warning/error Deploy backend แล้ว nginx health 200 โดยไม่เปลี่ยนข้อมูลผู้ใช้จริงหรือรันสคริปต์ล้างข้อมูล


## คำขอคืนเครดิตจากใบสมัคร — 19 ต.ค. 2569

เพิ่มขั้นให้ผู้สมัครส่งคำขอคืนเครดิตทั้งหมดจากหน้าใบสมัคร โดยยอด PAID ยังคงเป็นเครดิตจนกว่าจะมีการคืนเงินจริง ผู้สมัครเลือกเก็บเครดิตไว้สมัครต่อได้ หากส่งคำขอ ระบบปล่อยห้องและพักการแก้ไข อัปโหลด ชำระ และยื่นใบสมัครระหว่างรอ Admin

Admin จัดการในกล่อง “คำขอคืนเงินจากใบสมัคร” ที่หน้า **จัดการผู้พักอาศัย** รายการมาจาก HousingApplicationDraft จึงเห็นผู้สมัครที่ยังไม่มี Tenant/เอกสารได้ Admin ปฏิเสธพร้อมเหตุผล หรือบันทึกยอดอ้างอิง หลักฐาน และยืนยันหลังคืนเงินจริงแล้วเท่านั้น รายงานธุรกิจสะท้อนยอดคืนจากรายการที่บันทึกจริง

ตรวจแล้ว: Prisma schema validate/generate, Backend build/test:typecheck, Frontend production build, ESLint ไฟล์ที่แก้ และ AccountRetention unit 23/23 ผ่าน; เพิ่มกรณี PostgreSQL แยกสำหรับส่งคำขอ เครดิตถูกพักระหว่างรอ ปฏิเสธแล้วใช้เครดิตต่อ และคืนเงินจริงแล้วหักยอด แต่ยังไม่ได้รัน integration test นี้กับฐานข้อมูลทดสอบ Full `npm test` ยังติด 3 OCR flow cases เพราะ credentials ของฐานข้อมูล test ไม่ผ่าน ยังไม่ได้ browser acceptance หรือ deploy migration จึงยังไม่ยืนยันการทำงาน end-to-end ในระบบที่กำลังใช้งาน
