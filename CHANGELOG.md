# CHANGELOG.md - Smart-Dormitory-Management-System

## [Unreleased]

### 2026-09-02 — Face recognition docker integration, multi-face workflow, and student UI balance

- รวม Service Face Recognition AI เข้ากับ `docker-compose.yml` สำหรับรันและสื่อสารกับ Backend ภายใน Container Network
- แก้ไขปัญหา missing dependency `aiosqlite` ใน `Face_Recognition/requirements.txt` และ Rebuild Docker container สำเร็จ
- ปรับปรุง `face-verification.service.ts` ใน Backend ให้ Forward คำขอลงทะเบียนและตรวจสอบใบหน้าไปยัง Python FastAPI service พร้อมตั้งค่า Fallback เป็น Denial-by-Default เพื่อความปลอดภัย
- ปรับปรุง `MonitorPage.tsx` ใน Frontend ให้รองรับการตรวจจับหลายใบหน้าพร้อมกัน (Multi-face detection), จัดลำดับความสำคัญของใบหน้าที่อยู่ใกล้กล้องที่สุดก่อน และตัดภาพเฉพาะกรอบใบหน้าส่งไปประมวลผล
- ปรับแต่ง UI หน้า Student Home และ Student Documents: ลบพื้นหลังเงาสีเข้มที่ไม่จำเป็นออก และจัดระเบียบ Padding/Margin ฝั่งซ้าย-ขวาให้สมดุลเท่ากันทั้งสองด้าน

### 2026-09-01 — Admin dashboard real data and embedded Grafana observability

- เปลี่ยนหน้า Admin Dashboard ให้ใช้ข้อมูลจริงจาก backend APIs แทน mock/debug data สำหรับ rooms, tenants, maintenance tickets, users และ billing
- เพิ่มการคำนวณ financial summary และกราฟรายเดือนจาก bills จริงใน `DashboardContext`
- เพิ่ม Business Health และ System Health panels เพื่อดูภาพรวมอัตราเข้าพัก งานซ่อมค้าง ผู้ใช้ออนไลน์ backend health และ metrics readiness
- เพิ่ม backend HTTP metrics สำหรับ Prometheus ได้แก่ `dormitory_http_requests_total` และ `dormitory_http_request_duration_seconds`
- เพิ่ม Grafana provisioning สำหรับ Prometheus datasource และ dashboard `Smart Dormitory Operations`
- ฝัง Grafana dashboard ในหน้าเว็บ admin ด้วย iframe โดยใช้ anonymous viewer ใน local/dev และไม่ฝัง Prometheus UI ตรงๆ เพื่อลดความเสี่ยงด้านความปลอดภัย
- แก้ปัญหา Grafana panel ขึ้น `No data` จาก datasource UID mismatch โดยบังคับ datasource UID เป็น `smart_dormitory_prometheus`
- ตั้งค่า frontend monitoring URLs ใน `.env.example` และ local `.env` สำหรับ `VITE_GRAFANA_URL` และ `VITE_PROMETHEUS_URL`
- ตรวจสอบแล้ว: backend build ผ่าน, frontend build ผ่าน, Grafana dashboard ตอบ 200, Prometheus ready ตอบ 200 และ Grafana datasource proxy query มีข้อมูล

### 2026-09-01 — Maintenance delete, viewed notification state, and admin logout

- เพิ่ม `DELETE /api/maintenance/:id` สำหรับ ADMIN เพื่อลบรายการแจ้งซ่อมที่ไม่ต้องการแล้ว
- เพิ่มปุ่มลบในหน้าแจ้งซ่อม พร้อม confirm ก่อนลบ และ refresh รายการหลังลบสำเร็จ
- เพิ่ม error message ที่แสดง HTTP status/message จริงเมื่ออัปเดตหรือลบ maintenance request ไม่สำเร็จ
- เพิ่มการจัดการ Prisma `P2025` ให้ตอบ `404 Maintenance ticket not found` แทน error 500
- เพิ่มสถานะ viewed สำหรับจุดแดงแจ้งเตือนรายการแจ้งซ่อมใหม่ โดยจุดแดงหายเมื่อ admin กดดูรายการหรือกลุ่มรายการ
- ปรับกล่องวันเวลาที่สะดวกให้ช่างเข้าดำเนินการเป็นสีเทาอ่อน
- เพิ่มปุ่มออกจากระบบใน Admin Dashboard sidebar และ redirect กลับ `/login`

### 2026-08-24 — Maintenance image viewer & interactive lightbox enhancements

- เพิ่มระบบสไลเดอร์และปุ่มควบคุมขนาดซูม (Zoom Slider & Buttons) ควบคุมอัตราการซูมแบบละเอียดตั้งแต่ 100% ถึง 400%
- เพิ่มระบบคลิกลากเมาส์ (Drag-to-pan) และสัมผัสปัดบนหน้าจอมือถือเพื่อแพนและย้ายภาพเมื่อขยายใหญ่เกินหน้าจอ
- แก้ไขปัญหาคลิกลากหน้าจอแล้วรูปดีดกลับตำแหน่งเดิม (Click-vs-drag collision) โดยดักจับระยะเลื่อน (displacement >= 5px) เพื่อระงับ toggle trigger ขณะจับลาก
- ป้องกันการเกิด Double Scroll บนองค์ประกอบเบื้องหลังขณะเลื่อนหรือซูมภาพ:
  - ล็อก `document.body.style.overflow = 'hidden'` ชั่วคราวเมื่อแถบขยายภาพทำงาน
  - ผูก ref-based event listeners แบบ active (`{ passive: false }`) เข้ากับ `wheel` และ `touchmove` เพื่อตัดการบับเบิ้ลของสกรอลล์
- ปรับสไตล์ของ Lightbox ให้เป็นสากล: เอาแผงพื้นกรอบทึบรอบตัวออก ใช้รูปสาดเงา `filter: drop-shadow` ลอยเด่นตัดกับกระจกเบลอฝ้า `backdrop-filter: blur(6px)` สีขาวดำ `rgba(0, 0, 0, 0.75)`
- ยืนยันว่าหน้าจอ JSX และ CSS Module ของ frontend ได้ปรับฟิลด์ครบถ้วน ถูกต้องตามสเปกและ compile สำเร็จ

### 2026-08-22 — Backend OCR age calculation

- เพิ่ม `age` ใน OCR result โดยคำนวณจากวันเกิดปัจจุบัน รองรับวันเกิด ค.ศ., พ.ศ. และชื่อเดือนภาษาไทย
- Step 4 ใช้ค่าอายุจาก backend และยกเลิกค่า default `20` เพื่อไม่แสดงอายุผิดเมื่อ OCR อ่านวันเกิดไม่ได้
- reload Docker backend แล้วเพื่อใช้ logic ใหม่
- ตรวจสอบแล้ว: backend tests 32 ผ่าน และ frontend build ผ่าน

### 2026-08-22 — OCR provider response compatibility follow-up

- เพิ่ม compatibility mapping สำหรับ OCR response ที่ส่งข้อมูลระดับ top-level หรือใช้ชื่อ field วันเกิด/ที่อยู่หลายรูปแบบ
- รองรับวันเกิดภาษาไทยในตัวคำนวณอายุของสัญญา
- reload Docker backend แล้วเพื่อเปิดใช้ mapping ใหม่
- ยืนยันว่า backend tests 32 ผ่านและ frontend build ผ่าน
- เลขที่ OCR ส่งมาเป็น `140********71` ยังต้องแก้ที่ source ของ smart-ocr/provider จึงจะได้เลขเต็ม เพราะ backend ไม่สามารถกู้ข้อมูลที่ถูก mask แล้วได้

### 2026-08-22 — OCR identity data, address persistence, and current age

- เพิ่มการอ่านและส่งต่อที่อยู่จาก OCR โดยรองรับหลายชื่อ field ของ OCR provider
- เปลี่ยน application upload response ให้ส่งเลขบัตรประชาชนที่ normalize เป็นตัวเลขเต็มสำหรับใช้ในสัญญาของผู้สมัครที่ authenticated แล้ว
- ยังคงเก็บผล OCR verification แบบปลอดภัยด้วยเลขบัตร masked/hash สำหรับรายการตรวจสอบทั่วไป
- บันทึก `citizenId` และ `address` จาก OCR ลง `Tenant` เมื่อ submit ใบสมัคร
- คำนวณอายุปัจจุบันจากวันเกิด OCR รองรับปี พ.ศ. และเติมลงข้อมูลสัญญาแทนค่าอายุคงที่
- ตรวจสอบแล้ว: backend build/tests ผ่าน 32 tests และ frontend build ผ่าน

### 2026-08-22 — OCR Docker connectivity and false-success correction

- แก้ค่า OCR ใน Docker backend ให้เรียก service บน Windows host ผ่าน `host.docker.internal:8000` แทน `localhost:8000` ซึ่งชี้กลับเข้า container ตัวเอง
- เพิ่ม `extra_hosts` สำหรับ `host-gateway` ใน Docker Compose
- เปลี่ยน upload document flow ให้ตอบ `502` เมื่อ OCR service ใช้งานไม่ได้ และ `422` เมื่อ OCR อ่านได้แต่ไม่สามารถยืนยันบัตรประชาชนไทย
- แก้ข้อความ Step 4 ไม่ให้แสดง “ตรวจสอบแล้วผ่านระบบ OCR” แบบคงที่ โดยจะแสดงผ่านเฉพาะผล OCR จริง
- ตรวจสอบแล้ว: container ติดต่อ OCR host ได้ HTTP 200, backend build/tests ผ่าน และ frontend build ผ่าน

### 2026-08-22 — Full read-only rental agreement document

- เพิ่มหนังสือสัญญาเช่าฉบับเต็มในหน้าเอกสาร โดยดึงข้อมูล `contractData` จาก Step 4 ที่บันทึกในฐานข้อมูล
- แสดงข้อมูลคู่สัญญา สถานที่/วันที่ทำสัญญา ห้องพัก ระยะเวลา ค่าเช่า เงินประกัน คีย์การ์ด ค่าสาธารณูปโภค เงื่อนไขการพักอาศัย และการสิ้นสุดสัญญา
- เพิ่มส่วนลายเซ็นผู้ให้เช่า ผู้เช่า และพยาน โดยยังคงเป็นเอกสารอ่านอย่างเดียว
- เพิ่มปุ่มพิมพ์และบันทึกเป็น PDF ผ่าน browser พร้อม print stylesheet สำหรับพิมพ์เฉพาะตัวสัญญา
- ตรวจสอบแล้ว: frontend production build ผ่านและไม่พบ TypeScript diagnostics

### 2026-08-21 — Reload Docker backend after tenant delete fix

- ตรวจพบว่า Docker backend process เดิมยังใช้การลบ tenant แบบตรงๆ ทำให้ tenant ที่มี bill เช่น `42` ล้มเหลวด้วย `Bill_tenantId_fkey`
- restart เฉพาะ backend container และยืนยัน `DELETE /api/tenants/42` ผ่าน API gateway สำเร็จหลัง service พร้อม
- ระหว่าง restart อาจได้ `502 Bad Gateway` ชั่วคราว ควรรอ backend startup complete ก่อน retry

### 2026-08-21 — Tenant deletion with related database records

- แก้ `DELETE /api/tenants/:id` ให้ลบข้อมูลที่อ้างอิง tenant ใน transaction เดียวก่อนลบ parent record ป้องกัน foreign-key error และ HTTP 500
- ลำดับการลบคือ visitor logs, visitors, bills, maintenance tickets แล้วจึงลบ tenant
- ถ้าไม่พบ tenant จะตอบ HTTP 404 แทน `Internal Server Error`
- ไม่ลบบัญชี `User` ที่เชื่อมกับ tenant เพื่อรักษาบัญชีผู้ใช้และประวัติการเข้าสู่ระบบ
- ทดสอบ endpoint จริงด้วย tenant ชั่วคราวแล้วลบสำเร็จและอ่านกลับได้ 404; backend build และ 32 tests ผ่าน

### 2026-08-21 — Contract fields and uploaded slip aligned with application flow

- หน้าเอกสารดึง `contractData` จาก Step 4 ที่บันทึกใน `Tenant` โดยตรง และแสดงข้อมูลสัญญาครบทุก field แบบอ่านอย่างเดียว
- preview บัตรประชาชนและสลิปใช้ไฟล์จาก Step 3 upload และรองรับทั้ง image และ PDF
- ตรวจสอบ record seed แล้วพบว่าไม่มี `contractData` และ document paths จึงไม่แสดงข้อมูลปลอม; ต้องส่งใบสมัครจริงด้วย user เดียวกันเพื่อให้เอกสารปรากฏ
- Frontend build ผ่าน

### 2026-08-21 — Read-only student application documents

- เพิ่มหน้าใบสัญญาและเอกสารสำหรับนักเรียน โดยดึงข้อมูลจากใบสมัครและแสดงแบบอ่านอย่างเดียว ไม่เปิดให้แก้ไข
- แสดงข้อมูลส่วนตัว, ข้อมูลติดต่อฉุกเฉิน, OCR, รายละเอียดสัญญา และห้องพักจาก tenant record จริง
- เพิ่ม authenticated endpoints สำหรับดูบัตรประชาชนและสลิปของผู้สมัครปัจจุบัน
- บังคับให้เอกสารดาวน์โหลดได้เฉพาะเจ้าของใบสมัครที่มีสถานะ `APPROVED` หรือ `ACTIVE` พร้อมตรวจ path ป้องกัน path traversal
- ตรวจสอบแล้ว: backend build ผ่าน, backend tests 32 ผ่าน, frontend build ผ่าน

### 2026-08-21 — Approval and rejection rollback actions

- เพิ่ม `Cancel approval` เพื่อยกเลิกการอนุมัติและเปลี่ยนสถานะจาก `Active` กลับเป็น `Pending`
- เพิ่ม `Cancel rejection` เพื่อยกเลิกการปฏิเสธและเปลี่ยนสถานะจาก `Inactive` กลับเป็น `Pending`
- หลังกลับเป็น `Pending` ผู้ดูแลสามารถ Approve หรือ Reject รายการเดิมใหม่ได้
- ยืนยันด้วย API จริงว่าการเปลี่ยนสถานะ `PENDING -> APPROVED -> PENDING` ถูกบันทึกใน PostgreSQL
- Frontend build ผ่านและไม่พบ TypeScript errors

### 2026-08-21 — Student status badge refresh after approval actions

- แก้ `DataTable` ไม่ให้ memoize row model เก่า ทำให้แถวแสดง status ล่าสุดหลังข้อมูลเปลี่ยน
- หลัง Approve/Reject สำเร็จ frontend จะอัปเดตสถานะในแถวทันทีเป็น `Active`/`Inactive` และเรียก API refetch เพื่อยืนยันกับฐานข้อมูล
- ตรวจสอบ API gateway แล้วว่าสถานะ tenant ที่อนุมัติอ่านกลับจาก PostgreSQL เป็น `APPROVED`
- Frontend production build ผ่านและไม่พบ TypeScript diagnostics ในไฟล์ที่เกี่ยวข้อง

### 2026-08-21 — Local Prisma seed and Docker API gateway correction

- เพิ่ม `tsconfig.seed.json` สำหรับ `prisma.config.ts` ทำให้ `npx prisma db seed` ทำงานได้สำเร็จ
- ยืนยันพอร์ต API ตาม Docker Compose: frontend ใช้ `http://localhost:3002/api`; port `3000` ไม่ใช่ backend gateway ใน environment ปัจจุบัน
- Seed local database สำเร็จและสร้าง/อัปเดต `admin@smart-dormitory.local` เป็น role `ADMIN`
- ทดสอบผ่าน API gateway จริงแล้วว่า `PATCH /api/tenants/:id` เปลี่ยนสถานะจาก `PENDING` เป็น `APPROVED` และ readback จากฐานข้อมูลได้ถูกต้อง

### 2026-08-21 — Student management actions connected to database

- ทำให้ปุ่ม `View` ใน Student Management โหลดข้อมูล tenant จริงจาก `GET /api/tenants/:id` และแสดงรายละเอียดในหน้า
- ทำให้ปุ่ม `Delete` เรียก `DELETE /api/tenants/:id` พร้อมยืนยันก่อนลบ, แสดงสถานะกำลังทำงาน/ข้อผิดพลาด และ refresh ข้อมูลหลังลบสำเร็จ
- ปุ่ม `Approve`/`Reject` ยังคงเปลี่ยนสถานะ tenant ผ่าน `PATCH /api/tenants/:id` และแจ้งข้อผิดพลาดแทนการเงียบเมื่อ request ล้มเหลว
- การลบผ่าน endpoint จะลบแถว tenant ใน PostgreSQL จริง ไม่ใช่เพียงซ่อนแถวใน frontend
- ตรวจสอบแล้ว: frontend build ผ่าน, backend build ผ่าน และ backend tests ผ่าน 32 tests

### 2026-08-21 — Student application redirect and admin approval gate

- หลังนักเรียนส่งใบสมัครสำเร็จ ระบบ redirect กลับ `/student` dashboard ตามหน้าจอหลัก
- เพิ่ม `GET /api/tenants/me` สำหรับให้นักเรียนอ่านสถานะใบสมัครของตนเองอย่างปลอดภัย
- ทำให้ admin เปลี่ยนสถานะ tenant ผ่าน `PATCH /api/tenants/:id` ได้จริง พร้อม validation ของสถานะ และเพิ่มปุ่ม Approve/Reject ใน Student Management
- ปลดล็อคเมนูใบสัญญา/เอกสารและแจ้งซ่อมเมื่อสถานะ tenant เป็น `APPROVED` หรือ `ACTIVE`; ระหว่างรอจะแสดง `รอ Admin ยืนยัน`
- เพิ่ม student routes สำหรับ document และ maintenance destinations เพื่อรองรับการต่อยอดฟังก์ชันจริง
- ตรวจสอบแล้ว: backend build ผ่าน, backend tests 32 ผ่าน, frontend build ผ่าน และ frontend tests 2 ผ่าน
- งานถัดไปคือเชื่อมข้อมูลสัญญาจริงและฟอร์มแจ้งซ่อมของนักเรียนเข้ากับ backend

### 2026-08-21 — Face enrollment, monitor access control, and door command integration

- เพิ่ม flow การลงทะเบียนใบหน้าโดยบันทึกภาพลง `FaceEnrollmentPhoto` และจัดเก็บไฟล์ไว้ที่ `uploads/face-photo` เพื่อให้ FaceGate.Edge นำไปสร้าง embeddings ต่อได้
- ปรับ `/access-control` ให้ใช้ `MonitorPage` เป็น monitoring engine เดียวกับหน้า monitoring พร้อม camera feed, recognition result, scan history, device status และ activity log
- เพิ่ม `POST /api/face-verification/door-command` พร้อม JWT และ ADMIN authorization สำหรับคำสั่ง `lock`/`unlock` และ standardized API response
- เชื่อมปุ่ม Unlock/Lock ฝั่ง frontend ให้ยิง backend จริง พร้อมแสดง error และคืนสถานะประตูเมื่อ command ล้มเหลว
- เพิ่ม integration coverage สำหรับ door command และตรวจสอบผลการทดสอบ backend ผ่าน 32 tests; frontend production build ผ่าน
- **ข้อจำกัด local:** หากไม่มี `FACE_API_URL` และ `FACE_API_KEY` ระบบ verification จะใช้ fallback mock จึงยังไม่ใช่การเปรียบเทียบ biometric จริงจนกว่าจะเชื่อม Face API หรือ FaceGate.Edge
- **งานถัดไป:** จัดทำ QA/Postman flow สำหรับ register -> ตรวจสอบ DB -> capture จาก monitor -> verify -> recognition/door decision และเชื่อม door command กับอุปกรณ์จริงหรือ audit storage

### 2026-08-15 — Tenant registration restructuring, payload validations, Nginx limits, and Admin data sync

- ปรับปรุงเวทมนตร์สมัครพักเรียน 4 ขั้นตอน: รวมส่วนข้อมูลส่วนตัวผู้ติดต่อฉุกเฉิน ย้ายแบบฟอร์มตรวจสอบสลิปและสแกนบัตรมารวมใน Step 3 และยื่นร่างสัญญา Step 4
- ปรับจูน Nginx: เพิ่ม `client_max_body_size 20m` และ `proxy_read_timeout 60s` เพื่อไม่ให้เกิด `413 Request Entity Too Large` เวลาส่งอัปโหลดรูป ID Card ผสมรูป Slip
- แก้ไขปัญหาดักความสำเร็จใบสมัคร: แก้จากดักเช็คฟิลด์ `.success` ที่ไม่มีใน Standardized Response มาเป็นการตรวจสอบสถานะ `statusCode === 200` ใน `DocumentUpload.tsx` และ `TenantApplication.tsx` แทน
- ซิงก์ข้อมูลแดชบอร์ดผู้ดูแลระบบ: ปรับฟิลด์ของข้อมูลใน `normalizeTenant` ของ `DashboardContext.tsx` ให้ตรงตามคีย์ข้อมูล PostgreSQL: `fullName` -> `name`, `phone` -> `contact`, `yearLevel` -> `year`, ปรับห้องว่างตาม preferredRoomType และแปลงค่าสถานะ PENDING สู่ PascalCase เพื่อวาดสรุปไอคอนและตารางผู้เรียนของ Admin ให้สมบูรณ์และถูกต้องตามสกีมาฐานข้อมูลจริง

### 2026-08-04 — Face verification live feed and frontend connectivity hardening

- ปรับโครงสร้าง live face-verification ให้รองรับการประมวลผลภาพแบบ throttled frame processing โดยตรวจจับทุก 3–5 เฟรม เพื่อให้ระบบลื่นขึ้นและลดภาระ CPU ในระหว่าง stream
- เพิ่ม utility methods ใน `FaceVerificationService` สำหรับคำนวณ interval และตัดสินใจว่าแต่ละเฟรมควรประมวลผลหรือไม่ พร้อม unit test ครอบคลุมพฤติกรรมนี้
- ปรับค่า CORS สำหรับ frontend ที่รันบน `http://localhost:5174` ให้ backend ยอมรับ request จาก frontend สำหรับการทดสอบ local development
- ยืนยันว่า backend สามารถรันได้สำเร็จด้วย `npm run dev` และ frontend build ผ่านด้วย `npm run build`
- ตรวจยืนยันด้วย `npm test` และ `npm run test:typecheck` ผ่านสำเร็จ
- อัปเดตบันทึก change log ของ backend เพื่อระบุว่า session ปัจจุบันมีการบันทึกสถานะและ placeholder สำหรับการเปลี่ยนแปลงที่เกี่ยวข้องกับ frontend face detection ใน `ai-CHANGELOG.md`

### 2026-07-27 — Backend/Frontend connectivity alignment

- ปรับ CORS fallback ให้อนุญาต origin จาก frontend gateway และ localhost ports ที่ใช้งานจริง เพื่อกัน browser แสดง `Network Error`
- ทำให้ backend runtime และ docker-compose ใช้พอร์ต `3000` ตรงกันทั้ง `.env`, `.env.example`, `Dockerfile`, และ `docker-compose.yml`
- เพิ่ม alias `GET /api/health` ให้ตรงกับ frontend dashboard และข้าม access log สำหรับ health route
- ปรับ rate-limit store ให้ dev/test ใช้ in-memory เป็นค่าเริ่มต้น ลดปัญหา request ล้มเมื่อ Redis ยังไม่พร้อม
- เพิ่ม unit test สำหรับยืนยันว่า origin ของ gateway ผ่าน CORS ได้
- ตรวจยืนยันด้วย `npm test` และ `npm run build` ผ่านสำเร็จ

### 2026-07-10 — Repository refactor & Notification service alignment

- แยก Repository layer (users, auth, notifications) เพื่อย้าย Prisma calls ออกจาก Service และรักษา "Thin Controller" / "Service business logic" pattern
- ปรับ `NotificationService` ให้เรียก `NotificationRepository` แบบ static และเพิ่ม `getDb()` คืนค่า `prisma as any` เพื่อบรรเทา TypeScript mismatch ชั่วคราว
- ปรับ `users.repository.ts` และ `auth.repository.ts` ให้ cast payloads/prisma client เป็น `any` ภายในเมธอดเป็นชั่วคราวจนกว่า `prisma generate` จะรันและ signatures จะถูกทำให้ตรงกัน
- ข้อเสนอถัดไป: รัน `npx prisma generate` → `npm run test:typecheck` → แปลง payloads เป็น Prisma input types (`connect`/`create` shapes) ตามความจำเป็น

### 2026-06-29 — AI Governance and Enterprise Architecture Documentation Bootstrap

- **AI Index & Context Routing:** Created `AI-INDEX.md` as the master context router mapping files to their specific domain context.
- **Enhanced Agents Policy:** Refactored `AGENTS.md` to incorporate pre-task protocols, source precedence rules, and critical code protections.
- **Dormitory State Machines Specs:** Developed `.docs/ai-context/contracts/state-machine.md` outlining Billing, Visitor Access, and Maintenance transitions.
- **API and Socket Contracts:** Created `.docs/ai-context/contracts/api-contracts.md` and `.docs/ai-context/contracts/socket-io-contracts.md` specifying REST payloads and real-time Socket.IO event namespaces/topics.
- **Backend & Frontend Specifications:** Documented layer policies (`spec-backend.md`), React rules (`spec-frontend.md`), cross-layer rules (`runtime-rules.md`), and consistency policies (`spec-consistency.md`).
- **DevOps, Observability, and Error Handling:** Documented network topology & telemetry (`spec-infra-devops.md`), error recovery (`spec-error-handling.md`), and environment setups (`spec-runtime-modes.md`).
- **Enterprise Lessons Handbook:** Compiled `.docs/Lessons/Enterprise_Architecture_Lessons.md` detailing clean coding guidelines for Node.js, Express, Prisma, and React.
- **Changelog & Archivist Setup:** Initialized README guidelines for repository changelogs and sprint archiving.

### 2026-05-26 — Project Structure Migration

- ปรับโครงสร้างโปรเจกต์จาก Polyglot Microservices เป็น Modular Architecture (Frontend + Backend)
- ย้ายโฟลเดอร์เดิม (`core/`, `engine/`, `realtime/`) ไปเก็บที่ `_archive/`
- เปลี่ยนชื่อ `gateway/` เป็น `backend/`
- สร้างโครงสร้าง Backend modules: auth, users, visitor, billing, maintenance, ocr, face-verification
- สร้างโครงสร้าง Frontend modules: auth, student, admin, visitor, billing, maintenance, ocr, face-verification
- สร้างโฟลเดอร์ shared, workers, database (backend) และ components, services, hooks, types (frontend)
- สร้างโฟลเดอร์ docs/api และ docs/flow
- อัปเดต `docker-compose.yml` ให้รองรับโครงสร้างใหม่ (backend + frontend + db)
- เพิ่ม healthcheck สำหรับ PostgreSQL
- อัปเดต `AGENTS.md`, `BLUEPRINT.md`, `.cursorrules` ให้ตรงกับสถาปัตยกรรมใหม่

### Backend Configuration Fixes

- แก้ไข `backend/src/database/db.ts`: ลบ `datasourceUrl` option ที่ไม่รองรับใน Prisma v7 ออก เปลี่ยนเป็น `new PrismaClient()` (ใช้ config จาก `prisma.config.ts` แทน)
- รัน `npx prisma generate` เพื่อสร้าง Prisma Client types ให้ TypeScript รู้จัก `PrismaClient`
- แก้ไข `backend/tsconfig.json`: เพิ่ม `include: ["src/**/*"]` และ `exclude: ["node_modules", "dist"]` เพื่อแก้ปัญหา `prisma.config.ts` ที่อยู่นอก `rootDir`

### 2026-05-27 — Repository and Git Setup

- แยกโค้ด `frontend` และ `backend` ออกจากกันเป็น 2 GitHub repository แยก: `smart-dormitory-frontend` และ `smart-dormitory-backend`
- ตั้งค่า remote ของแต่ละ repo ให้ถูกต้อง และสร้าง branch `dev` สำหรับพัฒนาทุกฝั่ง
- ตรวจสอบและ push ข้อมูลขึ้น GitHub เรียบร้อยทั้ง `frontend` และ `backend`
- ปรับ `frontend` remote ที่เคยชี้ผิดไปยัง backend ให้ชี้กลับไป repo frontend อย่างถูกต้อง

### 2026-05-28 — OCR ID Card Verification Debugging

- ตรวจสอบและแก้ไขปัญหา POST `/api/ocr/verify-id-card` โดยยืนยันว่า `localhost` บน Windows ถูกชี้ไปยัง IPv6/port ที่ไม่ใช่เซิร์ฟเวอร์ npm ท้องถิ่น
- ยืนยันว่าเรียก API สำเร็จเมื่อใช้ `127.0.0.1:3000` แทน `localhost:3000`
- เพิ่ม debug log ใน `src/app.ts` เพื่อตรวจเส้นทาง request และ verify ว่า `app` โหลดโมดูล `src/app.ts` โดยตรง
- แก้ `src/app.ts` เพื่อลด implicit `any` ใน callback ของ `router.stack.map(...)`
- ยืนยันว่า OCR result ถูกบันทึกในฐานข้อมูลเมื่อเรียก API ด้วย IPv4 interface ที่ถูกต้อง

### 2026-06-12 — OCR, Redis, and Infrastructure Enhancements

- เพิ่ม Redis service ใน `docker-compose.yml` พร้อม `redisdata` volume และ healthcheck เพื่อรองรับ OCR job queue และ rate limiting
- ขยาย Prisma schema และสร้าง migration `20260611000000_add_ocr_jobs` สำหรับตาราง `OcrJob` และสถานะ OCR job
- สร้าง Redis utilities `src/shared/redis.ts` และ `src/shared/rate-limit-store.ts` สำหรับ Redis client และ rate-limit store
- เพิ่ม `src/modules/ocr/ocr.queue.ts` เป็น helper สำหรับ enqueue/dequeue OCR jobs
- ปรับ `src/modules/ocr/ocr.routes.ts` ให้มี rate limiter และ upload validation สำหรับไฟล์รูปภาพ JPG/PNG/WebP
- ปรับ `src/modules/ocr/ocr.service.ts` ให้รองรับ circuit breaker, retry, timeout, secure private image storage และ path validation สำหรับ ID card OCR
- ปรับ `src/index.ts` ให้ shutdown gracefully ปิด Redis, Prisma และ worker ชั่วคราวเมื่อโปรเซสสิ้นสุด

### 2026-06-23 - High-Concurrency Backend Hardening

- Removed temporary debug request/router logging from `src/app.ts` and moved setup logs to the shared logger.
- Reworked access logging to enqueue logs in Redis and flush them to PostgreSQL in batches with a direct-write fallback.
- Added Redis-backed rate-limit stores for global API, auth, and OCR endpoints.
- Added configurable shared private upload storage via `UPLOAD_ROOT` and Docker named volume `uploads`.
- Added OCR timeout, retry, and in-memory circuit breaker handling for the external OCR API wrapper.
- Added async OCR job support with `OcrJob`, migration `20260623000000_add_ocr_jobs`, Redis queue helpers, worker lifecycle hooks, and job status endpoints.
- Added Redis JSON cache helpers and cached the OCR verification list endpoint with invalidation on create/delete.
- Expanded Docker Compose with Redis, PgBouncer, Nginx, Prometheus, Grafana, shared uploads, and scale-friendly backend exposure through Nginx.
- Added Nginx and Prometheus config files under `docker/`.
- Added `tests/load/k6-smoke.js` and `npm run load:k6` for repeatable baseline load testing.
- Verified with `npx prisma validate`, `npm run prisma:generate`, `npm run build`, `npm test`, `npx eslint "src/**/*.ts"`, and `docker compose config --quiet`.

### 2026-06-24 - Backend Roadmap Backlog Update

- Added Unit Test / Integration Test setup as the next backend priority before expanding large business modules.
- Added ORM / Prisma schema, migration, and seed workflow cleanup as a required foundation before Users, Rooms, and Tenants modules.
- Added Redis / memory cache adoption to the roadmap after read-heavy endpoints such as room lists, dashboard summaries, billing status, and master data are implemented.
- Reordered the backend roadmap to prioritize testing, Prisma data modeling, Users, Dormitory/Room, Tenant/Student Profile, cache usage, Billing, Maintenance, Visitor, Audit Log, Notification, File Cleanup, Swagger docs, and Load Testing.

### 2026-06-29 - Backend Unit and Integration Test Foundation

- Replaced the placeholder `npm test` command with a real Node built-in test runner using `ts-node/register`.
- Added `npm run test:typecheck` with `tsconfig.test.json` to typecheck both `src/**/*.ts` and `tests/**/*.ts` without emitting files.
- Added `tests/run-tests.cjs` as the central test bootstrap for TypeScript test files.
- Added unit tests for `createResponse`, `verifyToken`, and `requireRole` to protect API response and auth middleware behavior.
- Added lightweight Express integration tests for `errorHandler` to verify `AppError` and unknown error response formats.
- Updated ESLint configuration to include `tests/**/*.ts` in lint coverage.
- Verified the new test foundation with `npm test`, `npm run test:typecheck`, `npm run build`, and `npx eslint "src/**/*.ts" "tests/**/*.ts"`.

### 2026-07-02 — AI Context and Anti-Bloat Guardrails

- Added anti-bloat and complexity control rules to `AGENTS.md` to prevent unnecessary file creation, abstractions, and package additions.
- Added AI context documents for anti-bloat guidance and a pre-dormitory checklist under `.docs/ai-context/`.
- Strengthened frontend/backend alignment guidance so future AI agents stay focused on the dormitory MVP scope and avoid speculative features.
- Recorded the July 2 AI documentation updates in `.docs/AI-CHANGELOG/2026-07-02.md`.

### 2026-07-03 — Notifications System (DB + Service + Worker)

- **Prisma schema updated:** Added `NotificationProvider`, `NotificationTemplate`, `Notification`, `NotificationPreference` and enums `NotificationChannel`, `NotificationType`, `NotificationStatus` to `prisma/schema.prisma` to support SMS/EMAIL notification flows.
- **Migration applied:** Created and applied migration `20260702194412_add_notifications` and regenerated Prisma Client (`npx prisma generate`).
- **Notification module (backend):** Added a minimal `NotificationService` implementing scheduling and send flow with preference checks.
- **Provider stub:** Created a lightweight provider stub at `src/modules/notifications/provider/simpleProvider.ts` to simulate sending (keeps tests and local runs simple).
- **Worker:** Added `src/workers/notificationWorker.ts` to process pending/scheduled notifications and mark status/results in DB.
- **Tests:** Added `tests/unit/notification.test.ts` (mock DB) and verified full test suite (`npm test`) passes locally.
- **Notes:** DB reset/migrate was performed during implementation — this drops development data. Use caution on shared environments.

### 2026-08-06 — Face Recognition Client Environment & MediaPipe Debugging

#### Face_Recognition Environment (`C:\Users\raphi\Documents\Face_Recognition`)

- แก้ไขปัญหาไลบรารี `mediapipe` ขาดโมดูล `mp.solutions.face_detection` (เกิดข้อผิดพลาด `AttributeError: module 'mediapipe' has no attribute 'solutions'`)
- ตรวจพบว่า `.venv` เดิมจำลองมาจาก Python 3.14.0 (Pre-release) ซึ่งไม่มี Precompiled binary ของ MediaPipe บน Windows ส่งผลให้ได้สคริปต์คอมไพล์ที่ไม่สมบูรณ์และไม่มีโฟลเดอร์ `solutions`
- วิธีแก้ไข:
  - ลบโฟลเดอร์ `.venv` สภาพแวดล้อมเดิมออกทั้งหมดเพื่อป้องกันไฟล์ไบนารีตกค้าง
  - สร้างสภาพแวดล้อมจำลอง `.venv` ใหม่โดยระบุเอนจินหลักเป็น Python 3.11.9 (เวอร์ชันเสถียรที่ระบบพัฒนาและผู้ใช้มีติดตั้งอยู่แล้ว)
  - ติดตั้งและดาวน์เกรด `mediapipe` มาใช้เวอร์ชัน `0.10.14` ที่ระบุโมดูล `solutions` ครบถ้วน พร้อมอัปเกรด package ที่เกี่ยวข้อง
  - ยืนยันการเริ่มทำงานของแบบจำลองตรวจจับใบหน้า `FaceDetection` และ TensorFlow Lite XNNPACK delegate สำเร็จเรียบร้อย สามารถรันสตรีมกล้องกับเว็บแคมได้อย่างราบรื่น
