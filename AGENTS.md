# AGENTS.md: Codex Project Instructions (v1.0.0)

## 1. บทบาท (Role)
คุณคือ Senior Full-stack Developer สำหรับ **Smart-Dormitory-Management-System**
ทำงานในฐานะ AI Coding Agent สำหรับโปรเจกต์โครงสร้าง Docker-based modular monolith เน้นการเขียนโค้ดและแก้ไขระบบที่นำไปใช้งานได้จริงในโปรดักชัน (Production-aware) ตรงตรรกะ และคล้องจองกับโครงสร้างปัจจุบันใน Repository

---

## 2. ขั้นตอนก่อนเริ่มงานและการจัดเส้นทางบริบท (Pre-Task Protocol & Context Routing)

### 2.1 ลำดับการเปิดเอกสาร (Context Routing Guide)
ก่อนเริ่มทำภารกิจใดๆ ห้าม AI เอเจนต์อ่านไฟล์ผังงานภาพรวมทั้งหมดตลอดย้อนหลังโดยไม่มีทิศทาง ให้เริ่มดังนี้:
1. อ่าน **`AI-INDEX.md`** เป็นประตูด่านแรก (หากมี) เพื่อหาไฟล์ Specs เฉพาะโมดูล
2. อ่าน **`AGENTS.md`** (ไฟล์นี้) เพื่อทำความเข้าใจระเบียบหลัก
3. ค้นหาและเปิดเฉพาะไฟล์ Spec/Contract ของโมดูลที่เกี่ยวข้องโดยตรงในโฟลเดอร์ `.docs/`
4. อ่านประวัติใน `.docs/AI-CHANGELOG/` เฉพาะวันที่เกี่ยวข้องเมื่อจำเป็นต้องย้อนประวัติการแก้ไข
*หลีกเลี่ยงการเปิดเอกสารประวัติทั้งหมดพร้อมกันเพื่อประหยัด Token Window และลดปัญหาความคัดแย้ง*

### 2.2 ขั้นตอนก่อนลงมือปฏิบัติงาน (Pre-Task Protocol Check)
1. ตรวจสอบ Source Code จริงในโมดูลที่เกี่ยวข้องและระบบการทดสอบ (Automated Tests)
2. ตรวจสอบรายละเอียดพอร์ต ตัวแปรสภาพแวดล้อม (.env) และการเชื่อมต่อใน Docker Context ปัจจุบัน
3. ค้นหา codebase เผื่อระบุรอยต่อการทำงาน แทนที่จะเดาโครงสร้างขึ้นมาเอง
4. **ถามผู้ใช้เพื่อตกลงใจก่อนแก้ไขระบบสำคัญเสมอ**

---

## 3. ลำดับความสำคัญของชุดข้อมูลสารสนเทศ (Source Precedence)

เมื่อพบข้อมูลขัดแย้งกันในโปรเจกต์ ให้จัดลำดับความถูกต้องของแหล่งข้อมูลตามความน่าเชื่อถือนี้:
1. กฎข้อห้ามหลักใน **`AGENTS.md`** และ **Critical Protection Rules** ของระบบ
2. สัญญาจำเพาะ (Active Contracts/Specs) ที่ระบุใน `AI-INDEX.md` และโฟลเดอร์ `.docs/`
3. โค้ดที่ใช้งานล่าสุด (Implementation) สอดคล้องกับผลลัพธ์ของ Automated Tests
4. เอกสารบันทึกการเปลี่ยนแปลงเก่า ๆ และ Changelog ประวัติย้อนหลัง
*ถ้าตัวโค้ดที่รันจริงมีพฤติกรรมอ่อนแอกว่ากฎความปลอดภัย ให้รักษาความปลอดภัยเป็นหลักแล้วรายงานปัญหาบั๊กเพื่อแก้ไขโค้ดต่อไป ห้ามลดระดับกฎลงมา*

---

## 4. ข้อกำหนดด้านเทคนิคและสถาปัตยกรรม (Technical Constraints)

### 4.1 สถาปัตยกรรม Backend (Node.js / Express / TypeScript)
* ใช้ **Express.js** ร่วมกับ **TypeScript**
* ยึดโครงสร้าง **Modular Architecture**: แต่ละโมดูลอยู่ภายใต้ `src/modules/<module-name>/`
* **Thin Controller Rule:** Controller ทำหน้าที่เป็นเพียง Transport Layer เท่านั้น (ทำหน้าที่ Validate Input ข้อมูล, Authorize ตรวจสอบสิทธิ์ และ Map Payload ล่วงหน้า) **ห้ามเขียน Business Logic, ห้ามเขียนการคำนวณซับซ้อน หรือเรียกใช้งาน Prisma Client ตรง ๆ จาก Controller เด็ดขาด** ให้ส่งต่อไปให้ Service Layer ในโฟลเดอร์ `services/` จัดการเสมอ
* **Standardized API Response Wrapper:** คืนค่า API REST Response ในรูปแบบเดียวกันโดยใช้ Wrapper โครงสร้าง `ApiResponse<T>` (มี statusCode, success, message, และ data เสมอ ห้ามส่งค่าดิบ/ค่าเปลือย) โดย HTTP Response status code ของ Express จะต้องมีสถานะตรงกับ `statusCode` ในตัว Payload Body นั้นด้วยเสมอ
* **Validation:** ต้องทำการกรองข้อมูล (Data Validation) ผ่าน `class-validator` และ `class-transformer` ป้องกันบั๊กตั้งแต่ Endpoint ข้อมูล

### 4.2 ระบบภายนอก (OCR & Face Verification)
* OCR และ Face Verification เป็น API ภายนอก (External APIs) ที่ระบบจัดไว้ให้แล้วในโครงสร้าง Wrapper
* โมดูล `ocr/` และ `face-verification/` บน Backend มีหน้าที่รับผิดชอบในฐานะ **Service Wrapper** ทำหน้าที่ยิง Http Request ส่งภาพไปประมวลผลภายนอกต่อเท่านั้น
* **ห้ามติดตั้งหรือเขียน engine ประมวลผล OCR หรืองาน Face Verification / Face Detection ขึ้นมาใหม่เองเด็ดขาด** ให้เชื่อมโยงผ่าน Client API และ Fallback Router ที่กำหนดไว้

### 4.3 โครงสร้างฐานข้อมูลและการเก็บรักษาสถานะ (Database & Redis)
* ใช้ **PostgreSQL 16** ร่วมกับ **Prisma ORM** ในการคุม Schema และการทำ Database query 
* ไฟล์ Schema หลักต้องอยู่ที่ `prisma/schema.prisma`
* **Redis rules:** Redis ถือเป็น Operation Cache เท่านั้น ห้ามยกฐานะเป็น Source of Truth สำหรับข้อมูลหลัก เช่น ประวัติล็อกอินของ Visitor, งานแจ้งซ่อม และบิลชำระเงินต้องบันทึกลง PostgreSQL ทันที ส่วน Redis ใช้เก็บสถานะ Heartbeat, อัปเดตพิกัด/กล้องสตรีมชั่วคราว, Rate limit หรือ Lock session การจ่ายเงิน/ตรวจบัตรเพื่อกัน Double Submission เท่านั้น

### 4.4 การจำแนกประเภทเหตุการณ์ (Event Classification)
ระบบห้ามเขียนอีเวนต์ต่าง ๆ ผสมกันโดยไร้โครงสร้าง ให้แยกเป็น:
1. **Domain Events:** ทำงานและรับส่งข้อมูลเฉพาะภายใน Module (ในโปรเซส Express)
2. **Integration Events:** (หากสื่อสารข้ามระบบหรือ Microservice ในอนาคต) บังคับใช้ชื่อ `<Domain><Action>IntegrationEvent`
3. **Telemetry Events:** Real-time data ความถี่สูง (เช่น สตรีมภาพกล้องสแกน หรือ Log การอ่านบัตร)

### 4.5 สถาปัตยกรรมหน้าบ้าน (React / Vite / TypeScript)
* ใช้ React (Vite) ร่วมกับ TypeScript
* คงรูปแบบ **Modular Architecture**: แยกแต่ละโมดูลหน้าจอที่ `frontend/src/modules/<module-name>/`
* ใช้ Axios สำหรับส่งคำขอ HTTP (ตั้งค่าคอนฟิกกลางที่ `frontend/src/services/`)
* สกัด Logic ออกจาก View Component ไปอยู่ร่วมกันที่ **Custom Hooks** เสมอ
* วาง UI components ร่วมกันไว้ที่ `frontend/src/components/` และ Interface ของ TS ไว้ที่ `frontend/src/types/`
* **UI Memory Leak Prevention:** ในหน้าจอลูกค้า ต้องป้องกันปัญหา Memory Leak เมื่อเชื่อมต่อ Socket.io หรือการรอผลการจองสิทธิ โดยทำการ Unsubscribe / Cleanup ใน `useEffect` เสมอ

### 4.6 Docker & Containers
* ทุก Service (Backend, Frontend, PostgreSQL, Redis) ต้องทำงานอยู่ในโครงสร้าง `docker-compose.yml`
* ต้องแน่ใจว่าการตั้งค่า Networking ใน compose ไม่เปิดเผยพอร์ตที่เสี่ยงภัยออกสู่พื้นที่สาธารณะโดยไม่มี Auth

---

## 5. การป้องกันตัวเอเจนต์ AI จินตนาการ (Anti-Hallucination Guardrails)

* ❌ **ห้ามเดาและจำลองค่าเอง:** ห้ามเดา Endpoints, JSON payload, Redis keys หรือชื่อตัวแปร ถ้าหลักฐานไม่เพียงพอให้ทำการสืบค้นทั่วทั้ง Repository ก่อนถามผู้บริโภค
* ❌ **ห้ามเปลี่ยน Casing ตัวแปรโดยพลการ:** ห้ามลดรูปหรือปรับ camelCase ของฝั่ง Frontend หรือ PascalCase ของ Backend ให้เละเทะโดยไม่ได้ไปสำรวจจุดอ้างอิงจริง
* ❌ **ห้ามอ้างอิง Path ปลอม:** ห้ามประกาศใช้งาน Class, Function, หรือโครงสร้างไดเรกทอรีที่ไม่มีอยู่จริงในโครงการ
* ❌ **ห้ามลบประวัติหรือ Revert โค้ดผู้ใช้:** ห้ามทำการลบโค้ดส่วนอื่นที่ไม่เกี่ยวข้องกับแผนภารกิจ

---

## 6. แนวทางระดับความปลอดภัยและปัญหาที่ต้องระวัง (Known Critical Pitfalls)

* **Double Request / Locks:** สำหรับการยืนยันตัวตนคนสแกนใบหน้า หรือลงทะเบียนผู้ติดต่อ (Visitor) ห้ามให้เกิดการ Submit ข้อมูลซ้อนกัน ต้องใช้ Redis Lock หรือตัวตรวจจับช่วยล็อกก่อนประมวลผลรอบถัดไป
* **Optimistic Concurrency Control (OCC):** เพื่อป้องกันสิทธิการจองห้องพัก หรือสถานะชำระเงินที่เปลี่ยนพร้อมกัน ให้ใช้ระบบ Versioning ผ่านฟีลด์ `version` (มีรองรับใน User Model) ในฐานข้อมูลในการเช็คความขัดแย้งของข้อมูล
* **Idempotency checks:** ทุกงานที่เป็นระบบประมวลผลบิลหรือตัดจ่าย ต้องตรวจสอบว่าอีเวนต์ ID และเลข Transaction นั้นถูกเคลียร์ไปหรือยังก่อนอัปเดตสิทธิ์ใหม่ เผื่อแก้ไของค์ประกอบระบบล่มกลางคัน
* **OCR Connection Timeout:** การสแกน slip โอนเงินหรือบัตรประชาชน ต้องทำการห่อและกำหนด Timeout รวมถึง Handler สำหรับกรณีเซิร์ฟเวอร์ OCR ภายนอกขัดข้อง

---

## 7. ทะเบียนการคุ้มครองโค้ดส่วนวิกฤต (Critical Code Protection Registry)

ห้ามดำเนินการใด ๆ เหล่านี้กับไฟล์และ Endpoint สำคัญโดยเด็ดขาด ยกเว้นแต่ได้รับอนุมัติจากผู้รับผิดชอบโครงการ:
1. ❌ **ห้ามล้างหรือลบไฟล์ Critical ทิ้งทั้งอัน**
2. ❌ **ห้ามคอมเมนต์ปิด (Comment-out) ตรรกะงานหลักของระบบ**
3. ❌ **ห้ามแก้ไข Function signature** ในพับลิกโมดูลการทำงานหลัก
4. ❌ **ห้ามลบกลไก Fallback** (เช่น ตรรกะประมวลผลไฟล์ภาพใน OCR กรณีส่งไป API ตัวใหญ่ไม่ผ่าน)

### 7.1 รายละเอียดระดับความเข้มงวด (File Registry Tiers)

* **Tier 1: System Critical (ห้ามแปลง/ห้ามยุบโครงสร้างสำคัญ)**
  * `prisma/schema.prisma` (Database Schema)
  * `src/modules/ocr/ocr.service.ts` (API OCR integration)
  * `src/modules/auth/auth.service.ts` (ตรรกะตรวจเช็คความปลอดภัย Tokens)
  * `src/app.ts` และ `src/index.ts` (จุดลงทะเบียนเซิร์ฟเวอร์ Express)
* **Tier 2: Feature Critical (ห้ามลบและต้องรักษาอินเทอร์เฟซกลาง)**
  * `src/shared/api-response.ts` (API Responses Wrapper)
  * `src/database/db.ts` (สิทธิทางฐานข้อมูลและการเริ่ม Prisma client)
  * Middleware คุมความปลอดภัยและการควบคุมสิทธิ์ Roles ใน `src/middlewares/`
* **Tier 3: Configuration Critical**
  * `docker-compose.yml` และ `.env.example`
  * `package.json` และ `tsconfig.json`

### 7.2 Endpoint ที่ได้รับการคุ้มครอง
* `POST /ocr/verify` (หรือระบบยิงอ่านบัตรประชาชน)
* `POST /auth/login` และ `POST /auth/register`
* Endpoints จัดการการตรวจสอบใบหน้าและยืนยันบิล

---

## 8. กฎการเก็บบันทึกและการทดสอบ (Logging & Testing Rules)

* **ความเกี่ยวโยงของ Log (Trace Correlation):** ทุก Log ของการไหลข้อมูลในโมดูลระบบ ต้องมี `CorrelationId` (ถ้าส่งมาใน Request Header), `UserId` หรือ `RoomId` อยู่ในบันทึกเสมอเพื่อใช้อ้างอิงการค้นหา
* **การบันทึกการทดสอบโหลด:** เมื่อมีการจำลอง Load Test หรือรันการทดสอบขีดจำกัดใด ๆ ห้ามบันทึกผลการทดสอบไว้นอกกรอบ ให้จัดเก็บไว้ในโฟลเดอร์ `tests/load/logs/YYYY-MM-DD/` โดยแยกประเภทไฟล์ให้เป็นมาตรฐานดังนี้:
  * `stats.csv` (ตัวชี้วัดประสิทธิภาพคอมพิวเตอร์และการตอบสนอง)
  * `run.log` (ข้อมูลรายละเอียดการทำงานของสคริปต์สแกน)
  * `final_report.md` (วิเคราะห์ผลลัพธ์ของระบบหอพัก)
* **การติดตั้ง Package ใหม่:**
  * ตรวจเช็คในไฟล์ `package.json` ก่อนเสมอว่ามีของเดิมที่สเปกคล้ายกันติดตั้งไว้อยู่แล้วหรือไม่เพื่อกันปัญหาความขัดแย้ง
  * ห้ามแก้ไข `npm.lock` หรือ `package-lock.json` โดยไม่มีการปรึกษาและอธิบายประโยชน์ทางสถาปัตยกรรมอย่างเป็นขั้นเป็นตอน

---

## 9. ขอบเขต ห้าม/ยอมรับ และรายการตรวจสอบการตรวจสอบ (Boundaries & Verification)

### 9.1 ขอบเขตสูงสุด (Absolute Boundaries)
* ❌ ห้ามแก้ตัวถ่วงดุลของระบบ Database โดยไม่ขออนุมัติและอธิบายเหตุผลให้ชัดแจ้ง
* ❌ ห้ามเปลี่ยนสแต็กภาษาการเขียนโค้ดหลัก จาก TypeScript เป็น JavaScript ดิบ
* ❌ ห้ามเปลี่ยนแปลง Package Manager (รักษาการใช้งาน `npm` เท่านั้น)
* ❌ ห้ามแก้ไขไฟล์สำคัญโดยไม่ได้ทำการศึกษาไฟล์อื่นที่เกี่ยวโยงในรอบข้างก่อน

### 9.2 รายการตรวจสอบก่อนตรวจสอบส่งมอบ (Verification Checklist Before Finish)
ทุกครั้งที่ AI Agent ทำภารกิจเสร็จสิ้น ต้องสามารถยืนยันจุดตรวจสอบเหล่านี้ได้:
* [ ] การทดสอบ Build ผ่านสำเร็จหมดจด (`npm run build`)
* [ ] ไร้ข้อผิดพลาดทาง TypeScript, ESLint หรือ Prettier
* [ ] Endpoint และ Routing ที่เกี่ยวข้องยังสามารถตอบสนองสถานะ HTTP ได้ปกติ
* [ ] มีการเคลียร์เอาโค้ดตรวจสอบแบบฉุกเฉิน (Temporary debug code หรือ `console.log` ถาวร) ออกจากโปรดักชันเรียบร้อยแล้ว
* [ ] ไม่มีการสร้างไฟล์ทับซ้อนและไม่มีการเพิ่ม Package ซ้ำเปล่า ๆ ในระบบ
