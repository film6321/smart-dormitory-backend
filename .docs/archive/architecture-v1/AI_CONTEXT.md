# AI_CONTEXT

## จุดประสงค์ของระบบ

ระบบ Smart Dormitory Management สำหรับจัดการผู้พักอาศัย ผู้ติดต่อ บิล ค่าบริการ และการยืนยันตัวตนด้วย OCR และ Face Recognition

## โครงสร้าง Backend

- Node.js + Express + TypeScript
- Modular monolith ภายใต้ `src/modules`
- Shared utilities และ middleware อยู่ใน `src/shared`
- ใช้ Prisma เป็น ORM เพื่อเข้าถึง PostgreSQL
- Redis ใช้เฉพาะสำหรับ cache, rate limiting, และ queue
- OCR และ Face Recognition ติดต่อผ่าน external REST API เท่านั้น

## โครงสร้าง Frontend

- React + Vite + TypeScript
- Pages, components, hooks, API service
- Frontend เรียกใช้งาน backend ผ่าน REST API

## Flow หลักของแต่ละโมดูล

- auth: login, register, token verification
- users: จัดการโปรไฟล์ผู้ใช้งานและข้อมูลผู้พักอาศัย
- tenants/rooms: จัดการห้องพักและ tenant mapping
- visitor: ลงทะเบียนผู้ติดต่อ เข้า-ออก
- billing: สร้างบิล, อัปโหลดสลิป, ตรวจสอบการชำระ
- maintenance: ขอซ่อมและติดตามสถานะงาน
- ocr: อัปโหลดภาพบัตร/สลิป ส่ง external OCR
- face-verification: บันทึกและตรวจสอบใบหน้า
- notifications: ส่งแจ้งเตือนและจัดการ preference

## สิ่งที่ห้ามทำ

- ห้ามเชื่อม Payment Gateway โดยตรง
- ห้ามใช้ Microservices หลายตัวในสถาปัตยกรรมหลัก (ยังเป็น monolith)
- ห้ามสร้าง business logic ใน Controller
- ห้ามเปลี่ยนไปใช้ ORM อื่นนอกเหนือจาก Prisma
- ห้ามเพิ่ม endpoint หรือ model ที่ไม่มีใน repo โดยไม่ตรวจสอบก่อน
- ห้ามใช้ Redis เป็น Source of Truth สำหรับข้อมูลหลัก
