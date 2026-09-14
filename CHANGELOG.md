# CHANGELOG.md - Smart-Dormitory-Management-System

## [Unreleased]

### 2026-09-13 — Full Type-Safety & ESLint Zero-Error Refactoring (Backend & Frontend)

- **Core & Database**: เพิ่ม `DbClient` type (`PrismaClient | Prisma.TransactionClient`) ใน `src/database/db.ts` เพื่อรองรับ Database Transactions และ Prisma client injection แบบ type-safe 100%
- **Tenant Module**: Refactor `TenantsRepository`, `TenantsService`, และ `TenantsController` โดยใช้ Prisma Input Types (`Prisma.TenantCreateInput`, `Prisma.TenantUpdateInput`, `Prisma.TenantWhereInput`) พร้อมกำจัด `any` และใช้ `AuthenticatedRequest`
- **Users & Rooms & Visitor Modules**: Refactor CRUD services, repositories, และ controllers ทุกไฟล์ให้ใช้ `DbClient`, Prisma relation connect patterns และ strict types แทนการ cast
- **Billing & Payment Batch**: ปรับปรุง `PaymentBatchService` ให้แปลงผลลัพธ์ผ่าน null-safe `toBatchResponse` mapping และแก้ไข typing ของ nested queries
- **OCR & Face Verification**: กำจัด `any` casts ใน `OcrService` และ `FaceVerificationService`, แก้ไข nested relation connection สำหรับ OCR documents และเชื่อมโยง typed `CameraScanSnapshot`
- **Notifications & Workers**: ปรับ `NotificationController` และ `notificationWorker` ให้ใช้ `AuthenticatedRequest` และ `DbClient` พร้อมล้าง unused imports
- **Zero Suppression Policy**: ไม่ใช้ `eslint-disable`, `@ts-ignore` หรือ `any` เพื่อปิดบังข้อผิดพลาด โดยแก้ไขให้ตรงตาม type contract จริง
- **Verification**: ตรวจสอบยืนยันด้วย `npm run lint` (0 errors, 0 warnings) และ `npm run build` (tsc) ผ่านสมบูรณ์

### 2026-09-11 — Auth, data exposure, and private file hardening

- บังคับการสมัครสมาชิกทั่วไปให้สร้างผู้ใช้ด้วย role `STUDENT` จาก Backend โดยไม่รับ role จาก Frontend
- ป้องกันไม่ให้ผลลัพธ์ `createUser` ส่ง password hash กลับออกไป และคงการเลือก password ไว้เฉพาะการตรวจ Login ภายใน Backend
- ลดข้อมูลจาก User relations ด้วย Prisma `select` และย้ายการแสดงชื่อไปใช้ `Tenant.fullName`, `username` หรือ `email`
- ลดการดึง relations ที่ไม่จำเป็นจาก Room และจำกัดข้อมูลที่ส่งกลับจาก Payment responses
- กรอง `providerResponse`, `slipPath`, `slipHash` และ `idempotencyKey` ออกจาก HTTP responses ที่เกี่ยวข้องกับการชำระเงิน
- ปรับการเข้าถึงเอกสาร Tenant และรูป Maintenance: ตรวจ token, จำกัดสิทธิ์ Admin ในการดาวน์โหลดรูป Maintenance, ป้องกัน path traversal และ mask เลขบัตรประชาชนใน upload response
- ปรับ access log ให้เก็บเฉพาะ request path โดยไม่บันทึก query string ที่อาจมีข้อมูลลับ
- ตรวจยืนยันด้วย `npm run build` ผ่านสำเร็จ

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
