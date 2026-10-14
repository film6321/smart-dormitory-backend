# บทที่ 2 แนวคิดและวิธีที่ใช้

เทคโนโลยีที่อธิบายในเล่มเลือกเฉพาะส่วนหลักที่ใช้งานจริง ดู [ตารางแยกภาษา Framework Library และเครื่องมือ](deployment-and-data.md#เทคโนโลยีหลัก-แยกตามประเภท) โดย TypeScript เป็นภาษา, Node.js เป็น Runtime, Express เป็น Web framework, React เป็น UI library และ Vite เป็นเครื่องมือพัฒนา/build ไม่รวบทุก dependency มาเป็นหัวข้อทฤษฎีแยกกัน

## 2.1 Modular Monolith และการแบ่งงานตามโมดูล

ระบบจัดบริการ HTTP เป็น Express แอปเดียว แต่จัดโค้ดตามงานใน `src/modules/<module>` เช่น auth, tenants, maintenance, visitor และ billing ภายในโมดูลมี Routes, Controller, Service, Repository/DTO ตามที่ใช้จริง ไม่ใช่ microservices ทั้งระบบ บริการ OCR/Face/Payment เป็นระบบภายนอกที่เรียกผ่าน wrapper

Routes กำหนด URL และ middleware Controller แปลง/ตรวจ payload และส่งงานให้ Service ส่วน Service คุมกฎธุรกิจและ transaction Repository รวม query ที่นำมาใช้ซ้ำ บาง Service ปัจจุบันยังใช้ Prisma เพื่อคุม transaction โดยตรง จึงไม่ควรอ้างว่าทั้ง repository เป็น Clean Architecture อย่างเคร่งครัด

Express ใช้ middleware ต่อเป็นลำดับสำหรับ authentication, authorization, validation และจัดการ error ดู [คู่มือ Express](https://expressjs.com/en/guide/using-middleware/) (เข้าถึง 8 ต.ค. 2569)

## 2.2 รูปแบบการเขียนโปรแกรม

TypeScript ช่วยตรวจชนิดข้อมูลระหว่างพัฒนา แต่ไม่แทนการตรวจ input ที่เข้ามาทาง HTTP ระบบจึงใช้ class-validator/class-transformer ร่วมกับ DTO ก่อนส่งข้อมูลเข้า Service

ระบบใช้ class ที่มี static methods เพื่อจัดกลุ่มกฎธุรกิจ ร่วมกับฟังก์ชัน utility และ async/await สำหรับ I/O ส่วนหน้าจอใช้ functional components และ Custom Hooks เพื่อแยก logic ออกจาก view ไม่ได้ใช้รูปแบบ OOP หรือ Functional Programming แบบบริสุทธิ์อย่างใดอย่างหนึ่งทั้งระบบ

Custom Hooks ใช้ซ้ำ logic ได้ แต่การเรียก hook คนละที่ไม่ได้ทำให้ state เป็นชุดเดียวกันอัตโนมัติ และ subscription ต้อง cleanup ดู [React: Reusing Logic with Custom Hooks](https://react.dev/learn/reusing-logic-with-custom-hooks) (เข้าถึง 8 ต.ค. 2569)

## 2.3 ฐานข้อมูล ความสอดคล้อง และรายการซ้ำ

PostgreSQL เป็น Source of Truth Prisma ทำหน้าที่ ORM จัดการ query/schema Redis ใช้กับ cache, rate limit และ lock ชั่วคราว การล็อก Redis ไม่แทน transaction ของข้อมูลถาวร

การเปลี่ยนหลายรายการที่ต้องสำเร็จร่วมกันใช้ transaction การจอง/คืนห้องและการลบข้อมูลใช้การล็อกหรือเงื่อนไขสถานะที่เหมาะกับโมดูล OCC ใช้ version เมื่อจุดนั้นรองรับ ส่วน idempotency ป้องกันรายการซ้ำจากคำขอหรือธุรกรรมเดิม ไม่ควรอ้างว่าทุก endpoint มีการ deduplicate ถาวรครบแล้ว

อ้างอิง [Prisma Transactions](https://www.prisma.io/docs/orm/fundamentals/transactions) และ [PostgreSQL 16: Transaction Isolation](https://www.postgresql.org/docs/16/transaction-iso.html) (เข้าถึง 8 ต.ค. 2569) ต้องออกแบบการรับมือ conflict/retry ตามจุดใช้งาน ไม่ใช่เปลี่ยนทุก transaction เป็นระดับเดียวโดยอัตโนมัติ

## 2.4 การยืนยันตัวตนและบริการภายนอก

Login ส่ง token ผ่าน HttpOnly cookie เว็บเรียก API พร้อม credentials ตรวจสิทธิ์ทุก request ข้อมูลจาก OCR ต้องตรวจเจ้าของและผูกกับผลตรวจที่บันทึกไว้ การยืนยันสลิปใช้ Payment API และข้อมูลธุรกรรม ไม่ใช่เพียงอ่านข้อความบนภาพ

การส่งผ่าน HTTPS ช่วยคุ้มครองระหว่างส่ง แต่ยังต้องลด payload และตรวจสิทธิ์ REST/Socket/SSE เป็นคนละช่องทางสื่อสาร ไม่ใช่หลักฐานว่าข้อมูลนั้นอยู่ใน Redis เท่านั้น

## 2.5 คะแนนใบหน้าและการประเมิน

ค่าความคล้ายเป็นคะแนนเปรียบเทียบตามโมเดลและ threshold ไม่ใช่เปอร์เซ็นต์ความแม่นยำของระบบ การวัด accuracy ต้องมีชุดข้อมูลที่ทราบคำตอบและจำนวนกรณีจริง รวมทั้ง false acceptance/rejection ตามนิยาม ดูรายละเอียดใน [รายงานการสแกน](../qa/face-scan-report.md)

เอกสารนี้ยังไม่มีงานวิจัยเปรียบเทียบหรือผลทดลองความแม่นยำจากชุดข้อมูลจริง ต้องเพิ่มแหล่งอ้างอิงที่อ่านจริงและจัดรูปแบบตามหลักสูตรก่อนใช้เป็นบททบทวนวรรณกรรมฉบับส่ง

## 2.6 การประเมินผลที่ใช้ในโครงการ

แยก source review, unit/mock, HTTP/PostgreSQL integration, runtime API/DB/files และ user acceptance จำนวน test เป็นจำนวนกรณีของ suite ไม่ใช่ coverage หรือความแม่นยำของระบบ ใช้ RPS สำหรับจำนวนคำขอต่อวินาทีและ TPS สำหรับจำนวน transaction สำเร็จต่อวินาทีบนช่วงทดลองเดียวกัน การทดสอบ local ช่วงสั้นไม่แทนขีดจำกัดใช้งานจริง

การตรวจว่าลบข้อมูลครบต้องตรวจทั้งความสัมพันธ์ในฐานข้อมูล ไฟล์ และคิวล้าง ไม่สรุปจากข้อความลบสำเร็จใน UI อย่างเดียว การแยก read state ของแจ้งเตือนตาม role/account ช่วยไม่ให้แสดงข้อมูลข้ามบัญชี แต่ browser-local read state ยังไม่ใช่การ sync หลายเครื่อง

รายละเอียดวิธีและผลดู [บทที่ 4](04-implementation-and-results.md) และ [สมรรถนะ/ข้อมูล](deployment-and-data.md) แหล่งเอกสารภายนอกที่มีอยู่ข้างต้นเป็นรายการในร่างเดิม ไม่ได้ตรวจการเข้าถึงใหม่ในการจัดเอกสารรอบนี้ ยังต้องจัดวรรณกรรมและบรรณานุกรมจากแหล่งที่อ่านจริงตามข้อกำหนดสถานศึกษา

## 2.7 คำชี้แจงและความยินยอมแยกตามวัตถุประสงค์

คำชี้แจงต้องระบุข้อมูลที่ใช้ วัตถุประสงค์ ผู้ที่เกี่ยวข้องกับการประมวลผล แนวทางเก็บ/ล้าง และช่องทางติดต่อ ระบบแยก HOUSING ออกจาก FACE_ENROLLMENT และการยอมรับสัญญา ไม่เลือกช่องยินยอมล่วงหน้า ไม่ให้ Admin ยินยอมแทนผ่าน API ของเจ้าของบัญชี และบันทึกหลักฐานพร้อมรุ่นข้อความ/เวลาในฐานข้อมูล

ข้อมูลชีวภาพเพื่อระบุตัวบุคคลต้องพิจารณาแยกจากข้อมูลทั่วไป การใช้ checkbox เพียงอย่างเดียวไม่ได้ยืนยันความครบถ้วนตามกฎหมาย ผู้ดูแลยังต้องพิจารณาฐานกฎหมาย ระยะเวลาเก็บ ช่องทางใช้สิทธิ์ และข้อตกลงกับผู้ประมวลผลให้ตรงการใช้งานจริง รอบนี้การถอนความยินยอมเป็นการติดต่อผู้ดูแล ไม่มี endpoint ถอนอัตโนมัติ รายละเอียดและแหล่งอ้างอิงที่อ่านแล้วอยู่ใน [โมดูลใบหน้า](face-verification.md)
