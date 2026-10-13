# 4.8 การพัฒนาส่วนเชื่อมต่อการตรวจใบหน้า

## 1. ขอบเขตที่ต้องแยกในเล่ม

ระบบมีหน้าเก็บใบหน้าและ wrapper เชื่อมบริการ Face รวมถึง endpoint สำหรับอุปกรณ์ แต่รอบ QA นี้ตรวจเว็บ/API สิทธิ์ ไฟล์ completion และ cleanup ส่วนกล้องจริง ประตู/Edge จริง และ Face provider จริงเป็น OS ไม่รับรอง accuracy หรือการเปิดประตูทางกายภาพ

ระบบเชื่อมต่อบริการตรวจ/จำแนกใบหน้าผ่าน wrapper โดยไม่สร้าง engine ใหม่ รับผลมาจัดข้อมูล ตรวจสิทธิ์ และบันทึกเหตุการณ์

## 2. หน้าจอและ flow ลงทะเบียน

1. ผู้พักที่อนุมัติ active และมีห้องเข้าสู่หน้าบันทึกใบหน้า
2. หน้าเว็บตรวจสถานะการบันทึกที่ server ก่อนเริ่ม flow
3. เก็บภาพตามขั้นที่กำหนดและส่ง register ของบัญชีตนเอง
4. หลัง register ทั้ง 5 สำเร็จเรียก `/api/tenants/me/face-enrollment/complete`
5. API ตรวจผู้พัก สถานะ ห้อง การเพิกถอน และอย่างน้อย 5 ภาพ แล้วบันทึก marker แบบ idempotent
6. `/api/tenants/me` คืน faceEnrollmentComplete เพื่อซ่อนเมนูและไม่เปิด flow เดิมหลังโหลดใหม่

จำนวนภาพและ marker นี้เป็นสถานะ UI ไม่ยืนยันว่าครบทุกมุมอย่างถูกต้อง embedding พร้อม หรือเปิดประตูได้ ไม่ backfill ภาพเก่า 5 ภาพเป็นสำเร็จโดยไม่มี marker เพราะการส่ง provider รอบก่อนอาจล้มเหลว

## 3. ข้อมูลและสิทธิ์

FaceEnrollmentPhoto เก็บ path และข้อมูลอ้างอิง FaceEmbedding เก็บข้อมูล template ตาม integration ส่วน AccessLog เก็บ marker ของ Tenant ปัจจุบัน User.faceRevokedAt คุมการเพิกถอน เจ้าหน้าที่และอุปกรณ์มีการตรวจสิทธิ์ตาม route ไม่ใช้ userId จาก body เพื่อย้ายเจ้าของภาพ

endpoint อุปกรณ์ใช้ verifyFaceGateToken ส่วนการจัดการของ Admin ใช้ session/role แยกกัน การอธิบาย “ประวัติสแกน” ต้องแยกจากการลงทะเบียนใบหน้าและบันทึก manual door command

## 4. การลบและสมัครใหม่

purge ลบภาพ/template ในฐานข้อมูลและ marker แล้วสร้าง durable cleanup job คิวจัดลำดับ EXTERNAL → FILES → DONE ตรวจผลยืนยันการลบจาก provider และ retry เมื่อขัดข้อง ไม่ประกาศ COMPLETE เพียงเพราะแถว Tenant หาย

หลังสมัครใหม่ Admin อนุมัติคืนสิทธิ์ได้เฉพาะ cleanup เดิม DONE และไม่เหลือ FaceEnrollmentPhoto/FaceEmbedding จึงต้องลงทะเบียนใหม่ ไม่ใช้ข้อมูลเก่าที่ถูกลบ วันหมดสัญญาอย่างเดียวไม่มี scheduler ลบใบหน้าโดยอัตโนมัติใน flow ปัจจุบัน ต้องดำเนินการย้ายออก/purge ตามกฎ

## 5. API ที่ใช้ประกอบคำอธิบาย

| Endpoint | หน้าที่ |
|---|---|
| POST `/api/face-verification/register` | ลงทะเบียนภายใต้สิทธิ์ |
| POST `/api/tenants/me/face-enrollment/complete` | บันทึก completion ของ User |
| GET `/api/face-verification/scan-history` | Admin อ่านประวัติ |
| GET `/api/face-verification/cleanup` | Admin อ่านคิวค้าง |
| GET `/api/face-verification/cleanup/:taskKey` | ตรวจงานล้างรายรายการ |

เส้นทาง verify/attendance/door/อุปกรณ์มีอยู่ใน routes แต่ไม่จัดเป็นการทดสอบฮาร์ดแวร์จริงในเล่มนี้

## 6. ผลทดสอบ

| กรณี | ผล | หลักฐาน |
|---|---|---|
| ไม่มี session/role ไม่ถูก | 401/403 | UT/IT/RT ตามกรณี |
| ภาพไม่ครบ/ถูก revoke/ไม่มีห้อง | ไม่สร้าง completion | UT/IT |
| complete ซ้ำ | marker เดียว | UT/IT |
| purge ภาพสังเคราะห์ 5 ภาพ | แถว/marker หาย ไฟล์ ENOENT | IT mock external deletion |
| อนุมัติใหม่ระหว่าง cleanup | 409 จน DONE | IT |
| purge User 781 จริง | face cleanup DONE แต่ก่อนลบมีภาพ 0 | RT ไม่ใช่หลักฐานลบภาพจริง |
| ความแม่นยำ/ประตู/กล้อง | ไม่มีชุดทดลองรับรอง | OS |

## 7. การตีความคะแนนและรูป

ค่าความคล้ายบนหน้าจอไม่ใช่เปอร์เซ็นต์ accuracy การประเมินจริงต้องมี ground truth และ false acceptance/rejection ตามนิยาม ไม่ใช้จำนวน unit tests เป็นตัวเลขความแม่นยำ

ใช้ภาพหน้าขั้นลงทะเบียนและเมนูที่หายเมื่อ complete พร้อมกำกับว่าเป็น UI ส่วนภาพตรวจอุปกรณ์ต้องกำกับ OS ไม่ใช้ใบหน้าจริงโดยไม่มีสิทธิ์เผยแพร่

- [Service](../../src/modules/face-verification/face-verification.service.ts), [Cleanup](../../src/modules/face-verification/face-cleanup.service.ts)
- [Tests](../../tests/unit/face-verification.test.ts), [Cleanup tests](../../tests/unit/face-cleanup.test.ts)
- [รายงานใบหน้า](../qa/face-scan-report.md), [QA](../qa/system-flow-report.md)
