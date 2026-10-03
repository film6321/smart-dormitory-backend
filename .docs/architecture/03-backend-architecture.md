# 03. Backend Architecture

## Request Flow

Router
↓
Middleware
↓
Controller
↓
Service
↓
Repository
↓
Prisma
↓
Database

## Component Responsibilities

### Router

Defines endpoints and route mapping.

### Middleware

Handles authentication, authorization, logging, validation, rate limiting, and error handling.

### Controller

Receives HTTP requests and returns responses. It should not contain business logic.

### Service

Contains business logic. It may call repositories and external APIs.

### Repository

Encapsulates database access logic.

### Prisma

ORM layer used to query and mutate the database.

### Database

Stores all persistent application data.

## แผนจัดโครงสร้าง Backend ตามสโคป — 2026-10-04

สถานะ: ดำเนินการและตรวจปิดชุด 1–4 แล้ว; ชุด 5 ทำส่วนตรวจสถานะใน service และ enum แล้วตามรายละเอียดด้านล่าง; ชุด 6–7 ยังเป็นแผนเสนอ ไม่มีการย้ายโมดูลธุรกิจ. เอกสารนี้เป็นข้อมูลอ้างอิง ไม่แทนกฎใน `AGENTS.md` หรือ active contracts ใน `.docs/ai-context/`.

บันทึกความคืบหน้าตามลำดับ:

ความคืบหน้า 2026-10-04: ชุด 1 ปรับผังใน spec-backend.md และ README ให้ตรงกับตำแหน่งปัจจุบัน พร้อมอธิบาย scripts และข้อมูล build/runtime/local แล้ว. ชุด 2–7 ยังไม่ได้ดำเนินการ; ไม่มีการย้ายโค้ดในชุด 1.

ความคืบหน้าชุด 2: ย้าย check_room207.ts และ check_tenants_ts.ts จาก root ไป scripts/ แล้ว โดยคงชื่อและการอ่านข้อมูลเดิม. ทั้งสองตัวใช้ Prisma Client กลางและ dotenv แทน import .js ที่ใช้กับ ts-node ไม่ได้หรือการเชื่อมต่อที่ hardcode; upload path อ้าง repo root และปิด client ใน finally. เก็บแยกจาก inspect-db เพราะตรวจเฉพาะห้อง/การผูกผู้เช่าและเอกสาร/ไฟล์อัปโหลดต่างจากการตรวจข้อมูลรวม. เพิ่มสองไฟล์เข้า tsconfig.test.json เดิมเพื่อให้ npm run test:typecheck ตรวจอย่างต่อเนื่อง. ตรวจ lifecycle สำเร็จ/ล้มเหลวด้วยข้อมูลจำลองทั้งสี่กรณี; build, typecheck และ lint ผ่าน. ไม่รันกับฐานข้อมูลในงานย้าย; ชุด 3–7 ยังไม่ได้ดำเนินการ.

ข้อสรุปหลังชุด 2: ผู้ใช้ยืนยันว่าไม่จำเป็นและลบสคริปต์ทั้งสองแล้ว จึงเอารายการไฟล์และคำสั่งออกจาก TypeScript/ESLint config และ README. ไม่สร้างสคริปต์กลับ และคงเครื่องมือ inspect-db เดิมไว้.

ความคืบหน้าชุด 3: ย้าย dto-validation.ts ไป src/middlewares/ และแก้ import ของ routes ทั้งสี่โมดูล พร้อมเปลี่ยน import AppError เป็น ./error-handler. ชื่อ export/signature และตรรกะ validation เดิมไม่เปลี่ยน. simple-validation.ts ยังอยู่ใน modules/shared เพราะการตรวจเลิกใช้อยู่ในชุด 4.

### ผลตรวจชุด 4: ไฟล์ที่เลิกใช้

ตรวจอ้างอิงในไฟล์ Git ของ Backend/Frontend และการโหลด dynamic ใน source/scripts พร้อมดูประวัติ Git ของแต่ละไฟล์ ไม่พบผู้เรียกจากโค้ดหรือคำสั่งที่ตรวจ. การอ้างถึงใน README/spec/แผนเป็นคำอธิบายรอตรวจ ไม่ใช่ runtime dependency. การใช้งานด้วยมือหรือจากเครื่องมือภายนอกไม่สามารถยืนยันจาก repo เพียงอย่างเดียว.

| ไฟล์ที่ผู้ใช้ลบแล้ว | หลักฐานก่อนลบ | สิ่งที่คงไว้ |
| --- | --- | --- |
| `src/modules/shared/simple-validation.ts` | ไม่มีผู้เรียก validateSimpleObject; การตรวจ body/property ลักษณะเดียวกันอยู่ใน validateDto ที่ใช้งานจริงแล้ว | `src/middlewares/dto-validation.ts` และผู้เรียกทั้งสี่โมดูล |
| `src/docs/swagger.json` | เป็นโครงเอกสารที่ paths ว่าง; setupSwagger.ts ไม่อ่านไฟล์นี้ แต่สร้าง specs จาก routes | setupSwagger และ Swagger annotations ของ routes |
| `scripts/update-dashboard-symmetry.js` | ไม่พบคำสั่งเรียก; เขียนทับ Frontend 4 ไฟล์ผ่าน path เฉพาะเครื่อง; template ChartCard/CSS ซ้ำกับ Frontend แต่ Dashboard TSX template ไม่ตรงกับโค้ดล่าสุด | Frontend source ที่ใช้งานจริง; ไม่ย้าย generator ที่เลิกใช้ไปสร้างความซ้ำในอีก repo |

ขนาดรวมประมาณ 21.5 KiB; ประโยชน์หลักคือเอาแหล่งโค้ด/เอกสารซ้ำและสคริปต์ที่อาจเขียนทับงานใหม่ออก ไม่ใช่การลดพื้นที่ระดับ GB. แต่ละไฟล์มีประวัติใน Git จึงไม่ต้องสร้าง archive สำเนาเพิ่ม.

ตรวจหลังผู้ใช้ลบ: ยืนยันว่าทั้งสามไฟล์และโฟลเดอร์ src/modules/shared กับ src/docs ไม่มีอยู่แล้ว ไม่พบจุดเรียกใช้ค้างใน source/tests/scripts และ configuration ที่ตรวจ. ปรับ README/spec ให้ตรงกับไฟล์ที่เหลือ และเอา src/docs/** ที่ไม่ใช้แล้วออกจากรายการ ignore ของ ESLint. คงประวัติการลบไว้ในแผนนี้; ไม่สร้าง archive สำเนาเพิ่ม.

ผลตรวจปิดชุด 4: npm run build, npm run test:typecheck, ESLint แบบไม่ใช้ --fix และ git diff --check ผ่าน; npm test ผ่าน 78/78 ไม่มีข้ามการทดสอบ. เป็นการตรวจโค้ดและ automated tests ไม่ใช่การรับรอง API ทุก endpoint บนระบบที่รันจริง. ยังไม่ commit งานจัดโครงสร้างชุดนี้.

### ความคืบหน้าชุด 5: หน้าที่ Maintenance

ย้ายการค้นหา ticket และตรวจ state transition สำหรับ updateTicketStatus จาก controller เข้า service เดิม เพื่อให้การเรียก service โดยตรงไม่ข้ามกฎ. Controller ยังคงตรวจ ticket id และส่ง HTTP response. Service ตรวจ category/status เทียบ enum ของ Prisma ก่อนบันทึกแทน as unknown as โดยคง public signatures เดิม; schema ที่ routes ใช้ตรวจค่า string จริงและใช้ enum เดียวกัน.

เพิ่ม tests/unit/maintenance.test.ts หนึ่งไฟล์เพราะยังไม่มี service tests ของโมดูลนี้ และเชื่อมทั้งไฟล์นี้กับ state-transitions.test.ts ที่มีอยู่เข้ากับ npm test. ครอบคลุม invalid enum, ticket ไม่พบ, transition ข้ามขั้น, payload ที่ส่งให้ repository และ persist ก่อน broadcast รวมถึงไม่ broadcast เมื่อบันทึกล้มเหลว. Build, test:typecheck และ ESLint ผ่าน; npm test ผ่าน 89/89 โดยใช้ mocks ใน tests ใหม่ ไม่มีธุรกรรมฐานข้อมูลจริง.

ข้อสรุปที่ผู้ใช้อนุมัติ: CLOSED/CANCELLED ดูประวัติได้เท่านั้น ห้ามแก้สถานะ หมายเหตุ และลบรายการ; งานใหม่ต้องสร้างรายการใหม่. เอา outgoing transitions ของสองสถานะนี้ออกจาก state-transitions.ts และปุ่มเปิดงานใหม่/กู้คืน/ลบออกจาก Frontend ทั้งตารางและ modal. Service ปฏิเสธการแก้และลบด้วย HTTP 409 และ repository เพิ่มเงื่อนไข status ในคำสั่ง update/delete เพื่อป้องกันคำขอที่ชนกับการปิด/ยกเลิกงาน. ไม่เปลี่ยน endpoint, public signatures หรือ schema ฐานข้อมูล.

ผลตรวจส่วน terminal states: Backend build, test:typecheck และ ESLint ผ่าน; tests ผ่าน 97/97 รวมการปฏิเสธทุก transition จากสถานะจบงาน การห้ามลบ เงื่อนไขคำสั่ง repository และคำขอที่ชนกับการปิด/ยกเลิก. Frontend build และ lint ผ่าน; tests เดิมผ่าน 17/17 แต่ยังไม่ได้ทดสอบการกด UI ใน browser หรือระบบ Docker ที่รันจริง. ไม่รันธุรกรรมกับฐานข้อมูลจริง.

การเปลี่ยน validation เป็น class-validator/class-transformer และการแยกงานจัดเก็บภาพออกจาก controller ยังไม่ได้ทำในชุดย่อยนี้. ยังไม่ commit.

แก้ flow Maintenance เพิ่มตามผู้ใช้อนุมัติ: normalizeMaintenance ส่ง rawStatus ให้ MaintenanceCard เพื่อให้ปุ่มของสถานะที่ยังทำงานแสดงถูกต้องและสถานะจบงานซ่อนปุ่มแก้/ลบ. มุมมองรวมรายห้องเปิด modal รายการ Pending ของห้องก่อน แล้วจึงเลือกดูรายละเอียดรายการ; ไม่มีรายการ Pending ให้แสดงข้อความว่าง โดยใช้ RoomGroupCard, Modal และ DataTable เดิม.

เพิ่มโควตาส่งสำเร็จ 3 รายการต่อบัญชีต่อวันตามเวลาไทยใน repository เดิม โดยใช้ PostgreSQL transaction ล็อกแถว User ก่อนตรวจโควตา สร้าง ticket และบันทึก AccessLog แบบ MAINTENANCE_CREATED เพื่อให้การลบ ticket ไม่คืนโควตา. คำขอที่ล้มเหลว rollback จึงไม่นับโควตา; ไม่เพิ่ม schema/package. คำขอสร้างและอัปโหลดรวมกันจำกัด 10 ครั้งต่อนาทีต่อบัญชีผ่าน middleware/store ที่มีอยู่. เพิ่ม regression tests ของ Frontend หนึ่งไฟล์เพราะยังไม่มี tests ของ mapping สถานะและ flow รวมรายห้อง; ใช้ React SSR/TypeScript เดิม ไม่เพิ่ม test library.

รายการเดิมในวันปัจจุบันที่ยังไม่มี submission log จะนับเพิ่มจาก AccessLog โดยยกเว้น ticket id ที่มี log แล้วเพื่อไม่ให้นับซ้ำ. ผลตรวจ Backend build/typecheck/lint ผ่านและ tests 103/103; Frontend build/lint ผ่านและ tests 21/21 รวม regression tests ของปุ่มและ room modal. เป็นการทดสอบด้วย mocks/React SSR และ HTTP คำขอที่ไม่ผ่าน validation ไม่ใช่การทดสอบ concurrency กับ PostgreSQL จริงหรือ browser จริง. ยังไม่ rebuild/restart Docker หรือ commit.

ผลตรวจ runtime เพิ่มเติม 2026-10-04: rebuild เฉพาะ Backend Docker แล้ว; health ผ่าน gateway :3002 และ Vite proxy :5174 ตอบ 200. บัญชี test01@gmail.com มีอยู่แล้ว จึงไม่เปลี่ยนรหัส/สิทธิ์; สร้างห้องทดสอบ 100 และ Tenant สำหรับบัญชีนี้ตามอนุมัติ. Login API และ Tenant/me ตอบ 200 และผูกห้อง 100 ถูกต้อง. ทดสอบ repository กับ PostgreSQL จริงส่งพร้อมกัน 4 ครั้ง สร้างสำเร็จ 3 รายการ อีกคำขอถูกปฏิเสธ 429; ตรวจ API คำขอที่ 4 ตอบ 429 เช่นกัน. ทดสอบ service กับรายการที่สร้างเอง: CLOSED/CANCELLED เปลี่ยนสถานะและลบถูกปฏิเสธ 409; student เรียก API แก้/ลบได้ 403. ทดสอบไม่คืนโควตาหลังลบใน transaction และ rollback เพื่อเก็บรายการ Pending ไว้. คง test tickets #244 CLOSED, #245 CANCELLED, #246 PENDING. ยังไม่ได้ยืนยันการกดหน้าจอ Admin ใน browser ด้วย session Admin จริง.

### แนวทางที่เหมาะกับโปรเจกต์

คง Modular Monolith และแบ่งโค้ดตามฟีเจอร์ที่ `src/modules/<feature>/` ภายในแต่ละฟีเจอร์แยกหน้าที่เป็น routes, controller, service, repository และ DTO ตามความจำเป็นจริง ไม่สร้างโฟลเดอร์ `controllers/`, `services/`, `repositories/` เพิ่มในทุกโมดูลเพียงเพื่อให้รูปแบบเหมือนกัน.

- Feature-based structure คือเก็บไฟล์ของงานเดียวกันไว้ใกล้กัน เช่น Maintenance อยู่ในโมดูลเดียว ทำให้ค้นขอบเขตการแก้ไขง่าย.
- Separation of Concerns คือแยกหน้าที่: routes จัดเส้นทาง, middleware ตรวจคำขอ, controller แปลงข้อมูล HTTP, service ตัดสินกฎธุรกิจ, repository รวบรวม query ที่โมดูลใช้งาน.
- Shared code คือส่วนที่ใช้ข้ามหลายโมดูลจริง ไม่ใช่โมดูลธุรกิจอีกตัว จึงควรวางใน `src/shared/` หรือ `src/middlewares/` ตามหน้าที่.
- ไม่บังคับสร้าง repository สำหรับทุก service การ query ใน service ที่มีอยู่สอดคล้องกับกฎ Backend; สิ่งที่ต้องแก้คือ query และกฎธุรกิจที่หลงอยู่ใน controller.

### โครงสร้างเป้าหมาย

```text
src/
  modules/       ฟีเจอร์ที่มีอยู่: auth, users, tenants, rooms, billing,
                 maintenance, visitor, notifications, audit, settings,
                 analytics, ocr, face-verification
  middlewares/   ตรวจสิทธิ์ คำขอ logging และ errors รวม middleware validation
  shared/        utilities ที่ใช้ข้ามโมดูล และ pure validation หากจำเป็น
  database/      Prisma client เดิม
  realtime/      Socket gateway เดิม
  workers/       งานเบื้องหลังเดิม
  routes/        health route เดิม
  setup/         security, Swagger และ observability เดิม
  app.ts         ลงทะเบียนระบบและ routes
  index.ts       เริ่ม/หยุด HTTP server และ workers
scripts/         เครื่องมือดูแล Backend ที่ยังใช้จริง
prisma/          schema, migrations และ seed
tests/           unit, integration, fixtures และ load
docker/          configuration ของแต่ละ service
.docs/           active specs, QA และเอกสารอ้างอิง/ประวัติ
```

`dist/`, `node_modules/`, uploads, cookie และไฟล์ชั่วคราวเป็นข้อมูล build/runtime/local ไม่ใช่โค้ดที่จะย้ายรวมกับ modules และไม่ลบข้อมูล runtime ในงานจัดโครงสร้าง.

### หลักฐานจากการสำรวจก่อนเริ่มย้ายไฟล์

| สิ่งที่พบ | ความหมายต่อแผน |
| --- | --- |
| Maintenance มี controller, routes, service, repository และ DTO ครบในโมดูลเดียว | คงตำแหน่ง ไม่แยก subfolders เพิ่ม |
| `src/modules/shared/dto-validation.ts` ใช้ใน routes ของ Billing, Maintenance, Notifications และ Visitor | เป็น middleware กลางที่ควรย้ายออกจาก modules หลังเตรียมแก้ import ทั้งสี่จุด |
| `src/modules/shared/simple-validation.ts` ตรวจข้อมูลคล้าย middleware แต่ยังไม่พบผู้เรียกใน src/tests/scripts/docs ที่ตรวจ | เป็นผู้สมัครตรวจการใช้ซ้ำ/เลิกใช้ ไม่สรุปว่าใช้ไม่ได้หรือลบได้ทันที |
| `check_room207.ts` และ `check_tenants_ts.ts` อยู่ที่ root | ตรวจว่าจำเป็นและซ้ำกับ `scripts/inspect-db.ts` หรือไม่ ก่อนเลือกเก็บ/รวม/ย้าย |
| `scripts/update-dashboard-symmetry.js` มีโค้ดสร้าง UI Frontend | ต้องตรวจว่าเป็นเครื่องมือใช้งานครั้งเดียวหรือของ repo Frontend ไม่วางปะปนเป็นเครื่องมือดูแล Backend โดยไม่มีคำอธิบาย |
| `src/docs/swagger.json` ยังไม่พบจุดอ้างอิง แต่ `setupSwagger.ts` สร้าง specs จาก routes | ตรวจว่า Postman/เครื่องมือภายนอกใช้ JSON นี้หรือไม่ก่อนตัดสินใจเลิกเก็บ |
| ผังใน `spec-backend.md` วาง middleware ใต้ shared ขณะที่โค้ดอยู่ `src/middlewares/` | แก้เอกสารให้ตรงกับโค้ด ไม่ย้าย middleware ทั้งชุดตามผังเก่า |
| Maintenance Controller ตรวจ state transition และ Face Controller มี `prisma.accessLog.deleteMany` | แยกเป็นงานปรับขอบเขตหน้าที่ ไม่ปนกับ commit ย้ายไฟล์ |
| Maintenance Service มีการ cast category/status ผ่าน `as unknown as` | เมื่อปรับหน้าที่ให้ตรวจ enum/type ตั้งแต่ขอบเขตข้อมูล ไม่ใช้ cast ซ่อนความไม่ตรงของชนิด |

การเทียบ hash ไม่พบไฟล์เนื้อหาเหมือนกันทุกไบต์ใน src/scripts; ไม่ได้หมายความว่าไม่มีตรรกะซ้ำ การสำรวจไม่พบโฟลเดอร์ว่างใน src/scripts/postman/docker/tests ไม่รวม node_modules, dist, uploads, tmp หรือข้อมูลใน volume.

### ลำดับดำเนินงานเป็นชุดเล็ก

| ชุด | งานที่จะทำ | รอยต่อ/ข้อจำกัด | เกณฑ์จบ |
| --- | --- | --- | --- |
| 1. แผนที่ส่งมอบ | ปรับผังที่ผิดใน `spec-backend.md`; เพิ่มคำอธิบายหน้าที่ scripts และ runtime/local ใน README เดิม | ไม่มีการย้ายโค้ดหรือเพิ่ม docs ใหม่; active contracts ต้องคงความหมายเดิม | path และลิงก์ตรงกับไฟล์จริง |
| 2. เครื่องมือที่ root | ตรวจ scripts ทั้งสองไฟล์กับ inspect-db; เก็บงานที่ยังใช้จริงไว้ใน scripts โดยคงชื่อก่อน | `check_room207.ts` อ้าง `./src/database/db.js` ต้องแก้เป็น path จากตำแหน่งใหม่และตรวจวิธีรัน; `check_tenants_ts.ts` ต้องแก้การอ่าน env/path ที่เกี่ยวข้อง; ไม่รันคำสั่งแก้/ล้างข้อมูลเพื่อทดสอบการย้าย | คำสั่งและ import ถูกต้อง ไม่มีเครื่องมือซ้ำโดยไม่จำเป็น |
| 3. Validation กลาง | เสนอ `src/modules/shared/dto-validation.ts` → `src/middlewares/dto-validation.ts` | เปลี่ยน import ใน routes ทั้งสี่โมดูล และ import AppError ภายในไฟล์; รักษาชื่อ export/signature และพฤติกรรม response | validation tests และ routes เดิมผ่าน ไม่เหลือ import เก่า |
| 4. ผู้สมัครเลิกใช้ | ตรวจ `simple-validation.ts`, `swagger.json` และสคริปต์สร้าง Frontend | ตรวจ Git history, คำสั่ง, dynamic loading และการใช้ภายนอกก่อนลบ; หากจำเป็นให้คงไว้พร้อมคำอธิบาย; ลบโฟลเดอร์เมื่อว่างจริงเท่านั้น | ไม่มีผู้เรียกเสีย ไม่มี spec/history ถูกลบโดยผิดขอบเขต |
| 5. หน้าที่ Maintenance | ย้ายการตัดสิน state transition จาก controller เข้า service ที่มีอยู่ และใช้ enum ที่ตรวจแล้ว | แยก commit จากการย้ายไฟล์; คง endpoint, public signatures, authorization, status codes และ state machine; ไม่สร้าง service/repository เพิ่ม | ทดสอบ transition ที่อนุญาต/ปฏิเสธ และ input ไม่ถูกต้อง |
| 6. หน้าที่ส่วนอื่น | ตรวจโมดูลที่เหลือตามความเสี่ยง; ย้าย query ใน Face Controller ไป service เดิมเมื่อได้รับอนุมัติ | Face Verification เก็บไว้และแก้บั๊กเท่านั้น; ไม่มีฟีเจอร์ใหม่หรือเปลี่ยน flow; ไม่ขยาย OCR engine; ไม่เปลี่ยน schema/auth/fallback โดยพลการ | controller ทำหน้าที่ transport และผล API เดิมไม่เปลี่ยน |
| 7. ส่งมอบ | อัปเดตแผนที่จริงหลังแต่ละชุดและ commit แยกตามวัตถุประสงค์ | ไม่ใช้ `git add .`; inspect staged diff; การบันทึก CHANGELOG ต้องได้รับอนุมัติทุกครั้ง | build/typecheck/lint/tests ผ่าน และลิงก์ส่งมอบใช้งานได้ |

ชุด 3 เปลี่ยนตำแหน่งของ validator เดิมเท่านั้น การเปลี่ยนจาก validator แบบฟังก์ชันเป็น class-validator/class-transformer ตามกฎโปรเจกต์ต้องตรวจผลต่อ payload/validation errors แล้ววางเป็นงานแก้ความสอดคล้องแยกต่างหาก ไม่ทำพร้อมการย้าย.

### การป้องกันปัญหาจากการย้าย

1. ค้น import, export, test mocks, คำสั่ง npm, Docker และลิงก์เอกสารของไฟล์ก่อนย้าย รวมการใช้ภายนอกที่ค้นใน repo ไม่ได้.
2. ย้ายไฟล์กับแก้ทุกจุดอ้างอิงใน commit เดียว คงชื่อฟังก์ชันและ endpoint; ไม่เพิ่ม re-export wrapper ค้างถาวรเพื่อกลบ import ที่ยังแก้ไม่ครบ.
3. ตรวจ TypeScript กับ lint ก่อน แล้วทดสอบพฤติกรรมที่รอยต่อนั้น ไม่ใช้ any/double assertion เพื่อให้ compile ผ่าน.
4. ใช้ `npm run build`, `npm run test:typecheck`, ESLint แบบไม่ใช้ `--fix` ในการตรวจ และ tests ที่เกี่ยวข้อง. ทดสอบ API ที่ไม่เปลี่ยนข้อมูลเมื่อ runtime/auth พร้อม; รายงานสิ่งที่ยังไม่ได้ยืนยัน.
5. ห้ามทดสอบ scripts ที่ล้างข้อมูล, seed, migration หรือธุรกรรมกับฐานข้อมูลจริงเพียงเพื่อพิสูจน์การย้าย path.
6. ไม่เปลี่ยน layout ของ `prisma/migrations`, protected files, Docker volumes หรือ uploads ในชุดนี้.

เริ่มดำเนินการด้วยชุด 1 ก่อน ชุดย้าย/ลบไฟล์และการแก้ระบบสำคัญต้องขออนุมัติรายการจริงก่อนลงมือ ตาม AGENTS.md และข้อตกลงกับผู้ใช้.
