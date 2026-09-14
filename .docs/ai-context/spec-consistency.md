# ⚖️ Data Consistency, State Authorities & Tracing Specs

**Version:** 1.0.0 | **Updated:** 2026-06-29

---

## 1. ขอบเขตสิทธิ์การเปลี่ยนสถานะ (State Transition Authority Rules)

เพื่อตัดปัญหา Multiple Writers Problem (เลเยอร์โค้ดแย่งกันเขียนสถานะมั่ว) ระบบล็อกสิทธิ์ให้เฉพาะชิ้นส่วนดังนี้:

### Billing States
| สถานะ | ผู้มีสิทธิ์เขียน (Authority) |
| :--- | :--- |
| `UNPAID` | `BillingService` (สร้างบิลอัตโนมัติ) |
| `VERIFYING` | `BillingService` (เมื่อผู้เช่า upload สลิป) |
| `PAID` | `OcrService` (เมื่อ OCR ยืนยันสลิปสำเร็จ) |
| `FAILED` | `OcrService` (เมื่อ OCR ตรวจสอบไม่ผ่าน) |
| `OVERDUE` | `BillingWorker` (Background job ตรวจเวลา) |

### Visitor States
| สถานะ | ผู้มีสิทธิ์เขียน (Authority) |
| :--- | :--- |
| `REGISTERED` | `VisitorService` (REST API ขาเข้า) |
| `VERIFYING` | `VisitorService` (เมื่อสแกนบัตร) |
| `APPROVED` / `REJECTED` | `FaceVerificationService` (หลังตรวจใบหน้า) |
| `CHECKED_IN` | `AccessControlService` (สแกนคีย์การ์ดเข้าตึก) + **Redis Lock** |
| `CHECKED_OUT` | `AccessControlService` (สแกนออก) |
| `EXPIRED` | `VisitorWorker` (Background job ตรวจเวลา) |

### Maintenance States
| สถานะ | ผู้มีสิทธิ์เขียน (Authority) |
| :--- | :--- |
| `PENDING` | `MaintenanceService` (REST API ขาเข้า) |
| `APPROVED` / `CANCELLED` | `MaintenanceService` (Admin Action) |
| `IN_PROGRESS` | `MaintenanceService` (ช่างกด Start) |
| `RESOLVED` | `MaintenanceService` (ช่างกด Done) |
| `CLOSED` | `MaintenanceService` (ผู้เช่ายืนยัน) |

---

## 2. ระบบป้องกันการทำธุรกรรมซ้ำ (Distributed Idempotency)

* **Slip Hash Check:** ก่อนเปลี่ยนบิลเป็น `VERIFYING` ต้องตรวจ Hash ของสลิปกับตาราง `Transaction` หากพบซ้ำให้ reject ทันที ห้ามส่ง OCR ซ้ำ
* **Prisma Concurrency Guard:** ใช้ฟิลด์ `version` ใน Model สำคัญ (User, Bill) ในการเช็ค OCC:
  ```typescript
  await prisma.bill.update({
    where: { id: billId, version: currentVersion },
    data: { status: "PAID", version: { increment: 1 } }
  })
  // ถ้า version ไม่ตรง Prisma จะ throw P2025 → ให้ catch และ retry
  ```
* **Redis Distributed Lock:** การเปลี่ยนสถานะ APPROVED → CHECKED_IN ต้องมี Redis Lock บน `visitorId` ก่อนเสมอ ป้องกันสแกนซ้ำพร้อมกัน

---

## 3. Tracing & Log Correlation

ทุก log ของ flow สำคัญต้องแนบ context เหล่านี้:

| Context Key | ที่มา | ตัวอย่าง |
| :--- | :--- | :--- |
| `CorrelationId` | Request Header หรือ UUID ที่สร้างใหม่ | `x-correlation-id: uuid-v4` |
| `UserId` | จาก JWT Payload | `userId: 42` |
| `RoomId` | จาก params หรือ DB | `roomId: "402"` |

```typescript
// ตัวอย่าง log pattern (pino)
logger.info({ correlationId, userId, roomId, event: "BILL_VERIFYING_STARTED" }, "Sending slip to OCR API");
```

---

## 4. Broadcast Ordering (กฎลำดับการ Broadcast)

**ทุก state change ต้อง persist ใน PostgreSQL ก่อน** แล้วจึง broadcast ผ่าน Socket.IO ห้ามส่ง event ก่อน save สำเร็จ เพื่อป้องกัน phantom state บนหน้าจอผู้ใช้

---

## 5. User Registration & Concurrency Guard (การป้องกัน Race Condition)

เพื่อรับมือกับเหตุการณ์ที่มีผู้ใช้กดสมัครสมาชิก (`POST /api/auth/register`) ด้วย Email หรือ Username เดียวกันพร้อมกันในระดับเสี้ยววินาที ($t=0$):

1. **Prisma Unique Constraint Handling (P2002 Guard):**
   - ใน `AuthService.register` เมื่อเกิดการแย่ง Insert ข้อมูลที่ชน Unique Index (`email`, `username`) ใน PostgreSQL พร้อมกัน ให้ดักจับ Prisma Error code `P2002` เสมอ
   - แปลง Error `P2002` เป็น `AppError('อีเมลหรือชื่อผู้ใช้นี้ถูกใช้งานแล้ว', 400)` ทันที **ห้ามปล่อยให้หลุดไปเป็น HTTP 500 Internal Server Error**
2. **Bcrypt Threadpool Optimization:**
   - การแฮชรหัสผ่าน `bcrypt.hash(password, 10)` เป็นงานที่ใช้ Libuv C++ Threadpool
   - ระบบกำหนด `UV_THREADPOOL_SIZE=64` ใน Container Environment เพื่อป้องกัน Threadpool Queue Saturation เมื่อมีคำขอเข้ามาพร้อมกันหลายสิบคำขอ
3. **Multi-Worker Horizontal Scaling:**
   - รัน Backend Service อย่างน้อย 2 Replicas หลัง Nginx Reverse Proxy (Round-Robin) เพื่อให้ใช้ประโยชน์จาก CPU Multi-Core ได้อย่างเต็มที่ รองรับ Throughput ได้มากกว่า 340+ RPS
4. **Proxy-Aware Rate Limiting:**
   - Rate Limiter ของ Register ต้องดึง Client IP จาก `X-Forwarded-For` ตัวซ้ายสุด (Original Client) ผ่าน `keyGenerator` เพื่อให้การจำกัดสิทธิ์ต่อ IP ถูกต้องแม่นยำแม้รันหลัง Nginx Reverse Proxy

