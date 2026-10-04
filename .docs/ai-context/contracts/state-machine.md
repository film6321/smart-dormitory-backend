# Smart Dormitory State Machines Contracts

เอกสารกำหนดสถานะและกฎการเลื่อนเปลี่ยนสถานะ (State Transitions) สำหรับโดเมนหลักในระบบหอพักอัจฉริยะ

---

## 1. Billing States (สถานะใบแจ้งหนี้/ค่าเช่า)

### 1.1 States

- `UNPAID` — ใบแจ้งหนี้ถูกสร้าง รอชำระเงิน
- `VERIFYING` — ผู้เช่าอัปโหลดสลิป อยู่ระหว่างตรวจด้วย OCR
- `PAID` — ตรวจสอบสลิปผ่าน ยอดชำระตรง
- `OVERDUE` — เลยกำหนดชำระ ยังไม่ดำเนินการ
- `FAILED` — OCR ตรวจสอบไม่ผ่าน (ยอดไม่ตรง / สลิปซ้ำ / QR เสียหาย)

### 1.2 Valid Transitions

```text
UNPAID    -> VERIFYING | OVERDUE
OVERDUE   -> VERIFYING
VERIFYING -> PAID | FAILED
FAILED    -> UNPAID | OVERDUE
```

### 1.3 Semantics

- **Idempotency:** ตรวจ Hash สลิปก่อนส่ง OCR — ห้าม double submit
- **OCR Fallback:** ถ้า OCR timeout → ค้างสถานะ `VERIFYING` + `reason: "OCR_TIMEOUT_WAIT_MANUAL_REVIEW"`
- **OCC:** อัปเดตต้องเช็ค `version` field เสมอ

---

## 2. Visitor Access States (สถานะผู้มาติดต่อ)

> Current flow (registration and expiry implemented; physical door integration pending): ผู้มาติดต่อส่งคำขอที่ผ่าน PDPA และข้อมูลบังคับครบ จะอยู่สถานะ REGISTERED เพื่อรอ Admin ตรวจเมื่อมาถึง ไม่มีขั้นอนุมัติใบหน้าหรือการเปลี่ยนเป็น CHECKED_IN จากการเปิดประตู การอนุญาตเข้าต้องถูกบันทึกเป็น access event แยกจากสถานะคำขอ

### 2.1 States

- REGISTERED — ส่งคำขอเข้าพบแล้ว รอ Admin ตรวจเมื่อมาถึง
- EXPIRED — ไม่มีการอนุญาตเข้าที่สำเร็จภายใน 24 ชั่วโมงหลังส่งคำขอ
- VERIFYING, APPROVED, REJECTED, CHECKED_IN, CHECKED_OUT — สถานะเดิมที่ยังอยู่ในระบบเพื่อรองรับข้อมูล/flow เก่า; ไม่ใช่ขั้นตอนของ target flow ใหม่

### 2.2 Target transition

REGISTERED -> EXPIRED

การสั่งเปิดประตูไม่เปลี่ยน Visitor status; ให้บันทึกผลการอนุญาตเข้าเป็น access event แยกต่างหาก

### 2.3 Semantics

- เวลานับอายุ 24 ชั่วโมงเริ่มเมื่อบันทึกคำขอสำเร็จ และใช้เวลาจาก PostgreSQL/server ไม่ใช้เวลาจาก Browser
- งานหมดอายุต้องเปลี่ยนสถานะใน PostgreSQL แบบทำซ้ำได้ (idempotent) และต้องไม่หมดอายุคำขอที่มี access event สำเร็จแล้ว
- การเปิดประตูไม่เปลี่ยน Visitor status เป็น CHECKED_IN; ให้เก็บผลการอนุญาตเข้า/ผลตอบรับจากอุปกรณ์เป็น access event แยกต่างหาก
- Admin ต้องตรวจชื่อผู้เช่าที่ผู้มาติดต่อแจ้งว่าตรงกับห้องของคำขอก่อนสั่งเปิดประตู
- API ดู pass/ยกเลิกจำกัดเฉพาะ Admin; ห้ามเปิดให้ผู้สมัครเรียกด้วย visitor ID เพียงอย่างเดียว
- สถานะเดิมอื่น ๆ คงไว้เพื่อข้อมูลเก่าและ migration compatibility จนกว่าจะมีแผนย้ายข้อมูล; ห้ามนำมาใช้เป็นขั้นใหม่โดยปริยาย
## 3. Maintenance Job States (ใบสั่งซ่อมแซม)

### 3.1 States

- `PENDING` — คำขอซ่อมใหม่ รอ Admin พิจารณา
- `APPROVED` — อนุมัติแล้ว กำลังมอบหมายช่าง
- `IN_PROGRESS` — ช่างเริ่มทำงาน
- `RESOLVED` — ซ่อมเสร็จ รอผู้เช่ายืนยัน
- `CANCELLED` — ยกเลิก (ก่อนช่างเริ่ม หรือ Admin ปฏิเสธ)
- `CLOSED` — ผู้เช่ายืนยันปิดงานถาวร

### 3.2 Valid Transitions

```text
PENDING     -> APPROVED | CANCELLED
APPROVED    -> IN_PROGRESS | CANCELLED
IN_PROGRESS -> RESOLVED | CANCELLED
RESOLVED    -> CLOSED
```

### 3.3 Semantics

- Terminal states: `CLOSED`, `CANCELLED` — ไม่มี outgoing transition
- `RESOLVED` แก้ไขต่อได้เฉพาะการยืนยันปิดงานเป็น `CLOSED`; ห้ามย้อนกลับ ยกเลิก หรือลบรายการที่ซ่อมเสร็จแล้ว.
- รายการ `CLOSED` และ `CANCELLED` ดูประวัติได้เท่านั้น ห้ามแก้สถานะ ข้อมูล/หมายเหตุ หรือลบรายการ; หากต้องแจ้งซ่อมอีกให้สร้างรายการใหม่.
- เมื่อ `RESOLVED` → ส่ง Socket.IO แจ้งผู้เช่าทันที

---

## 4. State Consistency Rules

1. **Database Authority:** สถานะสุดท้ายยึดจาก PostgreSQL ผ่าน Prisma เท่านั้น — ห้ามยึด Redis Cache หรือ Local Storage
2. **No Skip Transitions:** ห้ามข้าม step เช่น UNPAID → PAID โดยไม่ผ่าน VERIFYING
3. **Persist before Broadcast:** บันทึก DB สำเร็จก่อน broadcast Socket.IO เสมอ
