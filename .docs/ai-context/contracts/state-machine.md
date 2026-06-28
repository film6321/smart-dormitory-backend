# Smart Dormitory State Machines Contracts

เอกสารกำหนดสถานะและกฎการเลื่อนเปลี่ยนสถานะ (State Transitions) สำหรับโดเมนหลักในระบบหอพักอัจฉริยะ

---

## 1. Billing States (สถานะใบแจ้งหนี้/ค่าเช่า)

### 1.1 States
* `UNPAID` — ใบแจ้งหนี้ถูกสร้าง รอชำระเงิน
* `VERIFYING` — ผู้เช่าอัปโหลดสลิป อยู่ระหว่างตรวจด้วย OCR
* `PAID` — ตรวจสอบสลิปผ่าน ยอดชำระตรง
* `OVERDUE` — เลยกำหนดชำระ ยังไม่ดำเนินการ
* `FAILED` — OCR ตรวจสอบไม่ผ่าน (ยอดไม่ตรง / สลิปซ้ำ / QR เสียหาย)

### 1.2 Valid Transitions
```text
UNPAID    -> VERIFYING | OVERDUE
OVERDUE   -> VERIFYING
VERIFYING -> PAID | FAILED
FAILED    -> UNPAID | OVERDUE
```

### 1.3 Semantics
* **Idempotency:** ตรวจ Hash สลิปก่อนส่ง OCR — ห้าม double submit
* **OCR Fallback:** ถ้า OCR timeout → ค้างสถานะ `VERIFYING` + `reason: "OCR_TIMEOUT_WAIT_MANUAL_REVIEW"`
* **OCC:** อัปเดตต้องเช็ค `version` field เสมอ

---

## 2. Visitor Access States (สถานะผู้มาเยือน)

### 2.1 States
* `REGISTERED` — ลงทะเบียนนัดล่วงหน้า
* `VERIFYING` — สแกนบัตรประชาชน + รอยืนยันใบหน้า
* `APPROVED` — เอกสารถูกต้อง ใบหน้าผ่าน
* `REJECTED` — สแกนไม่ผ่านหรือติด Blacklist
* `CHECKED_IN` — ผ่านประตูเข้าอาคารเรียบร้อย
* `CHECKED_OUT` — ออกจากอาคารเรียบร้อย
* `EXPIRED` — เกินเวลานัดหรือเกินกำหนดสูงสุด

### 2.2 Valid Transitions
```text
REGISTERED -> VERIFYING | EXPIRED
VERIFYING  -> APPROVED | REJECTED
APPROVED   -> CHECKED_IN
REJECTED   -> REGISTERED | EXPIRED
CHECKED_IN -> CHECKED_OUT | EXPIRED
```

### 2.3 Semantics
* **Redis Lock:** APPROVED → CHECKED_IN ต้องมี Distributed Lock บน `visitorId` (TTL 5s)
* **Expired Alert:** ถ้า CHECKED_IN เกินเวลา → สร้าง Log แจ้ง Admin ทันที

---

## 3. Maintenance Job States (ใบสั่งซ่อมแซม)

### 3.1 States
* `PENDING` — คำขอซ่อมใหม่ รอ Admin พิจารณา
* `APPROVED` — อนุมัติแล้ว กำลังมอบหมายช่าง
* `IN_PROGRESS` — ช่างเริ่มทำงาน
* `RESOLVED` — ซ่อมเสร็จ รอผู้เช่ายืนยัน
* `CANCELLED` — ยกเลิก (ก่อนช่างเริ่ม หรือ Admin ปฏิเสธ)
* `CLOSED` — ผู้เช่ายืนยันปิดงานถาวร

### 3.2 Valid Transitions
```text
PENDING     -> APPROVED | CANCELLED
APPROVED    -> IN_PROGRESS | CANCELLED
IN_PROGRESS -> RESOLVED | CANCELLED
RESOLVED    -> CLOSED
```

### 3.3 Semantics
* Terminal states: `CLOSED`, `CANCELLED` — ไม่มี outgoing transition
* เมื่อ `RESOLVED` → ส่ง Socket.IO แจ้งผู้เช่าทันที

---

## 4. State Consistency Rules

1. **Database Authority:** สถานะสุดท้ายยึดจาก PostgreSQL ผ่าน Prisma เท่านั้น — ห้ามยึด Redis Cache หรือ Local Storage
2. **No Skip Transitions:** ห้ามข้าม step เช่น UNPAID → PAID โดยไม่ผ่าน VERIFYING
3. **Persist before Broadcast:** บันทึก DB สำเร็จก่อน broadcast Socket.IO เสมอ
