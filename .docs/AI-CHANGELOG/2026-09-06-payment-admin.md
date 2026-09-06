# Changelog 2026-09-06 — Payment Admin Safety

## ✅ สิ่งที่ทำเสร็จ

- เพิ่ม guard ห้ามลบบิลที่มีประวัติ `Payment` หรือ `PaymentBatchItem`
- เปลี่ยนผลลบจาก Prisma foreign-key error เป็น `409 Conflict`
- เอาปุ่มยืนยัน/ยกเลิกชำระเงินด้วยมือออกจากหน้า Admin
- เพิ่ม private slip storage สำหรับ PaymentBatch
- เพิ่มฟิลด์ `slipPath`, `slipAmount`, `transferAt`
- เพิ่ม Admin-only payment detail และ slip endpoints
- แสดงรูปสลิป, ยอดจากสลิป, วันเวลาโอน, เลขอ้างอิง และ provider response ใน Admin modal

## 📋 สิ่งที่ยังค้างอยู่

- สลิปของ legacy single-bill Payment ที่อัปโหลดก่อน flow PaymentBatch ยังไม่มีไฟล์ต้นฉบับย้อนหลัง
- ต้องทดสอบ upload slip จริงกับ Thunder API key ที่ใช้งานได้

## Verification

- Backend build ผ่าน
- Frontend build ผ่าน
- Frontend tests ผ่าน 2/2
- Backend tests ผ่าน 31/32; failure เดิมอยู่ที่ Face Verification mock
- Delete bill with payment history: 409
- Admin payment details: 200
- Missing private slip: 404

## Test Data Cleanup

- ลบเฉพาะข้อมูลทดสอบของบิล `#13` และ `#14`
- ลบ `PaymentBatch` ID `1–5` ที่ผูกกับบิลดังกล่าว
- ลบ `PaymentBatchItem`, `Payment` และ `Bill` ที่เกี่ยวข้อง
- ตรวจสอบหลังลบแล้วไม่พบข้อมูลเป้าหมายเหลืออยู่
