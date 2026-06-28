# Runtime Rules & Coding Constraints

**Version:** 1.0.0 | **Updated:** 2026-06-29

## 1. Mandatory Context (ขั้นตอนบังคับก่อนเริ่มงาน)

อ่าน `AI-INDEX.md` → `AGENTS.md` → spec/contract ที่เกี่ยวข้องกับโดเมนงานโดยตรง
และอ่าน `.docs/AI-CHANGELOG/` เฉพาะไฟล์ของวันที่จำเป็น **ห้ามแก้ changelog โดยอัตโนมัติ**

---

## 2. Backend Rules (Node.js / Express / TypeScript)

* **Thin Controller Rule:** Controller ทำหน้าที่เพียง Validate Input ตรวจ Role และส่งต่อ Service เท่านั้น ห้ามมี Business Logic หรือเรียก Prisma ตรงจาก Controller เด็ดขาด
* **Database Access:** ทุกการ Query/Mutation ต้องผ่าน Service ที่เรียกใช้งาน Prisma Client ผ่าน instance ที่กำหนดใน `src/database/db.ts`
* **Standardized Response:** ทุก REST Endpoint ต้องห่อด้วย `ApiResponse<T>` (statusCode, success, message, data) ห้ามส่ง Raw Object ออก ยกเว้นเฉพาะ `/health`, `/metrics` หรือ file/stream ที่ระบุ reason ชัดเจน
* **Idempotency:** งานประมวลผลบิลและการยืนยัน Visitor ต้องตรวจเช็คว่า TransactionId/EventId เคยทำงานไปแล้วหรือยัง ก่อนเริ่มกระบวนการ
* **OCR Timeout Handler:** การเรียกใช้งาน OCR API ภายนอกต้องกำหนด Timeout และมี Fallback handler อยู่เสมอ เพื่อให้ระบบยังรับสลิปได้แม้ OCR ล่มชั่วคราว
* **Logs:** ทุก Log ที่เกี่ยวกับ flow ค่าบิล, การเข้าออกผู้ติดต่อ หรือการแจ้งซ่อม ต้องมี `CorrelationId`, `UserId`, `RoomId` แนบเสมอ เพื่อให้ตรวจสอบย้อนหลังได้ง่าย

---

## 3. Database Evolution (กฎการปรับ Schema)

* ไฟล์ `prisma/migrations/` ถือเป็นประวัติการเปลี่ยนแปลงโครงสร้าง DB ที่ห้ามลบหรือยุบรวม
* **ห้าม squash migration** ที่เคยถูกนำขึ้น Production โดยไม่ทำ Compatibility Bridge ก่อน
* ใช้ฟิลด์ `version` ในโมเดลสำคัญ (เช่น `User`, `Bill`) เพื่อทำ OCC (Optimistic Concurrency Control) ป้องกันสถานะชนกัน
* การเพิ่ม index บน `IdCardVerification.citizenIdHash` และ `User.email` เป็นข้อบังคับ ห้ามถอดออก

---

## 4. React / Vite Frontend Rules

* ใช้ **Axios** สำหรับ HTTP ทุก call ผ่าน instance กลางที่ `frontend/src/services/`
* แยก Logic ออกจาก Component ให้เป็น **Custom Hooks** เสมอ
* ห้าม nested `.then()` ซ้อนกัน ใช้ `async/await` หรือ `Promise.all()` แทน
* ทุก long-lived subscription (Socket.IO) ต้อง cleanup ใน `useEffect` return เสมอ:
  ```typescript
  useEffect(() => {
    socket.on("billStatusUpdated", handler);
    return () => socket.off("billStatusUpdated", handler);
  }, []);
  ```
* **ห้ามเก็บ JWT Token ใน localStorage** ให้เก็บใน httpOnly Cookie สำหรับหน้าแดชบอร์ดแอดมิน
* แสดง Loading / Empty / Error state แยกกันชัดเจนทุก Component ที่มีการ fetch ข้อมูล
* 401 ต้อง redirect ไปหน้า Login ทันที และ Clear state ทั้งหมดก่อน

---

## 5. Redis Rules

Redis เป็นเพียง **Operational Cache** ไม่ใช่ Source of Truth:

| อนุญาต ✅ | ห้ามเด็ดขาด ❌ |
| :--- | :--- |
| Rate limit counter (`rl:auth:login:*`) | สถานะบิลสุดท้ายของนักศึกษา |
| OCR job lock ป้องกัน Double Submit | ประวัติการสแกนบัตรประชาชน |
| Visitor session โดยมี TTL สั้น | งานแจ้งซ่อมและสถานะการแก้ไข |
| Heartbeat / Online status ชั่วคราว | ข้อมูลสิทธิ์เช่าห้องพัก |

---

## 6. Tests Rules

* ไฟล์ Test ทั้งหมดต้องอยู่ภายใต้โฟลเดอร์ `tests/` เท่านั้น ห้ามสร้างโฟลเดอร์ `__tests__/` หรือ `*.test.ts` ปะปนใน Source Module
* Load/Stress Test logs ต้องเก็บใน `tests/load/logs/YYYY-MM-DD/` ตามชื่อมาตรฐาน `stats.csv`, `run.log`, `final_report.md`
* Integration tests ควร hermetic และทดสอบผ่าน Docker container จริง ไม่จำลอง DB

---

## 7. Scope & Secrets

* แก้เฉพาะ task ที่ได้รับมอบหมาย ห้าม revert งานของผู้ใช้
* ห้าม commit ค่า Secrets, JWT Secret, Connection Strings ลง git โดยใช้ `.env` เท่านั้น
* ใช้ `npm` เท่านั้น ห้ามเปลี่ยน Package Manager
* ใช้ TypeScript เท่านั้น ห้ามเปลี่ยนเป็น JavaScript ดิบ
