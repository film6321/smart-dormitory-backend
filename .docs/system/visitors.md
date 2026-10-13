# 4.7 การพัฒนาระบบผู้มาติดต่อ

## 1. หน้าที่และสิทธิ์

ผู้มาติดต่อเริ่มคำขอจากหน้าสาธารณะ ส่วน Admin ดูรายละเอียด ตรวจคำขอ และบันทึกการเข้าพบ คำขอระบุเลขห้องและชื่อผู้พักที่ขอพบ แต่ไม่ผูก Tenant จากชื่อที่กรอกโดยอัตโนมัติ เพราะข้อความชื่อไม่ใช่หลักฐานยืนยันเจ้าของ

## 2. Flow ตั้งแต่เริ่มจนจบ

1. เลือกภาพบัตร ระบบส่งอ่านผ่าน OCR wrapper และคืน verificationId
2. ตรวจแก้ชื่อ วันเกิด/อายุ ที่อยู่ เบอร์ติดต่อ ข้อมูลการเข้าพบ และห้องที่ต้องการ
3. ตรวจข้อมูลและ consent แล้วส่ง register ระบบตรวจหลักฐาน ห้อง และความซ้ำ
4. บันทึก Visitor และ VisitorLog ลง PostgreSQL ก่อนแจ้งเหตุการณ์
5. หน้าสำเร็จแสดงเลขอ้างอิง ข้อมูลสรุป และดาวน์โหลดหลักฐาน PNG
6. Admin ตรวจคำขอที่ยังไม่หมดอายุ บันทึก GRANT_ENTRY และภายหลัง COMPLETE_VISIT

อายุคำนวณจากวันเกิด หากไม่มีวันเกิดจึงใช้ค่าที่กรอก ภาพบัตรต้องตรงกับผล OCR ไม่รับ imagePath จาก client เป็นหลักฐานโดยไม่ตรวจความสัมพันธ์

## 3. แยกสถานะคำขอกับขั้นการเข้าพบ

| ข้อมูล | ความหมาย |
|---|---|
| status | สถานะคำขอ เช่น REGISTERED, CANCELLED, EXPIRED |
| visitStage=WAITING | ยังไม่มีบันทึกอนุญาตเข้าพบ |
| visitStage=ADMITTED | เจ้าหน้าที่บันทึกอนุญาตแล้ว |
| visitStage=COMPLETED | เจ้าหน้าที่บันทึกจบการเข้าพบแล้ว |

ขั้นเข้าพบอ่านจาก VisitorLog: DOOR_ACCESS_GRANTED และ VISIT_COMPLETED ใช้ transaction/lock กันการบันทึกซ้ำ ไม่ถือว่าบันทึกนี้ยืนยันประตูจริงเปิดหรือผู้มาติดต่อผ่านอุปกรณ์สแกนแล้ว แม้ชื่อ event จะมีคำว่า DOOR

Admin ไม่ใช้การแก้ status แบบ legacy เป็นทางลัด APPROVED/CHECKED_IN ใน flow นี้ คำขอมีอายุ 24 ชั่วโมง การจบการเข้าพบต้องมีบันทึกเข้าแล้ว จบแล้วกดซ้ำไม่สร้าง log เพิ่ม ยกเลิก/หมดอายุต้องไม่ถูกใช้เข้าใหม่

## 4. หลักฐานหลังส่งและรีเฟรช

หน้าเว็บเก็บ receipt ที่จำเป็นเพื่อแสดงสรุปหลังรีเฟรช และเปิดให้ดาวน์โหลด PNG โดยไม่ใส่ข้อมูลบัตร ที่อยู่ เบอร์ หรือภาพ OCR ลง receipt storage การเก็บสรุปใน browser ไม่แทน Visitor ที่อยู่ใน PostgreSQL และไม่เป็น token อนุญาตเข้าหอ

หาก storage ใช้ไม่ได้ยังแสดงผลสำเร็จบนหน้าและแนะนำดาวน์โหลด หากข้อมูล storage เสียไม่เปลี่ยนเป็นคำขอสำเร็จสมมติ PNG ต้องตัดบรรทัดภาษาไทย/ข้อความยาวได้ตาม test ของ frontend

## 5. API สำคัญ

| Endpoint | การใช้งาน |
|---|---|
| POST `/api/visitor/scan-id-card` | สาธารณะ/optional session ส่งบัตร |
| POST `/api/visitor/register` | ส่งคำขอพร้อม validation |
| GET `/api/visitor` | Admin อ่านรายการ |
| GET `/api/visitor/:id/pass` | Admin อ่านรายละเอียด |
| POST `/api/visitor/:id/cancel` | Admin ยกเลิกภายใต้กฎ |
| POST `/api/visitor/:id/access` | Admin บันทึก GRANT_ENTRY/COMPLETE_VISIT |

ชื่อ route ไม่ได้หมายความว่าสาธารณะอ่านข้อมูล Visitor ของคนอื่นได้ เส้นทาง list/pass/access ใช้ session Admin

## 6. ผลทดสอบ

| กรณี | ผลที่ตรวจ | หลักฐาน |
|---|---|---|
| ข้อมูลไม่ครบ/ไม่มีหลักฐาน | ปฏิเสธและไม่บันทึกคำขอสำเร็จ | UT/IT |
| OCR → register → บันทึก log | verification ผูกกับคำขอ | IT mock OCR |
| ชื่อผู้พักที่กรอก | เก็บข้อความ ไม่ผูก Tenant โดยเดาชื่อ | IT |
| manual entry/complete ซ้ำ | มี log ผลเดียวและตรวจลำดับ | IT |
| ข้อมูลเก่าใน storage/ดาวน์โหลด PNG | ไม่สร้างผลสำเร็จเทียม; export image/png | UT frontend |
| ใช้หน้าผู้มาเยือน | ผู้ใช้ยืนยันผ่านแล้ว | UA ตาม QA |
| provider/ประตู/กล้องจริง | ไม่มีผลรับรอง | OS |

## 7. รูปและหลักฐาน

ภาพที่ควรใช้: ฟอร์มตรวจข้อมูล หน้าส่งสำเร็จ PNG ตัวอย่าง รายการ Admin และ WAITING → ADMITTED → COMPLETED ปกปิดข้อมูลส่วนตัว ภาพบัตรจริงไม่จำเป็นต่อการอธิบาย flow

- [Service](../../src/modules/visitor/visitor.service.ts), [Routes](../../src/modules/visitor/visitor.routes.ts)
- [Integration](../../tests/integration/visitor-registration.test.ts), [Unit](../../tests/unit/visitor-flow.test.ts)
- [หน้าลงทะเบียน](../../../smart-dormitory-frontend/src/modules/visitor/VisitorRegistrationPage.tsx), [QA](../qa/system-flow-report.md)
