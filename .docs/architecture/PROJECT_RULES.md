# PROJECT_RULES

## กฎของโปรเจกต์

- ใช้ TypeScript ทุกไฟล์
- ห้ามเขียน Business Logic ใน Controller
- ทุก Module ต้องมี Controller, Service และ Repository
- ใช้ Prisma เป็น ORM เท่านั้น
- Response ต้องอยู่ในรูปแบบเดียวกัน
- Face Recognition และ OCR ติดต่อผ่าน REST API เท่านั้น
- ห้ามเรียก Prisma ตรงจาก Controller
- Controllers ต้องบางและไม่รับภาระธุรกิจ
- Redis ใช้เฉพาะสำหรับ cache, rate limiting, และ queue เท่านั้น
- ไม่ใช้ Redis เป็น Source of Truth สำหรับข้อมูลหลัก
- ห้ามเพิ่ม dependency ใหม่ถ้าไม่จำเป็น
- ใช้โครงสร้าง Modular Monolith ภายใต้ `src/modules`
