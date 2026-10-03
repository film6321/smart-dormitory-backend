# Smart Dormitory Backend

Backend API สำหรับ Smart Dormitory Management System

```text
┌────────────────────────────────────────────────────────┐
│  ⭐ สถานะปัจจุบันหลังปรับแต่ง (Production-Ready)           │
│                                                        │
│  - Throughput: ~345 Requests/วินาที                    │
│  - ความจุจริง: รองรับคนสมัครได้ 20,000+ คน/นาที          │
│  - Latency P95: 282ms (ตอบสนองเร็วมาก)                 │
│  - ความปลอดภัย: รหัสผ่านใช้ Bcrypt 10 rounds เต็มร้อย    │
│  - สถาปัตยกรรม: กระชับ ไม่ซับซ้อน ไม่บวม (Anti-Bloat)  │
└────────────────────────────────────────────────────────┘
```

## Overview

- Node.js + Express + TypeScript หลัง Nginx (Compose เริ่มต้น 1 replica; ปรับผ่าน `BACKEND_REPLICAS`)
- PgBouncer Connection Pooler กับ PostgreSQL 16
- Redis สำหรับ Rate Limit และ Cache
- Libuv Threadpool: `UV_THREADPOOL_SIZE=64` สำหรับ Bcrypt Hashing
- JWT Bearer authentication & Role-Based Access Control
- Modular architecture โดยแยกเป็นโมดูลใน `src/modules/`
- Security middleware: Helmet, CORS, distributed rate limiting

## Dependency maintenance

- Use Node.js 24 (24.14.0 or newer within major 24), matching the Docker build and runtime.
- Prisma CLI, client, and PostgreSQL adapter are pinned together at 7.8.0.
- Scoped npm overrides patch pinned transitive dependencies: deepmerge-ts under @prisma/config, mysql2 under prisma, and @hono/node-server / valibot under @prisma/dev.
- Recheck these overrides when upgrading Prisma. Validate its config, generate the client, and run build/tests before removing them.
- Use npm ci with the repository lockfile; do not use npm audit fix --force to downgrade Prisma.

## Prerequisites

- npm
- Docker Desktop (สำหรับ PostgreSQL/Redis)
- Git

## Environment Variables

Copy template:

```bash
cp .env.example .env
```

ตั้งค่าตัวแปร:

- `DATABASE_URL`
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `POSTGRES_DB`
- `JWT_SECRET`
- `REDIS_HOST`
- `REDIS_PORT`
- `OCR_API_URL`
- `OCR_API_KEY`
- `FACE_API_URL`
- `FACE_API_KEY`

## Project Structure

```text
smart-dormitory-backend/
├── package.json
├── package-lock.json
├── docker-compose.yml
├── Dockerfile
├── prisma.config.ts
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed.ts
├── src/
│   ├── app.ts
│   ├── index.ts
│   ├── database/db.ts
│   ├── modules/
│   │   ├── auth/
│   │   ├── users/
│   │   ├── tenants/
│   │   ├── rooms/
│   │   ├── visitor/
│   │   ├── billing/
│   │   ├── maintenance/
│   │   ├── notifications/
│   │   ├── audit/
│   │   ├── settings/
│   │   ├── analytics/
│   │   ├── ocr/
│   │   └── face-verification/
│   ├── middlewares/
│   ├── setup/
│   ├── shared/
│   ├── realtime/
│   ├── routes/
│   ├── workers/
│   └── logger.ts
├── scripts/
├── tests/
├── postman/
├── docker/
├── .docs/
└── tsconfig.json
```

ใช้ **Modular Architecture** โดยเก็บไฟล์ของฟีเจอร์เดียวกันไว้ใน `src/modules/<feature>/`. ภายในโมดูลแยก routes, controller, service, repository และ DTO ตามหน้าที่ที่ใช้งานจริง ไม่สร้างโครงสร้าง Frontend ซ้ำใน repo นี้.

| ตำแหน่ง | หน้าที่และจุดเริ่มอ่าน |
| --- | --- |
| `src/app.ts`, `src/index.ts` | ลงทะเบียน routes/middleware และเริ่มหรือหยุด server/Socket/workers |
| `src/modules/` | ฟีเจอร์ของ Backend; ดูขอบเขตใน [Backend spec](.docs/ai-context/spec-backend.md) |
| `src/middlewares/`, `src/shared/` | การตรวจคำขอ/สิทธิ์ รวม DTO validation และ utilities ที่ใช้ข้ามโมดูล |
| `src/database/`, `prisma/` | Prisma client, schema, migration history และ seed; seed มีการล้างข้อมูล ไม่ใช่ขั้นตอนตรวจโครงสร้าง |
| `src/realtime/`, `src/workers/` | Socket gateway และงานเบื้องหลัง เช่น OCR, notifications และ visitor expiry |
| `src/setup/`, `src/routes/` | เริ่ม security/Swagger/metrics และ health routes; Swagger สร้างจาก annotations ใน routes ผ่าน `src/setup/setupSwagger.ts` |
| `scripts/` | เครื่องมือตรวจหรือดูแลระบบ แยกจากโค้ดที่ server เรียกใช้งาน |
| `tests/`, `postman/` | Automated tests, load tests และ collection สำหรับตรวจ API; ดูข้อกำหนดฐานข้อมูลของ test ก่อนรัน |
| `docker/`, `docker-compose.yml` | Configuration และ topology ของ service; Frontend และ external services อยู่คนละ repo |
| `.docs/`, `AI-INDEX.md` | เริ่มที่ [AI-INDEX.md](AI-INDEX.md) เพื่อเลือก active specs/contracts; architecture เป็นข้อมูลอ้างอิง และ archive เป็นประวัติ |

### เครื่องมือดูแลระบบและ validation กลาง

- `scripts/inspect-db.ts`, `scripts/check_faces.ts`: เครื่องมือตรวจข้อมูล; ตรวจ env และข้อมูลที่จะแสดงก่อนรัน.
- `scripts/fix-db-statuses.ts`, `scripts/clear-face-data.ts`, `scripts/clear_mock_face_logs.ts`: เปลี่ยนหรือลบข้อมูล ไม่รันเพื่อทดสอบการย้ายไฟล์.
- `scripts/face-verification-flow.ps1` และ `.sh`: เครื่องมือตรวจ flow; อ่านคำขอที่ส่งและบัญชีทดสอบก่อนใช้งาน.
- DTO validation อยู่ที่ `src/middlewares/dto-validation.ts` ใช้ร่วมกันใน Billing, Maintenance, Notifications และ Visitor; ดูความคืบหน้าใน [แผนจัดโครงสร้าง](.docs/architecture/03-backend-architecture.md).

### Build, runtime และข้อมูลเฉพาะเครื่อง

| ตำแหน่ง | การจัดการ |
| --- | --- |
| `node_modules/`, `dist/`, `*.tsbuildinfo` | Dependencies และผล build/cache สร้างใหม่จาก lockfile และคำสั่ง build; ไม่ commit |
| `.env`, `cookies.txt` | Configuration ส่วนตัวและข้อมูล authentication; ไม่ commit และไม่ใส่ Docker build context |
| `uploads/` | ข้อมูลที่ระบบเก็บระหว่างใช้งาน ไม่ใช่ source code และไม่ลบในงานจัดโครงสร้าง |
| `tmp/`, `temp/`, log files | ไฟล์ชั่วคราวบนเครื่อง; ตรวจผู้ใช้งานก่อนทำความสะอาด |
| Docker volumes | ข้อมูลฐานข้อมูลและ service แยกจาก Git; ไม่ลบเพียงเพื่อให้โครงสร้าง repo เรียบร้อย |

## Run Locally

```bash
# Run from the smart-dormitory-backend repository root.
npm ci
npx prisma generate
npm run dev
```

## Docker

```bash
docker compose up -d --build
```

## Useful Commands

```bash
npm run lint
npm run build
npm run test
npx prisma validate
npx prisma generate
```
