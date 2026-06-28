---
module: Error Handling & Schema Versioning Policy
status: Active Operational Policy
---

# 🔄 Error Handling & Schema Versioning Policy

## 1. Schema Versioning Policy (นโยบายการจัดการเวอร์ชัน Event Payload)

เพื่อรองรับการขยายตัวโดยไม่ทำให้ระบบเดิมพัง (Backward Compatibility):

* ทุก Event Payload ที่ส่งผ่าน Socket.IO ต้องมีฟิลด์ `"schemaVersion": 1` กำกับอยู่
* **Non-breaking changes** (เพิ่ม optional field): ห้ามปรับเลขเวอร์ชัน
* **Breaking changes** (ลบ/เปลี่ยนชนิด field หลัก): บังคับขยับ `schemaVersion` ขึ้น 1 และต้องรักษา Backward Compatibility กับเวอร์ชันก่อนหน้า 1 เวอร์ชัน

---

## 2. OCR External API — Error Handling Policy

เนื่องจาก OCR และ Face Verification เป็น External API มีโอกาสล้มเหลวได้:

| สถานการณ์ | พฤติกรรมที่กำหนด |
| :--- | :--- |
| OCR Timeout (> 30s) | ค้างสถานะ `VERIFYING` + บันทึก `reason: "OCR_TIMEOUT"` + แจ้ง Admin |
| OCR 5xx Error | Retry 3 ครั้งด้วย Exponential Backoff (2s → 4s → 8s) แล้ว fallback manual |
| Face Verification Timeout | ค้างสถานะ `VERIFYING` + บันทึก `reason: "FACE_API_TIMEOUT"` |
| ข้อมูลสลิปซ้ำ (Duplicate Hash) | Reject ทันทีด้วย HTTP 409 Conflict ห้าม re-submit OCR |

---

## 3. Retry & Backoff Rules

* **Max Retry:** พยายามซ้ำสูงสุด **3 ครั้ง** สำหรับการเรียก OCR/Face Verification API
* **Retry Backoff:** Exponential Backoff: 2s → 4s → 8s
* **หลังครบ 3 ครั้ง:** เปลี่ยนสถานะเป็น `FAILED` หรือค้างสำหรับ Manual Review และแจ้ง Admin ผ่าน Log

---

## 4. Dead Job Handling (Background Worker ล้มเหลว)

หากมีงาน Background (เช่น BillingWorker ตรวจสอบบิลเกินกำหนด, VisitorWorker ตรวจ Expired) ล้มเหลว:

* ต้องบันทึก Error Log พร้อม `CorrelationId`, `UserId`, `RoomId`
* ต้องไม่ทำให้ Worker หยุดทำงานทั้งหมด ใช้ try/catch ครอบทุก iteration
* ห้ามแก้ข้อมูลใน Database โดยไม่มีการ verify state ก่อน เพื่อป้องกัน stale write
