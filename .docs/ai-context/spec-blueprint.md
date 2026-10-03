# Active Architecture Blueprint

**Version:** 1.0.0 | **Updated:** 2026-06-29

## 1. Active Stack

* **Database:** PostgreSQL 16 + Prisma ORM — Source of Truth
* **Cache & Locks:** Redis 7 สำหรับ Rate Limiting, Session Lock, Heartbeat เท่านั้น
* **Backend:** Node.js + Express.js + TypeScript
* **Realtime:** Socket.IO
* **Frontend:** React + Vite + TypeScript + Axios
* **External APIs:** OCR API (อ่านบัตรประชาชน/สลิป), Face Verification API (ยืนยันตัวตนเข้าตึก)
* **Observability:** Prometheus + Grafana (ผ่าน docker/prometheus)
* **Infrastructure:** Docker + docker-compose + Nginx

---

## 2. Event Boundaries (ขอบเขตการสื่อสาร)

ชื่อและหน้าที่ต้องไม่ปนกัน:

1. **Domain Events:** เกิดภายใน Module เดียว ส่งต่อผ่าน Service call ในโปรเซส Express
2. **Integration Events:** หากสื่อสารข้าม Service ในอนาคต บังคับใช้ชื่อ `<Domain><Action>IntegrationEvent`
3. **Telemetry Events:** Real-time ความถี่สูงผ่าน Socket.IO เช่น Log การสแกนประตูหรือกล้องวงจรปิด

---

## 3. Core Flows (กระบวนการสำคัญของระบบ)

### Bill Payment Flow
```text
ผู้เช่าส่งสลิป (Upload Image)
  → POST /api/billing/:id/upload-slip
  → OCR Service ตรวจสอบสลิป (External API)
  → Bill status: UNPAID → VERIFYING → PAID / FAILED
  → Socket.IO broadcast "billStatusUpdated" ไปยัง room:{roomNumber}
```

### Visitor Access Flow

สถานะ: ฟอร์ม/Backend validation/การหมดอายุ implement แล้ว; การสั่งประตูจริงและ access event รอข้อมูลอุปกรณ์:
ผู้มาติดต่อยินยอม PDPA
  → อัปโหลดบัตรประชาชนและตรวจ/แก้ข้อมูล OCR
  → กรอกชื่อ ที่อยู่ เลขบัตร และเลขห้องที่มีอยู่จริง (ข้อมูลบังคับ)
  → ยืนยันส่งคำขอ → บันทึก REGISTERED และแจ้ง Admin
  → Admin ค้นคำขอเมื่อผู้มาติดต่อมาถึง และให้ผู้มาติดต่อแจ้งชื่อผู้เช่าที่ต้องการพบ
  → Admin ตรวจว่าชื่อผู้เช่าตรงกับห้องในคำขอ แล้วสั่งเปิดประตูจำลองใน Monitor (ยังไม่เชื่อมฮาร์ดแวร์; response ระบุ simulated: true)
  → เมื่ออุปกรณ์ตอบยืนยัน จึงบันทึก access event แยกจากสถานะคำขอ; การเปิดประตูไม่เปลี่ยนเป็น CHECKED_IN

กรณีไม่มีเหตุการณ์อนุญาตเข้าภายใน 24 ชั่วโมงนับจากเวลาส่งคำขอ:
  → งานหมดอายุเปลี่ยน REGISTERED เป็น EXPIRED ใน PostgreSQL
  → แจ้ง Admin/ปรับรายการในหน้าประวัติให้เห็นสถานะหมดอายุ

ข้อกำหนดความปลอดภัย: API อ่าน pass/ยกเลิกจำกัดเฉพาะ Admin; การลงทะเบียนใช้ Idempotency-Key และไม่สร้าง QR ที่บรรจุข้อมูลส่วนบุคคล
### Maintenance Flow
```text
ผู้เช่าแจ้งซ่อม
  → POST /api/maintenance
  → Ticket status: PENDING → APPROVED → IN_PROGRESS → RESOLVED → CLOSED
  → Socket.IO broadcast "maintenanceStatusUpdated" ไปยัง room:{roomNumber}
```

---

## 4. Resilience Rules (กฎความทนทานของระบบ)

* **PostgreSQL เป็น final authority:** ทุก state change สำคัญต้อง persist ใน PostgreSQL ก่อน broadcast ผ่าน Socket.IO เสมอ
* **Redis eviction มี DB fallback:** หาก Redis ล่มหรือ key หมดอายุ ต้อง query PostgreSQL เพื่อดึงสถานะกลับมาได้เสมอ
* **OCR/Face API ล่ม:** ต้องมี Fallback handler ทำให้ระบบค้างสถานะ `VERIFYING` และรอ Admin กดยืนยัน Manual ได้
* **Logs:** ทุก flow ต้องมี `CorrelationId`, `UserId`, `RoomId` ใน log เมื่อมีค่า
* **ห้ามเพิ่ม stack** ที่อยู่ใน forbidden list ของ `AGENTS.md`
