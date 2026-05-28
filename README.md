# Smart Dormitory Backend

Backend API สำหรับ Smart Dormitory Management System

## Overview

- Node.js + Bun + Express + TypeScript
- Prisma ORM กับ PostgreSQL 16
- JWT Bearer authentication
- Modular architecture โดยแยกเป็นโมดูลใน `src/modules/`
- Security middleware: Helmet, CORS, rate limiting

## Prerequisites

- Bun
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
bun install
bunx prisma generate
bun run dev
```

## Docker

```bash
docker compose up -d --build
```

## Useful Commands

```bash
bun run lint
bun run build
bun run test
bunx prisma validate
bunx prisma generate
```
