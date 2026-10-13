# BLUEPRINT.md - Smart-Dormitory-Management-System

## Project Vision

ระบบจัดการหอพักอัจฉริยะ ที่รวมการจัดการห้องพัก, ผู้เช่า, บิลค่าเช่า, การแจ้งซ่อม, ระบบบันทึกผู้มาติดต่อ, การตรวจสอบเอกสารด้วย OCR, และการยืนยันตัวตนด้วยใบหน้า เข้าไว้ในระบบเดียว

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Frontend (React/Vite)              │
│  ┌──────┐ ┌───────┐ ┌───────┐ ┌────────┐ ┌───────┐ │
│  │ Auth │ │Student│ │ Admin │ │Billing │ │Visitor│ │
│  └──┬───┘ └───┬───┘ └───┬───┘ └───┬────┘ └───┬───┘ │
│     └─────────┴─────────┴─────────┴───────────┘     │
│                        │ Axios                       │
└────────────────────────┼─────────────────────────────┘
                         │ REST API (JSON)
┌────────────────────────┼─────────────────────────────┐
│                   Backend (Express/TS)               │
│  ┌──────┐ ┌─────┐ ┌───────┐ ┌────────┐ ┌──────────┐│
│  │ Auth │ │Users│ │Billing│ │Maintena│ │ Visitor  ││
│  └──────┘ └─────┘ └───────┘ └────────┘ └──────────┘│
│  ┌──────────────────┐  ┌──────────────────────────┐ │
│  │ OCR (API Wrapper)│  │ Face Verify (API Wrapper)│ │
│  └────────┬─────────┘  └────────────┬─────────────┘ │
│           │                         │                │
│     External OCR API        External Face API        │
└────────────────────────┬─────────────────────────────┘
                         │
              ┌──────────┴──────────┐
              │  PostgreSQL 16      │
              │  (dormitory_db)     │
              └─────────────────────┘
```

## Tech Stack

| Layer        | Technology                        |
|-------------|-----------------------------------|
| Frontend    | React 18+ / Vite / TypeScript     |
| Backend     | Node.js / Express / TypeScript    |
| Database    | PostgreSQL 16                     |
| ORM         | Prisma (หรือ TypeORM)              |
| Auth        | JWT Bearer Token                  |
| OCR         | External API (พร้อมใช้งาน)         |
| Face Verify | External API (พร้อมใช้งาน)         |
| Container   | Docker / Docker Compose           |

## Module Breakdown

### Backend Modules (`backend/src/modules/`)

| Module               | หน้าที่                                                    |
|----------------------|-----------------------------------------------------------|
| `auth/`              | ล็อกอิน, สมัครสมาชิก, JWT Token, จัดการสิทธิ์ (Role-based) |
| `users/`             | CRUD ข้อมูลผู้ใช้งาน (นักศึกษา, แอดมิน)                    |
| `visitor/`           | บันทึกการเข้า-ออกของผู้มาติดต่อ                             |
| `billing/`           | สร้างบิล, ตรวจสอบการชำระเงิน, แจ้งหนี้                      |
| `maintenance/`       | ระบบแจ้งซ่อม, อัปเดตสถานะการซ่อม                           |
| `ocr/`               | Service Wrapper → ยิงไปที่ External OCR API                |
| `face-verification/` | Service Wrapper → ยิงไปที่ External Face API               |

### Frontend Modules (historical plan; current code is in sibling smart-dormitory-frontend)

| Module               | หน้าที่                                           |
|----------------------|--------------------------------------------------|
| `auth/`              | หน้าล็อกอิน / สมัครสมาชิก                          |
| `student/`           | Dashboard ผู้เช่า (ดูบิล, แจ้งซ่อม, ดูประวัติ)      |
| `admin/`             | Dashboard แอดมิน (จัดการตึก, ห้อง, ผู้เช่า)         |
| `visitor/`           | หน้าลงทะเบียนผู้มาติดต่อ                           |
| `billing/`           | หน้าดูบิล / จ่ายเงิน / อัปโหลดสลิป                 |
| `maintenance/`       | หน้าแจ้งซ่อมและติดตามสถานะ                         |
| `ocr/`               | UI อัปโหลดเอกสาร/สลิปเพื่อตรวจสอบ                  |
| `face-verification/` | UI เปิดกล้องสแกนใบหน้ายืนยันตัวตน                   |

## Project Structure

```
qrdm-system/
├── frontend/
│   └── src/
│       ├── modules/
│       │   ├── auth/
│       │   ├── student/
│       │   ├── admin/
│       │   ├── visitor/
│       │   ├── billing/
│       │   ├── maintenance/
│       │   ├── ocr/
│       │   └── face-verification/
│       ├── components/        ← Shared UI components
│       ├── services/          ← Axios instance & API helpers
│       ├── hooks/             ← Custom React hooks
│       └── types/             ← TypeScript interfaces
│
├── backend/
│   └── src/
│       ├── modules/
│       │   ├── auth/
│       │   ├── users/
│       │   ├── visitor/
│       │   ├── billing/
│       │   ├── maintenance/
│       │   ├── ocr/
│       │   └── face-verification/
│       ├── shared/            ← api-response.ts, middlewares, error handler
│       ├── workers/           ← Background jobs (แจ้งเตือนบิล, cleanup)
│       └── database/          ← Prisma schema, migrations, seed
│
├── docs/
│   ├── api/                   ← API documentation
│   └── flow/                  ← Flow diagrams
│
├── docker-compose.yml
├── .env.example
├── .cursorrules
├── AGENTS.md
├── BLUEPRINT.md
├── CHANGELOG.md
└── README.md
```

## Git Flow

```
main ← Production-ready code only
 └── dev ← Integration branch (ทุกคน merge เข้าที่นี่)
      ├── feature/* ← ฟีเจอร์ใหม่ (เช่น feature/billing-module)
      └── fix/*     ← แก้บั๊ก (เช่น fix/login-token-expired)
```

## Current State & Priorities

### ✅ เสร็จแล้ว
- โครงสร้างโฟลเดอร์ frontend/backend/docs
- Docker Compose (backend + frontend + db)
- Shared utilities (api-response.ts)
- Git repository initialized

### 🔜 ลำดับความสำคัญถัดไป
1. **Auth Module** — ระบบล็อกอิน JWT (backend + frontend)
2. **Users Module** — CRUD ผู้ใช้งาน + Role management
3. **Billing Module** — สร้างบิล + ตรวจสอบการชำระเงิน
4. **Maintenance Module** — ระบบแจ้งซ่อม
5. **Visitor Module** — บันทึกผู้มาติดต่อ
6. **OCR Integration** — เชื่อมต่อ External OCR API
7. **Face Verification Integration** — เชื่อมต่อ External Face API

