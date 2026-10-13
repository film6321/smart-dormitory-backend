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
   _หลีกเลี่ยงการเปิดเอกสารประวัติทั้งหมดพร้อมกันเพื่อประหยัด Token Window และลดปัญหาความคัดแย้ง_

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
   _ถ้าตัวโค้ดที่รันจริงมีพฤติกรรมอ่อนแอกว่ากฎความปลอดภัย ให้รักษาความปลอดภัยเป็นหลักแล้วรายงานปัญหาบั๊กเพื่อแก้ไขโค้ดต่อไป ห้ามลดระดับกฎลงมา_

---

## 4. ข้อกำหนดด้านเทคนิคและสถาปัตยกรรม (Technical Constraints)

### 4.1 สถาปัตยกรรม Backend (Node.js / Express / TypeScript)

- ใช้ **Express.js** ร่วมกับ **TypeScript**
- ยึดโครงสร้าง **Modular Architecture**: แต่ละโมดูลอยู่ภายใต้ `src/modules/<module-name>/`
- **Thin Controller Rule:** Controller ทำหน้าที่เป็นเพียง Transport Layer เท่านั้น (ทำหน้าที่ Validate Input ข้อมูล, Authorize ตรวจสอบสิทธิ์ และ Map Payload ล่วงหน้า) **ห้ามเขียน Business Logic, ห้ามเขียนการคำนวณซับซ้อน หรือเรียกใช้งาน Prisma Client ตรง ๆ จาก Controller เด็ดขาด** ให้ส่งต่อไปให้ Service Layer ที่ `src/modules/<module-name>/*.service.ts` จัดการเสมอ (คงโครงสร้างเดิม ไม่สร้างโฟลเดอร์ `services/` เพื่อให้ตรงชื่อเอกสารอย่างเดียว)
- **Standardized API Response Wrapper:** คืนค่า API REST Response ในรูปแบบเดียวกันโดยใช้ Wrapper โครงสร้าง `ApiResponse<T>` (มี statusCode, success, message, และ data เสมอ ห้ามส่งค่าดิบ/ค่าเปลือย) โดย HTTP Response status code ของ Express จะต้องมีสถานะตรงกับ `statusCode` ในตัว Payload Body นั้นด้วยเสมอ
- **Validation:** ต้องทำการกรองข้อมูล (Data Validation) ผ่าน `class-validator` และ `class-transformer` ป้องกันบั๊กตั้งแต่ Endpoint ข้อมูล

### 4.2 ระบบภายนอก (OCR & Face Verification)

- OCR และ Face Verification เป็น API ภายนอก (External APIs) ที่ระบบจัดไว้ให้แล้วในโครงสร้าง Wrapper
- โมดูล `ocr/` และ `face-verification/` บน Backend มีหน้าที่รับผิดชอบในฐานะ **Service Wrapper** ทำหน้าที่ยิง Http Request ส่งภาพไปประมวลผลภายนอกต่อเท่านั้น
- **ห้ามติดตั้งหรือเขียน engine ประมวลผล OCR หรืองาน Face Verification / Face Detection ขึ้นมาใหม่เองเด็ดขาด** ให้เชื่อมโยงผ่าน Client API และ Fallback Router ที่กำหนดไว้

### 4.3 โครงสร้างฐานข้อมูลและการเก็บรักษาสถานะ (Database & Redis)

- ใช้ **PostgreSQL 16** ร่วมกับ **Prisma ORM** ในการคุม Schema และการทำ Database query
- ไฟล์ Schema หลักต้องอยู่ที่ `prisma/schema.prisma`
- **Redis rules:** Redis ถือเป็น Operation Cache เท่านั้น ห้ามยกฐานะเป็น Source of Truth สำหรับข้อมูลหลัก เช่น ประวัติล็อกอินของ Visitor, งานแจ้งซ่อม และบิลชำระเงินต้องบันทึกลง PostgreSQL ทันที ส่วน Redis ใช้เก็บสถานะ Heartbeat, อัปเดตพิกัด/กล้องสตรีมชั่วคราว, Rate limit หรือ Lock session การจ่ายเงิน/ตรวจบัตรเพื่อกัน Double Submission เท่านั้น

### 4.4 การจำแนกประเภทเหตุการณ์ (Event Classification)

ระบบห้ามเขียนอีเวนต์ต่าง ๆ ผสมกันโดยไร้โครงสร้าง ให้แยกเป็น:

1. **Domain Events:** ทำงานและรับส่งข้อมูลเฉพาะภายใน Module (ในโปรเซส Express)
2. **Integration Events:** (หากสื่อสารข้ามระบบหรือ Microservice ในอนาคต) บังคับใช้ชื่อ `<Domain><Action>IntegrationEvent`
3. **Telemetry Events:** Real-time data ความถี่สูง (เช่น สตรีมภาพกล้องสแกน หรือ Log การอ่านบัตร)

### 4.5 สถาปัตยกรรมหน้าบ้าน (React / Vite / TypeScript)

- ใช้ React (Vite) ร่วมกับ TypeScript
- คงรูปแบบ **Modular Architecture**: โค้ดอยู่ใน repo ข้างเคียง `../smart-dormitory-frontend/`; โมดูลใหม่อยู่ที่ `src/modules/` ส่วน Admin/User เดิมอยู่ใน `src/componants/addminpage/` และ `src/componants/userPage/` ให้แก้ที่ตำแหน่งจริงก่อน ไม่ย้ายทั้งหมดในงานแก้ flow
- ใช้ Axios สำหรับส่งคำขอ HTTP (ตั้งค่าคอนฟิกกลางที่ `../smart-dormitory-frontend/src/services/`)
- สกัด Logic ออกจาก View Component ไปอยู่ร่วมกันที่ **Custom Hooks** เสมอ
- วาง UI components ร่วมกันไว้ที่ `../smart-dormitory-frontend/src/components/` และ TypeScript types ไว้ในโมดูลที่ใช้งานจริง
- **UI Memory Leak Prevention:** ในหน้าจอลูกค้า ต้องป้องกันปัญหา Memory Leak เมื่อเชื่อมต่อ Socket.io หรือการรอผลการจองสิทธิ โดยทำการ Unsubscribe / Cleanup ใน `useEffect` เสมอ

### 4.6 Docker & Containers

- ทุก Service (Backend, Frontend, PostgreSQL, Redis) ต้องทำงานอยู่ในโครงสร้าง `docker-compose.yml`
- ต้องแน่ใจว่าการตั้งค่า Networking ใน compose ไม่เปิดเผยพอร์ตที่เสี่ยงภัยออกสู่พื้นที่สาธารณะโดยไม่มี Auth

---

## 5. การป้องกันตัวเอเจนต์ AI จินตนาการ (Anti-Hallucination Guardrails)

- ❌ **ห้ามเดาและจำลองค่าเอง:** ห้ามเดา Endpoints, JSON payload, Redis keys หรือชื่อตัวแปร ถ้าหลักฐานไม่เพียงพอให้ทำการสืบค้นทั่วทั้ง Repository ก่อนถามผู้บริโภค
- ❌ **ห้ามเปลี่ยน Casing ตัวแปรโดยพลการ:** ห้ามลดรูปหรือปรับ camelCase ของฝั่ง Frontend หรือ PascalCase ของ Backend ให้เละเทะโดยไม่ได้ไปสำรวจจุดอ้างอิงจริง
- ❌ **ห้ามอ้างอิง Path ปลอม:** ห้ามประกาศใช้งาน Class, Function, หรือโครงสร้างไดเรกทอรีที่ไม่มีอยู่จริงในโครงการ
- ❌ **ห้ามลบประวัติหรือ Revert โค้ดผู้ใช้:** ห้ามทำการลบโค้ดส่วนอื่นที่ไม่เกี่ยวข้องกับแผนภารกิจ

---

## 6. แนวทางระดับความปลอดภัยและปัญหาที่ต้องระวัง (Known Critical Pitfalls)

- **Double Request / Locks:** สำหรับการยืนยันตัวตนคนสแกนใบหน้า หรือลงทะเบียนผู้ติดต่อ (Visitor) ห้ามให้เกิดการ Submit ข้อมูลซ้อนกัน ต้องใช้ Redis Lock หรือตัวตรวจจับช่วยล็อกก่อนประมวลผลรอบถัดไป
- **Optimistic Concurrency Control (OCC):** เพื่อป้องกันสิทธิการจองห้องพัก หรือสถานะชำระเงินที่เปลี่ยนพร้อมกัน ให้ใช้ระบบ Versioning ผ่านฟีลด์ `version` (มีรองรับใน User Model) ในฐานข้อมูลในการเช็คความขัดแย้งของข้อมูล
- **Idempotency checks:** ทุกงานที่เป็นระบบประมวลผลบิลหรือตัดจ่าย ต้องตรวจสอบว่าอีเวนต์ ID และเลข Transaction นั้นถูกเคลียร์ไปหรือยังก่อนอัปเดตสิทธิ์ใหม่ เผื่อแก้ไของค์ประกอบระบบล่มกลางคัน
- **OCR Connection Timeout:** การสแกน slip โอนเงินหรือบัตรประชาชน ต้องทำการห่อและกำหนด Timeout รวมถึง Handler สำหรับกรณีเซิร์ฟเวอร์ OCR ภายนอกขัดข้อง

---

## 7. ทะเบียนการคุ้มครองโค้ดส่วนวิกฤต (Critical Code Protection Registry)

ห้ามดำเนินการใด ๆ เหล่านี้กับไฟล์และ Endpoint สำคัญโดยเด็ดขาด ยกเว้นแต่ได้รับอนุมัติจากผู้รับผิดชอบโครงการ:

1. ❌ **ห้ามล้างหรือลบไฟล์ Critical ทิ้งทั้งอัน**
2. ❌ **ห้ามคอมเมนต์ปิด (Comment-out) ตรรกะงานหลักของระบบ**
3. ❌ **ห้ามแก้ไข Function signature** ในพับลิกโมดูลการทำงานหลัก
4. ❌ **ห้ามลบกลไก Fallback** (เช่น ตรรกะประมวลผลไฟล์ภาพใน OCR กรณีส่งไป API ตัวใหญ่ไม่ผ่าน)

### 7.1 รายละเอียดระดับความเข้มงวด (File Registry Tiers)

- **Tier 1: System Critical (ห้ามแปลง/ห้ามยุบโครงสร้างสำคัญ)**
  - `prisma/schema.prisma` (Database Schema)
  - `src/modules/ocr/ocr.service.ts` (API OCR integration)
  - `src/modules/auth/auth.service.ts` (ตรรกะตรวจเช็คความปลอดภัย Tokens)
  - `src/app.ts` และ `src/index.ts` (จุดลงทะเบียนเซิร์ฟเวอร์ Express)
- **Tier 2: Feature Critical (ห้ามลบและต้องรักษาอินเทอร์เฟซกลาง)**
  - `src/shared/api-response.ts` (API Responses Wrapper)
  - `src/database/db.ts` (สิทธิทางฐานข้อมูลและการเริ่ม Prisma client)
  - Middleware คุมความปลอดภัยและการควบคุมสิทธิ์ Roles ใน `src/middlewares/`
- **Tier 3: Configuration Critical**
  - `docker-compose.yml` และ `.env.example`
  - `package.json` และ `tsconfig.json`

### 7.2 Endpoint ที่ได้รับการคุ้มครอง

- `POST /ocr/verify` (หรือระบบยิงอ่านบัตรประชาชน)
- `POST /auth/login` และ `POST /auth/register`
- Endpoints จัดการการตรวจสอบใบหน้าและยืนยันบิล

---

## 8. กฎการเก็บบันทึกและการทดสอบ (Logging & Testing Rules)

- **ความเกี่ยวโยงของ Log (Trace Correlation):** ทุก Log ของการไหลข้อมูลในโมดูลระบบ ต้องมี `CorrelationId` (ถ้าส่งมาใน Request Header), `UserId` หรือ `RoomId` อยู่ในบันทึกเสมอเพื่อใช้อ้างอิงการค้นหา
- **การบันทึกการทดสอบโหลด:** เมื่อมีการจำลอง Load Test หรือรันการทดสอบขีดจำกัดใด ๆ ห้ามบันทึกผลการทดสอบไว้นอกกรอบ ให้จัดเก็บไว้ในโฟลเดอร์ `tests/load/logs/YYYY-MM-DD/` โดยแยกประเภทไฟล์ให้เป็นมาตรฐานดังนี้:
  - `stats.csv` (ตัวชี้วัดประสิทธิภาพคอมพิวเตอร์และการตอบสนอง)
  - `run.log` (ข้อมูลรายละเอียดการทำงานของสคริปต์สแกน)
  - `final_report.md` (วิเคราะห์ผลลัพธ์ของระบบหอพัก)
- **การติดตั้ง Package ใหม่:**
  - ตรวจเช็คในไฟล์ `package.json` ก่อนเสมอว่ามีของเดิมที่สเปกคล้ายกันติดตั้งไว้อยู่แล้วหรือไม่เพื่อกันปัญหาความขัดแย้ง
  - ห้ามแก้ไข `npm.lock` หรือ `package-lock.json` โดยไม่มีการปรึกษาและอธิบายประโยชน์ทางสถาปัตยกรรมอย่างเป็นขั้นเป็นตอน

---

## 9. ขอบเขต ห้าม/ยอมรับ และรายการตรวจสอบการตรวจสอบ (Boundaries & Verification)

### 9.1 ขอบเขตสูงสุด (Absolute Boundaries)

- ❌ ห้ามแก้ตัวถ่วงดุลของระบบ Database โดยไม่ขออนุมัติและอธิบายเหตุผลให้ชัดแจ้ง
- ❌ ห้ามเปลี่ยนสแต็กภาษาการเขียนโค้ดหลัก จาก TypeScript เป็น JavaScript ดิบ
- ❌ ห้ามเปลี่ยนแปลง Package Manager (รักษาการใช้งาน `npm` เท่านั้น)
- ❌ ห้ามแก้ไขไฟล์สำคัญโดยไม่ได้ทำการศึกษาไฟล์อื่นที่เกี่ยวโยงในรอบข้างก่อน

### 9.2 รายการตรวจสอบก่อนตรวจสอบส่งมอบ (Verification Checklist Before Finish)

ทุกครั้งที่ AI Agent ทำภารกิจเสร็จสิ้น ต้องสามารถยืนยันจุดตรวจสอบเหล่านี้ได้:

- [ ] การทดสอบ Build ผ่านสำเร็จหมดจด (`npm run build`)
- [ ] ไร้ข้อผิดพลาดทาง TypeScript, ESLint หรือ Prettier
- [ ] Endpoint และ Routing ที่เกี่ยวข้องยังสามารถตอบสนองสถานะ HTTP ได้ปกติ
- [ ] มีการเคลียร์เอาโค้ดตรวจสอบแบบฉุกเฉิน (Temporary debug code หรือ `console.log` ถาวร) ออกจากโปรดักชันเรียบร้อยแล้ว
- [ ] ไม่มีการสร้างไฟล์ทับซ้อนและไม่มีการเพิ่ม Package ซ้ำเปล่า ๆ ในระบบ

## 10. กฎลดการบวมและความซับซ้อนของโปรเจกต์ (Anti-Bloat & Complexity Guardrails)

เพื่อไม่ให้โปรเจกต์กลายเป็นงานที่ใหญ่เกินจำเป็นและมีไฟล์จำนวนมากโดยไม่จำเป็น ให้ยึดกฎต่อไปนี้เสมอ:

- ❌ ห้ามสร้างไฟล์ใหม่เพียงเพื่อความสวยงามหรือต้องการแยกย่อยเกินความจำเป็น หากยังไม่จำเป็นต่อ task ที่กำลังทำ
- ❌ ห้ามเพิ่ม layer อื่น ๆ (service, hook, util, abstraction) ที่ไม่ใช้จริงในตอนนี้ หากมันยังไม่ลดความซับซ้อนลง
- ❌ ห้ามสร้างโมดูลใหม่หรือ route ใหม่ โดยไม่เชื่อมโยงกับคิวงานจริงของระบบ
- ❌ ห้ามเพิ่ม package/library ใหม่ ถ้ายังมีตัวเดิมที่ทำงานได้เพียงพอ
- ❌ ห้ามสร้าง docs/spec/guide ใหม่มากเกินจำเป็น ถ้ายังไม่มีความจำเป็นจริง
- ✅ ให้แก้ไขไฟล์เดิมก่อนเสมอ ถ้าเป็นสิ่งที่มีอยู่และพอใช้ได้
- ✅ ให้โฟกัสที่ MVP ที่ใช้งานได้จริงก่อน แล้วค่อยขยายเมื่อมีคำสั่งชัดเจน
- ✅ หากต้องเพิ่มไฟล์ใหม่ ให้ตรวจว่าสอดคล้องกับโครงสร้างเดิมและไม่ซ้ำกับสิ่งที่มีอยู่
- ✅ ทุกการเพิ่มความซับซ้อนต้องมีเหตุผลทางธุรกิจหรือทางเทคนิคชัดเจน และต้องบอกผู้ใช้ก่อนดำเนินการ

### 10.1 ตัวอย่างสิ่งที่ควรเลี่ยง

- สร้าง folder, service, hook, abstraction แยกเพื่อทุกอย่าง
- สร้าง state management แยกตอนโปรเจกต์ยังเล็กมาก
- เพิ่ม dependency ที่ไม่จำเป็น
- เพิ่ม docs/spec มากเกินจริงเมื่อ task ยังไม่ต้องการ
- แยก component ออกมาเกินความจำเป็นจนไม่ช่วยให้โค้ดอ่านง่ายขึ้น


## 11. ขอบเขตและ flow ปัจจุบัน (13 ต.ค. 2569)

- In scope: เว็บ Admin/User/Visitor, HTTP endpoints, authorization, validation, PostgreSQL, ไฟล์ที่ระบบเป็นเจ้าของ, draft/credit, idempotency และการกู้/ล้างข้อมูล ใช้ mock สำหรับ integration ภายนอกได้แต่ต้องระบุในผลทดสอบ
- Out of scope ของรอบนี้: กล้องและอุปกรณ์จริง, ประตู/Edge จริง, SMS จริง และ provider ภายนอกจริง (OCR/Face/payment/notification) การจัดเป็น Out of scope ไม่ใช่การลบ wrapper/fallback/security หรืออ้างว่าทดสอบจริงผ่าน
- Auth ใช้ HttpOnly cookie `access_token`; login body ไม่มี JWT การตรวจ REST/Socket ต้องตรวจบัญชีปัจจุบันกับ `authSessionVersion` ใน PostgreSQL; logout และเปลี่ยนรหัสผ่านยกเลิก session ทุกเครื่อง ไม่ใช้ `User.version` ของ OCC แทน session version
- สมัครเข้าพัก 4 ขั้น: ตัวตน/ข้อมูลส่วนตัว → ผู้ติดต่อฉุกเฉิน → ห้อง/ชำระเงิน → สัญญา/ยืนยัน วันเกิด เลขบัตร ที่อยู่ และ consent เป็นข้อมูลจำเป็นที่ API ต้องตรวจ ไม่เปิดช่อง legacy ข้าม validation
- ข้อมูลผู้ให้เช่า/เงื่อนไขสัญญากำหนดโดย Admin ใน SystemSetting หมวด CONTRACT; ค่าเริ่มต้นว่าง ห้ามนำค่าตัวอย่างมาเป็นข้อมูลจริง ค่าเช่า/มัดจำใช้ราคาห้อง ตรวจ snapshot ที่ server ก่อนบันทึก; สัญญาที่ส่งแล้วไม่เปลี่ยนตาม settings ใหม่
- การลบผู้พักใช้ guarded purge ข้อมูลที่ผูกผู้พักและไฟล์ทั้งหมด เก็บ User; ห้ามเก็บบิลนิรนามหรือ ARCHIVED แทนการลบตามคำสั่งปัจจุบัน บัญชีไม่ใช้งาน 1 ปีนับจาก login สำเร็จล่าสุด/createdAt เมื่อไม่เคย login; ไม่ส่งแจ้งเตือนล่วงหน้า
- ผู้มาติดต่อใช้สถานะคำขอแยกจาก visitStage WAITING/ADMITTED/COMPLETED; manual entry เป็นบันทึกเจ้าหน้าที่ ไม่ใช่หลักฐานประตูเปิดจริง อายุคำนวณจากวันเกิด ถ้าไม่มีวันเกิดจึงใช้อายุที่กรอก
- โหลดหน้าครั้งแรกใช้ Skeleton ตามรูปแบบข้อมูล; action ใช้ spinner แบบหน่วงสั้นและคงข้อความปุ่มเดิม ไม่บังคับข้อความโหลดซ้ำบนทุก action
- รายงาน QA ต้องแยก source review, unit/mock, HTTP/DB integration, browser acceptance และ Out of scope; จำนวน tests/routes ไม่ใช่หลักฐานว่าทุก end-to-end flow ผ่าน

วันสัญญา (13 ต.ค. 2569): สำหรับใบสมัครใหม่ startDate คือวันปัจจุบันใน Asia/Bangkok และ endDate บวก 5 เดือนปฏิทิน ถ้าวันไม่มีในเดือนปลายทางให้ใช้วันสุดท้ายของเดือน. ไม่ต้องตั้งค่า contractStartDate/contractEndDate ใน Admin; ค่าที่เก็บเดิมไม่ใช้กำหนดวันใบสมัครใหม่. เงื่อนไขส่วนกลางที่ผู้ดูแลต้องกรอกเหลือ 10 ช่อง. สัญญาที่ส่งแล้วคง snapshot เดิม; หากข้ามวันก่อนยืนยันให้โหลด terms ล่าสุดก่อนส่ง.
