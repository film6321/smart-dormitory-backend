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
- รายการ `CLOSED` และ `CANCELLED` ดูประวัติได้เท่านั้น ห้ามแก้สถานะ ข้อมูล/หมายเหตุ หรือลบรายการ; หากต้องแจ้งซ่อมอีกให้สร้างรายการใหม่. การล้างข้อมูลส่วนบุคคลหลังย้ายออกตามนโยบาย retention ในหัวข้อ 5 เป็นงานแยกจาก Endpoint แจ้งซ่อมทั่วไป.
- เมื่อ `RESOLVED` → ส่ง Socket.IO แจ้งผู้เช่าทันที

---

## 4. State Consistency Rules

1. **Database Authority:** สถานะสุดท้ายยึดจาก PostgreSQL ผ่าน Prisma เท่านั้น — ห้ามยึด Redis Cache หรือ Local Storage
2. **No Skip Transitions:** ห้ามข้าม step เช่น UNPAID → PAID โดยไม่ผ่าน VERIFYING
3. **Persist before Broadcast:** บันทึก DB สำเร็จก่อน broadcast Socket.IO เสมอ

## 5. Tenant lifecycle and account retention

- `PENDING` → `APPROVED` / `REJECTED`; approved/current stays use the Admin action **บันทึกย้ายออก** → `INACTIVE`.
- Move-out requires no unpaid bills, records `checkOutDate`, sets `isActive=false`, disconnects the room and recalculates occupancy in the transaction. It keeps the account and stay history.
- An `INACTIVE` stay cannot be reactivated or assigned a room. Admin must clear the old stay before a new application can be accepted; never overwrite its checkout history.
- Delete personal information only for `INACTIVE` / `REJECTED` records without a room, unsettled bills, unfinished repairs, active visitors, pending payments/OCR or batches shared with another resident/payer. Shared batches require separate review and are not erased by this flow.
- Removal clears profile, contract, documents, face enrollment and associated personal records. Paid bills, payments, payment batches, user transactions and the Tenant row are physically deleted under the user-approved policy of 2026-10-11. This intentionally removes their contribution to historical financial totals. Legacy roomless `ARCHIVED` rows are eligible for guarded cleanup. `User` remains after manual tenant deletion. Archived owners do not appear in the resident list.
- Automatic account deletion runs only for non-ADMIN accounts without a current stay or unsettled work. One calendar year is measured from the last **successful login**; never-logged-in accounts use `createdAt`. Socket, heartbeat and ordinary API activity do not extend this period. No advance notice or grace period is sent, as requested.


## Housing draft and credit lifecycle (2026-10-11)

`HousingApplicationDraft.OPEN` persists form progress and selected room before submission. Room changes are allowed while no transfer is pending; credit is the sum of that owner's PAID transfers. The required amount is monthly room rent plus the configured security deposit (default: one month's rent), collected as one combined payment; the UI shows both components and the total. Equal credit/total permits submission; a shortfall requires only the difference; excess requires separate handling. Rejection restores the draft and retains the combined paid credit and original payment evidence for reuse. A pending bank response prevents new transfers and room changes while allowing the original slip to be rechecked after cooldown. Successful application submission sets `SUBMITTED` and binds every transfer to the single Tenant in the same transaction. After submission, room changes use the existing Admin flow. Drafts do not reserve a room or create revenue by themselves. Admin confirmation timestamps drive recorded deposit revenue. Guarded removal purges the draft, transfers and resident data while retaining User.


## Monthly room-bill issuance (2026-10-11)

Room/month generation is atomic and cannot append another set while any bill for that room/period remains. A stable YYYY-MM field and unique tenant/room/period constraint protect persisted records. Issuance counts approved active residents only, rechecks them under User/Tenant/Room locks, and rejects concurrent membership changes. Satang remainder distribution preserves each component and the grand total. Existing bill payment transitions and guarded paid-bill deletion are unchanged.

### Reception visit progress (12 Oct 2026)
Current reception UI now records WAITING -> ADMITTED -> COMPLETED as a projection of VisitorLog DOOR_ACCESS_GRANTED and VISIT_COMPLETED, not as new VisitorStatus values. Visitor.status remains REGISTERED; cancelled/expired requests cannot grant access. Entry is allowed only before expiresAt, completion remains possible afterwards. A manual record includes the authenticated Admin identity and is not a physical door acknowledgement. Registration expiry ignores admitted/completed requests. Cancellation and entry serialize on the same Visitor row, and cancellation after entry is rejected. Legacy biometric statuses/transitions remain separate.

### Maintenance confirmation implementation (2026-10-12)
The resident can confirm an owned RESOLVED ticket through POST /api/maintenance/:id/confirm. A row lock serializes confirmation; repeated owner confirmation returns the existing CLOSED result. The ADMIN status endpoint remains for staff close-out compatibility, so CLOSED alone does not prove resident confirmation. No reopen transition is added. Existing Admin corrections APPROVED → PENDING and IN_PROGRESS → APPROVED are retained.


### Current flow safeguards (13 Oct 2026)

Housing application requires complete personal identity plus explicit contract consent on every request; no birthDate omission bypass. Contract terms are an Admin-owned server snapshot, independent of payment UI; stale terms return 409 and retain paid credit. Draft → SUBMITTED and Tenant creation/transfer binding remain atomic.

Logout/password changes increment User.authSessionVersion and cancel every prior REST/Socket session. This field must not be used for room/data OCC. Register always creates STUDENT and validates input before business work. Two-factor authentication is not an implemented state.

Maintenance attachment states are staged (owner + 24h expiry) → consumed with successful ticket, or expired → file removal after reference checks. Failed requests do not create a ticket; owner purge queues attachments for cleanup. Existing ticket transitions are preserved.

Visitor age derives from birthDate when supplied; age is manual only if birthDate is absent. The status/stage distinction in reception is intentional and already reflected in Admin labels/counts. Hardware/SMS/provider acknowledgements are outside current QA scope.
