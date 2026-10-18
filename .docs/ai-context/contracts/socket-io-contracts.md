# Socket.IO Real-time Contracts

**Endpoint:** `/socket.io` (WebSocket + HTTP Polling fallback)

---

## 1. Transport & Auth Rules

- **Authentication:** Client ต้องแนบ JWT ใน Handshake `auth` option:
  ```javascript
  const socket = io("http://localhost:5000", {
    auth: { token: "JWT_ACCESS_TOKEN" },
  });
  ```
- **Pure Transport Layer:** Socket.IO Handler ทำหน้าที่เพียง authenticate, validate, route — ห้ามมี Business Logic หรือ Prisma call โดยตรง
- **Persist First:** ทุก state change ต้อง save ลง PostgreSQL สำเร็จก่อน broadcast เสมอ

---

## 2. Client → Server Events

| Event Name      | Payload                            | กฎ                                  |
| :-------------- | :--------------------------------- | :---------------------------------- |
| `joinRoom`      | `{ room: "admins" \| "room:402" }` | ผูก socket เข้ากับ Room ของกลุ่ม    |
| `leaveRoom`     | `{ room: "admins" \| "room:402" }` | ออกจาก Room                         |
| `pingHeartbeat` | (none)                             | รายงานสถานะ Online ชั่วคราวใน Redis |

---

## 3. Server → Client Events

### `faceGateActivity` (Monitor)

- **Recipients:** `admins`; ส่งหลังบันทึกกิจกรรมลง PostgreSQL สำเร็จ
- Payload ใช้ `CameraScanSnapshot`: `id`, `student_code`, `direction` (`IN`/`OUT`), `confidence`, `scanned_at` และข้อมูลเสริม `student`, `device_code`, `action`
- `activity_type`: `FACE_SCAN` หรือ `DOOR`; เหตุการณ์ประตูมี `door_trigger` เป็น `MANUAL` หรือ `AUTO`
- Frontend ใช้ ID เดียวกับประวัติเพื่อระบุกิจกรรม และใช้สีเขียวสำหรับ IN/เปิด สีแดงสำหรับ OUT/ปิด
- ประตูปิดอัตโนมัติมีแจ้งเตือนและประวัติ แต่ไม่เพิ่มยอด Check-out ซึ่งนับเฉพาะการสแกนออก
- API interceptor ไม่สร้าง toast สำเร็จซ้ำสำหรับ `door-command`; Monitor รับ SSE เพื่ออัปเดตประวัติและอ่านยอดจาก API

### `visitorScanEvent`

- **Recipients:** `admins` group

```json
{
  "schemaVersion": 1,
  "visitorId": 801,
  "guestName": "นาย ขยัน มาเยือน",
  "status": "CHECKED_IN",
  "roomNumber": "305",
  "verifiedAt": "2026-06-29T13:02:15Z"
}
```

### `billStatusUpdated`

- **Recipients:** `admins` สำหรับ alias ของเหตุการณ์งานส่วนกลาง; แจ้งเตือนส่วนบุคคลใช้ `notificationAlert` ส่งตรง `user:{userId}` ไม่ส่งตามห้อง

```json
{
  "schemaVersion": 1,
  "billId": 101,
  "status": "PAID",
  "amount": 4500.0,
  "updatedAt": "2026-06-29T13:05:00Z"
}
```

### `maintenanceStatusUpdated`

- **Recipients:** `admins` สำหรับ alias ของเหตุการณ์งานส่วนกลาง; ไม่ใช้ห้องร่วมเพื่อส่งสถานะส่วนบุคคล

```json
{
  "schemaVersion": 1,
  "ticketId": 501,
  "status": "IN_PROGRESS",
  "note": "ช่างกำลังเดินทาง",
  "updatedAt": "2026-06-29T13:06:30Z"
}
```

### `notificationAlert`

- **Recipients:** `user:{userId}` เมื่อมีเจ้าของบัญชี; `admins` เฉพาะเมื่อทั้ง userId และ tenantId ว่าง หาก legacy record มีเพียง tenantId จะไม่ broadcast และให้ REST ตรวจเจ้าของ
- **Purpose:** แจ้งเตือนในแอปหลังบันทึก Notification ลง PostgreSQL สำเร็จ

```json
{
  "schemaVersion": 1,
  "id": 901,
  "type": "RENT_OVERDUE",
  "channel": "SMS",
  "status": "PENDING",
  "payload": "{\"message\":\"Bill 101 is overdue\"}",
  "createdAt": "2026-09-09T01:00:00Z"
}
```

---

## 4. Room Groups

| Room                | Principals          | วัตถุประสงค์                              |
| :------------------ | :------------------ | :---------------------------------------- |
| `admins`            | ADMIN role          | รับ Access Log, สแกนกล้อง, สถานะผู้ติดต่อ |
| `room:{roomNumber}` | STUDENT เจ้าของห้อง | รับอัปเดตบิลและข่าวซ่อมของตัวเอง          |

---

## 5. Naming Rules

- Event names ใช้ `camelCase` เสมอ
- ห้าม rename event โดยไม่อัปเดต contract นี้และ client ทุกตัวพร้อมกัน
- เพิ่ม field ใหม่ (optional) ได้โดยไม่ต้องเพิ่ม `schemaVersion`
- ลบหรือเปลี่ยนชนิด field หลัก → บังคับเพิ่ม `schemaVersion` ขึ้น 1

---

## 6. Frontend Teardown (Memory Leak Prevention)

```typescript
// ✅ ต้องมี cleanup ทุกครั้งใน useEffect
useEffect(() => {
  socket.on("billStatusUpdated", handleBillUpdate);
  socket.on("maintenanceStatusUpdated", handleMaintenanceUpdate);

  return () => {
    socket.off("billStatusUpdated", handleBillUpdate);
    socket.off("maintenanceStatusUpdated", handleMaintenanceUpdate);
  };
}, []);
```

- ห้าม register event ซ้ำในจังหวะ reconnect
- ตรวจ `socket.connected` ก่อน emit ทุกครั้ง


### Resident status reconciliation — 2026-10-18

publishResidentStatus sends tenantStatusUpdated { tenantId, status } only to authenticated user:<ownerId>, never admins or roommates. The event is a refresh hint; HTTP remains authoritative. StudentHome refetches on connect/event/focus/visible and every 30 seconds, aborts superseded requests, and removes listeners, timers and socket on unmount. CREDIT_UPDATED may use tenantId=0 for an applicant without a Tenant; it grants no rights or payment status by itself.

Login replacement disconnects owner-room sockets with a sessionVersion lower than the newly committed version. It must preserve a newer concurrent session. Connection rechecks authentication after joining to cover a rotation during the handshake. Reconnecting an old token is rejected; logout/password revocation retain the existing all-session disconnect policy.

Before disconnecting replaced sockets, emit sessionReplaced { reason: "SESSION_REPLACED" } only to the affected socket. The shared client dispatches auth:expired with that reason; AuthProvider clears local authentication and shows one persistent session dialog. Expired/revoked HTTP sessions use generic distinct wording when no explicit replacement event is available.
