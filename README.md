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

- Node.js + Express + TypeScript (Multi-Worker 2 Replicas หลัง Nginx)
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
backend/
├── package.json
├── prisma.config.ts
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── src/
│   ├── app.ts
│   ├── index.ts
│   ├── database/db.ts
│   ├── modules/
│   │   ├── auth/
│   │   ├── users/
│   │   ├── visitor/
│   │   ├── billing/
│   │   ├── maintenance/
│   │   ├── ocr/
│   │   └── face-verification/
│   ├── middlewares/
│   ├── setup/
│   ├── shared/
│   └── docs/
└── tsconfig.json
```

## Run Locally

```bash
cd backend
npm install
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
