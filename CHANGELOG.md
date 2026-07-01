# CHANGELOG.md - Smart-Dormitory-Management-System

## [Unreleased]

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
