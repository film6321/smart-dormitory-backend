# บทเรียนการพัฒนาซอฟต์แวร์ระดับองค์กร (Enterprise Software Development Lessons)

เอกสารนี้รวบรวมเทคนิค โครงสร้าง และมาตรฐานที่ใช้ในโปรเจกต์ **Smart-Dormitory-Management-System** เน้นการออกแบบที่รองรับการขยายตัว (Scalability) ทนทานต่อข้อผิดพลาด (Resiliency) และปลอดภัย (OWASP)

---

## บทที่ 1: Modular Architecture (ทำไมถึงแยกโมดูล)

**เป้าหมาย:** จัดกลุ่มโค้ดตาม "โดเมนธุรกิจ" แทนการจัดตาม "ชนิดไฟล์" ลดความซับซ้อนการแก้ไขข้าม Layer

### ❌ ตัวอย่างที่ไม่ดี (จัดตามประเภทไฟล์)
```text
/controllers
  - billing.controller.ts
  - visitor.controller.ts
/services
  - billing.service.ts
  - visitor.service.ts
```

### ✅ ตัวอย่างที่ดีสำหรับหอพัก (Modular - รูปแบบที่ใช้)
```text
src/modules/
  billing/
    billing.controller.ts   ← รับ Request (Transport only)
    billing.service.ts      ← Business Logic
    billing.routes.ts       ← Route registration
  visitor/
    visitor.controller.ts
    visitor.service.ts
    visitor.routes.ts
```

---

## บทที่ 2: Thin Controller Pattern (Controller ต้องบาง)

**ปัญหา:** Controller ที่อ้วน (Fat Controller) มี Business Logic ฝังอยู่ ทำให้ทดสอบ และบำรุงรักษายาก

### ❌ Fat Controller (ห้ามทำ)
```typescript
// billing.controller.ts
async uploadSlip(req: Request, res: Response) {
  const file = req.file;
  // ❌ เรียก Prisma ตรง
  const bill = await prisma.bill.findUnique({ where: { id: req.params.id } });
  // ❌ เรียก OCR ใน Controller
  const ocrResult = await axios.post("http://ocr-api/verify", { image: file });
  if (ocrResult.data.valid) {
    await prisma.bill.update({ where: { id: bill.id }, data: { status: "PAID" } });
  }
  res.json({ success: true });
}
```

### ✅ Thin Controller (มาตรฐานที่ใช้)
```typescript
// billing.controller.ts — Transport layer เท่านั้น
async uploadSlip(req: Request, res: Response) {
  const result = await BillingService.verifySlip(req.params.id, req.file);
  res.status(result.statusCode).json(result);
}
```

---

## บทที่ 3: Standardized API Response Wrapper

**ปัญหา:** ถ้าแต่ละ Endpoint ส่ง JSON รูปแบบต่างกัน Frontend ต้องเขียน parsing logic หลายแบบ

### ✅ ใช้ ApiResponse<T> เสมอ
```typescript
// src/shared/api-response.ts
export function createResponse<T>(
  statusCode: number,
  message: string,
  data?: T
): ApiResponse<T> {
  return { statusCode, success: statusCode < 400, message, data };
}

// ตัวอย่างการใช้งาน
res.status(200).json(createResponse(200, "อัปโหลดสลิปสำเร็จ", { billId, status: "VERIFYING" }));
```

---

## บทที่ 4: Redis Rate Limiting (ป้องกัน Brute Force / Spam)

**ปัญหา:** OCR Upload ถ้าไม่จำกัด อาจถูก Spam หรือทำ DB ล่ม

### ✅ Rate Limiting ด้วย Redis (มาตรฐานของโปรเจกต์)
```typescript
// ocr.routes.ts
const verifyIdCardLimiter = rateLimit({
  store: createRateLimitStore("rl:ocr:verify-id-card:"),
  windowMs: 60 * 1000,
  max: 10,
  message: { statusCode: 429, message: "Too many OCR requests, please try again later" },
});

router.post("/verify-id-card", verifyIdCardLimiter, uploadIdCardImage, OcrController.verifyIdCard);
```

---

## บทที่ 5: Optimistic Concurrency Control (ป้องกัน Stale Write)

**ปัญหา:** ถ้า Admin 2 คน กด Approve งานซ่อมชิ้นเดียวกันพร้อมกัน ข้อมูลอาจเสียหาย

### ✅ ใช้ version field ใน Prisma
```typescript
// maintenance.service.ts
const updated = await prisma.maintenanceTicket.updateMany({
  where: { id: ticketId, version: currentVersion, status: "PENDING" },
  data: { status: "APPROVED", version: { increment: 1 } }
});

if (updated.count === 0) {
  throw new AppError("Conflict: ticket was modified by another process", 409);
}
```

---

## บทที่ 6: OCR Timeout & Fallback (กฎระบบ External API)

**ปัญหา:** OCR API ภายนอกอาจล่มหรือตอบช้า ต้องไม่ทำให้ระบบค้าง

### ✅ Timeout + Fallback Pattern
```typescript
// ocr.service.ts
export async function callOcrApi(imageBuffer: Buffer): Promise<OcrResult> {
  try {
    const response = await axios.post(OCR_API_URL, imageBuffer, {
      timeout: 30_000, // 30 วินาที
      headers: { "Content-Type": "application/octet-stream" }
    });
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error) && error.code === "ECONNABORTED") {
      // Fallback: ค้างสถานะไว้ให้ Admin ตรวจสอบ Manual
      throw new AppError("OCR_TIMEOUT", 503);
    }
    throw error;
  }
}
```

---

## บทที่ 7: Distributed Lock ด้วย Redis (ป้องกัน Double Submit)

**ปัญหา:** ถ้ากล้อง 2 ตัวสแกนผู้ติดต่อคนเดียวกันพร้อมกัน อาจเปิดประตูให้ 2 ครั้ง

### ✅ Redis Lock ก่อนดำเนินการ
```typescript
// visitor.service.ts
const lockKey = `lock:visitor:checkin:${visitorId}`;
const acquired = await redis.set(lockKey, "1", "EX", 5, "NX"); // TTL 5s

if (!acquired) {
  throw new AppError("Concurrent checkin detected, please try again", 409);
}

try {
  // ดำเนินการ CHECKED_IN
} finally {
  await redis.del(lockKey); // ปล่อย lock เสมอ
}
```

---

## บทที่ 8: Trace Correlation (ติดตาม Log ข้าม Flow)

**ปัญหา:** เมื่อ Billing Flow มีหลาย step การหา Log ที่เกี่ยวกับ Request เดิมทำได้ยาก

### ✅ ใช้ CorrelationId ใน Log ทุกตัว (pino)
```typescript
// middleware/correlationId.ts
app.use((req, res, next) => {
  req.correlationId = req.headers["x-correlation-id"] as string || uuidv4();
  res.setHeader("x-correlation-id", req.correlationId);
  next();
});

// ใน service
logger.info({ correlationId, userId, roomId, event: "BILL_VERIFYING_STARTED" },
  "Sending slip to OCR API");
```

---

## บทที่ 9: Background Workers (งานเบื้องหลังไม่รบกวน API)

**ปัญหา:** การตรวจสอบบิลเกินกำหนดทุกวัน ถ้ารันใน HTTP Request จะทำให้ช้า

### ✅ Worker Pattern ใน Node.js
```typescript
// src/workers/billing-worker.ts
export async function startBillingWorker() {
  setInterval(async () => {
    try {
      const overdueBills = await prisma.bill.findMany({
        where: { status: "UNPAID", dueDate: { lt: new Date() } }
      });
      for (const bill of overdueBills) {
        await prisma.bill.update({
          where: { id: bill.id },
          data: { status: "OVERDUE" }
        });
      }
    } catch (error) {
      logger.error({ error }, "BillingWorker iteration failed");
      // ไม่ throw → Worker ยังทำงานต่อ
    }
  }, 60 * 60 * 1000); // รันทุก 1 ชั่วโมง
}
```

---

## บทที่ 10: Memory Leak Prevention (Frontend React)

**ปัญหา:** Socket.IO event listener ที่ไม่ถูก cleanup จะสะสมไปเรื่อยๆ ทำให้ Browser ช้า

### ✅ Cleanup ใน useEffect
```typescript
useEffect(() => {
  const handleBillUpdate = (data: BillStatusPayload) => {
    setBillStatus(data.status);
  };

  socket.on("billStatusUpdated", handleBillUpdate);

  // ✅ cleanup เสมอ
  return () => {
    socket.off("billStatusUpdated", handleBillUpdate);
  };
}, []);
```

---

## บทสรุป

การพัฒนาระบบหอพักอัจฉริยะระดับ Production ต้องคำนึงถึง:
1. **Scalability:** แยกโมดูล, Worker สำหรับงานเบื้องหลัง
2. **Resiliency:** OCR Timeout Fallback, Redis Lock, OCC
3. **Security:** Rate Limiting, JWT, ห้าม expose port
4. **Maintainability:** Thin Controller, Modular Architecture, ไม่มี Code Bloat
5. **Observability:** CorrelationId ทุก Log, Prometheus/Grafana Dashboard
