# ⚖️ Data Consistency, State Authorities & Tracing Specs

**Version:** 1.1.0 | **Updated:** 2026-10-13

---

## 1. ขอบเขตสิทธิ์การเปลี่ยนสถานะ (State Transition Authority Rules)

เพื่อตัดปัญหา Multiple Writers Problem (เลเยอร์โค้ดแย่งกันเขียนสถานะมั่ว) ระบบล็อกสิทธิ์ให้เฉพาะชิ้นส่วนดังนี้:

### Billing States

BillingService/PaymentBatchService claim and settle payments through the existing payment provider wrapper. OcrService owns ID-card verification and does not authorize PAID bills. Bills are generated atomically per room/month; settlement checks persisted payment evidence, ownership, amount, provider transaction uniqueness and current state. OVERDUE display alone does not prove a background worker wrote a transition: inspect the active service/worker before making that claim.

### Visitor States

VisitorService owns REGISTERED/CANCELLED/EXPIRED and reception logs; visitorExpiryWorker triggers expiry. The current flow does not require Face approval or an AccessControlService that is absent from this repository. WAITING/ADMITTED/COMPLETED derive from VisitorLog and do not overwrite Visitor.status. Entry/cancel/expiry serialize on the Visitor row. Manual reception records do not acknowledge physical door movement; legacy face statuses are outside this QA round's device/provider scope.

### Maintenance States
| สถานะ | ผู้มีสิทธิ์เขียน (Authority) |
| :--- | :--- |
| `PENDING` | `MaintenanceService` (REST API ขาเข้า) |
| `APPROVED` / `CANCELLED` | `MaintenanceService` (Admin Action) |
| `IN_PROGRESS` | `MaintenanceService` (ช่างกด Start) |
| `RESOLVED` | `MaintenanceService` (ช่างกด Done) |
| `CLOSED` | `MaintenanceService` (ผู้เช่ายืนยันงานของตนผ่าน confirm endpoint หรือ Admin ตาม route เดิม) |

---

## 2. ระบบป้องกันการทำธุรกรรมซ้ำ (Distributed Idempotency)

- Payment wrappers check slip hash/idempotency/provider transaction evidence against persisted Payment/Transaction records before committing. PostgreSQL is the source of truth; Redis locks only coordinate requests.
- User.version and HousingApplicationDraft.version provide data OCC where implemented. Bill has no generic version field; billing uses state guards, row locks and unique billingPeriod constraints. Do not invent a Prisma Bill.version query or blindly retry a financial mutation.
- User.authSessionVersion is independent of data OCC and is checked for REST/Socket auth. Logout/password reset revoke all sessions durably; Redis presence must not authorize a stale JWT.
- Contract settings updates and application snapshots share PostgreSQL advisory lock 756032; stale conditions return 409 for review, never silently change accepted terms. Academic catalog retains its separate lock 756031.
- Maintenance upload ownership/TTL is persisted in SystemSetting; consuming an attachment and saving its ticket are atomic. Expiry checks persisted ticket references before deleting a file.
- Face photo retries reuse metadata by owner + content hash under the owner lock. External forwarding may be retried; five angles are not one atomic transaction.

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

