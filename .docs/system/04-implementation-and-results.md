# บทที่ 4 การพัฒนาและผลการทดสอบ

ฉบับอ้างอิงล่าสุด 14 ตุลาคม 2569 (ผล runtime เดิมระบุแยกตามวันที่ทดสอบ) เอกสารนี้สรุปภาพรวม ส่วนรายละเอียดหน้าจอ flow ข้อมูล API และกรณีทดสอบแยกตามโมดูลใน .docs/system/

## 4.1 วิธีจัดผลและสภาพแวดล้อม

ใช้ local Docker/API gateway http://127.0.0.1:3002 สำหรับ runtime และฐานทดสอบแยกสำหรับ integration ก่อนเขียนผลต้องแยก source review (SR), unit/mock (UT), HTTP/DB integration (IT), runtime HTTP/DB/files (RT), user acceptance (UA) และ Out of scope (OS)

การที่ผู้ใช้บอกว่าใช้งานปกติบันทึกเป็น UA ไม่ใช้แทนหลักฐานเชิงรายละเอียดที่ไม่มี การทดสอบ provider ด้วย mock ยืนยันขอบเขตการเชื่อมต่อ ไม่ยืนยันคุณภาพบริการจริง แก้ความขัดแย้งจากร่างวันที่ 8 ต.ค. เดิม: สมัครเป็น 4 ขั้นและ purge ลบข้อมูลผูกผู้พักทั้งหมด ไม่เก็บ ARCHIVED/บิลนิรนามแล้ว บันทึกเก่าคงอยู่ในรายงาน QA เป็นประวัติ

## 4.2–4.12 ผลพัฒนาแยกโมดูล

| หัวข้อ | รายละเอียด | ผลพัฒนาที่สำคัญ |
|---|---|---|
| 4.2 | [Authentication](authentication.md) | cookie session, OTP mock, role และ revoke session |
| 4.3 | [Users/Tenants](users-and-tenants.md) | สมัคร 4 ขั้น draft สัญญา 5 เดือน อนุมัติ ย้ายออก/purge/สมัครใหม่ |
| 4.4 | [Rooms](rooms.md) | ความจุ reservation ราคา และการคืนห้อง |
| 4.5 | [Billing/Payments](billing-and-payments.md) | รายบิล/รวมบิล มัดจำ เครดิต ตารางแยกประเภท |
| 4.6 | [Maintenance](maintenance.md) | flow ถึงผู้พักปิดงาน โควตาและภาพแนบ |
| 4.7 | [Visitors](visitors.md) | ส่งคำขอ PNG และ manual visit completion |
| 4.8 | [Face verification](face-verification.md) | wrapper/สิทธิ์/completion/cleanup โดยไม่รับรองอุปกรณ์จริง |
| 4.9 | [OCR](ocr.md) | auto-read ตรวจแก้ ownership และ fallback |
| 4.10 | [Notifications](notifications-and-realtime.md) | แยก User/Admin จุดแดงและสถานะอ่าน |
| 4.11 | [Reports/Audit](reports-and-audit.md) | Dashboard กราฟ นิยามรายรับและเหตุการณ์ |
| 4.12 | [Deployment/Data](deployment-and-data.md) | Docker/cache/retention/security/RPS/TPS |

## 4.13 ผลอัตโนมัติที่มีหลักฐาน

| ชุด | ผลที่บันทึก | การตีความ |
|---|---|---|
| กฎธุรกิจและ API regression 14 ต.ค. 2569 | 185/185 | UT/mock และ route checks; รวมความยินยอมใหม่ 3 กรณี |
| Logic และสถานะหน้าจอ regression 14 ต.ค. 2569 | 119/119 | VM/mock รวมความยินยอมใหม่ 4 กรณี ไม่ใช่ browser ทุกหน้า |
| maintenance_flow_test ล่าสุด | 38/38 | HTTP/PostgreSQL/files แยกฐาน; provider mock |
| housing-payment ก่อนหน้า | 27/27 | integration ตามรายงาน ไม่ได้รันใหม่พร้อมชุดล่าสุด |
| visitor-registration ก่อนหน้า | 29/29 | integration ตามรายงาน ไม่ใช่ประตูจริง |
| Build/typecheck/lint | ผ่านรอบ implementation ล่าสุด | ไม่ใช่ผลประเมินความพึงพอใจ |

จำนวน tests เป็นกรณีที่เลือก ไม่ใช่ accuracy/coverage หรือจำนวน end-to-end routes ทั้งหมด รอบ 14 ต.ค. รัน regression หลังเพิ่มความยินยอมและตรวจ HTTP หลัง deploy ส่วน integration ฐานข้อมูลแยกและ load test ใช้ผลเดิม ไม่ได้รันใหม่

## 4.14 ผล flow จริงที่ตรวจได้

| ลำดับ | กรณี | Expected | Actual / หลักฐาน |
|---|---|---|---|
| 1 | ตรวจเอกสารและชำระสมัคร | ผู้ใช้ทำต่อได้ | UA ผู้ใช้ยืนยัน OCR/payment ปกติ |
| 2 | งานซ่อมจนจบ | ผู้พักยืนยัน CLOSED | งาน #248 CLOSED; UA+RT |
| 3 | ย้ายออกก่อนจ่ายบิล | ปฏิเสธ | 409 และยังพักตามเดิม; RT |
| 4 | ผู้ใช้จ่ายบิล #58 | PAID | RT พบ 100 บาท PAID หลังผู้ใช้จ่ายเอง |
| 5 | ย้ายออก Tenant #67 | คืนห้อง | PATCH 200 INACTIVE, roomId null; RT |
| 6 | ลบ Tenant เดิม | ลบข้อมูลและเก็บ User | DELETE 202, GET 404; RT |
| 7 | ตรวจข้อมูลสัมพันธ์ | ข้อมูลของเจ้าของหายครบ | ตารางที่ตรวจ 16 ประเภทเป็น 0, User 781 ยัง 1; RT |
| 8 | ตรวจไฟล์และคิว | ไฟล์หายและงาน COMPLETE | 10/10 ไฟล์ ENOENT, 11/11 tasks COMPLETE; RT |
| 9 | เอกสาร/รายการเก่า | เข้าถึงไม่ได้ | id-card/payment-slip 404 และไม่อยู่ใน list; RT |
| 10 | สมัครใหม่บัญชีเดิม | สมัครได้ | ผู้ใช้ยืนยันผ่านหน้าเว็บ; UA |
| 11 | การใช้งานหลังสมัครใหม่ | ใช้งานได้ตามผู้ใช้ตรวจ | UA ผู้ใช้แจ้งทุกอย่างปกติ ไม่มี checklist/ภาพรายกรณีแนบ |

รายการฐานข้อมูลที่ตรวจ 16 ประเภทคือ Tenant, Bill, Payment, PaymentBatch, PaymentBatchItem, MaintenanceTicket, Visitor, HousingApplicationDraft, IdCardVerification, OcrJob, FaceEnrollmentPhoto, FaceEmbedding, Notification, NotificationPreference, AccessLog และ Transaction ไม่ได้ลบบัญชี อาคาร/การแสดงอาคาร ห้อง หรือ settings ส่วนกลาง

## 4.15 ข้อผิดพลาดที่พบและผลแก้

| ปัญหา | สาเหตุ/การแก้ | ผลยืนยัน |
|---|---|---|
| Registered account phone number was not found | เบอร์ User หาย; จัดการข้อมูลบัญชีแยกจาก OCR | guard คงอยู่ ไม่บังคับ OCR อ่านเบอร์ |
| บันทึก draft 200 แต่สร้าง QR 409 | เงื่อนไข Admin CONTRACT ไม่ครบ | เปิดส่วนตั้งค่า/ตรวจ terms ที่ server |
| ลบแล้วสมัครใหม่ลงทะเบียนหน้าไม่ได้ | faceRevokedAt เดิมยังคง | คืนสิทธิ์เมื่ออนุมัติ PENDING ใหม่หลัง cleanup DONE; IT |
| ไม่มีผู้พักแต่ยังมีข้อมูลซ่อม/เงิน | flow ลบเก่า/ข้อมูลตกค้าง | guarded purge ลบสัมพันธ์และ files; RT |
| QR เก่า PENDING ขวาง purge หลังบิลจ่าย | มี placeholder ไม่ส่งสลิป | ข้อยกเว้นจำกัดเฉพาะไม่มีหลักฐาน/ทุกบิล PAID; IT+RT |
| แจ้งเตือนส่วนตัวรวมใน Admin | REST/Socket ส่งรวม | แยก owner/admin และ read state; UT+IT |

## 4.16 สมรรถนะและความปลอดภัย

[Bounded write artifact](../../tests/load/logs/2026-10-13/final_report.md) ล่าสุดมี synthetic visitor 12 requests, concurrency 4, rows/logs commit 12/12, RPS/TPS ประมาณ 77.67 เป็น local integration ช่วงสั้น ไม่รวม gateway/real provider และไม่ใช้รับรอง production capacity

ผลความปลอดภัยเป็นการตรวจเฉพาะ role/owner/input/session/idempotency/files ตามกรณี ไม่ใช่รายงาน penetration test ทั้งระบบ ไม่มีผลเปรียบเทียบ cache ก่อน/หลังหรือ long-running memory profiling ที่จะกล่าวว่าเร็วขึ้น/ไม่รั่วทุกกรณี

## 4.17 รูปประกอบและข้อจำกัด

แต่ละโมดูลมีรายการรูปที่ควรจับจากหน้าจอ ยังไม่ใช่ภาพที่แนบแล้ว ใช้ข้อมูลสังเคราะห์และปิดข้อมูลบัตร สลิป cookie และใบหน้าจริง การประเมินความพึงพอใจ/accuracy ไม่มีชุดข้อมูลในรอบนี้

กล้อง ประตู/Edge SMS และ provider จริงเป็น OS; User 781 ไม่มีภาพหน้าก่อน purge จึงไม่อ้างผลลบใบหน้าจริงจากรอบนั้น Annual retention มี implementation/tests แต่ไม่อ้างว่าเปิดลบบัญชีจริงครบปีแล้ว Browser acceptance ของผู้ใช้แยกจากผลเครื่องมือเสมอ

แหล่งหลักฐาน: [QA ระบบ](../qa/system-flow-report.md), [QA ใบหน้า](../qa/face-scan-report.md), [QA OTP](../qa/password-reset-otp-report.md), [สารบัญรายละเอียด](README.md)

## 4.18 ผลเพิ่มคำชี้แจงและความยินยอม — 14 ต.ค. 2569

แยก HOUSING ก่อนฟอร์มสมัคร และ FACE_ENROLLMENT ก่อนกล้อง/ส่งภาพ จากการยอมรับสัญญา ใช้ตาราง AccessLog เดิมโดยไม่เพิ่ม migration

| กรณี | Expected และผลที่ตรวจ | หลักฐาน |
|---|---|---|
| ยังไม่ยินยอม เรียก API สมัคร/อัปโหลดตรง | 403 แม้ส่ง pdpaConsent=true | HTTP routes + Prisma mock |
| รุ่นเก่า ยินยอม false หรือ string | ไม่สร้างหลักฐาน | unit/HTTP mock |
| ส่ง userId อื่น หรือ Admin กดยินยอม | ใช้ session ตนเอง; Admin ถูกปฏิเสธ | HTTP mock |
| ยินยอมสมัครแล้วส่งใบหน้า | ยังถูกปฏิเสธจนยินยอม FACE_ENROLLMENT | service mock |
| รีเฟรช/กดซ้ำ/ออกจากหน้า | อ่านหลักฐานเดิม; ไม่ส่งซ้ำ; abort และไม่รับผลล่าช้า | unit/VM mock |
| Runtime หลังอัปเดต Docker | health 200; คำชี้แจงทั้งสอง purpose ที่ไม่มี session 401 | local HTTP smoke |

ยังไม่ได้บันทึกความยินยอมของผู้ใช้จริง ไม่ได้เปิดกล้องหรือเรียก provider จริง การถอนเป็นช่องทางติดต่อผู้ดูแล และยังรอ browser acceptance ของหน้าที่เพิ่ม แหล่งรายละเอียด: [ผู้พัก](users-and-tenants.md), [ใบหน้า](face-verification.md), [QA](../qa/system-flow-report.md)
