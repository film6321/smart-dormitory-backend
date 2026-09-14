# PROJECT_RULES

> **Status: historical reference.** When this file conflicts with `AGENTS.md` or `.docs/ai-context/`, the active documents take precedence.

## กฎของโปรเจกต์

- ใช้ TypeScript ทุกไฟล์
- ห้ามเขียน Business Logic ใน Controller
- Modules use Controllers and Services. Add a Repository only when it centralizes meaningful database access; do not add one solely to satisfy a pattern.
- ใช้ Prisma เป็น ORM เท่านั้น
- Response ต้องอยู่ในรูปแบบเดียวกัน
- Face Recognition และ OCR ติดต่อผ่าน REST API เท่านั้น
- ห้ามเรียก Prisma ตรงจาก Controller
- Controllers ต้องบางและไม่รับภาระธุรกิจ
- Redis ใช้เฉพาะสำหรับ cache, rate limiting, และ queue เท่านั้น
- ไม่ใช้ Redis เป็น Source of Truth สำหรับข้อมูลหลัก
- ห้ามเพิ่ม dependency ใหม่ถ้าไม่จำเป็น
- ใช้โครงสร้าง Modular Monolith ภายใต้ `src/modules`
