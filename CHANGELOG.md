# CHANGELOG.md - Smart-Dormitory-Management-System

## [Unreleased]

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
