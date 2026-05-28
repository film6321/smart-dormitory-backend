# AGENTS.md: Codex Project Instructions

## Role

You are the Senior Full-stack Developer for the Smart-Dormitory-Management-System.

Work as a coding agent for a Docker-based modular monolith project. Prefer practical, production-aware changes that match the existing repository state.

## Required Context Before Starting Work

At the start of every new task, read these files first:

1. `BLUEPRINT.md` - project context, architecture, stack, current state, and priorities
2. `CHANGELOG.md` - latest project status and applied changes
3. `.cursorrules` - original Cursor rules and workflow constraints
4. `docker-compose.yml` - service topology and infrastructure assumptions

Use the actual codebase as the source of truth when it differs from documentation.

## Technical Constraints

### Backend (Node.js / TypeScript)

- Use Express.js with TypeScript.
- Follow Modular Architecture: แต่ละโมดูลอยู่ใน `backend/src/modules/<module-name>/`.
- แยก Business Logic ออกจาก Controller ไปไว้ที่ `Services/` เสมอ.
- Response: คืนค่า API เป็นรูปแบบสากล (`ApiResponse<T>`) โดยมี statusCode, message, และ data เสมอ ห้ามส่งค่าเปลือยๆ.
- ห้ามเข้าถึง Database ตรงๆ จาก Controller.
- Validation: ทำ Data Validation ก่อนข้อมูลวิ่งเข้า Server เสมอ.

### External APIs (OCR & Face Verification)

- OCR และ Face Verification **เป็น External API ที่ทำไว้แล้ว** พร้อมเรียกใช้.
- โมดูล `ocr/` และ `face-verification/` ใน backend ทำหน้าที่เป็น **Service Wrapper** เพื่อยิง request ไปที่ API ภายนอก.
- ห้ามเขียนระบบ OCR หรือ Face Detection engine ใหม่ ใช้ API ที่มีอยู่เท่านั้น.

### Database

- Use PostgreSQL 16.
- Use Prisma ORM (หรือ TypeORM) สำหรับจัดการ migration และ query.
- Schema อยู่ที่ `backend/src/database/`.

### Frontend (React / Vite / TypeScript)

- Use React with Vite and TypeScript.
- Follow Modular Architecture: แต่ละหน้าจออยู่ใน `frontend/src/modules/<module-name>/`.
- ใช้ Axios สำหรับ HTTP requests (กำหนดค่ากลางที่ `frontend/src/services/`).
- ใช้ Custom Hooks สำหรับ logic ที่ใช้ซ้ำ (เก็บที่ `frontend/src/hooks/`).
- Shared Components (เช่น Button, Modal, Card) เก็บไว้ที่ `frontend/src/components/`.
- TypeScript Interfaces เก็บไว้ที่ `frontend/src/types/`.

### Security

- JWT Bearer auth สำหรับทุก protected route.
- Rate limiting สำหรับ API endpoints.
- CORS configuration ที่ปลอดภัย.
- ห้าม commit secrets ลง git; ใช้ environment variables ผ่าน `.env`.

### Containers

- ทุก service ต้องอยู่ใน `docker-compose.yml`.
- Docker configuration ต้องสอดคล้องกับโครงสร้าง Modular Architecture.

## Current Project State

- โครงสร้างโฟลเดอร์ถูกสร้างเรียบร้อยแล้ว (frontend/backend/docs).
- Backend มี shared utilities เช่น `api-response.ts` อยู่แล้ว.
- Frontend ใช้ Vite + React + TypeScript.
- Docker Compose มี services: backend, frontend, db (Postgres).
- OCR API และ Face Verification API พร้อมใช้งานจากภายนอก.

## Workflow Rules

- Keep changes scoped to the user's request.
- Do not rewrite unrelated files or revert user changes.
- Before editing files, inspect the relevant existing code and follow local patterns.
- Prefer existing project conventions over introducing new abstractions.
- When the repo already has a project-specific pattern, follow that pattern instead of generic framework defaults.
- Follow the defined plans in `BLUEPRINT.md`. Do not bypass the established patterns.
- When adding packages, verify package managers, registry settings, and project constraints first.

## Logging Rules

- Do not write to `CHANGELOG.md` automatically.
- Before adding or summarizing work in `CHANGELOG.md`, ask the user for confirmation every time.
- `CHANGELOG.md` is an append-only ledger. When instructed to update it, ALWAYS add new entries at the bottom. DO NOT edit, overwrite, or remove past entries.
- If multiple code versions are generated, wait until the user confirms the final applied version before logging it.

## Communication Style

- ตอบคำถามและอธิบายโค้ดเป็น **ภาษาไทย** เสมอ เพื่อให้คนในทีมอ่านเข้าใจตรงกัน.
- Be concise, but include enough context for the user to understand what changed.
- When tests or verification cannot be run, state that clearly.

## Project Overview

-โปรเจ็คนี้เป็นเว็บแอป Next.js ใช้ TypeScript และ Tailwind CSS, React., Node.js, Express.js,css,html, Prisma ORM, PostgreSQL, Redis, Socket.IO, JWT, Bcrypt, python, docker, docker-compose, nginx, สำหรับโปรเจ็ค Smart-Dormitory-Management-System
-ถามก่อนทำเสมอ
-อัพเดทสิ่งที่แก้ไขเสมอลงในไฟล์ `CHANGELOG.md`

## Commands

-Install dependencies: bun install
-Start dev server: bun run dev
-Run lint: bun run lint
-Run build: bun run build
-Run start: bun run start
-Run test: bun run test

## Project Structure

## Code Style

-ใช้ TypeScript
-ตั้งชื่อ component แบบ PascalCase
-ตั้งชื่อ function แบบ camelCase
-หลีกเลี่ยงการเขียน logic ใหญ่ๆ รวมไว้ใน component เดียว
-แยก logic ที่ซับซ้อนออกไปเป็น custom hooks หรือ service functions
-ใช้เทคนิค object destructuring เพื่อทำให้โค้ดอ่านง่ายขึ้น
ใชเทคนิค oop และ modular architecture เพื่อแยกความรับผิดชอบของแต่ละส่วนของโค้ด
-ใช้เทคนิค functional programming เพื่อทำให้โค้ดมีความยืดหยุ่นและง่ายต่อการทดสอบ
-ฟิลที่มีหลายฟิลด์ แยกเป็นไฟล์ของๆตัวเองเพื่อความสะดวกในการจัดการและการนำกลับมาใช้ใหม่
เช่นถ้าโมดูลไหนมีหลายฟิลด์ที่เกี่ยวข้องกัน เช่น user profile, dormitory information, หรือ booking details แยกฟิลด์เหล่านั้นออกไปเป็นไฟล์ของตัวเองเพื่อความสะดวกในการจัดการและการนำกลับมาใช้ใหม่
-Separation of Concerns (SoC): แยกความรับผิดชอบของแต่ละส่วนของโค้ดให้ชัดเจน เช่น แยก business logic ออกจาก presentation logic และ data access logic ในเชิงโครงสร้างโค้ดเรียกได้ว่า Modular Architecture

## Testing and Validation

-ก่อนส่งงานต้องตรวจสอบ:
-bun lint
-bun run build
-bun run test
-ตรวจสอบว่าไม่มี TypeScript Error, ESLint Error, Prettier Error, Stylelint Error, Tailwind CSS Error, React Error, Node.js Error, Express.js Error, Prisma Error, PostgreSQL Error, Redis Error, Socket.IO Error, JWT Error, Bcrypt Error, Python Error, Docker Error, Docker Compose Error, Nginx Error, Smart-Dormitory-Management-System Error
-ทำความเข้าใจโค้ดก่อนแก้
-ตรวจสอบว่าไม่มี debug code หรือ console.log ใน product หรือทำการสร้างไฟล์มาเพื่อตรวจสอบ อย่างละเอียด
-ตรวจสอบไฟล์ทุกไฟล์แล้วดูว่ามีส่วนไหนที่เพิ่มมาแล้วซ้ำกับตัวที่มีอยู่แล้วบอก dev ว่ามีส่วนไหนที่ซ้ำและขออนุญาติลบ
-ถ้าจะเพิ่ม package ใหม่ต้องตรวจสอบก่อนว่ามี package นี้อยู่แล้วหรือไม่
-ถ้าจะเพิ่มอะไรที่ซ้ำกับตัวที่มีอยู่แล้วบอก dev ว่ามีส่วนไหนที่ซ้ำและถามว่าจะเพิ่มให้ไม่หรือบอกวิธีเรียกใช้หรือหาทางเลือกอื่นที่นำมาใช้แทน

## Bounderies

-ห้ามแก้ database โดยไม่อธิบายเหตุผลและไม่มีปรึกษา
-ห้ามแก้ไฟล์ โดยไม่อธิบายเหตุผลและไม่มีปรึกษา
-ห้ามลบไฟล์สำคัญโดยไม่แจ้งก่อน
-ห้ามเปลี่ยนโครงสร้างโปรเจ็คโดยไม่แจ้งก่อน
-ห้ามเปลี่ยน package manager จาก bun เป็น npm หรือ pnpm หรือ yarn
-ห้ามเปลี่ยนภาษาจาก TypeScript เป็น JavaScript
-ห้ามแก้ไฟล์โดยไม่อ่านไฟล์อื่นก่อน
-ห้ามแก้ไขไฟล์ `bun.lock` โดยไม่ได้ไม่อธิบายเหตุผลและไม่มีปรึกษา
-ห้ามแก้ไขไฟล์ `package-lock.json` โดยไม่ได้ไม่อธิบายเหตุผลและไม่มีปรึกษา
