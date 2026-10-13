# บทที่ 3 การวิเคราะห์และออกแบบระบบ

ฉบับอ้างอิง implementation และขอบเขต ณ 13 ตุลาคม 2569 รายละเอียดผลทดลองแยกไว้ในบทที่ 4

## 3.1 ผู้ใช้งานและความต้องการ

| ผู้ใช้งาน | ความต้องการหลัก | ขอบเขตข้อมูล |
|---|---|---|
| User/STUDENT | สมัคร ตรวจสัญญา ชำระบิล แจ้งซ่อม และอ่านแจ้งเตือน | ข้อมูลของบัญชีตนเอง |
| Admin | อนุมัติผู้พัก จัดห้อง/ราคา บิล ซ่อม Visitor และรายงาน | ข้อมูลที่จำเป็นต่อการบริหารตาม endpoint |
| ผู้มาติดต่อ | อ่านบัตร ส่งคำขอและดาวน์โหลดหลักฐาน | ส่งคำขอ; ไม่มีสิทธิ์ list/pass ของคนอื่น |

ความต้องการร่วมคือข้อมูลคงอยู่หลังรีเฟรช ลดการกรอกซ้ำ ตรวจสิทธิ์ที่ server ป้องกัน submit ซ้ำ และมีปลายทางสถานะชัดเจน แต่ละหน้ามี loading/empty/error ตามงาน การซ่อนปุ่มไม่แทนการตรวจสิทธิ์

## 3.2 สถาปัตยกรรม

ระบบใช้ TypeScript เป็นภาษาหลัก React สร้างหน้าจอ Vite สนับสนุนการพัฒนา/build Axios ส่งคำขอ HTTP และ Express จัดการ API โดยแบ่งโมดูลตามหน้าที่ Prisma/PostgreSQL 16 เก็บข้อมูลถาวร Redis ใช้ cache, lock, rate limit และ presence บริการ OCR/Face/payment ติดต่อผ่าน wrapper องค์ประกอบเหล่านี้ร่วมกันรองรับ flow ของระบบเดียว

Compose ปัจจุบันจัดบริการ API ฐานข้อมูล cache PgBouncer Nginx และบริการ/profile ที่ระบุจริง ส่วนเว็บใช้ Vite/ไฟล์ build และยังไม่มี service ใน Compose นี้ รายละเอียดการติดตั้งองค์ประกอบร่วมกันอยู่ใน [Deployment and data](deployment-and-data.md)

## 3.3 แบบจำลองข้อมูล

| Model | หน้าที่และความสัมพันธ์ |
|---|---|
| User | บัญชี phone/role/password/lastLogin/session version; มี Tenant ได้ตาม schema |
| Tenant | โปรไฟล์เข้าพัก สถานะ สัญญา snapshot เชื่อม User/Room |
| Room | ห้อง ราคา ความจุและสถานะ |
| HousingApplicationDraft | ข้อมูลสมัครที่ server เชื่อม User และห้อง |
| Bill | ยอดเรียกเก็บแยกประเภท/รอบ เชื่อม Tenant |
| Payment | ผลชำระบิลหรือมัดจำ เชื่อม payer/verification/draft ตามกรณี |
| PaymentBatch/Item | รวมบิลและความสัมพันธ์ชุดชำระ |
| MaintenanceTicket | งานซ่อมเชื่อม Tenant/Room |
| Visitor/VisitorLog | คำขอและขั้นเข้าพบที่อ้างจาก log |
| IdCardVerification/OcrJob | ผลอ่านและหลักฐานเอกสาร |
| FaceEnrollmentPhoto/FaceEmbedding | ภาพอ้างอิง/template ตาม integration |
| Notification/Preference | แจ้งเตือนและผู้รับ |
| SystemSetting | ค่าระบบ คณะ และคิว cleanup ที่ต้องอยู่ถาวร |
| AccessLog/Transaction | ร่องรอยการทำงานตามจุดที่บันทึก |

รูปจริงเก็บในพื้นที่ไฟล์และอ้าง path ไม่ใช่ binary ทุกภาพในฐานข้อมูล การออกแบบการสำรอง/ลบต้องตรวจทั้ง reference และไฟล์ Schema อ้าง [prisma/schema.prisma](../../prisma/schema.prisma) ไม่สร้าง ER ที่มี Building/Course table สมมติโดยไม่ตรวจ schema

## 3.4 กระบวนการสมัครและสัญญา

สมัคร 4 ขั้น: ตัวตน/OCR/ข้อมูลส่วนตัว → ผู้ติดต่อฉุกเฉิน → ห้อง/ชำระเงิน → สัญญา/ยืนยัน ชื่อ วันเกิด เลขบัตรและที่อยู่ดึงจากข้อมูลที่ตรวจแก้แล้ว ไม่กรอกใหม่บนสัญญา เบอร์ติดต่อใช้บัญชี คณะเลือกจากคำแนะนำขณะพิมพ์ ไม่มีช่องหลักสูตรในฟอร์มปัจจุบัน

Draft/เครดิตผูก User ที่ server การเปลี่ยนห้องคำนวณยอดขาดจากเครดิตที่ตรวจผ่าน ข้อมูลผู้ให้เช่าและเงื่อนไข CONTRACT มาจาก Admin วันเริ่มคือวันปัจจุบัน Asia/Bangkok วันสิ้นสุดบวก 5 เดือนปฏิทินแบบ clamp สิ้นเดือน สัญญาที่ส่งแล้วคง snapshot การอนุมัติ Tenant แยกจากการตรวจสลิปและการนับรายรับมัดจำ

## 3.5 กระบวนการที่มีปลายทาง

| Flow | ปลายทางและ guard |
|---|---|
| ซ่อม | PENDING → APPROVED → IN_PROGRESS → RESOLVED → CLOSED; ผู้พักยืนยันสุดท้าย |
| Visitor | คำขอแยกจาก WAITING → ADMITTED → COMPLETED; manual record ไม่ใช่ประตูจริง |
| บิล | UNPAID/OVERDUE → VERIFYING → PAID หรือ FAILED ตามผลตรวจ |
| ย้ายออก | INACTIVE/isActive false/คืนห้อง; ปฏิเสธเมื่อบิลค้าง |
| purge | ลบข้อมูลผูกผู้พัก เก็บ User; 202 ระหว่างล้างจน COMPLETE |
| สมัครใหม่ | เก็บบัญชีเดิม ข้อมูลผู้พักใหม่ไม่ใช้โปรไฟล์ที่ purge แล้ว |

purge ไม่เก็บ Tenant ARCHIVED หรือยอดบิลนิรนามแทนการลบ ชุด QR PENDING ที่ไม่เคยมีหลักฐานและทุกบิลชำระแล้วลบไปพร้อมชุดข้อมูลได้ภายใต้ guard บัญชีร่วม/เงินค้าง/งานค้างยังป้องกันตามเดิม

การล้างบัญชีไม่ใช้ 1 ปีนับ login สำเร็จล่าสุดหรือ createdAt เมื่อไม่เคย login ไม่ใช้ heartbeat ไม่มีแจ้งล่วงหน้าและต้องเปิด worker mode ตาม deployment เงื่อนไขข้าม Admin/รายการค้างยังใช้

## 3.6 API ความปลอดภัยและ realtime

Response เป็น statusCode/success/message/data และ HTTP status ต้องตรง Session ใช้ HttpOnly cookie และ authSessionVersion จากบัญชีปัจจุบัน ไม่ใช้ User.version ของ OCC แทน Logout/เปลี่ยนรหัสผ่าน revoke session ทุกเครื่อง

Socket ส่งข้อมูลส่วนบุคคลตรง user:<id> และงานกลางไป admins ไม่ใช้ห้องร่วมส่งข้อมูลส่วนตัว REST กรอง ownership ส่วนหน้า User derive บิล/ซ่อม/สัญญาจาก API ตนเองทุก 30 วินาทีเป็น fallback Read state แยก role/account ใน browser ยังไม่ sync ข้ามเครื่อง

## 3.7 UX/UI และการทดสอบ

ใช้ shared header/modal/table/search สีและระยะตาม frontend spec หน้าแรก Skeleton ตามชนิดข้อมูล action ใช้ spinner หน่วงสั้นคงข้อความเดิม แสดงภาพ OCR/สลิปพร้อมโหลดในช่องเดียว แสดง error ใกล้ข้อมูลที่ต้องแก้ Empty state ไม่สร้างกราฟสมมติ

แผนทดสอบครอบคลุม happy path, validation, ownership/role, สถานะขัดแย้ง, double submit, รีเฟรช/กู้ draft, การลบ DB/files และ retry แยก UT/IT/RT/UA/OS ทุกผลไม่ใช้จำนวน route เป็นหลักฐานว่าระบบผ่านทั้งหมด

อ่านต่อ [บทที่ 4](04-implementation-and-results.md) และ [สารบัญโมดูล](README.md)
